/**
 * Invariant I6 — verification reloads emitted bytes independently from sanitizer state.
 *
 * Encoding under attack: `src/verifier/independence.ts` — the verifier accepts only a
 * structured-clone-safe request, re-derives the digest of the bytes it actually
 * received, and refuses any live object at any depth. The module boundary in
 * `scripts/check-boundaries.mjs` separately forbids `src/verifier` from importing
 * `src/sanitizer`.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { SensitiveNeedle } from '../../src/findings/sensitive.js';
import { sha256Hex } from '../../src/pdf/parser/digest.js';
import { FreshDocumentBytes } from '../../src/sanitizer/fresh-graph.js';
import { VerifierBoundaryError } from '../../src/verifier/errors.js';
import {
  acceptIndependentRequest,
  assertStructuredCloneSafe,
  buildIndependentRequest,
  type VerificationPolicyV1,
} from '../../src/verifier/independence.js';

const SEED = 2_026_08_16;

const POLICY: VerificationPolicyV1 = {
  schemaVersion: 1,
  attacks: ['raw-byte-grep', 'structural-object-graph-scan'],
  coverageThreshold: 0.98,
  deadlineMs: 30_000,
};

function freshDocument(bodyLength: number): Uint8Array {
  const body = 'A'.repeat(bodyLength);
  const text =
    `%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% ${body}\nxref\n0 2\n` +
    `0000000000 65535 f \n0000000009 00000 n \ntrailer\n<< /Size 2 /Root 1 0 R >>\n` +
    `startxref\n120\n%%EOF\n`;
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
}

/** Live values the sanitizer could accidentally hand over. None may cross the boundary. */
const liveValueArbitrary = fc.oneof(
  fc.constant(() => 'sanitizer-callback'),
  fc.constant(new Date(0)),
  fc.constant(new Map<string, string>([['a', 'b']])),
  fc.constant(new Set<string>(['a'])),
  fc.constant(Symbol('sanitizer')),
  fc.constant(FreshDocumentBytes.seal(freshDocument(8))),
  fc.constant(SensitiveNeedle.adopt('token-1', 'abc')),
);

describe('I6 — verification is independent of sanitizer state', () => {
  it('property i6-live-values-refused: a live object at any depth is refused (3000 cases)', () => {
    fc.assert(
      fc.property(
        liveValueArbitrary,
        fc.nat({ max: 10 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        (live, depth, key) => {
          let payload: unknown = live;
          for (let level = 0; level < depth; level += 1) {
            payload = level % 2 === 0 ? [payload] : { [`${key}${String(level)}`]: payload };
          }
          expect(() => {
            assertStructuredCloneSafe(payload);
          }).toThrow(VerifierBoundaryError);
        },
      ),
      { numRuns: 3_000, seed: SEED },
    );
  });

  it('property i6-plain-data-accepted: plain JSON-shaped data and byte arrays pass (3000 cases)', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(() => {
          assertStructuredCloneSafe(value);
        }).not.toThrow();
      }),
      { numRuns: 3_000, seed: SEED + 1 },
    );
  });

  it('property i6-digest-is-rederived: the worker recomputes the digest of the bytes it received (2500 cases)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 120 }), (bodyLength) => {
        const bytes = freshDocument(bodyLength);
        const request = buildIndependentRequest({
          requestId: 'request-1',
          emittedBytes: bytes,
          policy: POLICY,
          needles: [SensitiveNeedle.adopt('token-1', 'abc').toChannelPayload()],
        });
        expect(request.emittedBytesSha256).toBe(sha256Hex(bytes));
        const accepted = acceptIndependentRequest(request);
        expect(accepted.emittedBytesSha256).toBe(sha256Hex(bytes));
        expect(Array.from(accepted.emittedBytes)).toStrictEqual(Array.from(bytes));
      }),
      { numRuns: 2_500, seed: SEED + 2 },
    );
  });

  it('property i6-announced-digest-cannot-lie: a mismatched digest refuses the whole run (2500 cases)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 80 }),
        fc.integer({ min: 1, max: 80 }),
        (bodyLength, otherLength) => {
          fc.pre(bodyLength !== otherLength);
          const bytes = freshDocument(bodyLength);
          const request = buildIndependentRequest({
            requestId: 'request-1',
            emittedBytes: bytes,
            policy: POLICY,
            needles: [],
          });
          const tampered = {
            ...request,
            emittedBytesSha256: sha256Hex(freshDocument(otherLength)),
          };
          expect(() => acceptIndependentRequest(tampered)).toThrow(VerifierBoundaryError);
          try {
            acceptIndependentRequest(tampered);
          } catch (error: unknown) {
            expect((error as VerifierBoundaryError).code).toBe('VERIFIER_BYTES_DIGEST_MISMATCH');
          }
        },
      ),
      { numRuns: 2_500, seed: SEED + 3 },
    );
  });

  it('property i6-sanitizer-handle-cannot-cross: a sealed sanitizer result is never an acceptable request (2000 cases)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), (bodyLength) => {
        const sealed = FreshDocumentBytes.seal(freshDocument(bodyLength));
        expect(() =>
          acceptIndependentRequest({
            schemaVersion: 1,
            requestId: 'request-1',
            emittedBytes: sealed,
            emittedBytesSha256: sealed.sha256,
            policy: POLICY,
            needles: [],
          }),
        ).toThrow(VerifierBoundaryError);
      }),
      { numRuns: 2_000, seed: SEED + 4 },
    );
  });

  it('refuses an accessor-backed request field, a symbol key, and an unknown attack', () => {
    const withAccessor = {};
    Object.defineProperty(withAccessor, 'emittedBytes', {
      enumerable: true,
      get: () => new Uint8Array([1]),
    });
    expect(() => {
      assertStructuredCloneSafe(withAccessor);
    }).toThrow(/accessor/u);

    const withSymbolKey = { [Symbol('k')]: 1 };
    expect(() => {
      assertStructuredCloneSafe(withSymbolKey);
    }).toThrow(/symbol-key/u);

    expect(() =>
      buildIndependentRequest({
        requestId: 'request-1',
        emittedBytes: freshDocument(4),
        policy: { ...POLICY, attacks: ['not-an-attack'] } as unknown as VerificationPolicyV1,
        needles: [],
      }),
    ).toThrow(VerifierBoundaryError);
  });
});
