/**
 * Invariant I4 — unknown parser, filter, or structure state yields NOT VERIFIED.
 *
 * Encoding under attack: `src/findings/verdict.ts` — the green variant's `unknowns`
 * field is the empty tuple type `readonly []`, and `deriveVerdict` returns NOT VERIFIED
 * before considering anything else whenever an unknown state is present.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { deriveVerdict, type Verdict } from '../../src/findings/verdict.js';
import { sha256Hex } from '../../src/pdf/parser/digest.js';
import {
  attackOutcomeArbitrary,
  passingAttackOutcomeArbitrary,
  unknownStateArbitrary,
} from '../support/domain-arbitraries.js';

const SEED = 2_026_08_14;
const DIGEST = sha256Hex(new Uint8Array([9, 9, 9]));

function isGreen(verdict: Verdict): boolean {
  return verdict.status === 'verified-within-scope';
}

describe('I4 — unknown state yields NOT VERIFIED', () => {
  it('property i4-unknown-forces-not-verified: any unknown state makes green unreachable (4000 cases)', () => {
    fc.assert(
      fc.property(
        fc.array(passingAttackOutcomeArbitrary, { minLength: 1, maxLength: 13 }),
        fc.array(unknownStateArbitrary, { minLength: 1, maxLength: 6 }),
        (attacks, unknowns) => {
          const verdict = deriveVerdict({ attacks, unknowns, emittedBytesSha256: DIGEST });
          expect(verdict.status).toBe('not-verified');
          expect(isGreen(verdict)).toBe(false);
          if (verdict.status === 'not-verified') {
            expect(verdict.reason).toBe('unknown-structure');
            expect(verdict.unknowns).toHaveLength(unknowns.length);
          }
        },
      ),
      { numRuns: 4_000, seed: SEED },
    );
  });

  it('property i4-green-requires-all-conditions: green exactly matches its stated preconditions (4000 cases)', () => {
    fc.assert(
      fc.property(
        fc.array(attackOutcomeArbitrary, { maxLength: 13 }),
        fc.array(unknownStateArbitrary, { maxLength: 4 }),
        fc.oneof(fc.constant(DIGEST), fc.string({ maxLength: 8 })),
        (attacks, unknowns, digest) => {
          const verdict = deriveVerdict({ attacks, unknowns, emittedBytesSha256: digest });
          const everyAttackPassed =
            attacks.length > 0 &&
            attacks.every((attack) => attack.status === 'passed' && attack.residualCount === 0);
          const expectGreen = unknowns.length === 0 && everyAttackPassed && digest === DIGEST;
          expect(isGreen(verdict)).toBe(expectGreen);
        },
      ),
      { numRuns: 4_000, seed: SEED + 1 },
    );
  });

  it('property i4-not-run-and-errored-are-failures-not-skips: neither can be green (3000 cases)', () => {
    fc.assert(
      fc.property(
        fc.array(passingAttackOutcomeArbitrary, { minLength: 1, maxLength: 8 }),
        fc.constantFrom('not-run' as const, 'errored' as const),
        (passed, blockingStatus) => {
          const blocking = {
            schemaVersion: 1 as const,
            attackId: 'ocr-of-rendered-pages' as const,
            status: blockingStatus,
            residualCount: 0,
          };
          const verdict = deriveVerdict({
            attacks: [...passed, blocking],
            unknowns: [],
            emittedBytesSha256: DIGEST,
          });
          expect(verdict.status).toBe('not-verified');
          if (verdict.status === 'not-verified') {
            expect(verdict.reason).toBe(
              blockingStatus === 'errored' ? 'attack-errored' : 'attack-not-run',
            );
          }
        },
      ),
      { numRuns: 3_000, seed: SEED + 2 },
    );
  });

  it('property i4-residual-is-a-confirmed-leak: a residual is never green and never merely unknown (3000 cases)', () => {
    fc.assert(
      fc.property(
        fc.array(passingAttackOutcomeArbitrary, { maxLength: 8 }),
        fc.integer({ min: 1, max: 500 }),
        (passed, residualCount) => {
          const verdict = deriveVerdict({
            attacks: [
              ...passed,
              {
                schemaVersion: 1,
                attackId: 'raw-byte-grep',
                status: 'passed',
                residualCount,
              },
            ],
            unknowns: [],
            emittedBytesSha256: DIGEST,
          });
          expect(verdict.status).toBe('leak-confirmed');
        },
      ),
      { numRuns: 3_000, seed: SEED + 3 },
    );
  });

  it('property i4-no-attacks-is-not-green: an empty attack list can never be green (2000 cases)', () => {
    fc.assert(
      fc.property(fc.constant(0), () => {
        const verdict = deriveVerdict({ attacks: [], unknowns: [], emittedBytesSha256: DIGEST });
        expect(verdict.status).toBe('not-verified');
        if (verdict.status === 'not-verified') {
          expect(verdict.reason).toBe('no-attacks-declared');
        }
      }),
      { numRuns: 2_000, seed: SEED + 4 },
    );
  });
});
