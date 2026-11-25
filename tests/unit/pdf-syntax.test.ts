import { describe, expect, it } from 'vitest';

import { DeviceLocalBytes } from '../../src/pdf/parser/device-local-bytes.js';
import { PdfBoundaryError } from '../../src/pdf/parser/errors.js';
import {
  PdfLexer,
  isPdfDelimiter,
  isPdfRegularCharacter,
  isPdfWhitespace,
} from '../../src/pdf/parser/lexer.js';
import { DEFAULT_DOCUMENT_LIMITS } from '../../src/pdf/parser/limits.js';
import {
  budgetsFromLimits,
  integerEntry,
  parseIndirectObjectAt,
  parseObjectAt,
} from '../../src/pdf/parser/object-parser.js';
import {
  asArray,
  assertObjectIdentifier,
  describeObject,
  dictionaryGet,
  isDictionaryLike,
  nameValue,
  numericValue,
  objectKey,
  pdfArray,
  pdfBoolean,
  pdfDictionary,
  pdfInteger,
  pdfName,
  pdfReal,
  pdfReference,
  pdfStream,
  pdfString,
  PDF_NULL,
  type PdfObject,
} from '../../src/pdf/parser/objects.js';
import { adoptSource } from '../support/pdf-syntax.js';

function tokenize(source: string): ReturnType<PdfLexer['next']>[] {
  const lexer = new PdfLexer(adoptSource(source));
  const tokens: ReturnType<PdfLexer['next']>[] = [];
  for (let step = 0; step < 200; step += 1) {
    const token = lexer.next();
    tokens.push(token);
    if (token.kind === 'end-of-input') break;
  }
  return tokens;
}

function parse(source: string): PdfObject {
  return parseObjectAt(adoptSource(source), 0).object;
}

describe('byte classification', () => {
  it('matches the specification’s white-space, delimiter and regular sets', () => {
    for (const byte of [0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]) {
      expect(isPdfWhitespace(byte)).toBe(true);
      expect(isPdfRegularCharacter(byte)).toBe(false);
    }
    for (const character of '()<>[]{}/%') {
      expect(isPdfDelimiter(character.charCodeAt(0))).toBe(true);
      expect(isPdfRegularCharacter(character.charCodeAt(0))).toBe(false);
    }
    expect(isPdfRegularCharacter('A'.charCodeAt(0))).toBe(true);
    expect(isPdfWhitespace(undefined)).toBe(false);
    expect(isPdfDelimiter(undefined)).toBe(false);
    expect(isPdfRegularCharacter(undefined)).toBe(false);
  });
});

