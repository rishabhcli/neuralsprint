/**
 * Invariant I1 — no document byte leaves the device by default.
 *
 * Encoding: document bytes are nominally typed. `DeviceLocalBytes` has a private
 * constructor and a private field, so TypeScript refuses to accept any structurally
 * similar object in its place. The only way to obtain one is {@link DeviceLocalBytes.adopt},
 * which copies the caller's buffer into a domain-owned allocation and records a
 * declared on-device origin. After adoption the caller's original buffer can be
 * detached or transferred without affecting inspection, and the domain copy is
 * never handed back out as a live reference.
 *
 * The class deliberately exposes read primitives only. It has no serializer to any
 * sink, no `toString` that emits content, and a `toJSON` that emits provenance and
 * length only, so a log line, telemetry event, or report can never carry bytes by
 * accident.
 */

import { PdfBoundaryError } from './errors.js';

/**
 * Where the bytes came from. Every member is an on-device source. There is no
 * network member, and adding one would be a visible change to this union.
 */
export const DEVICE_LOCAL_ORIGINS = [
  'user-file-input',
  'generated-fixture',
  'sanitizer-output',
  'test-vector',
] as const;

export type DeviceLocalOrigin = (typeof DEVICE_LOCAL_ORIGINS)[number];

export function isDeviceLocalOrigin(value: unknown): value is DeviceLocalOrigin {
  return typeof value === 'string' && (DEVICE_LOCAL_ORIGINS as readonly string[]).includes(value);
}

export type DeviceLocalBytesDescriptor = Readonly<{
  schemaVersion: 1;
  origin: DeviceLocalOrigin;
  byteLength: number;
}>;

export class DeviceLocalBytes {
  readonly origin: DeviceLocalOrigin;
  readonly byteLength: number;
  readonly #bytes: Uint8Array;

  private constructor(origin: DeviceLocalOrigin, bytes: Uint8Array) {
    this.origin = origin;
    this.#bytes = bytes;
    this.byteLength = bytes.byteLength;
  }

  /**
   * Adopts a caller-owned buffer as device-local document bytes.
   *
   * @param origin declared on-device provenance
   * @param source caller buffer; copied, never retained
   * @param maximumBytes explicit size budget for this boundary
   */
  static adopt(
    origin: DeviceLocalOrigin,
    source: ArrayBufferView | ArrayBuffer,
    maximumBytes: number,
  ): DeviceLocalBytes {
    if (!isDeviceLocalOrigin(origin)) {
      throw new PdfBoundaryError('PDF_BYTES_NOT_DEVICE_LOCAL', { reason: 'unknown-origin' });
    }
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
      throw new PdfBoundaryError('PDF_LIMIT_EXCEEDED', {
        field: 'maximumBytes',
        reason: 'not-positive',
      });
    }

    const view =
      source instanceof ArrayBuffer
        ? new Uint8Array(source)
        : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);

    if (view.byteLength === 0) {
      throw new PdfBoundaryError('PDF_BYTES_EMPTY', { origin });
    }
    if (view.byteLength > maximumBytes) {
      throw new PdfBoundaryError('PDF_BYTES_TOO_LARGE', {
        origin,
        limit: maximumBytes,
        requested: view.byteLength,
      });
    }

    // Copy: after this point the caller may neuter, transfer, or mutate `source`
    // without changing what was inspected, and nothing holds a reference that a
    // caller could later hand to a different sink.
    const owned = new Uint8Array(view.byteLength);
    owned.set(view);
    return new DeviceLocalBytes(origin, owned);
  }

  /** Unsigned byte at `index`, or `undefined` outside the buffer. Never throws on range. */
  byteAt(index: number): number | undefined {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.byteLength) return undefined;
    return this.#bytes[index];
  }

  /** Copy of `[start, end)`, clamped to the buffer. The internal buffer never escapes. */
  slice(start: number, end: number): Uint8Array {
    const from = Math.max(0, Math.min(this.byteLength, Math.trunc(start)));
    const to = Math.max(from, Math.min(this.byteLength, Math.trunc(end)));
    return this.#bytes.slice(from, to);
  }

  /** Latin-1 decoding of `[start, end)`. Used for PDF's byte-oriented syntax layer. */
  latin1Slice(start: number, end: number): string {
    const window = this.slice(start, end);
    let text = '';
    for (const byte of window) text += String.fromCharCode(byte);
    return text;
  }

  /** First index at or after `from` where `pattern` occurs, or `-1`. */
  indexOf(pattern: Uint8Array, from = 0): number {
    if (pattern.byteLength === 0 || pattern.byteLength > this.byteLength) return -1;
    const first = pattern[0];
    if (first === undefined) return -1;
    const start = Math.max(0, Math.trunc(from));
    const last = this.byteLength - pattern.byteLength;
    for (let index = start; index <= last; index += 1) {
      if (this.#bytes[index] !== first) continue;
      let matched = true;
      for (let offset = 1; offset < pattern.byteLength; offset += 1) {
        if (this.#bytes[index + offset] !== pattern[offset]) {
          matched = false;
          break;
        }
      }
      if (matched) return index;
    }
    return -1;
  }

  /** Last index at or before `before` where `pattern` occurs, or `-1`. */
  lastIndexOf(pattern: Uint8Array, before = this.byteLength): number {
    if (pattern.byteLength === 0 || pattern.byteLength > this.byteLength) return -1;
    const start = Math.min(this.byteLength - pattern.byteLength, Math.trunc(before));
    for (let index = start; index >= 0; index -= 1) {
      let matched = true;
      for (let offset = 0; offset < pattern.byteLength; offset += 1) {
        if (this.#bytes[index + offset] !== pattern[offset]) {
          matched = false;
          break;
        }
      }
      if (matched) return index;
    }
    return -1;
  }

  /** Provenance and length only. Content is structurally excluded from serialization. */
  toJSON(): DeviceLocalBytesDescriptor {
    return Object.freeze({
      schemaVersion: 1 as const,
      origin: this.origin,
      byteLength: this.byteLength,
    });
  }

  toString(): string {
    return `DeviceLocalBytes(${this.origin}, ${String(this.byteLength)} bytes)`;
  }
}
