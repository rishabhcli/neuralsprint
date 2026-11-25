/**
 * Parser robustness and round-trip properties for the PDF syntax layer.
 *
 * `GOAL.md` Tier 7 layer 2 requires serialization round-trips and parser robustness as
 * property tests. Both are here, and the robustness property is the one that matters
 * most for this project: a forensic tool is handed hostile files by definition, so the
 * only acceptable outcomes on arbitrary bytes are a parse or a typed refusal — never a
 * hang, never a host-level crash, and never a value the caller cannot classify.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { PdfLexer } from '../../src/pdf/parser/lexer.js';
import {
  budgetsFromLimits,
  parseIndirectObjectAt,
  parseObjectAt,
} from '../../src/pdf/parser/object-parser.js';
import { PdfBoundaryError } from '../../src/pdf/parser/errors.js';
import { DEFAULT_DOCUMENT_LIMITS } from '../../src/pdf/parser/limits.js';
import { DeviceLocalBytes } from '../../src/pdf/parser/device-local-bytes.js';
import {
  adoptSource,
  pdfObjectArbitrary,
  serializeIndirectObject,
  serializePdfObject,
} from '../support/pdf-syntax.js';

const SEED = 2_026_08_18;

describe('PDF syntax round-trip', () => {
  it('property pdf-object-round-trip: every object survives write then read (3000 cases)', () => {
    fc.assert(
      fc.property(pdfObjectArbitrary, (object) => {
        const source = serializePdfObject(object);
        const parsed = parseObjectAt(adoptSource(source), 0);
        expect(parsed.object).toStrictEqual(object);
      }),
      { numRuns: 3_000, seed: SEED },
    );
  });

  it('property pdf-indirect-round-trip: an indirect wrapper survives too (2000 cases)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 65_535 }),
        pdfObjectArbitrary,
        (objectNumber, generation, object) => {
          const source = serializeIndirectObject(
            objectNumber,
            generation,
            serializePdfObject(object),
          );
          const parsed = parseIndirectObjectAt(adoptSource(source), 0);
          expect(parsed.objectNumber).toBe(objectNumber);
          expect(parsed.generation).toBe(generation);
          expect(parsed.hadEndObject).toBe(true);
          expect(parsed.object).toStrictEqual(object);
        },
      ),
      { numRuns: 2_000, seed: SEED + 1 },
    );
  });

  it('property pdf-parse-is-deterministic: the same bytes always give the same tree (2000 cases)', () => {
    fc.assert(
      fc.property(pdfObjectArbitrary, (object) => {
        const bytes = adoptSource(serializePdfObject(object));
        expect(parseObjectAt(bytes, 0).object).toStrictEqual(parseObjectAt(bytes, 0).object);
      }),
      { numRuns: 2_000, seed: SEED + 2 },
    );
  });
});

describe('PDF syntax robustness against hostile bytes', () => {
  const arbitraryDocument = fc.uint8Array({ minLength: 1, maxLength: 512 });

  it('property pdf-lexer-never-crashes: arbitrary bytes tokenize or refuse typed (4000 cases)', () => {
    fc.assert(
      fc.property(arbitraryDocument, (raw) => {
        const bytes = DeviceLocalBytes.adopt('test-vector', raw, 1024 * 1024);
        const lexer = new PdfLexer(bytes);
        try {
          for (let step = 0; step < 4_096; step += 1) {
            const before = lexer.position;
            const token = lexer.next();
            if (token.kind === 'end-of-input') return;
            // Every token consumes at least one byte, so tokenization terminates.
            expect(lexer.position).toBeGreaterThan(before);
          }
          throw new Error('tokenization did not terminate within the byte budget');
        } catch (error: unknown) {
          expect(error).toBeInstanceOf(PdfBoundaryError);
          expect((error as PdfBoundaryError).code).toBe('PDF_STRUCTURE_AMBIGUOUS');
        }
      }),
      { numRuns: 4_000, seed: SEED + 3 },
    );
  });

  it('property pdf-parser-never-crashes: arbitrary bytes parse or refuse typed (4000 cases)', () => {
    fc.assert(
      fc.property(arbitraryDocument, (raw) => {
        const bytes = DeviceLocalBytes.adopt('test-vector', raw, 1024 * 1024);
        try {
          const parsed = parseObjectAt(bytes, 0);
          expect(parsed.endOffset).toBeGreaterThanOrEqual(0);
          expect(parsed.endOffset).toBeLessThanOrEqual(bytes.byteLength);
        } catch (error: unknown) {
          expect(error).toBeInstanceOf(PdfBoundaryError);
          expect([
            'PDF_STRUCTURE_AMBIGUOUS',
            'PDF_OBJECT_UNRESOLVABLE',
            'PDF_LIMIT_EXCEEDED',
          ]).toContain((error as PdfBoundaryError).code);
        }
      }),
      { numRuns: 4_000, seed: SEED + 4 },
    );
  });

  it('property pdf-nesting-is-bounded: deep nesting refuses rather than overflowing (1500 cases)', () => {
    const budgets = budgetsFromLimits({ ...DEFAULT_DOCUMENT_LIMITS, maximumResolutionDepth: 16 });
    fc.assert(
      fc.property(fc.integer({ min: 17, max: 400 }), (depth) => {
        const source = `${'['.repeat(depth)}1${']'.repeat(depth)}`;
        expect(() => parseObjectAt(adoptSource(source), 0, budgets)).toThrow(PdfBoundaryError);
        try {
          parseObjectAt(adoptSource(source), 0, budgets);
        } catch (error: unknown) {
          expect((error as PdfBoundaryError).code).toBe('PDF_LIMIT_EXCEEDED');
        }
      }),
      { numRuns: 1_500, seed: SEED + 5 },
    );
  });

  it('property pdf-collections-are-bounded: an oversized collection refuses (1500 cases)', () => {
    const budgets = budgetsFromLimits({ ...DEFAULT_DOCUMENT_LIMITS, maximumObjectCount: 8 });
    fc.assert(
      fc.property(fc.integer({ min: 9, max: 200 }), (count) => {
        const source = `[ ${Array.from({ length: count }, () => '1').join(' ')} ]`;
        expect(() => parseObjectAt(adoptSource(source), 0, budgets)).toThrow(/PDF_LIMIT_EXCEEDED/u);
      }),
      { numRuns: 1_500, seed: SEED + 6 },
    );
  });
});
