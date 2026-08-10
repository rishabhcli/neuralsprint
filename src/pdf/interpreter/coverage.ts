/**
 * Invariant I2 — a visual overlay is never treated as removal.
 *
 * Encoding: the interpreter's presence vocabulary has exactly two members, and
 * neither of them means "absent". {@link ContentPresence} is
 * `'present-and-extractable' | 'present-but-not-painted'`. There is no third member,
 * so no amount of opaque paint, clipping, invisible render mode, or hidden optional
 * content can produce a value that a later stage could read as removal.
 *
 * Absence is a different type in a different ownership area
 * (`src/findings/removal.ts`), and it can only be constructed from an independent
 * reload of emitted bytes. That is a compile-time barrier, not a convention: the
 * interpreter has no function that returns an absence proof and cannot import the
 * findings area.
 */

import { PdfBoundaryError } from '../parser/errors.js';
import { coveredFraction, normalizeRectangle, type RectanglePoints } from './geometry.js';

export const TEXT_VISIBILITY_KINDS = [
  'painted-visible',
  'covered-by-later-opaque-paint',
  'clipped-out',
  'invisible-text-render-mode',
  'hidden-optional-content',
  'transparent-or-unknown',
] as const;

export type TextVisibilityKind = (typeof TEXT_VISIBILITY_KINDS)[number];

export type TextVisibility = Readonly<{
  schemaVersion: 1;
  kind: TextVisibilityKind;
  /** Fraction of the text run's box hidden by later opaque paint, in `[0, 1]`. */
  coveredFraction: number;
  /** Paint-order index of the first occluder, or `null` when nothing occludes it. */
  firstOccluderPaintIndex: number | null;
}>;

/**
 * Presence, as the interpreter is allowed to describe it.
 *
 * `present-but-not-painted` covers every way a viewer can be persuaded not to draw
 * text: an overlay above it, a clipping path around it, text render mode 3, or an
 * optional content group switched off. In all of those cases the glyphs, their
 * encoding, and their bytes are still in the object graph and still extractable by a
 * different viewer, so they are *present*.
 */
export const CONTENT_PRESENCE = ['present-and-extractable', 'present-but-not-painted'] as const;

export type ContentPresence = (typeof CONTENT_PRESENCE)[number];

/**
 * Total function from visibility to presence.
 *
 * Its return type makes I2 a type error rather than a review comment: there is no
 * input for which this function can report removal.
 */
export function presenceFromVisibility(visibility: TextVisibility): ContentPresence {
  switch (visibility.kind) {
    case 'painted-visible':
      return 'present-and-extractable';
    case 'covered-by-later-opaque-paint':
    case 'clipped-out':
    case 'invisible-text-render-mode':
    case 'hidden-optional-content':
    case 'transparent-or-unknown':
      return 'present-but-not-painted';
  }
}

/**
 * True when this visibility is the classic fake redaction: content a user believes is
 * gone because a viewer does not draw it.
 */
export function looksLikeFakeRedaction(visibility: TextVisibility): boolean {
  return presenceFromVisibility(visibility) === 'present-but-not-painted';
}

export type OpaqueOccluder = Readonly<{
  /** Paint-order index within the page's content stream sequence. */
  paintIndex: number;
  /** Device-independent bounding box of the painted region. */
  boundsPoints: RectanglePoints;
  /** Alpha in `[0, 1]`. Only fully opaque paint can hide content from a viewer. */
  alpha: number;
}>;

export type TextRunGeometry = Readonly<{
  /** Paint-order index of the text-showing operator. */
  paintIndex: number;
  /** Union of the glyph boxes for this run. */
  boundsPoints: RectanglePoints;
}>;

export type VisibilityInputs = Readonly<{
  run: TextRunGeometry;
  occluders: readonly OpaqueOccluder[];
  /** True when a clipping path in force excludes the whole run. */
  clippedOut: boolean;
  /** PDF text render mode; `3` means "do not paint". */
  textRenderMode: number;
  /** True when the run sits in an optional content group that is currently off. */
  inHiddenOptionalContent: boolean;
  /** Coverage fraction at or above which the run counts as hidden by paint. */
  coverageThreshold: number;
}>;

