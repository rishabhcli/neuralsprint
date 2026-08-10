/**
 * The typed vocabulary every later stage shares: what can leak, where it can be
 * looked for, and which named attack looks there.
 *
 * These three lists are the backbone of invariants I4 and I7. A verdict may only be
 * green when it names attacks from {@link ATTACK_IDS}, and a leak class may only be
 * called resolved when the surfaces in {@link LEAK_CLASS_REQUIRED_SURFACES} have all
 * been attacked. Adding a leak class without adding its required surfaces is a type
 * error, not an omission someone has to notice in review.
 */

/** Every way this tool believes content can survive a fake redaction. */
export const LEAK_CLASSES = [
  'covered-selectable-text',
  'clipped-text',
  'invisible-render-mode-text',
  'hidden-optional-content',
  'unapplied-redaction-annotation',
  'annotation-content',
  'form-field-value',
  'document-info-metadata',
  'xmp-metadata',
  'embedded-attachment',
  'earlier-revision',
  'ocr-text-layer',
  'font-subset-glyph-names',
  'javascript-action',
  'egress-capable-action',
  'raster-only-pixels',
] as const;

export type LeakClass = (typeof LEAK_CLASSES)[number];

/** Places inside a document that an attack can read. */
export const VERIFICATION_SURFACES = [
  'object-graph',
  'decoded-streams',
  'raw-bytes',
  'text-extraction',
  'annotations',
  'form-fields',
  'document-info-metadata',
  'xmp-metadata',
  'embedded-files',
  'incremental-revisions',
  'optional-content',
  'font-programs',
  'rendered-pixels',
  'ocr-of-rendered-pages',
] as const;

export type VerificationSurface = (typeof VERIFICATION_SURFACES)[number];

/** Named attacks. A green verdict must enumerate exactly which of these passed. */
export const ATTACK_IDS = [
  'structural-object-graph-scan',
  'decoded-stream-byte-grep',
  'raw-byte-grep',
  'text-extraction-scan',
  'annotation-scan',
  'form-field-scan',
  'metadata-scan',
  'embedded-file-scan',
  'incremental-revision-scan',
  'optional-content-scan',
  'font-program-scan',
  'ocr-of-rendered-pages',
  'pixel-difference',
] as const;

export type AttackId = (typeof ATTACK_IDS)[number];

export type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

/** Which surfaces each attack actually reads. */
export const ATTACK_SURFACE_COVERAGE: Readonly<
  Record<AttackId, NonEmptyReadonlyArray<VerificationSurface>>
> = Object.freeze({
  'structural-object-graph-scan': ['object-graph'],
  'decoded-stream-byte-grep': ['decoded-streams'],
  'raw-byte-grep': ['raw-bytes'],
  'text-extraction-scan': ['text-extraction'],
  'annotation-scan': ['annotations'],
  'form-field-scan': ['form-fields'],
  'metadata-scan': ['document-info-metadata', 'xmp-metadata'],
  'embedded-file-scan': ['embedded-files'],
  'incremental-revision-scan': ['incremental-revisions', 'raw-bytes'],
  'optional-content-scan': ['optional-content', 'object-graph'],
  'font-program-scan': ['font-programs'],
  'ocr-of-rendered-pages': ['ocr-of-rendered-pages', 'rendered-pixels'],
  'pixel-difference': ['rendered-pixels'],
});

/**
 * Which surfaces must be attacked before a finding of each class can be called
 * resolved. Deliberately conservative: covered text, for example, is not resolved by
 * a text-extraction pass alone, because the glyphs can survive in a decoded stream,
 * in the raw bytes, in an earlier revision, or in a font program.
 */
export const LEAK_CLASS_REQUIRED_SURFACES: Readonly<
  Record<LeakClass, NonEmptyReadonlyArray<VerificationSurface>>
> = Object.freeze({
  'covered-selectable-text': [
    'object-graph',
    'decoded-streams',
    'raw-bytes',
    'text-extraction',
    'incremental-revisions',
  ],
  'clipped-text': ['object-graph', 'decoded-streams', 'raw-bytes', 'text-extraction'],
  'invisible-render-mode-text': ['object-graph', 'decoded-streams', 'raw-bytes', 'text-extraction'],
  'hidden-optional-content': ['optional-content', 'object-graph', 'decoded-streams', 'raw-bytes'],
  'unapplied-redaction-annotation': ['annotations', 'object-graph', 'raw-bytes'],
  'annotation-content': ['annotations', 'object-graph', 'raw-bytes'],
  'form-field-value': ['form-fields', 'object-graph', 'raw-bytes'],
  'document-info-metadata': ['document-info-metadata', 'raw-bytes'],
  'xmp-metadata': ['xmp-metadata', 'raw-bytes'],
  'embedded-attachment': ['embedded-files', 'object-graph', 'raw-bytes'],
  'earlier-revision': ['incremental-revisions', 'raw-bytes'],
  'ocr-text-layer': ['text-extraction', 'decoded-streams', 'raw-bytes'],
  'font-subset-glyph-names': ['font-programs', 'raw-bytes'],
  'javascript-action': ['object-graph', 'decoded-streams', 'raw-bytes'],
  'egress-capable-action': ['object-graph', 'annotations', 'raw-bytes'],
  'raster-only-pixels': ['rendered-pixels', 'ocr-of-rendered-pages'],
});

export function isLeakClass(value: unknown): value is LeakClass {
  return typeof value === 'string' && (LEAK_CLASSES as readonly string[]).includes(value);
}

export function isVerificationSurface(value: unknown): value is VerificationSurface {
  return typeof value === 'string' && (VERIFICATION_SURFACES as readonly string[]).includes(value);
}

export function isAttackId(value: unknown): value is AttackId {
  return typeof value === 'string' && (ATTACK_IDS as readonly string[]).includes(value);
}

/** Union of the surfaces read by `attacks`. */
export function surfacesCoveredBy(attacks: readonly AttackId[]): ReadonlySet<VerificationSurface> {
  const covered = new Set<VerificationSurface>();
  for (const attack of attacks) {
    for (const surface of ATTACK_SURFACE_COVERAGE[attack]) covered.add(surface);
  }
  return covered;
}

/** Surfaces a leak class still needs, given the attacks that have passed. */
export function missingSurfacesFor(
  leakClass: LeakClass,
  attacks: readonly AttackId[],
): readonly VerificationSurface[] {
  const covered = surfacesCoveredBy(attacks);
  return LEAK_CLASS_REQUIRED_SURFACES[leakClass].filter((surface) => !covered.has(surface));
}
