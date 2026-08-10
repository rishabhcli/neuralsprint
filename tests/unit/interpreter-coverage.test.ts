import { describe, expect, it } from 'vitest';

import {
  classifyTextVisibility,
  parseTextVisibility,
  presenceFromVisibility,
  TEXT_VISIBILITY_KINDS,
} from '../../src/pdf/interpreter/coverage.js';
import {
  coveredFraction,
  intersectRectangles,
  normalizeRectangle,
  rectangleAreaPoints,
  unionAreaPoints,
  type RectanglePoints,
} from '../../src/pdf/interpreter/geometry.js';

function box(x0: number, y0: number, x1: number, y1: number): RectanglePoints {
  return normalizeRectangle({ x0Points: x0, y0Points: y0, x1Points: x1, y1Points: y1 });
}

describe('geometry', () => {
  it('normalizes inverted edges and refuses non-finite or malformed rectangles', () => {
    expect(box(10, 10, 0, 0)).toStrictEqual({
      x0Points: 0,
      y0Points: 0,
      x1Points: 10,
      y1Points: 10,
    });
    expect(() => normalizeRectangle(null)).toThrow(/PDF_STRUCTURE_AMBIGUOUS/u);
    expect(() => normalizeRectangle([0, 0, 1, 1])).toThrow(/shape/u);
    expect(() =>
      normalizeRectangle({ x0Points: Number.NaN, y0Points: 0, x1Points: 1, y1Points: 1 }),
    ).toThrow(/non-finite/u);
    expect(() => normalizeRectangle({ x0Points: 0, y0Points: 0, x1Points: 1 })).toThrow(
      /non-finite/u,
    );
  });

  it('measures area and intersection, returning null when boxes only touch', () => {
    expect(rectangleAreaPoints(box(0, 0, 4, 5))).toBe(20);
    expect(intersectRectangles(box(0, 0, 4, 4), box(2, 2, 8, 8))).toStrictEqual(box(2, 2, 4, 4));
    expect(intersectRectangles(box(0, 0, 4, 4), box(4, 0, 8, 4))).toBeNull();
    expect(intersectRectangles(box(0, 0, 4, 4), box(9, 9, 10, 10))).toBeNull();
  });

  it('computes the exact union area rather than summing overlapping boxes', () => {
    expect(unionAreaPoints([])).toBe(0);
    // Two 4x4 boxes overlapping in a 2x2 corner: 16 + 16 - 4 = 28, not 32.
    expect(unionAreaPoints([box(0, 0, 4, 4), box(2, 2, 6, 6)])).toBe(28);
    expect(unionAreaPoints([box(0, 0, 4, 4), box(0, 0, 4, 4)])).toBe(16);
    expect(unionAreaPoints([box(0, 0, 0, 4)])).toBe(0);
  });

  it('never reports a degenerate region as covered', () => {
    expect(coveredFraction(box(1, 1, 1, 1), [box(0, 0, 10, 10)])).toBe(0);
    expect(coveredFraction(box(0, 0, 4, 4), [])).toBe(0);
    expect(coveredFraction(box(0, 0, 4, 4), [box(0, 0, 2, 4)])).toBeCloseTo(0.5, 9);
    expect(coveredFraction(box(0, 0, 4, 4), [box(-5, -5, 9, 9)])).toBe(1);
  });
});

describe('text visibility', () => {
  const run = { paintIndex: 10, boundsPoints: box(0, 0, 100, 20) };
  const fullCover = { paintIndex: 11, alpha: 1, boundsPoints: box(-5, -5, 105, 25) };

  const baseInputs = {
    run,
    occluders: [],
    clippedOut: false,
    textRenderMode: 0,
    inHiddenOptionalContent: false,
    coverageThreshold: 0.98,
  } as const;

  it('classifies each designed visibility state and never reports removal', () => {
    expect(classifyTextVisibility(baseInputs).kind).toBe('painted-visible');
    expect(classifyTextVisibility({ ...baseInputs, clippedOut: true }).kind).toBe('clipped-out');
    expect(classifyTextVisibility({ ...baseInputs, inHiddenOptionalContent: true }).kind).toBe(
      'hidden-optional-content',
    );
    expect(classifyTextVisibility({ ...baseInputs, textRenderMode: 3 }).kind).toBe(
      'invisible-text-render-mode',
    );
    expect(classifyTextVisibility({ ...baseInputs, occluders: [fullCover] }).kind).toBe(
      'covered-by-later-opaque-paint',
    );
    expect(
      classifyTextVisibility({
        ...baseInputs,
        occluders: [{ ...fullCover, alpha: 0.5 }],
      }).kind,
    ).toBe('transparent-or-unknown');

    for (const kind of TEXT_VISIBILITY_KINDS) {
      const presence = presenceFromVisibility({
        schemaVersion: 1,
        kind,
        coveredFraction: 1,
        firstOccluderPaintIndex: null,
      });
      expect(presence.startsWith('present')).toBe(true);
    }
  });

  it('records the earliest opaque occluder and no occluder when none applies', () => {
    const covered = classifyTextVisibility({
      ...baseInputs,
      occluders: [fullCover, { ...fullCover, paintIndex: 40 }],
    });
    expect(covered.firstOccluderPaintIndex).toBe(11);
    expect(classifyTextVisibility(baseInputs).firstOccluderPaintIndex).toBeNull();
    expect(
      classifyTextVisibility({ ...baseInputs, occluders: [{ ...fullCover, alpha: 0 }] }).kind,
    ).toBe('painted-visible');
  });

  it('refuses a coverage threshold outside the open unit interval', () => {
    for (const coverageThreshold of [0, -0.1, 1.01, Number.NaN]) {
      expect(() => classifyTextVisibility({ ...baseInputs, coverageThreshold })).toThrow(
        /out-of-range/u,
      );
    }
  });
});

describe('parseTextVisibility at the untrusted edge', () => {
  const valid = {
    schemaVersion: 1,
    kind: 'covered-by-later-opaque-paint',
    coveredFraction: 1,
    firstOccluderPaintIndex: 3,
  };

  it('accepts a well-formed value and freezes it', () => {
    const parsed = parseTextVisibility(valid);
    expect(parsed).toStrictEqual(valid);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(parseTextVisibility({ ...valid, firstOccluderPaintIndex: null })).toBeDefined();
  });

  it('refuses a fabricated "removed" kind and every other malformed field', () => {
    expect(() => parseTextVisibility({ ...valid, kind: 'removed' })).toThrow(/unknown-kind/u);
    expect(() => parseTextVisibility({ ...valid, kind: 7 })).toThrow(/unknown-kind/u);
    expect(() => parseTextVisibility(null)).toThrow(/shape/u);
    expect(() => parseTextVisibility(['x'])).toThrow(/shape/u);
    expect(() => parseTextVisibility({ ...valid, schemaVersion: 2 })).toThrow(
      /unsupported-version/u,
    );
    expect(() => parseTextVisibility({ ...valid, coveredFraction: 1.5 })).toThrow(/out-of-range/u);
    expect(() => parseTextVisibility({ ...valid, coveredFraction: 'lots' })).toThrow(
      /out-of-range/u,
    );
    expect(() => parseTextVisibility({ ...valid, firstOccluderPaintIndex: -1 })).toThrow(
      /not-a-paint-index/u,
    );
    expect(() => parseTextVisibility({ ...valid, firstOccluderPaintIndex: 'first' })).toThrow(
      /not-a-paint-index/u,
    );
  });
});
