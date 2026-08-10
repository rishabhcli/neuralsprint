/**
 * Axis-aligned geometry used to decide, from paint order rather than heuristics,
 * how much of a text run is hidden behind later opaque paint.
 *
 * Units are PDF user-space points (1/72 inch) throughout; the unit is carried in the
 * type name so a caller cannot mix device pixels into the same computation.
 */

import { PdfBoundaryError } from '../parser/errors.js';

export type RectanglePoints = Readonly<{
  /** Left edge, user-space points. */
  x0Points: number;
  /** Bottom edge, user-space points. */
  y0Points: number;
  /** Right edge, user-space points. */
  x1Points: number;
  /** Top edge, user-space points. */
  y1Points: number;
}>;

function isFinitePoint(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Normalizes an untrusted rectangle: reorders inverted edges and refuses non-finite
 * coordinates. A NaN edge would silently make every later comparison false, which is
 * exactly the kind of quiet wrong answer this project forbids.
 */
export function normalizeRectangle(input: unknown): RectanglePoints {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', { field: 'rectangle', reason: 'shape' });
  }
  const record = input as Record<string, unknown>;
  const x0 = record.x0Points;
  const y0 = record.y0Points;
  const x1 = record.x1Points;
  const y1 = record.y1Points;
  if (!isFinitePoint(x0) || !isFinitePoint(y0) || !isFinitePoint(x1) || !isFinitePoint(y1)) {
    throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
      field: 'rectangle',
      reason: 'non-finite',
    });
  }
  return Object.freeze({
    x0Points: Math.min(x0, x1),
    y0Points: Math.min(y0, y1),
    x1Points: Math.max(x0, x1),
    y1Points: Math.max(y0, y1),
  });
}

export function rectangleAreaPoints(rectangle: RectanglePoints): number {
  return (
    Math.max(0, rectangle.x1Points - rectangle.x0Points) *
    Math.max(0, rectangle.y1Points - rectangle.y0Points)
  );
}

export function intersectRectangles(
  first: RectanglePoints,
  second: RectanglePoints,
): RectanglePoints | null {
  const x0 = Math.max(first.x0Points, second.x0Points);
  const y0 = Math.max(first.y0Points, second.y0Points);
  const x1 = Math.min(first.x1Points, second.x1Points);
  const y1 = Math.min(first.y1Points, second.y1Points);
  if (x1 <= x0 || y1 <= y0) return null;
  return Object.freeze({ x0Points: x0, y0Points: y0, x1Points: x1, y1Points: y1 });
}

function uniqueSorted(values: readonly number[]): number[] {
  const sorted = [...values].sort((left, right) => left - right);
  const result: number[] = [];
  for (const value of sorted) {
    if (result.length === 0 || result[result.length - 1] !== value) result.push(value);
  }
  return result;
}

/**
 * Exact area of the union of `rectangles`, by coordinate compression.
 *
 * Summing individual areas would double-count overlapping occluders and could report
 * a text run as more than fully covered. Over-reporting coverage is the dangerous
 * direction here, so the union is computed exactly rather than approximated.
 */
export function unionAreaPoints(rectangles: readonly RectanglePoints[]): number {
  if (rectangles.length === 0) return 0;
  const xs = uniqueSorted(rectangles.flatMap((r) => [r.x0Points, r.x1Points]));
  const ys = uniqueSorted(rectangles.flatMap((r) => [r.y0Points, r.y1Points]));

  let total = 0;
  for (let xIndex = 0; xIndex + 1 < xs.length; xIndex += 1) {
    const left = xs[xIndex];
    const right = xs[xIndex + 1];
    if (left === undefined || right === undefined) continue;
    const width = right - left;
    if (width <= 0) continue;

    for (let yIndex = 0; yIndex + 1 < ys.length; yIndex += 1) {
      const bottom = ys[yIndex];
      const top = ys[yIndex + 1];
      if (bottom === undefined || top === undefined) continue;
      const height = top - bottom;
      if (height <= 0) continue;

      const covered = rectangles.some(
        (rectangle) =>
          rectangle.x0Points <= left &&
          rectangle.x1Points >= right &&
          rectangle.y0Points <= bottom &&
          rectangle.y1Points >= top,
      );
      if (covered) total += width * height;
    }
  }
  return total;
}

/**
 * Fraction of `subject` covered by the union of `occluders`, in `[0, 1]`.
 *
 * A zero-area subject returns `0`: an empty region is never reported as covered,
 * because "fully covered" must not be reachable by degenerate geometry.
 */
export function coveredFraction(
  subject: RectanglePoints,
  occluders: readonly RectanglePoints[],
): number {
  const subjectArea = rectangleAreaPoints(subject);
  if (subjectArea <= 0) return 0;
  const clipped: RectanglePoints[] = [];
  for (const occluder of occluders) {
    const intersection = intersectRectangles(subject, occluder);
    if (intersection !== null) clipped.push(intersection);
  }
  const covered = unionAreaPoints(clipped);
  return Math.min(1, Math.max(0, covered / subjectArea));
}
