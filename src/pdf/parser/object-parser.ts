/**
 * Recursive-descent parser for PDF objects, built on the byte lexer.
 *
 * Two behaviours here exist because of what this tool is for.
 *
 * **Streams are located twice.** The declared `/Length` is read *and* the real
 * `endstream` is scanned for, and the two are compared. A stream whose declared length
 * stops short of its real terminator hides bytes from every viewer that trusts the
 * dictionary while remaining visible to every viewer that scans. That disagreement is
 * recorded on the stream as {@link StreamLengthAgreement} rather than silently resolved,
 * and the authoritative `rawRange` always extends to the scanned terminator, because the
 * larger region is the one that can hide something.
 *
 * **Every recursion and every collection is bounded.** A document is untrusted input; a
 * deeply nested array or a dictionary with a million keys is a denial-of-service vector,
 * and `AGENTS.md` treats an unbounded boundary as a defect even when nothing has ever
 * exceeded it.
 */

import type { DeviceLocalBytes } from './device-local-bytes.js';
import { PdfBoundaryError } from './errors.js';
import { PdfLexer, type PdfToken } from './lexer.js';
import { DEFAULT_DOCUMENT_LIMITS, type DocumentLimits } from './limits.js';
import {
  assertObjectIdentifier,
  numericValue,
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
  type PdfDictionary,
  type StreamLengthAgreement,
} from './objects.js';

export type ObjectParseBudgets = Readonly<{
  schemaVersion: 1;
  maximumNestingDepth: number;
  maximumCollectionEntries: number;
  maximumStreamBytes: number;
}>;

export function budgetsFromLimits(
  limits: DocumentLimits = DEFAULT_DOCUMENT_LIMITS,
): ObjectParseBudgets {
  return Object.freeze({
    schemaVersion: 1 as const,
    maximumNestingDepth: limits.maximumResolutionDepth,
    maximumCollectionEntries: limits.maximumObjectCount,
    maximumStreamBytes: limits.maximumDecodedStreamBytes,
  });
}

export const DEFAULT_OBJECT_PARSE_BUDGETS = budgetsFromLimits();

export type ParsedObject = Readonly<{
  object: PdfObject;
  /** Offset immediately after the object's last byte. */
  endOffset: number;
}>;

export type ParsedIndirectObject = Readonly<{
  objectNumber: number;
  generation: number;
  object: PdfObject;
  /** Offset immediately after `endobj`, or after the object when `endobj` is absent. */
  endOffset: number;
  /** True when the terminating `endobj` keyword was actually present. */
  hadEndObject: boolean;
}>;

const ENDSTREAM = asciiBytes('endstream');

function asciiBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
}

/**
 * Parses one object starting at `offset`.
 *
 * @param resolveLength resolves an indirect `/Length`; when omitted, an indirect length
 * is treated as unavailable and the stream extent comes from the scan alone.
 */
export function parseObjectAt(
  bytes: DeviceLocalBytes,
  offset: number,
  budgets: ObjectParseBudgets = DEFAULT_OBJECT_PARSE_BUDGETS,
  resolveLength?: (objectNumber: number, generation: number) => number | undefined,
): ParsedObject {
  const lexer = new PdfLexer(bytes, offset);
  const object = parseValue(bytes, lexer, budgets, 0, resolveLength);
  return Object.freeze({ object, endOffset: lexer.position });
}

/**
 * Parses `N G obj ... endobj` starting at `offset`.
 *
 * A missing `endobj` is reported rather than rejected: real files omit it, and refusing
 * the whole document would hide every other finding in it. The absence is surfaced as
 * `hadEndObject: false` so a caller can raise it as an unknown state.
 */
export function parseIndirectObjectAt(
  bytes: DeviceLocalBytes,
  offset: number,
  budgets: ObjectParseBudgets = DEFAULT_OBJECT_PARSE_BUDGETS,
  resolveLength?: (objectNumber: number, generation: number) => number | undefined,
): ParsedIndirectObject {
  const lexer = new PdfLexer(bytes, offset);
  const numberToken = lexer.next();
  const generationToken = lexer.next();
  const keywordToken = lexer.next();

  if (
    numberToken.kind !== 'integer' ||
    generationToken.kind !== 'integer' ||
    keywordToken.kind !== 'keyword' ||
    keywordToken.text !== 'obj'
  ) {
    throw new PdfBoundaryError('PDF_OBJECT_UNRESOLVABLE', {
      offset,
      reason: 'not-an-indirect-object-header',
    });
  }

  const objectNumber = numberToken.numberValue ?? -1;
  const generation = generationToken.numberValue ?? -1;
  assertObjectIdentifier(objectNumber, generation);

  const object = parseValue(bytes, lexer, budgets, 0, resolveLength);

  const afterObject = lexer.position;
  const terminator = lexer.next();
  const hadEndObject = terminator.kind === 'keyword' && terminator.text === 'endobj';

  return Object.freeze({
    objectNumber,
    generation,
    object,
    endOffset: hadEndObject ? lexer.position : afterObject,
    hadEndObject,
  });
}

