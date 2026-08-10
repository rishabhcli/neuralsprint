/**
 * Invariant I5 — real secrets are masked in UI, logs, telemetry, screenshots, and
 * reports by default (carrier half; see `masking.ts` for the masking half).
 *
 * The verifier genuinely needs the secret in order to prove its absence from emitted
 * bytes. That is the one legitimate flow, and it is the flow most likely to leak, so
 * the secret is carried by a type that cannot be serialized by accident:
 *
 * - the value lives in a `#private` field, so spread, `Object.keys`, `structuredClone`
 *   and `JSON.stringify` cannot reach it;
 * - `toJSON` returns masked evidence, so a report or log line that stringifies a
 *   needle emits the mask rather than the secret;
 * - `toString` and the Node inspection hook return the mask, so template literals and
 *   console-style formatting emit the mask too;
 * - crossing a worker boundary requires an explicit {@link SensitiveChannelPayload},
 *   which is tagged so {@link assertReportSafe} can refuse it anywhere in a report.
 */

import { FindingsBoundaryError } from './errors.js';
import { maskSecret, type MaskedEvidence } from './masking.js';

/** Tag key that marks a plain object as belonging to the sensitive worker channel. */
export const SENSITIVE_CHANNEL_TAG = 'sensitiveChannel' as const;

/**
 * The only serializable form of a needle. It is structured-clone safe on purpose, so
 * it can cross the sanitizer-to-verifier worker boundary, and tagged on purpose, so a
 * report, log, or telemetry payload containing one is refused.
 */
export type SensitiveChannelPayload = Readonly<{
  schemaVersion: 1;
  [SENSITIVE_CHANNEL_TAG]: true;
  needleId: string;
  /** Unicode code points of the secret. Never emitted outside the worker channel. */
  codePoints: readonly number[];
  masked: MaskedEvidence;
}>;

const NEEDLE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

const nodeInspectSymbol = Symbol.for('nodejs.util.inspect.custom');

export class SensitiveNeedle {
  /** Caller-supplied stable identifier. Never derived from the secret's content. */
  readonly needleId: string;
  readonly masked: MaskedEvidence;
  readonly #value: string;

  private constructor(needleId: string, value: string) {
    this.needleId = needleId;
    this.#value = value;
    this.masked = maskSecret(value);
  }

  /**
   * Adopts a secret the user has selected for removal.
   *
   * @param needleId stable id chosen by the caller, e.g. `token-3`; content-independent
   * @param value the secret; retained privately, never re-emitted
   */
  static adopt(needleId: string, value: string): SensitiveNeedle {
    if (typeof needleId !== 'string' || !NEEDLE_ID_PATTERN.test(needleId)) {
      throw new FindingsBoundaryError('FINDINGS_NEEDLE_INVALID', { reason: 'bad-id' });
    }
    if (typeof value !== 'string' || value.length === 0) {
      throw new FindingsBoundaryError('FINDINGS_NEEDLE_INVALID', { reason: 'empty-value' });
    }
    return new SensitiveNeedle(needleId, value);
  }