const FULLY_OPAQUE_ALPHA = 1;

/**
 * Classifies one text run's visibility from paint order and geometry.
 *
 * Only occluders painted *after* the run and fully opaque can hide it. Partially
 * transparent paint is reported as `transparent-or-unknown` rather than as visible,
 * because "a human probably cannot read it" is not a property this tool is willing to
 * assert; both readings keep the content *present* either way.
 */
export function classifyTextVisibility(inputs: VisibilityInputs): TextVisibility {
  if (
    !Number.isFinite(inputs.coverageThreshold) ||
    inputs.coverageThreshold <= 0 ||
    inputs.coverageThreshold > 1
  ) {
    throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
      field: 'coverageThreshold',
      reason: 'out-of-range',
    });
  }

  const later = inputs.occluders.filter((occluder) => occluder.paintIndex > inputs.run.paintIndex);
  const opaque = later.filter((occluder) => occluder.alpha >= FULLY_OPAQUE_ALPHA);
  const translucent = later.filter(
    (occluder) => occluder.alpha > 0 && occluder.alpha < FULLY_OPAQUE_ALPHA,
  );

  const fraction = coveredFraction(
    inputs.run.boundsPoints,
    opaque.map((occluder) => occluder.boundsPoints),
  );
  const firstOccluderPaintIndex =
    opaque.length === 0
      ? null
      : opaque.reduce(
          (lowest, occluder) => Math.min(lowest, occluder.paintIndex),
          Number.POSITIVE_INFINITY,
        );

  const base = {
    schemaVersion: 1 as const,
    coveredFraction: fraction,
    firstOccluderPaintIndex:
      firstOccluderPaintIndex === null || !Number.isFinite(firstOccluderPaintIndex)
        ? null
        : firstOccluderPaintIndex,
  };

  if (inputs.clippedOut) return Object.freeze({ ...base, kind: 'clipped-out' });
  if (inputs.inHiddenOptionalContent) {
    return Object.freeze({ ...base, kind: 'hidden-optional-content' });
  }
  if (inputs.textRenderMode === 3) {
    return Object.freeze({ ...base, kind: 'invisible-text-render-mode' });
  }
  if (fraction >= inputs.coverageThreshold) {
    return Object.freeze({ ...base, kind: 'covered-by-later-opaque-paint' });
  }
  if (translucent.length > 0) return Object.freeze({ ...base, kind: 'transparent-or-unknown' });
  return Object.freeze({ ...base, kind: 'painted-visible' });
}

/**
 * Boundary assertion for visibility values that arrive from an untrusted edge, such
 * as a worker message or a stored report. A value whose `kind` is outside the union —
 * including a fabricated `"removed"` — is refused rather than coerced.
 */
export function parseTextVisibility(input: unknown): TextVisibility {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', { field: 'visibility', reason: 'shape' });
  }
  const record = input as Record<string, unknown>;
  const kind = record.kind;
  const fraction = record.coveredFraction;
  const occluder = record.firstOccluderPaintIndex;

  if (record.schemaVersion !== 1) {
    throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
      field: 'visibility.schemaVersion',
      reason: 'unsupported-version',
    });
  }
  if (typeof kind !== 'string' || !(TEXT_VISIBILITY_KINDS as readonly string[]).includes(kind)) {
    throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
      field: 'visibility.kind',
      reason: 'unknown-kind',
    });
  }
  if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
    throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
      field: 'visibility.coveredFraction',
      reason: 'out-of-range',
    });
  }
  if (
    occluder !== null &&
    (typeof occluder !== 'number' || !Number.isSafeInteger(occluder) || occluder < 0)
  ) {
    throw new PdfBoundaryError('PDF_STRUCTURE_AMBIGUOUS', {
      field: 'visibility.firstOccluderPaintIndex',
      reason: 'not-a-paint-index',
    });
  }

  return Object.freeze({
    schemaVersion: 1 as const,
    kind: kind as TextVisibilityKind,
    coveredFraction: fraction,
    firstOccluderPaintIndex: occluder,
  });
}

/** Rectangle helper re-exported so callers build occluder bounds through validation. */
export { normalizeRectangle };
export type { RectanglePoints };
