/**
 * Invariant I7 — a green result names exactly which attacks passed and never implies
 * universal safety.
 *
 * Encoding under attack: `src/findings/verdict.ts` — the green variant requires
 * non-empty `attacksPassed` and non-empty `notCovered` tuples, `STANDING_LIMITATIONS`
 * is merged into every scope, and `summarizeVerdict` renders both.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { surfacesCoveredBy } from '../../src/findings/leak-classes.js';
import {
  bannedSafetyPhrasesIn,
  deriveVerdict,
  STANDING_LIMITATIONS,
  summarizeVerdict,
} from '../../src/findings/verdict.js';
import { sha256Hex } from '../../src/pdf/parser/digest.js';
import { passingAttackOutcomeArbitrary } from '../support/domain-arbitraries.js';

const SEED = 2_026_08_17;
const DIGEST = sha256Hex(new Uint8Array([7, 7, 7]));

describe('I7 — a green result names its attacks and states what it does not cover', () => {
  it('property i7-green-names-every-attack: the summary enumerates each passed attack (4000 cases)', () => {
    fc.assert(
      fc.property(
        fc.array(passingAttackOutcomeArbitrary, { minLength: 1, maxLength: 13 }),
        (attacks) => {
          const verdict = deriveVerdict({ attacks, unknowns: [], emittedBytesSha256: DIGEST });
          expect(verdict.status).toBe('verified-within-scope');
          if (verdict.status !== 'verified-within-scope') return;

          const summary = summarizeVerdict(verdict);
          const declared = new Set(attacks.map((attack) => attack.attackId));
          for (const attackId of declared) {
            expect(summary).toContain(attackId);
            expect(verdict.scope.attacksPassed).toContain(attackId);
          }
          // The scope never claims an attack that was not run.
          for (const claimed of verdict.scope.attacksPassed) {
            expect(declared.has(claimed)).toBe(true);
          }
        },
      ),
      { numRuns: 4_000, seed: SEED },
    );
  });

  it('property i7-scope-surfaces-match-attacks: surfaces are exactly those the attacks read (3000 cases)', () => {
    fc.assert(
      fc.property(
        fc.array(passingAttackOutcomeArbitrary, { minLength: 1, maxLength: 13 }),
        (attacks) => {
          const verdict = deriveVerdict({ attacks, unknowns: [], emittedBytesSha256: DIGEST });
          if (verdict.status !== 'verified-within-scope') throw new Error('expected green');
          const expected = surfacesCoveredBy(attacks.map((attack) => attack.attackId));
          expect(
            [...verdict.scope.surfacesCovered].sort((a, b) => a.localeCompare(b)),
          ).toStrictEqual([...expected].sort((a, b) => a.localeCompare(b)));
        },
      ),
      { numRuns: 3_000, seed: SEED + 1 },
    );
  });

  it('property i7-never-universal: no verdict summary contains a universal-safety phrase (4000 cases)', () => {
    fc.assert(
      fc.property(
        fc.array(passingAttackOutcomeArbitrary, { minLength: 1, maxLength: 13 }),
        (attacks) => {
          const verdict = deriveVerdict({ attacks, unknowns: [], emittedBytesSha256: DIGEST });
          const summary = summarizeVerdict(verdict);
          expect(bannedSafetyPhrasesIn(summary)).toStrictEqual([]);
          expect(summary.toLowerCase()).not.toContain('is safe');
          if (verdict.status === 'verified-within-scope') {
            expect(verdict.scope.notCovered.length).toBeGreaterThanOrEqual(
              STANDING_LIMITATIONS.length,
            );
            for (const limitation of STANDING_LIMITATIONS) {
              expect(summary).toContain(limitation.statement);
            }
          }
        },
      ),
      { numRuns: 4_000, seed: SEED + 2 },
    );
  });

  it('property i7-additional-limitations-are-additive: run-specific limits never displace the standing set (2000 cases)', () => {
    fc.assert(
      fc.property(
        fc.array(passingAttackOutcomeArbitrary, { minLength: 1, maxLength: 4 }),
        fc.array(
          fc.record({
            area: fc.string({ maxLength: 12 }),
            statement: fc.string({ maxLength: 40 }),
          }),
          { maxLength: 4 },
        ),
        (attacks, extras) => {
          const additionalLimitations = extras.map((extra) =>
            Object.freeze({ schemaVersion: 1 as const, ...extra }),
          );
          const verdict = deriveVerdict({
            attacks,
            unknowns: [],
            emittedBytesSha256: DIGEST,
            additionalLimitations,
          });
          if (verdict.status !== 'verified-within-scope') throw new Error('expected green');
          expect(verdict.scope.notCovered).toHaveLength(
            STANDING_LIMITATIONS.length + additionalLimitations.length,
          );
        },
      ),
      { numRuns: 2_000, seed: SEED + 3 },
    );
  });

  it('detects every banned safety phrase in candidate copy', () => {
    expect(bannedSafetyPhrasesIn('This file is Completely Safe to share.')).toStrictEqual([
      'completely safe',
    ]);
    expect(bannedSafetyPhrasesIn('No residuals were found by the listed attacks.')).toStrictEqual(
      [],
    );
  });

  it('renders non-green verdicts without a scope claim', () => {
    const notVerified = deriveVerdict({
      attacks: [],
      unknowns: [
        {
          schemaVersion: 1,
          code: 'PDF_FILTER_UNSUPPORTED',
          surface: 'decoded-streams',
          detail: 'object 7 0',
        },
      ],
      emittedBytesSha256: DIGEST,
    });
    expect(summarizeVerdict(notVerified)).toContain('NOT VERIFIED');
    expect(summarizeVerdict(notVerified)).toContain('PDF_FILTER_UNSUPPORTED');
  });
});