describe('lexer', () => {
  it('skips white-space and comments, including a comment at the end of input', () => {
    expect(tokenize('  % a comment\n 42 % trailing').map((token) => token.kind)).toStrictEqual([
      'integer',
      'end-of-input',
    ]);
  });

  it('emits each structural token kind', () => {
    expect(tokenize('[ ] << >> { }').map((token) => token.kind)).toStrictEqual([
      'array-open',
      'array-close',
      'dictionary-open',
      'dictionary-close',
      'procedure-open',
      'procedure-close',
      'end-of-input',
    ]);
  });

  it('accepts the numeric forms the grammar allows and refuses the ambiguous ones', () => {
    expect(tokenize('+5')[0]?.numberValue).toBe(5);
    expect(tokenize('-5')[0]?.numberValue).toBe(-5);
    expect(tokenize('4.')[0]?.numberValue).toBe(4);
    expect(tokenize('4.')[0]?.kind).toBe('real');
    expect(tokenize('.002')[0]?.numberValue).toBeCloseTo(0.002, 12);
    expect(tokenize('34')[0]?.kind).toBe('integer');

    expect(() => tokenize('--5')).toThrow(/sign-inside-number/u);
    expect(() => tokenize('1.2.3')).toThrow(/second-decimal-point/u);
    expect(() => tokenize('1a')).toThrow(/non-numeric-character-in-number/u);
    expect(() => tokenize('.')).toThrow(/number-without-digits/u);
  });

  it('resolves name escapes and refuses an incomplete one', () => {
    expect(tokenize('/Name#20With#20Spaces')[0]?.text).toBe('Name With Spaces');
    expect(tokenize('/A#42')[0]?.text).toBe('AB');
    expect(tokenize('/')[0]?.text).toBe('');
    expect(() => tokenize('/Bad#4')).toThrow(/incomplete-name-escape/u);
    expect(() => tokenize('/Bad#zz')).toThrow(/incomplete-name-escape/u);
  });

  it('applies every literal-string escape the specification defines', () => {
    const token = tokenize('(a\\nb\\rc\\td\\be\\ff\\(g\\)h\\\\i\\101j\\1k)')[0];
    expect(Array.from(token?.bytes ?? [])).toStrictEqual(
      Array.from(
        Uint8Array.from([
          0x61, 0x0a, 0x62, 0x0d, 0x63, 0x09, 0x64, 0x08, 0x65, 0x0c, 0x66, 0x28, 0x67, 0x29, 0x68,
          0x5c, 0x69, 0x41, 0x6a, 0x01, 0x6b,
        ]),
      ),
    );
  });

  it('keeps balanced parentheses inside a literal string', () => {
    const token = tokenize('(outer (inner) tail)')[0];
    expect(String.fromCharCode(...(token?.bytes ?? []))).toBe('outer (inner) tail');
  });

  it('normalizes raw line endings and honours line continuations', () => {
    expect(String.fromCharCode(...(tokenize('(a\r\nb)')[0]?.bytes ?? []))).toBe('a\nb');
    expect(String.fromCharCode(...(tokenize('(a\rb)')[0]?.bytes ?? []))).toBe('a\nb');
    expect(String.fromCharCode(...(tokenize('(a\\\r\nb)')[0]?.bytes ?? []))).toBe('ab');
    expect(String.fromCharCode(...(tokenize('(a\\\nb)')[0]?.bytes ?? []))).toBe('ab');
    expect(String.fromCharCode(...(tokenize('(a\\qb)')[0]?.bytes ?? []))).toBe('aqb');
  });

  it('pads an odd hexadecimal string and ignores white-space inside it', () => {
    expect(Array.from(tokenize('<48 65 6C 6C 6F>')[0]?.bytes ?? [])).toStrictEqual([
      0x48, 0x65, 0x6c, 0x6c, 0x6f,
    ]);
    expect(Array.from(tokenize('<4>')[0]?.bytes ?? [])).toStrictEqual([0x40]);
    expect(Array.from(tokenize('<>')[0]?.bytes ?? [])).toStrictEqual([]);
  });

  it('refuses every unterminated or malformed string', () => {
    expect(() => tokenize('(unterminated')).toThrow(/unterminated-literal-string/u);
    expect(() => tokenize('<4142')).toThrow(/unterminated-hexadecimal-string/u);
    expect(() => tokenize('<zz>')).toThrow(/non-hexadecimal-digit-in-string/u);
    expect(() => tokenize(')')).toThrow(/unmatched-close-parenthesis/u);
    expect(() => tokenize('>')).toThrow(/unmatched-angle-bracket/u);
    expect(() => tokenize('}{')).not.toThrow();
  });

  it('validates its own window and seek target', () => {
    const bytes = adoptSource('12 0 obj');
    expect(() => new PdfLexer(bytes, -1)).toThrow(/lexer.start/u);
    expect(() => new PdfLexer(bytes, 0, bytes.byteLength + 1)).toThrow(/lexer.limit/u);
    expect(() => new PdfLexer(bytes, 5, 2)).toThrow(/lexer.limit/u);
    const lexer = new PdfLexer(bytes);
    expect(() => {
      lexer.seek(999);
    }).toThrow(/lexer.seek/u);
    lexer.seek(3);
    expect(lexer.next().numberValue).toBe(0);
  });

  it('stops at an explicit limit rather than reading past it', () => {
    const lexer = new PdfLexer(adoptSource('11 22'), 0, 2);
    expect(lexer.next().numberValue).toBe(11);
    expect(lexer.next().kind).toBe('end-of-input');
  });
});

