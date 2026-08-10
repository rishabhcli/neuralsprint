/**
 * Invariant I1 — no document byte leaves the device by default (boundary assertion).
 *
 * A PDF can name content that lives outside its own bytes: a stream with an `/F`
 * external file specification, a `/URI`, `/SubmitForm`, `/GoToR`, `/ImportData` or
 * `/Launch` action, a remote XFA resource, or an embedded-file spec whose `/FS` is
 * `/URL`. A renderer resolves those targets. A forensic redaction verifier must not,
 * because resolving one would send document-derived material off the device and
 * would let a crafted document exfiltrate the very content the user is trying to
 * remove.
 *
 * Encoding: every such target is funnelled through {@link classifyReferenceTarget},
 * whose return type cannot express "resolved" and whose `refused` field is the
 * literal type `true`. {@link resolveExternalTarget} is the only function shaped like
 * a resolver, and it always throws. There is no branch, option, flag, or policy that
 * turns resolution on.
 */

import { PdfBoundaryError } from './errors.js';

/**
 * How an out-of-document target is shaped. Every member is external: an in-document
 * indirect reference is a different type entirely and never reaches this module.
 */
export const EXTERNAL_TARGET_KINDS = [
  'scheme-qualified',
  'protocol-relative',
  'unc-path',
  'absolute-file-path',
  'relative-file-path',
  'inline-data-literal',
  'empty-or-unparseable',
] as const;

export type ExternalTargetKind = (typeof EXTERNAL_TARGET_KINDS)[number];

export type ExternalTargetClassification = Readonly<{
  schemaVersion: 1;
  kind: ExternalTargetKind;
  /** True when following this target would move bytes off the device. */
  egressCapable: boolean;
  /** Structurally `true`. No classification can report that a target was followed. */
  refused: true;
  /** Lowercased scheme when the target is scheme-qualified, otherwise `null`. */
  scheme: string | null;
  /** Length of the raw target. The target itself is never retained or echoed. */
  targetLength: number;
}>;

const SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/iu;

/**
 * Schemes this tool is willing to name in a classification.
 *
 * A scheme is attacker-controlled text. A document could declare a target such as
 * `<the-secret>:...`, and echoing the parsed scheme back into a finding would print
 * the secret in a report. Anything outside this fixed vocabulary is reported as
 * {@link UNKNOWN_SCHEME_LABEL} instead, so the classification's fields can only ever
 * contain values chosen by this repository.
 */
const KNOWN_SCHEMES: ReadonlySet<string> = new Set([
  'about',
  'blob',
  'cid',
  'data',
  'file',
  'ftp',
  'ftps',
  'gopher',
  'http',
  'https',
  'jar',
  'javascript',
  'ldap',
  'mailto',
  'news',
  'nntp',
  'sftp',
  'sms',
  'smb',
  'tel',
  'urn',
  'vbscript',
  'ws',
  'wss',
]);

export const UNKNOWN_SCHEME_LABEL = 'unlisted-scheme';

/**
 * Schemes that name an inline payload rather than a remote endpoint. They are still
 * refused, but they are not classified as egress-capable because following them moves
 * nothing off the device.
 */
const INLINE_SCHEMES: ReadonlySet<string> = new Set(['data', 'cid']);

/**
 * Classifies an out-of-document target without dereferencing it.
 *
 * The raw target is never stored in the result, never logged, and never returned, so
 * a crafted target cannot smuggle document content into a report through this path.
 */
export function classifyReferenceTarget(rawTarget: unknown): ExternalTargetClassification {
  if (typeof rawTarget !== 'string' || rawTarget.trim().length === 0) {
    return freeze(
      'empty-or-unparseable',
      false,
      null,
      typeof rawTarget === 'string' ? rawTarget.length : 0,
    );
  }

  const target = rawTarget.trim();
  const schemeMatch = SCHEME_PATTERN.exec(target);
  const parsedScheme = schemeMatch?.[1]?.toLowerCase() ?? null;

  if (parsedScheme !== null) {
    // A Windows drive letter (`C:\...`) also matches the scheme grammar; treat a
    // single-character scheme followed by a separator as a filesystem path.
    if (parsedScheme.length === 1 && /^[a-z]:[\\/]/iu.test(target)) {
      return freeze('absolute-file-path', true, null, target.length);
    }
    const scheme = KNOWN_SCHEMES.has(parsedScheme) ? parsedScheme : UNKNOWN_SCHEME_LABEL;
    if (INLINE_SCHEMES.has(parsedScheme)) {
      return freeze('inline-data-literal', false, scheme, target.length);
    }
    return freeze('scheme-qualified', true, scheme, target.length);
  }

  if (target.startsWith('\\\\')) return freeze('unc-path', true, null, target.length);
  if (target.startsWith('//')) return freeze('protocol-relative', true, null, target.length);
  if (target.startsWith('/') || target.startsWith('\\')) {
    return freeze('absolute-file-path', true, null, target.length);
  }
  return freeze('relative-file-path', true, null, target.length);
}

function freeze(
  kind: ExternalTargetKind,
  egressCapable: boolean,
  scheme: string | null,
  targetLength: number,
): ExternalTargetClassification {
  return Object.freeze({
    schemaVersion: 1 as const,
    kind,
    egressCapable,
    refused: true as const,
    scheme,
    targetLength,
  });
}

/**
 * A PDF file specification, reduced to the fields that can name something outside
 * the document. Values are unknown because they arrive from untrusted bytes.
 */
export type FileSpecificationInput = Readonly<{
  fileSystem?: unknown;
  file?: unknown;
  unicodeFile?: unknown;
  dosFile?: unknown;
  macFile?: unknown;
  unixFile?: unknown;
}>;

export type FileSpecificationAssessment = Readonly<{
  schemaVersion: 1;
  /** One classification per populated target slot, in declaration order. */
  targets: readonly ExternalTargetClassification[];
  /** True when at least one populated slot could move bytes off the device. */
  egressCapable: boolean;
  refused: true;
}>;

const FILE_SPECIFICATION_SLOTS = [
  'file',
  'unicodeFile',
  'dosFile',
  'macFile',
  'unixFile',
] as const satisfies readonly (keyof FileSpecificationInput)[];

/** Assesses every target slot of a file specification. No slot is ever dereferenced. */
export function assessFileSpecification(
  specification: FileSpecificationInput,
): FileSpecificationAssessment {
  const targets: ExternalTargetClassification[] = [];
  for (const slot of FILE_SPECIFICATION_SLOTS) {
    const value = specification[slot];
    if (value === undefined || value === null) continue;
    targets.push(classifyReferenceTarget(value));
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    targets: Object.freeze(targets),
    egressCapable: targets.some((target) => target.egressCapable),
    refused: true as const,
  });
}

/**
 * The only resolver-shaped function in the domain. It exists so that any future call
 * site that wants external content has exactly one place to go, and that place always
 * refuses. Its return type is `never`.
 */
export function resolveExternalTarget(
  classification: ExternalTargetClassification,
  where: string,
): never {
  throw new PdfBoundaryError('PDF_EXTERNAL_REFERENCE_REFUSED', {
    where,
    kind: classification.kind,
    scheme: classification.scheme ?? 'none',
    egressCapable: classification.egressCapable,
  });
}
