/**
 * A PDF syntax writer and object generator used as a test oracle.
 *
 * This is not a production module and is not a test double for one: it is an independent
 * implementation of the serialization direction, so a round-trip property compares the
 * parser against something that was written from the grammar rather than against itself.
 * When the sanitizer's real writer arrives it will replace this as the round-trip
 * partner, which is a stronger oracle again.
 */

import fc from 'fast-check';

import { DeviceLocalBytes } from '../../src/pdf/parser/device-local-bytes.js';
import {
  pdfArray,
  pdfBoolean,
  pdfDictionary,
  pdfInteger,
  pdfName,
  pdfReal,
  pdfReference,
  pdfString,
  PDF_NULL,
  type PdfObject,
} from '../../src/pdf/parser/objects.js';

const REGULAR_NAME_CHARACTER = /^[A-Za-z0-9_+-]$/u;

/** Writes a name, escaping every byte the grammar does not allow bare. */
export function serializeName(name: string): string {
  let out = '/';
  for (let index = 0; index < name.length; index += 1) {
    const character = name.charAt(index);
    if (REGULAR_NAME_CHARACTER.test(character)) {
      out += character;
      continue;
    }
    out += `#${name.charCodeAt(index).toString(16).padStart(2, '0')}`;
  }
  return out;
}

/** Writes a literal string, escaping the three characters that would end or nest it. */
export function serializeLiteralString(bytes: Uint8Array): string {
  let out = '(';
  for (const byte of bytes) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) {
      out += `\\${String.fromCharCode(byte)}`;
    } else if (byte < 0x20 || byte > 0x7e) {
      out += `\\${byte.toString(8).padStart(3, '0')}`;
    } else {
      out += String.fromCharCode(byte);
    }
  }
  return `${out})`;
}

export function serializeHexadecimalString(bytes: Uint8Array): string {
  let out = '<';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return `${out}>`;
}

/** Writes any object in PDF syntax. Streams are written with a correct `/Length`. */
export function serializePdfObject(object: PdfObject): string {
  switch (object.kind) {
    case 'null':
      return 'null';
    case 'boolean':
      return object.value ? 'true' : 'false';
    case 'integer':
      return String(object.value);
    case 'real':
      return object.value.toFixed(2);
    case 'name':
      return serializeName(object.name);
    case 'string':
      return object.writtenAs === 'literal'
        ? serializeLiteralString(object.bytes)
        : serializeHexadecimalString(object.bytes);
    case 'array':
      return `[ ${object.items.map(serializePdfObject).join(' ')} ]`;
    case 'dictionary': {
      const entries = [...object.entries.entries()]
        .map(([key, value]) => `${serializeName(key)} ${serializePdfObject(value)}`)
        .join(' ');
      return `<< ${entries} >>`;
    }
    case 'reference':
      return `${String(object.objectNumber)} ${String(object.generation)} R`;
    case 'stream':
      throw new Error('serializePdfObject: use serializeStream for streams');
  }
}

/** Writes a stream body with a declared length that may deliberately disagree. */
export function serializeStream(
  entries: readonly (readonly [string, PdfObject])[],
  payload: string,
  declaredLength: number | 'omit' | 'indirect' = payload.length,
): string {
  const declared =
    declaredLength === 'omit'
      ? ''
      : declaredLength === 'indirect'
        ? '/Length 99 0 R '
        : `/Length ${String(declaredLength)} `;
  const written = entries
    .map(([key, value]) => `${serializeName(key)} ${serializePdfObject(value)}`)
    .join(' ');
  return `<< ${declared}${written} >>\nstream\n${payload}\nendstream`;
}

/** Wraps a serialized body as an indirect object. */
export function serializeIndirectObject(
  objectNumber: number,
  generation: number,
  body: string,
): string {
  return `${String(objectNumber)} ${String(generation)} obj\n${body}\nendobj\n`;
}

/** Adopts PDF source text as device-local bytes for the parser under test. */
export function adoptSource(source: string): DeviceLocalBytes {
  const bytes = new Uint8Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    bytes[index] = source.charCodeAt(index) & 0xff;
  }
  return DeviceLocalBytes.adopt('test-vector', bytes, 64 * 1024 * 1024);
}

const nameTextArbitrary = fc
  .array(fc.integer({ min: 1, max: 255 }), { minLength: 1, maxLength: 12 })
  .map((codes) => codes.map((code) => String.fromCharCode(code)).join(''));

const byteStringArbitrary = fc
  .array(fc.integer({ min: 0, max: 255 }), { maxLength: 24 })
  .map((codes) => Uint8Array.from(codes));

/**
 * Reals are generated on a hundredths grid so the written form is exact.
 *
 * PDF has no exponent notation, so an arbitrary double could not be written back
 * faithfully; a round-trip failure there would be an artefact of the oracle rather than a
 * parser defect.
 */
const realArbitrary = fc
  .integer({ min: -1_000_000, max: 1_000_000 })
  .map((scaled) => Number((scaled / 100).toFixed(2)));

const leafArbitrary: fc.Arbitrary<PdfObject> = fc.oneof(
  fc.constant(PDF_NULL),
  fc.boolean().map(pdfBoolean),
  fc.integer({ min: -1_000_000, max: 1_000_000 }).map(pdfInteger),
  realArbitrary.map(pdfReal),
  nameTextArbitrary.map(pdfName),
  byteStringArbitrary.map((bytes) => pdfString(bytes, 'literal')),
  byteStringArbitrary.map((bytes) => pdfString(bytes, 'hexadecimal')),
  fc
    .tuple(fc.integer({ min: 0, max: 100_000 }), fc.integer({ min: 0, max: 65_535 }))
    .map(([objectNumber, generation]) => pdfReference(objectNumber, generation)),
);

/** Arbitrary object graphs, excluding streams, which are exercised separately. */
export const pdfObjectArbitrary: fc.Arbitrary<PdfObject> = fc.letrec<{ node: PdfObject }>(
  (tie) => ({
    node: fc.oneof(
      { depthSize: 'small', withCrossShrink: true },
      leafArbitrary,
      fc.array(tie('node'), { maxLength: 6 }).map((items) => pdfArray(items)),
      fc
        .uniqueArray(fc.tuple(nameTextArbitrary, tie('node')), {
          maxLength: 6,
          selector: ([key]) => key,
        })
        .map((pairs) => pdfDictionary(new Map(pairs))),
    ),
  }),
).node;
