import fc from 'fast-check';

import {
  ATTACK_IDS,
  VERIFICATION_SURFACES,
  type AttackId,
  type VerificationSurface,
} from '../../src/findings/leak-classes.js';
import { CHARACTER_CLASS_SYMBOLS, type CharacterClass } from '../../src/findings/masking.js';
import {
  ATTACK_STATUSES,
  type AttackOutcome,
  type UnknownState,
} from '../../src/findings/verdict.js';
import { TEXT_VISIBILITY_KINDS, type TextVisibility } from '../../src/pdf/interpreter/coverage.js';
import type { RectanglePoints } from '../../src/pdf/interpreter/geometry.js';

export const attackIdArbitrary: fc.Arbitrary<AttackId> = fc.constantFrom(...ATTACK_IDS);

export const surfaceArbitrary: fc.Arbitrary<VerificationSurface> = fc.constantFrom(
  ...VERIFICATION_SURFACES,
);

export const attackOutcomeArbitrary: fc.Arbitrary<AttackOutcome> = fc
  .record({
    attackId: attackIdArbitrary,
    status: fc.constantFrom(...ATTACK_STATUSES),
    residualCount: fc.nat({ max: 12 }),
  })
  .map(({ attackId, status, residualCount }) =>
    Object.freeze({ schemaVersion: 1 as const, attackId, status, residualCount }),
  );

export const passingAttackOutcomeArbitrary: fc.Arbitrary<AttackOutcome> = attackIdArbitrary.map(
  (attackId) =>
    Object.freeze({
      schemaVersion: 1 as const,
      attackId,
      status: 'passed' as const,
      residualCount: 0,
    }),
);

export const unknownStateArbitrary: fc.Arbitrary<UnknownState> = fc
  .record({
    code: fc.constantFrom(
      'PDF_FILTER_UNSUPPORTED',
      'PDF_XREF_UNREADABLE',
      'PDF_ENCRYPTION_UNSUPPORTED',
      'PDF_STRUCTURE_AMBIGUOUS',
      'VERIFIER_ATTACK_INCOMPLETE',
    ),
    surface: surfaceArbitrary,
    detail: fc.constantFrom('object 12 0', 'page 3', 'revision 2', 'stream filter chain'),
  })
  .map(({ code, surface, detail }) =>
    Object.freeze({ schemaVersion: 1 as const, code, surface, detail }),
  );

export const textVisibilityArbitrary: fc.Arbitrary<TextVisibility> = fc
  .record({
    kind: fc.constantFrom(...TEXT_VISIBILITY_KINDS),
    coveredFraction: fc.double({ min: 0, max: 1, noNaN: true }),
    firstOccluderPaintIndex: fc.option(fc.nat({ max: 5_000 }), { nil: null }),
  })
  .map(({ kind, coveredFraction, firstOccluderPaintIndex }) =>
    Object.freeze({
      schemaVersion: 1 as const,
      kind,
      coveredFraction,
      firstOccluderPaintIndex,
    }),
  );

export const rectangleArbitrary: fc.Arbitrary<RectanglePoints> = fc
  .record({
    x: fc.double({ min: -1_000, max: 1_000, noNaN: true }),
    y: fc.double({ min: -1_000, max: 1_000, noNaN: true }),
    width: fc.double({ min: 0.5, max: 500, noNaN: true }),
    height: fc.double({ min: 0.5, max: 500, noNaN: true }),
  })
  .map(({ x, y, width, height }) =>
    Object.freeze({
      x0Points: x,
      y0Points: y,
      x1Points: x + width,
      y1Points: y + height,
    }),
  );

/**
 * Representative code points per character class.
 *
 * `other` uses control, format and combining-mark code points, which are none of
 * letter, digit, whitespace, punctuation or symbol, so they exercise the fallback
 * branch of the classifier rather than an accidental default.
 */
const OTHER_CLASS_SAMPLES: readonly string[] = [
  String.fromCharCode(0x00),
  String.fromCharCode(0x01),
  String.fromCharCode(0x200b),
  String.fromCharCode(0x0301),
  String.fromCharCode(0x00ad),
];

const CLASS_SAMPLES: Readonly<Record<CharacterClass, readonly string[]>> = {
  uppercase: ['A', 'Q', 'Z', 'Ä', 'Λ'],
  lowercase: ['a', 'q', 'z', 'ß', 'λ'],
  digit: ['0', '5', '9', '٣', '৭'],
  whitespace: [' ', '\t', '\n'],
  punctuation: ['-', '.', '/', '@', '#'],
  other: OTHER_CLASS_SAMPLES,
};

const CLASS_NAMES = Object.keys(CHARACTER_CLASS_SYMBOLS) as CharacterClass[];

/**
 * Two strings drawn from the same class sequence but with independently chosen
 * characters. Used to attack invariant I5: masking must be a function of the class
 * sequence alone, so both members of the pair must mask identically.
 */
export const classPreservingPairArbitrary: fc.Arbitrary<readonly [string, string]> = fc
  .array(
    fc.record({
      className: fc.constantFrom(...CLASS_NAMES),
      leftIndex: fc.nat({ max: 4 }),
      rightIndex: fc.nat({ max: 4 }),
    }),
    { minLength: 1, maxLength: 40 },
  )
  .map((entries) => {
    let left = '';
    let right = '';
    for (const entry of entries) {
      const samples = CLASS_SAMPLES[entry.className];
      left += samples[entry.leftIndex % samples.length] ?? 'a';
      right += samples[entry.rightIndex % samples.length] ?? 'a';
    }
    return [left, right] as const;
  });
