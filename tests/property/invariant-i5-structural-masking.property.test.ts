/**
 * Invariant I5 — real secrets are masked in UI, logs, telemetry, screenshots, and
 * reports by default.
 *
 * Encoding under attack:
 * - `src/findings/masking.ts` — masking is a function of the character-class sequence
 *   alone, so no character of the secret survives.
 * - `src/findings/sensitive.ts` — `SensitiveNeedle` keeps the value in a `#private`
 *   field; `toJSON`, `toString` and the inspection hook all emit the mask; and
 *   `assertReportSafe` refuses a sensitive channel payload at any depth.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { FindingsBoundaryError } from '../../src/findings/errors.js';
import {
  classSkeleton,
  isClassAlphabetOnly,
  maskSecret,
  parseMaskedEvidence,
} from '../../src/findings/masking.js';
import { assertReportSafe, SensitiveNeedle } from '../../src/findings/sensitive.js';
import { classPreservingPairArbitrary } from '../support/domain-arbitraries.js';

const SEED = 2_026_08_15;

describe('I5 — secrets are masked structurally, not by best-effort replacement', () => {
  it('property i5-class-invariance: masking depends only on the character-class sequence (4000 cases)', () => {
    fc.assert(
      fc.property(classPreservingPairArbitrary, ([left, right]) => {
        expect(classSkeleton(left)).toBe(classSkeleton(right));
        expect(maskSecret(left)).toStrictEqual(maskSecret(right));
      }),
      { numRuns: 4_000, seed: SEED },
    );
  });

  it('property i5-mask-alphabet-only: masked evidence uses the class alphabet and nothing else (4000 cases)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 400 }), (secret) => {
        const masked = maskSecret(secret);
        expect(isClassAlphabetOnly(masked.classSkeleton)).toBe(true);
        expect(parseMaskedEvidence(masked)).toStrictEqual(masked);
      }),
      { numRuns: 4_000, seed: SEED + 1 },
    );
  });

  it('property i5-needle-never-serializes-its-value: no serialization path emits the secret (4000 cases)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 3, maxLength: 60 }).filter((value) => value.trim().length >= 3),
        (secret) => {
          const needle = SensitiveNeedle.adopt('token-1', secret);
          // Exact-shape assertion: a substring search would produce coincidental
          // collisions whenever the secret happens to contain JSON punctuation.
          expect(JSON.parse(JSON.stringify({ needle, nested: { needle } }))).toStrictEqual({
            needle: maskSecret(secret),
            nested: { needle: maskSecret(secret) },
          });
          expect(needle.toString()).toBe(
            `SensitiveNeedle(token-1: ${maskSecret(secret).classSkeleton})`,
          );
          expect(Object.keys(needle)).toStrictEqual(['needleId', 'masked']);
        },
      ),
      { numRuns: 4_000, seed: SEED + 2 },
    );
  });

  it('property i5-report-safety-at-any-depth: a sensitive payload is refused wherever it hides (3000 cases)', () => {
    fc.assert(
      fc.property(fc.nat({ max: 12 }), fc.string({ minLength: 1, maxLength: 12 }), (depth, key) => {
        const payload = SensitiveNeedle.adopt('token-1', 'secret-value').toChannelPayload();
        let report: unknown = payload;
        for (let level = 0; level < depth; level += 1) {
          report = level % 2 === 0 ? [report] : { [`${key}${String(level)}`]: report };
        }
        expect(() => {
          assertReportSafe(report);
        }).toThrow(FindingsBoundaryError);
      }),
      { numRuns: 3_000, seed: SEED + 3 },
    );
  });

  it('property i5-report-safety-accepts-masked-only: masked evidence passes the report gate (3000 cases)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 80 }), (secret) => {
        const needle = SensitiveNeedle.adopt('token-1', secret);
        expect(() => {
          assertReportSafe({
            schemaVersion: 1,
            findings: [{ needleId: needle.needleId, evidence: needle.masked }],
          });
        }).not.toThrow();
      }),
      { numRuns: 3_000, seed: SEED + 4 },
    );
  });

  it('property i5-byte-search-covers-real-encodings: the needle is found in every encoding it ships (2000 cases)', () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 2, maxLength: 24 })
          .filter(
            (value) =>
              value.length >= 2 &&
              Array.from(value).every(
                (character) =>
                  character.codePointAt(0) !== undefined && (character.codePointAt(0) ?? 0) < 0x80,
              ),
          ),
        (secret) => {
          const needle = SensitiveNeedle.adopt('token-1', secret);
          for (const form of needle.encodedForms()) {
            const haystack = new Uint8Array(form.byteLength + 8);
            haystack.set(form, 4);
            expect(needle.occurrencesInBytes(haystack)).toBeGreaterThanOrEqual(1);
          }
          expect(needle.occurrencesIn(`prefix ${secret} suffix`)).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: 2_000, seed: SEED + 5 },
    );
  });

  it('refuses a needle round-trip that was not tagged for the sensitive channel', () => {
    const payload = SensitiveNeedle.adopt('token-1', 'abc').toChannelPayload();
    expect(SensitiveNeedle.fromChannelPayload(payload).masked).toStrictEqual(maskSecret('abc'));
    expect(() =>
      SensitiveNeedle.fromChannelPayload({ ...payload, sensitiveChannel: false }),
    ).toThrow(FindingsBoundaryError);
    expect(() => SensitiveNeedle.adopt('Token 1', 'abc')).toThrow(FindingsBoundaryError);
    expect(() => SensitiveNeedle.adopt('token-1', '')).toThrow(FindingsBoundaryError);
  });

  it('refuses a report containing a function or a cycle', () => {
    expect(() => {
      assertReportSafe({ render: () => 'x' });
    }).toThrow(/function/u);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => {
      assertReportSafe(cyclic);
    }).toThrow(/cycle/u);
  });
});
