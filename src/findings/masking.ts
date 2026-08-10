/**
 * Invariant I5 — real secrets are masked in UI, logs, telemetry, screenshots, and
 * reports by default (masking half; see `sensitive.ts` for the carrier half).
 *
 * Encoding: masking is *structural*, not a best-effort string replacement. A masked
 * value is a function of the input's character-class sequence and nothing else, so no
 * character of the secret survives into the masked form. That gives a property a test
 * can attack directly:
 *
 * > for any two secrets with the same class sequence, the masked evidence is equal.
 *
 * A best-effort redactor cannot satisfy that property, and neither can a hash: a hash
 * of a secret is itself derived from content, which `AGENTS.md` forbids in analytics
 * payloads and which is trivially reversible for a short structured token such as a
 * national identifier.
 */

export const CHARACTER_CLASS_SYMBOLS = {
  uppercase: 'A',
  lowercase: 'a',
  digit: 'D',
  whitespace: '_',
  punctuation: '.',
  other: '?',
} as const;

export type CharacterClass = keyof typeof CHARACTER_CLASS_SYMBOLS;
export type CharacterClassSymbol = (typeof CHARACTER_CLASS_SYMBOLS)[CharacterClass];

const UPPERCASE = /\p{Lu}/u;
const LOWERCASE = /\p{Ll}|\p{Lt}|\p{Lm}|\p{Lo}/u;
const DIGIT = /\p{Nd}/u;
const WHITESPACE = /\s/u;
const PUNCTUATION = /\p{P}|\p{S}/u;

/** Classifies one code point. Total: every code point maps to exactly one class. */
export function classifyCodePoint(codePoint: string): CharacterClass {
  if (UPPERCASE.test(codePoint)) return 'uppercase';
  if (LOWERCASE.test(codePoint)) return 'lowercase';
  if (DIGIT.test(codePoint)) return 'digit';
  if (WHITESPACE.test(codePoint)) return 'whitespace';
  if (PUNCTUATION.test(codePoint)) return 'punctuation';
  return 'other';
}

/**
 * Number of Unicode code points in `value`.
 *
 * `value.length` counts UTF-16 units and would report a different length for the same
 * visible text depending on plane, which would make masked evidence leak an encoding
 * detail rather than a stable shape.
 */
export function codePointCount(value: string): number {
  let count = 0;
  let index = 0;
  while (index < value.length) {
    const code = value.codePointAt(index);
    index += code !== undefined && code > 0xffff ? 2 : 1;
    count += 1;
  }
  return count;
}

/** The class sequence of a value, as a string over the fixed class alphabet. */
export function classSkeleton(value: string): string {
  let skeleton = '';
  for (const codePoint of value) skeleton += CHARACTER_CLASS_SYMBOLS[classifyCodePoint(codePoint)];
  return skeleton;
}

export type MaskedEvidence = Readonly<{
  schemaVersion: 1;
  /** Class sequence over `A a D _ . ?`. Contains no character of the secret. */
  classSkeleton: string;
  /** Length in Unicode code points. Length is the only quantity intentionally disclosed. */
  codePointLength: number;
}>;

/**
 * Longest class skeleton retained. Longer secrets are truncated with an explicit
 * marker so an unbounded value cannot inflate a report or a log line.
 */
export const MAXIMUM_SKELETON_LENGTH = 128;
const TRUNCATION_MARKER = '…';

/** Produces masked evidence for a secret. The secret itself is not retained. */
export function maskSecret(value: string): MaskedEvidence {
  const skeleton = classSkeleton(value);
  const codePointLength = codePointCount(value);
  const truncated =
    skeleton.length > MAXIMUM_SKELETON_LENGTH
      ? `${skeleton.slice(0, MAXIMUM_SKELETON_LENGTH)}${TRUNCATION_MARKER}`
      : skeleton;
  return Object.freeze({
    schemaVersion: 1 as const,
    classSkeleton: truncated,
    codePointLength,
  });
}

/** Human-readable rendering for a UI surface. Still contains no secret character. */
export function renderMaskedEvidence(evidence: MaskedEvidence): string {
  return `${evidence.classSkeleton} (${String(evidence.codePointLength)} characters)`;
}

/**
 * Boundary parser for masked evidence arriving from an untrusted edge, such as a
 * stored report. A skeleton containing any character outside the class alphabet is
 * refused, because that is exactly what a leaked secret would look like.
 */
export function parseMaskedEvidence(input: unknown): MaskedEvidence | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const skeleton = record.classSkeleton;
  const length = record.codePointLength;
  if (record.schemaVersion !== 1) return null;
  if (typeof skeleton !== 'string') return null;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) return null;
  if (!isClassAlphabetOnly(skeleton)) return null;
  if (skeleton.replace(TRUNCATION_MARKER, '').length > MAXIMUM_SKELETON_LENGTH) return null;
  return Object.freeze({
    schemaVersion: 1 as const,
    classSkeleton: skeleton,
    codePointLength: length,
  });
}

const CLASS_ALPHABET: ReadonlySet<string> = new Set([
  ...Object.values(CHARACTER_CLASS_SYMBOLS),
  TRUNCATION_MARKER,
]);

/** True when every character of `skeleton` belongs to the fixed class alphabet. */
export function isClassAlphabetOnly(skeleton: string): boolean {
  for (const codePoint of skeleton) {
    if (!CLASS_ALPHABET.has(codePoint)) return false;
  }
  return true;
}