describe('object parser', () => {
  it('parses each direct object kind', () => {
    expect(parse('null')).toStrictEqual(PDF_NULL);
    expect(parse('true')).toStrictEqual(pdfBoolean(true));
    expect(parse('false')).toStrictEqual(pdfBoolean(false));
    expect(parse('7')).toStrictEqual(pdfInteger(7));
    expect(parse('7.5')).toStrictEqual(pdfReal(7.5));
    expect(parse('/Type')).toStrictEqual(pdfName('Type'));
    expect(parse('(hi)')).toStrictEqual(pdfString(Uint8Array.from([0x68, 0x69]), 'literal'));
    expect(parse('<6869>')).toStrictEqual(pdfString(Uint8Array.from([0x68, 0x69]), 'hexadecimal'));
    expect(parse('[1 /A]')).toStrictEqual(pdfArray([pdfInteger(1), pdfName('A')]));
    expect(parse('<< /A 1 >>')).toStrictEqual(pdfDictionary(new Map([['A', pdfInteger(1)]])));
  });

  it('distinguishes a reference from adjacent integers without consuming them', () => {
    expect(parse('12 0 R')).toStrictEqual(pdfReference(12, 0));
    expect(parse('[12 0 R 5]')).toStrictEqual(pdfArray([pdfReference(12, 0), pdfInteger(5)]));
    expect(parse('[12 0 5]')).toStrictEqual(
      pdfArray([pdfInteger(12), pdfInteger(0), pdfInteger(5)]),
    );
    // A negative generation or object number cannot form a reference, so the trailing
    // `R` is left as a bare keyword and the array is refused rather than guessed at.
    expect(() => parse('[12 -1 R]')).toThrow(/unexpected-keyword/u);
    expect(() => parse('[-3 0 R]')).toThrow(/unexpected-keyword/u);
  });

  it('recovers the cursor when a reference lookahead hits malformed bytes', () => {
    // The lookahead throws on ; the cursor must return to just after  so the
    // integer is still reported and the caller decides what the trailing bytes mean.
    const parsed = parseObjectAt(adoptSource('12 1.2.3'), 0);
    expect(parsed.object).toStrictEqual(pdfInteger(12));
    expect(parsed.endOffset).toBe(2);
  });

  it('refuses a duplicate dictionary key rather than choosing a winner', () => {
    expect(() => parse('<< /A 1 /A 2 >>')).toThrow(/duplicate-dictionary-key/u);
  });

  it('refuses malformed collections', () => {
    expect(() => parse('[1 2')).toThrow(/unterminated-array/u);
    expect(() => parse('<< /A 1')).toThrow(/unterminated-dictionary/u);
    expect(() => parse('<< 1 2 >>')).toThrow(/dictionary-key-is-not-a-name/u);
    expect(() => parse('obj')).toThrow(/unexpected-keyword/u);
    expect(() => parse('   ')).toThrow(/unexpected-end-of-input/u);
    expect(() => parse(']')).toThrow(/unexpected-token-array-close/u);
  });

  it('parses an indirect object and reports a missing endobj instead of failing', () => {
    const withTerminator = parseIndirectObjectAt(adoptSource('4 0 obj\n<< /A 1 >>\nendobj\n'), 0);
    expect(withTerminator.objectNumber).toBe(4);
    expect(withTerminator.hadEndObject).toBe(true);

    const withoutTerminator = parseIndirectObjectAt(adoptSource('4 0 obj\n<< /A 1 >>\n'), 0);
    expect(withoutTerminator.hadEndObject).toBe(false);
    expect(withoutTerminator.endOffset).toBe(18);
  });

  it('refuses a header that is not an indirect object', () => {
    expect(() => parseIndirectObjectAt(adoptSource('<< /A 1 >>'), 0)).toThrow(
      /not-an-indirect-object-header/u,
    );
    expect(() => parseIndirectObjectAt(adoptSource('4 0 xxx\n1\n'), 0)).toThrow(
      /not-an-indirect-object-header/u,
    );
    expect(() => parseIndirectObjectAt(adoptSource('4 70000 obj\n1\nendobj'), 0)).toThrow(
      /generation-out-of-range/u,
    );
  });
});