function parseValue(
  bytes: DeviceLocalBytes,
  lexer: PdfLexer,
  budgets: ObjectParseBudgets,
  depth: number,
  resolveLength?: (objectNumber: number, generation: number) => number | undefined,
): PdfObject {
  const token = lexer.next();
  return parseFromToken(bytes, lexer, budgets, depth, token, resolveLength);
}

/**
 * The depth guard lives here rather than in {@link parseValue} because array elements
 * enter through this function directly. A guard that only covered one of the two entry
 * points would let `[[[[…]]]]` recurse until the JavaScript stack overflowed, which is a
 * crash rather than a refusal.
 */
function parseFromToken(
  bytes: DeviceLocalBytes,
  lexer: PdfLexer,
  budgets: ObjectParseBudgets,
  depth: number,
  token: PdfToken,
  resolveLength?: (objectNumber: number, generation: number) => number | undefined,
): PdfObject {
  if (depth > budgets.maximumNestingDepth) {
    throw new PdfBoundaryError('PDF_LIMIT_EXCEEDED', {
      field: 'maximumNestingDepth',
      limit: budgets.maximumNestingDepth,
      offset: token.start,
    });
  }

  switch (token.kind) {
    case 'integer':
      return parseIntegerOrReference(lexer, token);
    case 'real':
      return pdfReal(token.numberValue ?? 0);
    case 'name':
      return pdfName(token.text ?? '');
    case 'string-literal':
      return pdfString(token.bytes ?? new Uint8Array(0), 'literal');
    case 'string-hexadecimal':
      return pdfString(token.bytes ?? new Uint8Array(0), 'hexadecimal');
    case 'array-open':
      return parseArray(bytes, lexer, budgets, depth, resolveLength);
    case 'dictionary-open':
      return parseDictionaryOrStream(bytes, lexer, budgets, depth, resolveLength);
    case 'keyword':
      return parseKeyword(token);
    case 'end-of-input':
      throw new PdfBoundaryError('PDF_OBJECT_UNRESOLVABLE', {
        offset: token.start,
        reason: 'unexpected-end-of-input',
      });
    default:
      throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
        offset: token.start,
        reason: `unexpected-token-${token.kind}`,
      });
  }
}

function parseKeyword(token: PdfToken): PdfObject {
  switch (token.text) {
    case 'true':
      return pdfBoolean(true);
    case 'false':
      return pdfBoolean(false);
    case 'null':
      return PDF_NULL;
    default:
      throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
        offset: token.start,
        reason: 'unexpected-keyword',
      });
  }
}

/**
 * Distinguishes `12` from `12 0 R`.
 *
 * The lexer is forward-only, so the two-token lookahead records the cursor first and
 * restores it when the pattern does not match. That keeps every parse reproducible from
 * `(bytes, offset)` without a token buffer that could drift out of sync.
 */
function parseIntegerOrReference(lexer: PdfLexer, token: PdfToken): PdfObject {
  const value = token.numberValue ?? 0;
  if (!Number.isSafeInteger(value) || value < 0) return pdfInteger(value);

  const checkpoint = lexer.position;
  let generationToken: PdfToken;
  let keywordToken: PdfToken;
  try {
    generationToken = lexer.next();
    keywordToken = lexer.next();
  } catch {
    lexer.seek(checkpoint);
    return pdfInteger(value);
  }

  const generation = generationToken.numberValue ?? -1;
  if (
    generationToken.kind === 'integer' &&
    keywordToken.kind === 'keyword' &&
    keywordToken.text === 'R' &&
    Number.isSafeInteger(generation) &&
    generation >= 0 &&
    generation <= 65_535
  ) {
    return pdfReference(value, generation);
  }

  lexer.seek(checkpoint);
  return pdfInteger(value);
}

function parseArray(
  bytes: DeviceLocalBytes,
  lexer: PdfLexer,
  budgets: ObjectParseBudgets,
  depth: number,
  resolveLength?: (objectNumber: number, generation: number) => number | undefined,
): PdfObject {
  const items: PdfObject[] = [];
  for (;;) {
    const token = lexer.next();
    if (token.kind === 'array-close') return pdfArray(items);
    if (token.kind === 'end-of-input') {
      throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
        offset: token.start,
        reason: 'unterminated-array',
      });
    }
    if (items.length >= budgets.maximumCollectionEntries) {
      throw new PdfBoundaryError('PDF_LIMIT_EXCEEDED', {
        field: 'maximumCollectionEntries',
        limit: budgets.maximumCollectionEntries,
      });
    }
    items.push(parseFromToken(bytes, lexer, budgets, depth + 1, token, resolveLength));
  }
}

