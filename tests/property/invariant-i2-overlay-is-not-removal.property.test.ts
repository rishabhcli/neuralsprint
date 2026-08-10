/**
 * Invariant I2 — a visual overlay is never treated as removal.
 *
 * Encoding under attack:
 * - `src/pdf/interpreter/coverage.ts` — `ContentPresence` has no "absent" member and
 *   `presenceFromVisibility` is total over `TextVisibility`.
 * - `src/findings/removal.ts` — `ResolvedFinding` is nominal and reachable only through
 *   `resolveFinding`, which requires an `IndependentAbsenceProof` covering every surface
 *   the leak class declares.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { FindingsBoundaryError } from '../../src/findings/errors.js';
import { LEAK_CLASS_REQUIRED_SURFACES, type LeakClass } from '../../src/findings/leak-classes.js';
import { maskSecret } from '../../src/findings/masking.js';
import {
  IndependentAbsenceProof,
  resolveFinding,
  type Finding,
} from '../../src/findings/removal.js';
import {
  CONTENT_PRESENCE,
  classifyTextVisibility,
  looksLikeFakeRedaction,
  presenceFromVisibility,
} from '../../src/pdf/interpreter/coverage.js';
import { sha256Hex } from '../../src/pdf/parser/digest.js';
import { rectangleArbitrary, textVisibilityArbitrary } from '../support/domain-arbitraries.js';

const SEED = 2_026_08_12;
const DIGEST = sha256Hex(new Uint8Array([1, 2, 3]));

function coveredTextFinding(): Finding {
  return Object.freeze({
    schemaVersion: 1 as const,
    findingId: 'finding-1',
    leakClass: 'covered-selectable-text' as const,
    presence: 'present-but-not-painted' as const,
    evidence: maskSecret('000-00-0000'),
    locator: Object.freeze({
      schemaVersion: 1 as const,
      pageIndex: 0,
      objectNumber: 4,
      surface: 'decoded-streams' as const,
    }),
    needleId: 'token-1',
  });
}

describe('I2 — a visual overlay is never treated as removal', () => {
  it('property i2-presence-is-never-absent: no visibility maps to removal (4000 cases)', () => {
    fc.assert(
      fc.property(textVisibilityArbitrary, (visibility) => {
        const presence = presenceFromVisibility(visibility);
        expect(CONTENT_PRESENCE).toContain(presence);
        expect(presence).not.toBe('absent-from-object-graph');
        expect(presence).not.toBe('removed');
        expect(presence.startsWith('present')).toBe(true);
      }),
      { numRuns: 4_000, seed: SEED },
    );
  });

  it('property i2-full-cover-is-still-present: fully occluded text stays present (3000 cases)', () => {
    fc.assert(
      fc.property(rectangleArbitrary, fc.nat({ max: 100 }), (bounds, paintIndex) => {
        const visibility = classifyTextVisibility({
          run: { paintIndex, boundsPoints: bounds },
          occluders: [
            {
              paintIndex: paintIndex + 1,
              alpha: 1,
              boundsPoints: {
                x0Points: bounds.x0Points - 10,
                y0Points: bounds.y0Points - 10,
                x1Points: bounds.x1Points + 10,
                y1Points: bounds.y1Points + 10,
              },
            },
          ],
          clippedOut: false,
          textRenderMode: 0,
          inHiddenOptionalContent: false,
          coverageThreshold: 0.98,
        });
        expect(visibility.kind).toBe('covered-by-later-opaque-paint');
        expect(visibility.coveredFraction).toBeCloseTo(1, 9);
        expect(presenceFromVisibility(visibility)).toBe('present-but-not-painted');
        expect(looksLikeFakeRedaction(visibility)).toBe(true);
      }),
      { numRuns: 3_000, seed: SEED + 1 },
    );
  });

  it('property i2-earlier-paint-cannot-hide: paint before the run never counts as cover (2000 cases)', () => {
    fc.assert(
      fc.property(rectangleArbitrary, fc.integer({ min: 1, max: 100 }), (bounds, paintIndex) => {
        const visibility = classifyTextVisibility({
          run: { paintIndex, boundsPoints: bounds },
          occluders: [{ paintIndex: paintIndex - 1, alpha: 1, boundsPoints: bounds }],
          clippedOut: false,
          textRenderMode: 0,
          inHiddenOptionalContent: false,
          coverageThreshold: 0.5,
        });
        expect(visibility.coveredFraction).toBe(0);
        expect(visibility.kind).toBe('painted-visible');
      }),
      { numRuns: 2_000, seed: SEED + 2 },
    );
  });

  it('property i2-overlay-never-resolves: an incomplete proof can never resolve a covered-text finding (2000 cases)', () => {
    const required = LEAK_CLASS_REQUIRED_SURFACES['covered-selectable-text'];
    fc.assert(
      fc.property(
        fc.subarray([...required], { maxLength: required.length - 1 }),
        (partialSurfaces) => {
          const observations = partialSurfaces.map((surface) => ({
            schemaVersion: 1 as const,
            attackId: 'structural-object-graph-scan' as const,
            surface,
            residualCount: 0,
            reloadedFromEmittedBytes: true as const,
            sharedSanitizerState: false as const,
            emittedBytesSha256: DIGEST,
          }));
          if (observations.length === 0) {
            expect(() => IndependentAbsenceProof.mint(observations)).toThrow(FindingsBoundaryError);
            return;
          }
          const proof = IndependentAbsenceProof.mint(observations);
          expect(() => resolveFinding(coveredTextFinding(), proof)).toThrow(FindingsBoundaryError);
        },
      ),
      { numRuns: 2_000, seed: SEED + 3 },
    );
  });

  it('property i2-residual-blocks-proof: any residual makes an absence proof unmintable (2000 cases)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000 }), (residualCount) => {
        expect(() =>
          IndependentAbsenceProof.mint([
            {
              schemaVersion: 1,
              attackId: 'raw-byte-grep',
              surface: 'raw-bytes',
              residualCount,
              reloadedFromEmittedBytes: true,
              sharedSanitizerState: false,
              emittedBytesSha256: DIGEST,
            },
          ]),
        ).toThrow(FindingsBoundaryError);
      }),
      { numRuns: 2_000, seed: SEED + 4 },
    );
  });

  it('refuses an absence proof that reused sanitizer state or was not reloaded', () => {
    const base = {
      schemaVersion: 1 as const,
      attackId: 'raw-byte-grep' as const,
      surface: 'raw-bytes' as const,
      residualCount: 0,
      reloadedFromEmittedBytes: true,
      sharedSanitizerState: false,
      emittedBytesSha256: DIGEST,
    };
    expect(() =>
      IndependentAbsenceProof.mint([{ ...base, reloadedFromEmittedBytes: false }]),
    ).toThrow(/not-reloaded/u);
    expect(() => IndependentAbsenceProof.mint([{ ...base, sharedSanitizerState: true }])).toThrow(
      /shared-sanitizer-state/u,
    );
  });

  it('resolves only when every required surface was independently observed', () => {
    const leakClass: LeakClass = 'covered-selectable-text';
    const observations = LEAK_CLASS_REQUIRED_SURFACES[leakClass].map((surface) => ({
      schemaVersion: 1 as const,
      attackId: attackForSurface(surface),
      surface,
      residualCount: 0,
      reloadedFromEmittedBytes: true as const,
      sharedSanitizerState: false as const,
      emittedBytesSha256: DIGEST,
    }));
    const proof = IndependentAbsenceProof.mint(observations);
    const resolved = resolveFinding(coveredTextFinding(), proof);
    expect(resolved.proof.emittedBytesSha256).toBe(DIGEST);
    expect(resolved.toJSON().surfacesCovered.length).toBeGreaterThan(0);
  });
});

function attackForSurface(
  surface: (typeof LEAK_CLASS_REQUIRED_SURFACES)['covered-selectable-text'][number],
) {
  switch (surface) {
    case 'object-graph':
      return 'structural-object-graph-scan' as const;
    case 'decoded-streams':
      return 'decoded-stream-byte-grep' as const;
    case 'raw-bytes':
      return 'raw-byte-grep' as const;
    case 'text-extraction':
      return 'text-extraction-scan' as const;
    default:
      return 'incremental-revision-scan' as const;
  }
}