describe('stream extent and declared length', () => {
  const payload = 'HIDDEN-PAYLOAD';

  function streamSource(declared: string): string {
    return `<< ${declared} >>\nstream\n${payload}\nendstream\n`;
  }

  it('reports agreement when the declared length matches the scan', () => {
    const object = parse(streamSource(`/Length ${String(payload.length)}`));
    expect(object.kind).toBe('stream');
    if (object.kind !== 'stream') return;
    expect(object.lengthAgreement).toBe('agrees');
    expect(object.declaredLength).toBe(payload.length);
    expect(object.rawRange.end - object.rawRange.start).toBe(payload.length);
  });

  it('keeps the larger extent when a short declared length would hide bytes', () => {
    const object = parse(streamSource('/Length 4'));
    expect(object.kind).toBe('stream');
    if (object.kind !== 'stream') return;
    expect(object.lengthAgreement).toBe('declared-differs-from-scan');
    expect(object.declaredLength).toBe(4);
    // The scan wins: the bytes a trusting viewer would skip are still in the range.
    expect(object.rawRange.end - object.rawRange.start).toBe(payload.length);
  });

  it('keeps the larger extent when an over-long declared length runs past endstream', () => {
    const object = parse(streamSource('/Length 40'));
    expect(object.kind).toBe('stream');
    if (object.kind !== 'stream') return;
    expect(object.lengthAgreement).toBe('declared-differs-from-scan');
    expect(object.rawRange.end - object.rawRange.start).toBeGreaterThan(payload.length);
  });

  it('reports a missing length and an unresolved indirect length distinctly', () => {
    const missing = parse(streamSource('/Type /Thing'));
    expect(missing.kind === 'stream' && missing.lengthAgreement).toBe('declared-missing');

    const indirect = parse(streamSource('/Length 9 0 R'));
    expect(indirect.kind === 'stream' && indirect.lengthAgreement).toBe('declared-indirect');
    expect(indirect.kind === 'stream' && indirect.declaredLength).toBeNull();
  });

  it('uses a resolver for an indirect length when one is supplied', () => {
    const source = streamSource('/Length 9 0 R');
    const parsed = parseObjectAt(adoptSource(source), 0, undefined, (objectNumber) =>
      objectNumber === 9 ? payload.length : undefined,
    );
    expect(parsed.object.kind === 'stream' && parsed.object.lengthAgreement).toBe('agrees');
  });

  it('reports a missing terminator and bounds the payload by the declared length', () => {
    const bounded = parse(`<< /Length 4 >>\nstream\n${payload}`);
    expect(bounded.kind === 'stream' && bounded.lengthAgreement).toBe('endstream-not-found');
    expect(bounded.kind === 'stream' && bounded.rawRange.end - bounded.rawRange.start).toBe(4);

    const unbounded = parse(`<< /Type /Thing >>\nstream\n${payload}`);
    expect(unbounded.kind === 'stream' && unbounded.lengthAgreement).toBe('endstream-not-found');
  });

  it('accepts CRLF, LF and a bare CR after the stream keyword', () => {
    for (const separator of ['\r\n', '\n', '\r']) {
      const object = parse(`<< /Length 2 >>\nstream${separator}AB\nendstream\n`);
      expect(object.kind).toBe('stream');
      if (object.kind !== 'stream') continue;
      expect(object.rawRange.end - object.rawRange.start).toBe(2);
    }
  });

  it('refuses a stream larger than the declared budget', () => {
    const budgets = budgetsFromLimits({
      ...DEFAULT_DOCUMENT_LIMITS,
      maximumDecodedStreamBytes: 4,
    });
    expect(() =>
      parseObjectAt(adoptSource(streamSource(`/Length ${String(payload.length)}`)), 0, budgets),
    ).toThrow(/maximumStreamBytes/u);
  });

  it('leaves the cursor after endstream so the next object can be read', () => {
    const source = `<< /Length ${String(payload.length)} >>\nstream\n${payload}\nendstream\n42`;
    const parsed = parseObjectAt(adoptSource(source), 0);
    const next = parseObjectAt(adoptSource(source), parsed.endOffset);
    expect(next.object).toStrictEqual(pdfInteger(42));
  });
});