function parseDictionaryOrStream(
  bytes: DeviceLocalBytes,
  lexer: PdfLexer,
  budgets: ObjectParseBudgets,
  depth: number,
  resolveLength?: (objectNumber: number, generation: number) => number | undefined,
): PdfObject {
  const entries = new Map<string, PdfObject>();

  for (;;) {
    const keyToken = lexer.next();
    if (keyToken.kind === 'dictionary-close') break;
    if (keyToken.kind === 'end-of-input') {
      throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
        offset: keyToken.start,
        reason: 'unterminated-dictionary',
      });
    }
    if (keyToken.kind !== 'name') {
      throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
        offset: keyToken.start,
        reason: 'dictionary-key-is-not-a-name',
      });
    }
    if (entries.size >= budgets.maximumCollectionEntries) {
      throw new PdfBoundaryError('PDF_LIMIT_EXCEEDED', {
        field: 'maximumCollectionEntries',
        limit: budgets.maximumCollectionEntries,
      });
    }

    const key = keyToken.text ?? '';
    const value = parseValue(bytes, lexer, budgets, depth + 1, resolveLength);
    if (entries.has(key)) {
      // A duplicate key has two defensible readings — first wins, or last wins — and
      // real viewers disagree. Refusing is the only answer that cannot be wrong.
      throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
        offset: keyToken.start,
        reason: 'duplicate-dictionary-key',
      });
    }
    entries.set(key, value);
  }

  const dictionary = pdfDictionary(entries);
  const checkpoint = lexer.position;
  const next = lexer.next();
  if (next.kind !== 'keyword' || next.text !== 'stream') {
    lexer.seek(checkpoint);
    return dictionary;
  }

  return readStream(bytes, lexer, dictionary, next.end, budgets, resolveLength);
}

/**
 * Locates a stream payload from the `stream` keyword onwards.
 *
 * The specification requires exactly CRLF or LF after the keyword. A lone CR is accepted
 * here because writers emit it, but the payload start is computed from what is actually
 * present rather than from an assumed two-byte break, so an off-by-one cannot shift the
 * whole payload.
 */
function readStream(
  bytes: DeviceLocalBytes,
  lexer: PdfLexer,
  dictionary: PdfDictionary,
  afterKeyword: number,
  budgets: ObjectParseBudgets,
  resolveLength?: (objectNumber: number, generation: number) => number | undefined,
): PdfObject {
  let start = afterKeyword;
  if (bytes.byteAt(start) === 0x0d) start += 1;
  if (bytes.byteAt(start) === 0x0a) start += 1;

  const scannedTerminator = bytes.indexOf(ENDSTREAM, start);
  const lengthEntry = dictionary.entries.get('Length');

  let declaredLength: number | null = null;
  let agreement: StreamLengthAgreement;

  if (lengthEntry?.kind === 'integer') {
    declaredLength = lengthEntry.value;
  } else if (lengthEntry?.kind === 'reference') {
    declaredLength = resolveLength?.(lengthEntry.objectNumber, lengthEntry.generation) ?? null;
  }

  if (scannedTerminator === -1) {
    // No terminator anywhere: the payload can only be bounded by the declared length,
    // and if that is missing too, the rest of the document is the conservative extent.
    const end =
      declaredLength !== null && declaredLength >= 0
        ? Math.min(bytes.byteLength, start + declaredLength)
        : bytes.byteLength;
    assertStreamWithinBudget(start, end, budgets);
    lexer.seek(end);
    return pdfStream(dictionary, { start, end }, declaredLength, 'endstream-not-found');
  }

  // `endstream` is preceded by an end-of-line that is not part of the payload.
  let scannedEnd = scannedTerminator;
  if (bytes.byteAt(scannedEnd - 1) === 0x0a) scannedEnd -= 1;
  if (bytes.byteAt(scannedEnd - 1) === 0x0d) scannedEnd -= 1;
  if (scannedEnd < start) scannedEnd = start;

  const declaredEnd = declaredLength === null ? null : start + declaredLength;
  if (lengthEntry === undefined) agreement = 'declared-missing';
  else if (declaredEnd === null) agreement = 'declared-indirect';
  else if (declaredEnd === scannedEnd) agreement = 'agrees';
  else agreement = 'declared-differs-from-scan';

  // The scanned terminator is authoritative: a short declared length would exclude bytes
  // that a scanning viewer still sees, and excluded bytes are exactly where content hides.
  const end = declaredEnd === null ? scannedEnd : Math.max(scannedEnd, declaredEnd);
  const boundedEnd = Math.min(bytes.byteLength, end);
  assertStreamWithinBudget(start, boundedEnd, budgets);

  lexer.seek(Math.min(bytes.byteLength, scannedTerminator + ENDSTREAM.byteLength));
  return pdfStream(dictionary, { start, end: boundedEnd }, declaredLength, agreement);
}

function assertStreamWithinBudget(start: number, end: number, budgets: ObjectParseBudgets): void {
  const size = end - start;
  if (size > budgets.maximumStreamBytes) {
    throw new PdfBoundaryError('PDF_LIMIT_EXCEEDED', {
      field: 'maximumStreamBytes',
      limit: budgets.maximumStreamBytes,
      requested: size,
    });
  }
}

/** Convenience accessor used by the xref and revision layers. */
export function integerEntry(dictionary: PdfDictionary, key: string): number | undefined {
  return numericValue(dictionary.entries.get(key));
}