  /** Reconstitutes a needle inside a worker from its explicit channel payload. */
  static fromChannelPayload(payload: unknown): SensitiveNeedle {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new FindingsBoundaryError('FINDINGS_NEEDLE_INVALID', { reason: 'shape' });
    }
    const record = payload as Record<string, unknown>;
    if (record.schemaVersion !== 1 || record[SENSITIVE_CHANNEL_TAG] !== true) {
      throw new FindingsBoundaryError('FINDINGS_NEEDLE_INVALID', { reason: 'untagged' });
    }
    const needleId = record.needleId;
    const codePoints = record.codePoints;
    if (typeof needleId !== 'string' || !Array.isArray(codePoints) || codePoints.length === 0) {
      throw new FindingsBoundaryError('FINDINGS_NEEDLE_INVALID', { reason: 'fields' });
    }
    let value = '';
    for (const codePoint of codePoints) {
      if (
        typeof codePoint !== 'number' ||
        !Number.isSafeInteger(codePoint) ||
        codePoint < 0 ||
        codePoint > 0x10ffff
      ) {
        throw new FindingsBoundaryError('FINDINGS_NEEDLE_INVALID', { reason: 'code-point' });
      }
      value += String.fromCodePoint(codePoint);
    }
    return SensitiveNeedle.adopt(needleId, value);
  }

  /** Explicit, auditable serialization for the worker channel only. */
  toChannelPayload(): SensitiveChannelPayload {
    return Object.freeze({
      schemaVersion: 1 as const,
      [SENSITIVE_CHANNEL_TAG]: true as const,
      needleId: this.needleId,
      codePoints: Object.freeze(
        Array.from(this.#value, (character) => character.codePointAt(0) ?? 0),
      ),
      masked: this.masked,
    });
  }

  /** Number of non-overlapping occurrences in decoded text. */
  occurrencesIn(haystack: string): number {
    if (this.#value.length === 0) return 0;
    let count = 0;
    let index = haystack.indexOf(this.#value);
    while (index !== -1) {
      count += 1;
      index = haystack.indexOf(this.#value, index + this.#value.length);
    }
    return count;
  }

  /**
   * Byte encodings a PDF can carry the secret in. Byte-level search must cover all of
   * them, because finding the secret only in decoded text would let a document hide it
   * as UTF-16 in a metadata stream or as a hex string in an object.
   */
  encodedForms(): readonly Uint8Array[] {
    const value = this.#value;
    const forms: Uint8Array[] = [];

    const utf8 = new Uint8Array(utf8Bytes(value));
    forms.push(utf8);

    const latin1: number[] = [];
    let latin1Representable = true;
    for (const character of value) {
      const code = character.codePointAt(0) ?? 0;
      if (code > 0xff) {
        latin1Representable = false;
        break;
      }
      latin1.push(code);
    }
    if (latin1Representable && latin1.length > 0) forms.push(new Uint8Array(latin1));

    const utf16be: number[] = [];
    const utf16le: number[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const unit = value.charCodeAt(index);
      utf16be.push((unit >> 8) & 0xff, unit & 0xff);
      utf16le.push(unit & 0xff, (unit >> 8) & 0xff);
    }
    forms.push(new Uint8Array(utf16be), new Uint8Array(utf16le));

    forms.push(asciiBytes(hexOf(utf8, false)), asciiBytes(hexOf(utf8, true)));

    return Object.freeze(dedupeByteArrays(forms));
  }

  /** Number of occurrences of any encoded form inside raw bytes. */
  occurrencesInBytes(haystack: Uint8Array): number {
    let total = 0;
    for (const form of this.encodedForms()) total += countByteOccurrences(haystack, form);
    return total;
  }

  /** Masked by construction. `JSON.stringify(needle)` can never emit the secret. */
  toJSON(): MaskedEvidence {
    return this.masked;
  }

  toString(): string {
    return `SensitiveNeedle(${this.needleId}: ${this.masked.classSkeleton})`;
  }

  [nodeInspectSymbol](): string {
    return this.toString();
  }
}

function utf8Bytes(value: string): number[] {
  const bytes: number[] = [];
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

function asciiBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1)
    bytes[index] = value.charCodeAt(index) & 0x7f;
  return bytes;
}

function hexOf(bytes: Uint8Array, uppercase: boolean): string {
  let text = '';
  for (const byte of bytes) {
    const pair = byte.toString(16).padStart(2, '0');
    text += uppercase ? pair.toUpperCase() : pair;
  }
  return text;
}

function dedupeByteArrays(forms: readonly Uint8Array[]): Uint8Array[] {
  const seen = new Set<string>();
  const unique: Uint8Array[] = [];
  for (const form of forms) {
    if (form.byteLength === 0) continue;
    const key = Array.from(form).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(form);
  }
  return unique;
}

/** Non-overlapping occurrences of `needle` inside `haystack`. */
export function countByteOccurrences(haystack: Uint8Array, needle: Uint8Array): number {
  if (needle.byteLength === 0 || needle.byteLength > haystack.byteLength) return 0;
  let count = 0;
  let index = 0;
  const last = haystack.byteLength - needle.byteLength;
  while (index <= last) {
    let matched = true;
    for (let offset = 0; offset < needle.byteLength; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      count += 1;
      index += needle.byteLength;
    } else {
      index += 1;
    }
  }
  return count;
}

const MAXIMUM_REPORT_DEPTH = 32;

/**
 * Boundary assertion for I5: refuses any value destined for a report, a log, a
 * telemetry event, or a screenshot payload that still carries unmasked material.
 *
 * Refused: `SensitiveNeedle` instances, sensitive channel payloads at any depth,
 * functions, and structures deeper than {@link MAXIMUM_REPORT_DEPTH}.
 */
export function assertReportSafe(value: unknown, path = '$'): void {
  walkReport(value, path, 0, new WeakSet<object>());
}

function walkReport(value: unknown, path: string, depth: number, seen: WeakSet<object>): void {
  if (depth > MAXIMUM_REPORT_DEPTH) {
    throw new FindingsBoundaryError('FINDINGS_REPORT_UNSAFE', { path, reason: 'too-deep' });
  }
  if (typeof value === 'function') {
    throw new FindingsBoundaryError('FINDINGS_REPORT_UNSAFE', { path, reason: 'function' });
  }
  if (typeof value !== 'object' || value === null) return;
  if (seen.has(value)) {
    throw new FindingsBoundaryError('FINDINGS_REPORT_UNSAFE', { path, reason: 'cycle' });
  }
  seen.add(value);

  if (value instanceof SensitiveNeedle) {
    throw new FindingsBoundaryError('FINDINGS_REPORT_UNSAFE', { path, reason: 'needle-instance' });
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      walkReport(entry, `${path}[${String(index)}]`, depth + 1, seen);
    });
    return;
  }

  const record = value as Record<string, unknown>;
  if (record[SENSITIVE_CHANNEL_TAG] === true) {
    throw new FindingsBoundaryError('FINDINGS_REPORT_UNSAFE', {
      path,
      reason: 'sensitive-channel',
    });
  }
  for (const [key, entry] of Object.entries(record)) {
    walkReport(entry, `${path}.${key}`, depth + 1, seen);
  }
}
