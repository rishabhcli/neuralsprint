/**
 * The PDF object model, as a tagged union.
 *
 * Every value a PDF file can hold is one of nine shapes. Modelling them as a closed
 * union rather than as `unknown` or a loose record means a consumer that forgets a case
 * fails to compile, and it means no code path can silently treat a stream as a
 * dictionary or a reference as a resolved value.
 *
 * Two deliberate choices matter for forensics:
 *
 * - **Strings keep their bytes.** A PDF string is a byte string, and the same secret can
 *   be stored as PDFDocEncoding, UTF-16BE with a byte-order mark, or an octal escape
 *   sequence. Decoding at parse time would destroy the evidence that a byte-level attack
 *   needs, so `PdfString` carries the raw bytes plus how they were written.
 * - **Streams keep their byte range, not their data.** A stream's payload is located but
 *   not decoded until a caller asks and a budget allows, so a hostile document cannot
 *   force megabytes of inflation during a structural walk.
 */

import { PdfBoundaryError } from './errors.js';

export type ByteRange = Readonly<{
  /** Inclusive start offset in the document. */
  start: number;
  /** Exclusive end offset in the document. */
  end: number;
}>;

export type PdfNull = Readonly<{ kind: 'null' }>;
export type PdfBoolean = Readonly<{ kind: 'boolean'; value: boolean }>;

/** An integer as written. PDF distinguishes integers from reals in some contexts. */
export type PdfInteger = Readonly<{ kind: 'integer'; value: number }>;
export type PdfReal = Readonly<{ kind: 'real'; value: number }>;

export type PdfStringEncoding = 'literal' | 'hexadecimal';
export type PdfString = Readonly<{
  kind: 'string';
  /** Decoded string *bytes* — escapes resolved, but no character-set interpretation. */
  bytes: Uint8Array;
  /** How the string was written in the file. */
  writtenAs: PdfStringEncoding;
}>;

/** A name with `#XX` escapes resolved, held as Latin-1 so it round-trips byte-exactly. */
export type PdfName = Readonly<{ kind: 'name'; name: string }>;

export type PdfArray = Readonly<{ kind: 'array'; items: readonly PdfObject[] }>;
export type PdfDictionary = Readonly<{
  kind: 'dictionary';
  entries: ReadonlyMap<string, PdfObject>;
}>;

/**
 * How a stream's declared `/Length` compares with where `endstream` actually is.
 *
 * This is forensic evidence, not a diagnostic. Bytes between a short declared length and
 * the real `endstream` are invisible to a viewer that trusts `/Length`, and visible to
 * one that scans — which is exactly the shape of a cross-parser hiding place.
 */
export const STREAM_LENGTH_AGREEMENTS = [
  'agrees',
  'declared-differs-from-scan',
  'declared-indirect',
  'declared-missing',
  'endstream-not-found',
] as const;

export type StreamLengthAgreement = (typeof STREAM_LENGTH_AGREEMENTS)[number];

export type PdfStream = Readonly<{
  kind: 'stream';
  dictionary: PdfDictionary;
  /** Where the raw, still-encoded payload lives. Never decoded during a structural walk. */
  rawRange: ByteRange;
  /** `/Length` as written, when it was written as a direct integer. */
  declaredLength: number | null;
  /** Whether the declared length agrees with the scanned `endstream` position. */
  lengthAgreement: StreamLengthAgreement;
}>;

export type PdfReference = Readonly<{
  kind: 'reference';
  objectNumber: number;
  generation: number;
}>;

export type PdfObject =
  | PdfNull
  | PdfBoolean
  | PdfInteger
  | PdfReal
  | PdfString
  | PdfName
  | PdfArray
  | PdfDictionary
  | PdfStream
  | PdfReference;

export const PDF_NULL: PdfNull = Object.freeze({ kind: 'null' });

export function pdfBoolean(value: boolean): PdfBoolean {
  return Object.freeze({ kind: 'boolean', value });
}

export function pdfInteger(value: number): PdfInteger {
  return Object.freeze({ kind: 'integer', value });
}

export function pdfReal(value: number): PdfReal {
  return Object.freeze({ kind: 'real', value });
}

export function pdfString(bytes: Uint8Array, writtenAs: PdfStringEncoding): PdfString {
  return Object.freeze({ kind: 'string', bytes, writtenAs });
}

export function pdfName(name: string): PdfName {
  return Object.freeze({ kind: 'name', name });
}