describe('object model helpers', () => {
  const stream = pdfStream(
    pdfDictionary(new Map([['Length', pdfInteger(3)]])),
    { start: 10, end: 13 },
    3,
    'agrees',
  );

  it('reads entries from a dictionary or a stream dictionary', () => {
    expect(dictionaryGet(stream, 'Length')).toStrictEqual(pdfInteger(3));
    expect(dictionaryGet(stream, 'Missing')).toBeUndefined();
    expect(isDictionaryLike(stream)).toBe(true);
    expect(isDictionaryLike(pdfInteger(1))).toBe(false);
  });

  it('normalizes single values and arrays the way /Filter is written', () => {
    expect(asArray(undefined)).toStrictEqual([]);
    expect(asArray(PDF_NULL)).toStrictEqual([]);
    expect(asArray(pdfName('FlateDecode'))).toStrictEqual([pdfName('FlateDecode')]);
    expect(asArray(pdfArray([pdfName('A'), pdfName('B')]))).toStrictEqual([
      pdfName('A'),
      pdfName('B'),
    ]);
  });

  it('extracts numbers and names only from the right kinds', () => {
    expect(numericValue(pdfInteger(4))).toBe(4);
    expect(numericValue(pdfReal(4.5))).toBe(4.5);
    expect(numericValue(pdfName('A'))).toBeUndefined();
    expect(numericValue(undefined)).toBeUndefined();
    expect(nameValue(pdfName('A'))).toBe('A');
    expect(nameValue(pdfInteger(1))).toBeUndefined();
    expect(integerEntry(pdfDictionary(new Map([['N', pdfInteger(9)]])), 'N')).toBe(9);
    expect(integerEntry(pdfDictionary(new Map()), 'N')).toBeUndefined();
  });

  it('describes every object kind without disclosing content', () => {
    expect(describeObject(PDF_NULL)).toBe('null');
    expect(describeObject(pdfBoolean(true))).toBe('boolean(true)');
    expect(describeObject(pdfInteger(3))).toBe('integer(3)');
    expect(describeObject(pdfReal(3.5))).toBe('real(3.5)');
    expect(describeObject(pdfName('Type'))).toBe('name(/Type)');
    expect(describeObject(pdfArray([PDF_NULL]))).toBe('array(1 items)');
    expect(describeObject(pdfDictionary(new Map([['A', PDF_NULL]])))).toBe('dictionary(1 keys)');
    expect(describeObject(pdfReference(2, 1))).toBe('reference(2 1)');
    expect(describeObject(stream)).toBe('stream(1 keys, 3 raw bytes)');

    const secret = pdfString(Uint8Array.from([0x53, 0x45, 0x43]), 'literal');
    expect(describeObject(secret)).toBe('string(literal, 3 bytes)');
    expect(describeObject(secret)).not.toContain('SEC');
    expect(objectKey(2, 1)).toBe('2 1');
  });

  it('refuses an out-of-range object identifier', () => {
    expect(() => {
      assertObjectIdentifier(-1, 0);
    }).toThrow(/object-number-out-of-range/u);
    expect(() => {
      assertObjectIdentifier(1, 70_000);
    }).toThrow(/generation-out-of-range/u);
    expect(() => {
      assertObjectIdentifier(1.5, 0);
    }).toThrow(PdfBoundaryError);
  });

  it('derives parse budgets from the document limits', () => {
    const budgets = budgetsFromLimits();
    expect(budgets.maximumNestingDepth).toBe(DEFAULT_DOCUMENT_LIMITS.maximumResolutionDepth);
    expect(budgets.maximumCollectionEntries).toBe(DEFAULT_DOCUMENT_LIMITS.maximumObjectCount);
    expect(budgets.maximumStreamBytes).toBe(DEFAULT_DOCUMENT_LIMITS.maximumDecodedStreamBytes);
  });

  it('refuses to adopt a document larger than the intake budget', () => {
    expect(() => DeviceLocalBytes.adopt('test-vector', new Uint8Array(10), 5)).toThrow(
      /PDF_BYTES_TOO_LARGE/u,
    );
  });
});
