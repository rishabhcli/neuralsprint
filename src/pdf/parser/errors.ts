/**
 * Stable, versioned failure vocabulary for every PDF boundary in this repository.
 *
 * `AGENTS.md` requires errors to carry stable codes, safe user messages, internal
 * context, and a retryability classification. Nothing in this module may embed
 * document content: `context` is restricted to primitives that describe structure
 * (offsets, counts, object numbers), never bytes or extracted text.
 */

export const PDF_ERROR_CODES = [
  'PDF_BYTES_EMPTY',
  'PDF_BYTES_TOO_LARGE',
  'PDF_BYTES_NOT_DEVICE_LOCAL',
  'PDF_HEADER_INVALID',
  'PDF_XREF_UNREADABLE',
  'PDF_XREF_CYCLE',
  'PDF_OBJECT_UNRESOLVABLE',
  'PDF_FILTER_UNSUPPORTED',
  'PDF_FILTER_CORRUPT',
  'PDF_ENCRYPTION_UNSUPPORTED',
  'PDF_EXTERNAL_REFERENCE_REFUSED',
  'PDF_LIMIT_EXCEEDED',
  'PDF_OPERATION_CANCELLED',
  'PDF_STRUCTURE_AMBIGUOUS',
] as const;

export type PdfErrorCode = (typeof PDF_ERROR_CODES)[number];

/**
 * How a caller may respond. `retryable-with-different-input` means the same bytes
 * will always fail; `retryable-transient` means the same bytes may succeed after a
 * resource condition clears. Neither ever means "treat the document as safe".
 */
export type Retryability =
  'not-retryable' | 'retryable-with-different-input' | 'retryable-transient';

export type PdfErrorContextValue = string | number | boolean;
export type PdfErrorContext = Readonly<Record<string, PdfErrorContextValue>>;

type RetryabilityByCode = Readonly<Record<PdfErrorCode, Retryability>>;

const RETRYABILITY: RetryabilityByCode = {
  PDF_BYTES_EMPTY: 'retryable-with-different-input',
  PDF_BYTES_TOO_LARGE: 'retryable-with-different-input',
  PDF_BYTES_NOT_DEVICE_LOCAL: 'not-retryable',
  PDF_HEADER_INVALID: 'retryable-with-different-input',
  PDF_XREF_UNREADABLE: 'retryable-with-different-input',
  PDF_XREF_CYCLE: 'retryable-with-different-input',
  PDF_OBJECT_UNRESOLVABLE: 'retryable-with-different-input',
  PDF_FILTER_UNSUPPORTED: 'not-retryable',
  PDF_FILTER_CORRUPT: 'retryable-with-different-input',
  PDF_ENCRYPTION_UNSUPPORTED: 'not-retryable',
  PDF_EXTERNAL_REFERENCE_REFUSED: 'not-retryable',
  PDF_LIMIT_EXCEEDED: 'retryable-transient',
  PDF_OPERATION_CANCELLED: 'retryable-transient',
  PDF_STRUCTURE_AMBIGUOUS: 'not-retryable',
};

type UserMessageByCode = Readonly<Record<PdfErrorCode, string>>;

/**
 * Safe user-facing copy. Every message states what the tool will not conclude, so
 * an error surface can never be mistaken for a safety result.
 */
const USER_MESSAGES: UserMessageByCode = {
  PDF_BYTES_EMPTY: 'This file contains no bytes, so nothing was inspected.',
  PDF_BYTES_TOO_LARGE: 'This file is larger than the inspection limit, so it was not inspected.',
  PDF_BYTES_NOT_DEVICE_LOCAL:
    'These bytes were not adopted through the on-device intake path, so they were not inspected.',
  PDF_HEADER_INVALID: 'This file does not begin with a PDF header, so it was not inspected.',
  PDF_XREF_UNREADABLE:
    'The cross-reference structure could not be read, so hidden content cannot be ruled out.',
  PDF_XREF_CYCLE:
    'The revision chain refers back to itself, so the document history cannot be trusted.',
  PDF_OBJECT_UNRESOLVABLE:
    'A referenced object is missing or unreadable, so the document is incomplete.',
  PDF_FILTER_UNSUPPORTED:
    'This document uses a stream filter this tool does not decode, so its contents are unknown.',
  PDF_FILTER_CORRUPT: 'A compressed stream failed to decode, so its contents are unknown.',
  PDF_ENCRYPTION_UNSUPPORTED:
    'This document is encrypted and this tool does not decrypt documents.',
  PDF_EXTERNAL_REFERENCE_REFUSED:
    'This document points at content outside itself. That target was refused and never fetched.',
  PDF_LIMIT_EXCEEDED: 'Inspection stopped at a declared resource limit before finishing.',
  PDF_OPERATION_CANCELLED: 'Inspection was cancelled before it finished.',
  PDF_STRUCTURE_AMBIGUOUS:
    'This structure has more than one valid reading, so no single interpretation is trusted.',
};

/**
 * Renders structural context into the developer-facing `message`.
 *
 * Only offsets, counts, field names and stable reasons ever reach a context, so this
 * is safe to log; the clean, user-facing sentence stays available as `userMessage`.
 */
function describeContext(context: PdfErrorContext): string {
  const pairs = Object.entries(context).map(([key, value]) => `${key}=${String(value)}`);
  return pairs.length === 0 ? '' : ` (${pairs.join('; ')})`;
}

/** Every boundary failure raised by the parser, interpreter, sanitizer, or verifier. */
export class PdfBoundaryError extends Error {
  readonly code: PdfErrorCode;
  readonly retryability: Retryability;
  readonly userMessage: string;
  readonly context: PdfErrorContext;

  constructor(code: PdfErrorCode, context: PdfErrorContext = {}) {
    const userMessage = USER_MESSAGES[code];
    super(`${code}: ${userMessage}${describeContext(context)}`);
    this.name = 'PdfBoundaryError';
    this.code = code;
    this.retryability = RETRYABILITY[code];
    this.userMessage = userMessage;
    this.context = Object.freeze({ ...context });
  }

  /**
   * Serialization is masked by construction: only the stable code, classification,
   * safe copy, and structural context are emitted. `message` and `stack` are omitted
   * so a report or log line can never carry an incidental content fragment.
   */
  toJSON(): Readonly<{
    schemaVersion: 1;
    code: PdfErrorCode;
    retryability: Retryability;
    userMessage: string;
    context: PdfErrorContext;
  }> {
    return Object.freeze({
      schemaVersion: 1 as const,
      code: this.code,
      retryability: this.retryability,
      userMessage: this.userMessage,
      context: this.context,
    });
  }
}

export function isPdfErrorCode(value: unknown): value is PdfErrorCode {
  return typeof value === 'string' && (PDF_ERROR_CODES as readonly string[]).includes(value);
}

export function retryabilityOf(code: PdfErrorCode): Retryability {
  return RETRYABILITY[code];
}

export function userMessageOf(code: PdfErrorCode): string {
  return USER_MESSAGES[code];
}