export function pdfArray(items: readonly PdfObject[]): PdfArray {
  return Object.freeze({ kind: 'array', items: Object.freeze([...items]) });
}

export function pdfDictionary(entries: ReadonlyMap<string, PdfObject>): PdfDictionary {
  return Object.freeze({ kind: 'dictionary', entries: new Map(entries) });
}

export function pdfStream(
  dictionary: PdfDictionary,
  rawRange: ByteRange,
  declaredLength: number | null,
  lengthAgreement: StreamLengthAgreement,
): PdfStream {
  return Object.freeze({
    kind: 'stream',
    dictionary,
    rawRange: Object.freeze({ ...rawRange }),
    declaredLength,
    lengthAgreement,
  });
}

export function pdfReference(objectNumber: number, generation: number): PdfReference {
  return Object.freeze({ kind: 'reference', objectNumber, generation });
}

/** Stable key for an indirect object, used by the xref and revision layers. */
export function objectKey(objectNumber: number, generation: number): string {
  return `${String(objectNumber)} ${String(generation)}`;
}

/**
 * Reads an entry from a dictionary, or from a stream's dictionary.
 *
 * Returns `undefined` for a missing key so a caller must decide what a missing key
 * means, rather than receiving a null object that looks like a present one.
 */
export function dictionaryGet(
  container: PdfDictionary | PdfStream,
  key: string,
): PdfObject | undefined {
  const dictionary = container.kind === 'stream' ? container.dictionary : container;
  return dictionary.entries.get(key);
}

export function isDictionaryLike(object: PdfObject): object is PdfDictionary | PdfStream {
  return object.kind === 'dictionary' || object.kind === 'stream';
}

/** Numeric value of an integer or real; `undefined` for anything else. */
export function numericValue(object: PdfObject | undefined): number | undefined {
  if (object === undefined) return undefined;
  if (object.kind === 'integer' || object.kind === 'real') return object.value;
  return undefined;
}

/** Name text; `undefined` for anything else. */
export function nameValue(object: PdfObject | undefined): string | undefined {
  return object?.kind === 'name' ? object.name : undefined;
}

/**
 * Normalizes a value that a PDF may write either singly or as an array — `/Filter`
 * being the canonical example, which is either a name or an array of names.
 */
export function asArray(object: PdfObject | undefined): readonly PdfObject[] {
  if (object === undefined) return [];
  if (object.kind === 'array') return object.items;
  if (object.kind === 'null') return [];
  return [object];
}

/**
 * Asserts an object number and generation are within the representable range.
 *
 * PDF object numbers are positive integers and generations are in `[0, 65535]`. A file
 * that violates either is malformed; accepting it would let a crafted reference index
 * outside the xref table.
 */
export function assertObjectIdentifier(objectNumber: number, generation: number): void {
  if (!Number.isSafeInteger(objectNumber) || objectNumber < 0) {
    throw new PdfBoundaryError('PDF_OBJECT_UNRESOLVABLE', {
      reason: 'object-number-out-of-range',
      objectNumber,
    });
  }
  if (!Number.isSafeInteger(generation) || generation < 0 || generation > 65_535) {
    throw new PdfBoundaryError('PDF_OBJECT_UNRESOLVABLE', {
      reason: 'generation-out-of-range',
      generation,
    });
  }
}

/**
 * A structural, content-free description of an object, safe for logs and reports.
 *
 * Strings and streams report their length only. This is what an observability event or
 * a masked finding may carry; the object itself never is.
 */
export function describeObject(object: PdfObject): string {
  switch (object.kind) {
    case 'null':
      return 'null';
    case 'boolean':
      return `boolean(${String(object.value)})`;
    case 'integer':
      return `integer(${String(object.value)})`;
    case 'real':
      return `real(${String(object.value)})`;
    case 'string':
      return `string(${object.writtenAs}, ${String(object.bytes.byteLength)} bytes)`;
    case 'name':
      return `name(/${object.name})`;
    case 'array':
      return `array(${String(object.items.length)} items)`;
    case 'dictionary':
      return `dictionary(${String(object.entries.size)} keys)`;
    case 'stream':
      return `stream(${String(object.dictionary.entries.size)} keys, ${String(
        object.rawRange.end - object.rawRange.start,
      )} raw bytes)`;
    case 'reference':
      return `reference(${objectKey(object.objectNumber, object.generation)})`;
  }
}
