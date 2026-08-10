/**
 * Invariant I3 — output is written as a fresh object graph, never an incremental append.
 *
 * This is the invariant most often violated by accident, because the easiest way to
 * "edit" a PDF is to append a new revision to the original bytes. That produces a file
 * that looks correct in a viewer while still containing every byte of the original,
 * including the content the user asked to remove.
 *
 * Encoding: emitted bytes are nominally typed as {@link FreshDocumentBytes}, a class
 * with a private constructor. The only way to obtain one is {@link sealFreshDocument},
 * which runs {@link auditFreshObjectGraph} against the emitted bytes and refuses on
 * any of the structural signatures of an append:
 *
 * - more than one `startxref`, `%%EOF`, or `%PDF-` header;
 * - any `/Prev` entry in a trailer dictionary or cross-reference stream;
 * - emitted bytes that begin with the entire source document.
 *
 * The audit reads the *emitted bytes*, not the writer's intent, so a writer bug cannot
 * produce a sealed document.
 */

import { countByteOccurrences } from '../findings/sensitive.js';
import { sha256Hex } from '../pdf/parser/digest.js';
import { SanitizerBoundaryError } from './errors.js';

function ascii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
}

const HEADER = ascii('%PDF-');
const START_XREF = ascii('startxref');
const END_OF_FILE = ascii('%%EOF');
const PREV_KEY = ascii('/Prev');

export type FreshGraphAudit = Readonly<{
  schemaVersion: 1;
  headerCount: number;
  startxrefCount: number;
  endOfFileCount: number;
  previousPointerCount: number;
  beginsWithHeader: boolean;
  endsWithEndOfFile: boolean;
  sourceIsPrefixOfOutput: boolean;
  passed: boolean;
  failures: readonly string[];
}>;

/**
 * Audits emitted bytes for every structural signature of an incremental append.
 *
 * @param emitted the bytes the sanitizer proposes to hand to the user
 * @param source the original document, when available; enables the prefix check
 */
export function auditFreshObjectGraph(emitted: Uint8Array, source?: Uint8Array): FreshGraphAudit {
  const headerCount = countByteOccurrences(emitted, HEADER);
  const startxrefCount = countByteOccurrences(emitted, START_XREF);
  const endOfFileCount = countByteOccurrences(emitted, END_OF_FILE);
  const previousPointerCount = countByteOccurrences(emitted, PREV_KEY);
  const beginsWithHeader = startsWith(emitted, HEADER);
  const endsWithEndOfFile = endsWithIgnoringTrailingWhitespace(emitted, END_OF_FILE);
  const sourceIsPrefixOfOutput = source !== undefined && startsWith(emitted, source);

  const failures: string[] = [];
  if (!beginsWithHeader) failures.push('missing-header');
  if (headerCount !== 1) failures.push(`header-count-${String(headerCount)}`);
  if (startxrefCount !== 1) failures.push(`startxref-count-${String(startxrefCount)}`);
  if (endOfFileCount !== 1) failures.push(`eof-count-${String(endOfFileCount)}`);
  if (!endsWithEndOfFile) failures.push('missing-trailing-eof');
  if (previousPointerCount !== 0) {
    failures.push(`previous-pointer-count-${String(previousPointerCount)}`);
  }
  if (sourceIsPrefixOfOutput) failures.push('source-is-prefix');

  return Object.freeze({
    schemaVersion: 1 as const,
    headerCount,
    startxrefCount,
    endOfFileCount,
    previousPointerCount,
    beginsWithHeader,
    endsWithEndOfFile,
    sourceIsPrefixOfOutput,
    passed: failures.length === 0,
    failures: Object.freeze(failures),
  });
}

function startsWith(haystack: Uint8Array, prefix: Uint8Array): boolean {
  if (prefix.byteLength === 0 || prefix.byteLength > haystack.byteLength) return false;
  for (let index = 0; index < prefix.byteLength; index += 1) {
    if (haystack[index] !== prefix[index]) return false;
  }
  return true;
}

function endsWithIgnoringTrailingWhitespace(haystack: Uint8Array, suffix: Uint8Array): boolean {
  let end = haystack.byteLength;
  while (end > 0) {
    const byte = haystack[end - 1];
    if (byte === 0x0a || byte === 0x0d || byte === 0x20 || byte === 0x09) end -= 1;
    else break;
  }
  if (suffix.byteLength > end) return false;
  for (let index = 0; index < suffix.byteLength; index += 1) {
    if (haystack[end - suffix.byteLength + index] !== suffix[index]) return false;
  }
  return true;
}

/** Emitted bytes that have been proven to be a single fresh object graph. */
export class FreshDocumentBytes {
  readonly byteLength: number;
  readonly sha256: string;
  readonly audit: FreshGraphAudit;
  readonly #bytes: Uint8Array;

  private constructor(bytes: Uint8Array, audit: FreshGraphAudit) {
    this.#bytes = bytes;
    this.byteLength = bytes.byteLength;
    this.sha256 = sha256Hex(bytes);
    this.audit = audit;
  }

  /** Copy of the emitted bytes. The sealed buffer itself never escapes. */
  toBytes(): Uint8Array {
    return this.#bytes.slice();
  }

  toJSON(): Readonly<{
    schemaVersion: 1;
    byteLength: number;
    sha256: string;
    audit: FreshGraphAudit;
  }> {
    return Object.freeze({
      schemaVersion: 1 as const,
      byteLength: this.byteLength,
      sha256: this.sha256,
      audit: this.audit,
    });
  }

  /**
   * The only constructor of sealed output in the repository.
   *
   * @throws SanitizerBoundaryError when the emitted bytes carry any append signature.
   */
  static seal(emitted: Uint8Array, source?: Uint8Array): FreshDocumentBytes {
    const audit = auditFreshObjectGraph(emitted, source);
    if (!audit.passed) {
      const code = audit.sourceIsPrefixOfOutput
        ? 'SANITIZER_SOURCE_PREFIX_DETECTED'
        : audit.previousPointerCount > 0 || audit.startxrefCount > 1 || audit.endOfFileCount > 1
          ? 'SANITIZER_INCREMENTAL_APPEND_REFUSED'
          : 'SANITIZER_OUTPUT_MALFORMED';
      throw new SanitizerBoundaryError(code, {
        failures: audit.failures.join(','),
        byteLength: emitted.byteLength,
      });
    }
    return new FreshDocumentBytes(emitted.slice(), audit);
  }
}

/** Convenience wrapper matching the naming used elsewhere in the domain. */
export function sealFreshDocument(emitted: Uint8Array, source?: Uint8Array): FreshDocumentBytes {
  return FreshDocumentBytes.seal(emitted, source);
}
