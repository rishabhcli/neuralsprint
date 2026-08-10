import { describe, expect, it } from 'vitest';

import { isSha256Hex, sha256Hex } from '../../src/pdf/parser/digest.js';

function ascii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return bytes;
}

/**
 * Correctness oracle for the dependency-free digest: the published FIPS 180-4
 * SHA-256 example vectors plus the NIST one-million-character vector. These values
 * are external to this repository, so a bug in the implementation cannot also produce
 * the expectation.
 */
const FIPS_180_4_VECTORS: readonly (readonly [string, string])[] = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  [
    'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  ],
  [
    'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
    'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
  ],
];

describe('sha256Hex', () => {
  it('matches every published FIPS 180-4 example vector', () => {
    for (const [message, expected] of FIPS_180_4_VECTORS) {
      expect(sha256Hex(ascii(message)), `vector length ${String(message.length)}`).toBe(expected);
    }
  });

  it('matches the NIST one-million-character vector', () => {
    const million = new Uint8Array(1_000_000).fill('a'.charCodeAt(0));
    expect(sha256Hex(million)).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });

  it('is sensitive to every single-byte change at a block boundary', () => {
    const base = new Uint8Array(64);
    const baseline = sha256Hex(base);
    for (const index of [0, 31, 55, 56, 63]) {
      const mutated = base.slice();
      mutated[index] = 1;
      expect(sha256Hex(mutated), `byte ${String(index)}`).not.toBe(baseline);
    }
  });

  it('accepts only well-formed lowercase digests', () => {
    expect(isSha256Hex(sha256Hex(ascii('abc')))).toBe(true);
    expect(isSha256Hex(sha256Hex(ascii('abc')).toUpperCase())).toBe(false);
    expect(isSha256Hex('deadbeef')).toBe(false);
    expect(isSha256Hex(null)).toBe(false);
  });
});
