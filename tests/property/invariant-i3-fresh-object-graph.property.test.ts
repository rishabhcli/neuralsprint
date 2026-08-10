/**
 * Invariant I3 — output is written as a fresh object graph, never an incremental append.
 *
 * Encoding under attack: `src/sanitizer/fresh-graph.ts` — `FreshDocumentBytes` is
 * nominal with a private constructor, and `seal` audits the emitted bytes for the
 * structural signatures of an append before any sealed value exists.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { SanitizerBoundaryError } from '../../src/sanitizer/errors.js';
import {
  auditFreshObjectGraph,
  FreshDocumentBytes,
  sealFreshDocument,
} from '../../src/sanitizer/fresh-graph.js';

const SEED = 2_026_08_13;

function ascii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
}

/** A minimal single-revision document: one header, one xref, one trailer, one EOF. */
function singleRevisionDocument(bodyLength: number): Uint8Array {
  const body = 'A'.repeat(bodyLength);
  return ascii(
    `%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% ${body}\nxref\n0 2\n` +
      `0000000000 65535 f \n0000000009 00000 n \ntrailer\n<< /Size 2 /Root 1 0 R >>\n` +
      `startxref\n120\n%%EOF\n`,
  );
}

/** An appended revision, exactly as a naive "edit" would produce it. */
function appendedRevision(index: number): string {
  return (
    `2 0 obj\n<< /Type /Annot /N ${String(index)} >>\nendobj\n` +
    `xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 3 /Root 1 0 R /Prev 120 >>\n` +
    `startxref\n${String(400 + index)}\n%%EOF\n`
  );
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.byteLength;
  }
  return combined;
}

describe('I3 — output is a fresh object graph, never an incremental append', () => {
  it('property i3-append-always-refused: any appended revision is refused (3000 cases)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 64 }),
        fc.array(fc.nat({ max: 99 }), { minLength: 1, maxLength: 4 }),
        (bodyLength, revisionIndexes) => {
          const source = singleRevisionDocument(bodyLength);
          const appended = concat(
            source,
            ...revisionIndexes.map((index) => ascii(appendedRevision(index))),
          );
          expect(() => sealFreshDocument(appended, source)).toThrow(SanitizerBoundaryError);
          const audit = auditFreshObjectGraph(appended, source);
          expect(audit.passed).toBe(false);
          expect(audit.sourceIsPrefixOfOutput).toBe(true);
          expect(audit.startxrefCount).toBeGreaterThan(1);
          expect(audit.previousPointerCount).toBeGreaterThan(0);
        },
      ),
      { numRuns: 3_000, seed: SEED },
    );
  });

  it('property i3-previous-pointer-refused: any /Prev entry is refused even without a second xref (2500 cases)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4_000 }), (previousOffset) => {
        const emitted = ascii(
          `%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\n0 2\n` +
            `0000000000 65535 f \n0000000009 00000 n \n` +
            `trailer\n<< /Size 2 /Root 1 0 R /Prev ${String(previousOffset)} >>\n` +
            `startxref\n90\n%%EOF\n`,
        );
        expect(() => sealFreshDocument(emitted)).toThrow(SanitizerBoundaryError);
        expect(auditFreshObjectGraph(emitted).previousPointerCount).toBe(1);
      }),
      { numRuns: 2_500, seed: SEED + 1 },
    );
  });

  it('property i3-source-prefix-refused: emitted bytes may never begin with the source (2500 cases)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 40 }),
        fc.uint8Array({ minLength: 0, maxLength: 32 }),
        (bodyLength, tail) => {
          const source = singleRevisionDocument(bodyLength);
          const emitted = concat(source, tail);
          const audit = auditFreshObjectGraph(emitted, source);
          expect(audit.sourceIsPrefixOfOutput).toBe(true);
          expect(audit.passed).toBe(false);
          expect(() => FreshDocumentBytes.seal(emitted, source)).toThrow(SanitizerBoundaryError);
        },
      ),
      { numRuns: 2_500, seed: SEED + 2 },
    );
  });

  it('property i3-fresh-rebuild-seals: a single-revision rebuild seals and reports its own digest (2000 cases)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200 }), (bodyLength) => {
        const source = singleRevisionDocument(bodyLength);
        const rebuilt = singleRevisionDocument(bodyLength + 1);
        const sealed = FreshDocumentBytes.seal(rebuilt, source);
        expect(sealed.audit.passed).toBe(true);
        expect(sealed.audit.startxrefCount).toBe(1);
        expect(sealed.audit.endOfFileCount).toBe(1);
        expect(sealed.audit.previousPointerCount).toBe(0);
        expect(sealed.sha256).toMatch(/^[0-9a-f]{64}$/u);
        expect(Array.from(sealed.toBytes())).toStrictEqual(Array.from(rebuilt));
      }),
      { numRuns: 2_000, seed: SEED + 3 },
    );
  });

  it('property i3-sealed-bytes-are-copies: mutating a returned buffer cannot change the sealed document (1500 cases)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 64 }), fc.nat({ max: 255 }), (bodyLength, mutation) => {
        const sealed = FreshDocumentBytes.seal(singleRevisionDocument(bodyLength));
        const first = sealed.toBytes();
        const original = first[0] ?? 0;
        // XOR with a non-zero mask always changes the byte; adding a wrapping offset
        // could land back on the original value and make the assertion vacuous.
        first[0] = original ^ ((mutation % 255) + 1);
        expect(first[0]).not.toBe(original);
        expect(Array.from(sealed.toBytes())).not.toStrictEqual(Array.from(first));
        expect(sealed.toBytes()[0]).toBe(original);
      }),
      { numRuns: 1_500, seed: SEED + 4 },
    );
  });

  it('refuses output with no header and output with a duplicated header', () => {
    expect(() => sealFreshDocument(ascii('not a pdf at all'))).toThrow(
      /SANITIZER_OUTPUT_MALFORMED/u,
    );
    const doubled = concat(ascii('%PDF-1.7\n'), singleRevisionDocument(4));
    expect(() => sealFreshDocument(doubled)).toThrow(SanitizerBoundaryError);
  });
});
