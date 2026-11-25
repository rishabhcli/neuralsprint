/**
 * The PDF syntax layer: a byte-exact tokenizer over device-local document bytes.
 *
 * This is written from the byte grammar rather than delegated to a rendering library,
 * for two reasons that matter to this project specifically. First, a renderer is allowed
 * to be forgiving — it wants to show *something* — whereas a forensic tool must know
 * precisely when a construct is ambiguous, because ambiguity is where hidden content
 * survives. Second, invariant I6 requires the verifier to read emitted bytes without
 * sharing the sanitizer's parser state; a single shared third-party document object
 * would make that impossible.
 *
 * Where the specification permits a tolerance, this lexer takes it and records nothing.
 * Where a construct has more than one defensible reading, it raises
 * `PDF_STRUCTURE_AMBIGUOUS` rather than picking one, because picking one is how a
 * cross-parser difference becomes a missed leak.
 */

import type { DeviceLocalBytes } from './device-local-bytes.js';
import { PdfBoundaryError } from './errors.js';

export const PDF_TOKEN_KINDS = [
  'integer',
  'real',
  'string-literal',
  'string-hexadecimal',
  'name',
  'array-open',
  'array-close',
  'dictionary-open',
  'dictionary-close',
  'procedure-open',
  'procedure-close',
  'keyword',
  'end-of-input',
] as const;

export type PdfTokenKind = (typeof PDF_TOKEN_KINDS)[number];

export type PdfToken = Readonly<{
  kind: PdfTokenKind;
  /** Inclusive start offset of the token in the document. */
  start: number;
  /** Exclusive end offset of the token in the document. */
  end: number;
  /** Numeric value for `integer` and `real`. */
  numberValue?: number;
  /** Resolved text for `name` and `keyword`. */
  text?: string;
  /** Resolved bytes for the two string kinds, with escapes already applied. */
  bytes?: Uint8Array;
}>;

const NUL = 0x00;
const TAB = 0x09;
const LINE_FEED = 0x0a;
const FORM_FEED = 0x0c;
const CARRIAGE_RETURN = 0x0d;
const SPACE = 0x20;

const PERCENT = 0x25;
const SLASH = 0x2f;
const NUMBER_SIGN = 0x23;
const PLUS = 0x2b;
const MINUS = 0x2d;
const PERIOD = 0x2e;
const DIGIT_ZERO = 0x30;
const DIGIT_SEVEN = 0x37;
const DIGIT_NINE = 0x39;
const BACKSLASH = 0x5c;
const PAREN_OPEN = 0x28;
const PAREN_CLOSE = 0x29;
const ANGLE_OPEN = 0x3c;
const ANGLE_CLOSE = 0x3e;
const BRACKET_OPEN = 0x5b;
const BRACKET_CLOSE = 0x5d;
const BRACE_OPEN = 0x7b;
const BRACE_CLOSE = 0x7d;

/** The six bytes the specification calls white-space. `NUL` is one of them. */
export function isPdfWhitespace(byte: number | undefined): boolean {
  return (
    byte === NUL ||
    byte === TAB ||
    byte === LINE_FEED ||
    byte === FORM_FEED ||
    byte === CARRIAGE_RETURN ||
    byte === SPACE
  );
}

/** The delimiter bytes. Everything else that is not white-space is a regular character. */
export function isPdfDelimiter(byte: number | undefined): boolean {
  return (
    byte === PAREN_OPEN ||
    byte === PAREN_CLOSE ||
    byte === ANGLE_OPEN ||
    byte === ANGLE_CLOSE ||
    byte === BRACKET_OPEN ||
    byte === BRACKET_CLOSE ||
    byte === BRACE_OPEN ||
    byte === BRACE_CLOSE ||
    byte === SLASH ||
    byte === PERCENT
  );
}

export function isPdfRegularCharacter(byte: number | undefined): boolean {
  return byte !== undefined && !isPdfWhitespace(byte) && !isPdfDelimiter(byte);
}

function hexDigitValue(byte: number | undefined): number | undefined {
  if (byte === undefined) return undefined;
  if (byte >= DIGIT_ZERO && byte <= DIGIT_NINE) return byte - DIGIT_ZERO;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return undefined;
}

function isDigit(byte: number | undefined): boolean {
  return byte !== undefined && byte >= DIGIT_ZERO && byte <= DIGIT_NINE;
}

/**
 * A forward-only cursor over document bytes.
 *
 * The lexer never seeks backwards on its own. Callers that need to re-read a region
 * construct a new lexer at a known offset, so a parse can always be reproduced from
 * `(bytes, offset)` alone.
 */
export class PdfLexer {
  readonly #bytes: DeviceLocalBytes;
  readonly #limit: number;
  #position: number;

  constructor(bytes: DeviceLocalBytes, start = 0, limit = bytes.byteLength) {
    if (!Number.isSafeInteger(start) || start < 0 || start > bytes.byteLength) {
      throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
        field: 'lexer.start',
        reason: 'out-of-range',
      });
    }
    if (!Number.isSafeInteger(limit) || limit < start || limit > bytes.byteLength) {
      throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
        field: 'lexer.limit',
        reason: 'out-of-range',
      });
    }
    this.#bytes = bytes;
    this.#position = start;
    this.#limit = limit;
  }

  get position(): number {
    return this.#position;
  }

  /** Repositions the cursor. Used by the object layer after locating a stream payload. */
  seek(position: number): void {
    if (!Number.isSafeInteger(position) || position < 0 || position > this.#limit) {
      throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
        field: 'lexer.seek',
        reason: 'out-of-range',
      });
    }
    this.#position = position;
  }

  #byteAt(index: number): number | undefined {
    return index < this.#limit ? this.#bytes.byteAt(index) : undefined;
  }

  /** Advances past white-space and comments. Comments run to the end of the line. */
  skipWhitespaceAndComments(): void {
    for (;;) {
      while (this.#position < this.#limit && isPdfWhitespace(this.#byteAt(this.#position))) {
        this.#position += 1;
      }
      if (this.#byteAt(this.#position) !== PERCENT) return;
      while (this.#position < this.#limit) {
        const byte = this.#byteAt(this.#position);
        if (byte === LINE_FEED || byte === CARRIAGE_RETURN) break;
        this.#position += 1;
      }
    }
  }

  /** Reads the next token, or `end-of-input` at the limit. */
  next(): PdfToken {
    this.skipWhitespaceAndComments();
    const start = this.#position;
    const byte = this.#byteAt(start);
    if (byte === undefined) {
      return Object.freeze({ kind: 'end-of-input', start, end: start });
    }

    switch (byte) {
      case BRACKET_OPEN:
        this.#position += 1;
        return Object.freeze({ kind: 'array-open', start, end: this.#position });
      case BRACKET_CLOSE:
        this.#position += 1;
        return Object.freeze({ kind: 'array-close', start, end: this.#position });
      case BRACE_OPEN:
        this.#position += 1;
        return Object.freeze({ kind: 'procedure-open', start, end: this.#position });
      case BRACE_CLOSE:
        this.#position += 1;
        return Object.freeze({ kind: 'procedure-close', start, end: this.#position });
      case PAREN_OPEN:
        return this.#readLiteralString(start);
      case SLASH:
        return this.#readName(start);
      case ANGLE_OPEN:
        if (this.#byteAt(start + 1) === ANGLE_OPEN) {
          this.#position += 2;
          return Object.freeze({ kind: 'dictionary-open', start, end: this.#position });
        }
        return this.#readHexadecimalString(start);
      case ANGLE_CLOSE:
        if (this.#byteAt(start + 1) === ANGLE_CLOSE) {
          this.#position += 2;
          return Object.freeze({ kind: 'dictionary-close', start, end: this.#position });
        }
        throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
          offset: start,
          reason: 'unmatched-angle-bracket',
        });
      case PAREN_CLOSE:
        throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
          offset: start,
          reason: 'unmatched-close-parenthesis',
        });
      default:
        break;
    }

    if (isDigit(byte) || byte === PLUS || byte === MINUS || byte === PERIOD) {
      return this.#readNumber(start);
    }
    return this.#readKeyword(start);
  }

  #readNumber(start: number): PdfToken {
    let index = start;
    let sawSign = false;
    let sawPeriod = false;
    let sawDigit = false;

    while (index < this.#limit) {
      const byte = this.#byteAt(index);
      if (byte === PLUS || byte === MINUS) {
        if (index !== start) {
          throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
            offset: index,
            reason: 'sign-inside-number',
          });
        }
        sawSign = true;
      } else if (byte === PERIOD) {
        if (sawPeriod) {
          throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
            offset: index,
            reason: 'second-decimal-point',
          });
        }
        sawPeriod = true;
      } else if (isDigit(byte)) {
        sawDigit = true;
      } else if (isPdfRegularCharacter(byte)) {
        throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
          offset: index,
          reason: 'non-numeric-character-in-number',
        });
      } else {
        break;
      }
      index += 1;
    }

    if (!sawDigit) {
      throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
        offset: start,
        reason: 'number-without-digits',
      });
    }

    const text = this.#bytes.latin1Slice(start, index);
    const value = Number(sawPeriod && text.endsWith('.') ? `${text}0` : text);
    if (!Number.isFinite(value)) {
      throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
        offset: start,
        reason: 'number-not-finite',
      });
    }
    this.#position = index;
    return Object.freeze({
      kind: sawPeriod ? 'real' : 'integer',
      start,
      end: index,
      numberValue: value,
      text: sawSign ? text : text,
    });
  }

  #readName(start: number): PdfToken {
    let index = start + 1;
    let name = '';
    while (index < this.#limit) {
      const byte = this.#byteAt(index);
      if (!isPdfRegularCharacter(byte)) break;
      if (byte === NUMBER_SIGN) {
        const high = hexDigitValue(this.#byteAt(index + 1));
        const low = hexDigitValue(this.#byteAt(index + 2));
        if (high === undefined || low === undefined) {
          throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
            offset: index,
            reason: 'incomplete-name-escape',
          });
        }
        name += String.fromCharCode(high * 16 + low);
        index += 3;
        continue;
      }
      name += String.fromCharCode(byte ?? 0);
      index += 1;
    }
    this.#position = index;
    return Object.freeze({ kind: 'name', start, end: index, text: name });
  }

  #readLiteralString(start: number): PdfToken {
    let index = start + 1;
    let depth = 1;
    const out: number[] = [];

    while (index < this.#limit) {
      const byte = this.#byteAt(index);
      if (byte === undefined) break;

      if (byte === BACKSLASH) {
        const escaped = this.#byteAt(index + 1);
        index += 2;
        if (escaped === undefined) break;
        switch (escaped) {
          case 0x6e:
            out.push(LINE_FEED);
            continue;
          case 0x72:
            out.push(CARRIAGE_RETURN);
            continue;
          case 0x74:
            out.push(TAB);
            continue;
          case 0x62:
            out.push(0x08);
            continue;
          case 0x66:
            out.push(FORM_FEED);
            continue;
          case CARRIAGE_RETURN:
            // Line continuation; a following LF belongs to the same break.
            if (this.#byteAt(index) === LINE_FEED) index += 1;
            continue;
          case LINE_FEED:
            continue;
          default:
            break;
        }
        if (escaped >= DIGIT_ZERO && escaped <= DIGIT_SEVEN) {
          let value = escaped - DIGIT_ZERO;
          for (let digit = 0; digit < 2; digit += 1) {
            const next = this.#byteAt(index);
            if (next === undefined || next < DIGIT_ZERO || next > DIGIT_SEVEN) break;
            value = value * 8 + (next - DIGIT_ZERO);
            index += 1;
          }
          out.push(value & 0xff);
          continue;
        }
        out.push(escaped);
        continue;
      }

      if (byte === PAREN_OPEN) {
        depth += 1;
        out.push(byte);
        index += 1;
        continue;
      }
      if (byte === PAREN_CLOSE) {
        depth -= 1;
        index += 1;
        if (depth === 0) {
          this.#position = index;
          return Object.freeze({
            kind: 'string-literal',
            start,
            end: index,
            bytes: Uint8Array.from(out),
          });
        }
        out.push(byte);
        continue;
      }
      if (byte === CARRIAGE_RETURN) {
        // An unescaped end-of-line is a single line feed regardless of how it was written.
        out.push(LINE_FEED);
        index += 1;
        if (this.#byteAt(index) === LINE_FEED) index += 1;
        continue;
      }

      out.push(byte);
      index += 1;
    }

    throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
      offset: start,
      reason: 'unterminated-literal-string',
    });
  }

  #readHexadecimalString(start: number): PdfToken {
    let index = start + 1;
    const out: number[] = [];
    let pending: number | undefined;

    while (index < this.#limit) {
      const byte = this.#byteAt(index);
      if (byte === ANGLE_CLOSE) {
        index += 1;
        // An odd number of digits is padded with a trailing zero, per the specification.
        if (pending !== undefined) out.push(pending * 16);
        this.#position = index;
        return Object.freeze({
          kind: 'string-hexadecimal',
          start,
          end: index,
          bytes: Uint8Array.from(out),
        });
      }
      if (isPdfWhitespace(byte)) {
        index += 1;
        continue;
      }
      const digit = hexDigitValue(byte);
      if (digit === undefined) {
        throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
          offset: index,
          reason: 'non-hexadecimal-digit-in-string',
        });
      }
      if (pending === undefined) pending = digit;
      else {
        out.push(pending * 16 + digit);
        pending = undefined;
      }
      index += 1;
    }

    throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
      offset: start,
      reason: 'unterminated-hexadecimal-string',
    });
  }

  #readKeyword(start: number): PdfToken {
    let index = start;
    while (index < this.#limit && isPdfRegularCharacter(this.#byteAt(index))) index += 1;
    if (index === start) {
      throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
        offset: start,
        reason: 'unexpected-delimiter',
      });
    }
    this.#position = index;
    return Object.freeze({
      kind: 'keyword',
      start,
      end: index,
      text: this.#bytes.latin1Slice(start, index),
    });
  }
}
