/**
 * Invariants I4 and I7 — unknown state yields NOT VERIFIED, and a green result names
 * exactly which attacks passed and never implies universal safety.
 *
 * Encoding, I4: the green variant's `unknowns` field has the type `readonly []`. An
 * empty tuple accepts no elements, so a scope carrying even one unknown state is not
 * assignable to the green variant. Unknowns cannot be "considered and dismissed";
 * they make the green branch unrepresentable.
 *
 * Encoding, I7: the green variant requires `attacksPassed` and `notCovered` to be
 * non-empty tuples. A result that names no attacks cannot be built, and a result that
 * claims nothing is out of scope cannot be built either. {@link STANDING_LIMITATIONS}
 * is merged into every scope, so "this document is safe" has no representation in the
 * type system at all.
 */

import { isSha256Hex } from '../pdf/parser/digest.js';
import { FindingsBoundaryError } from './errors.js';
import {
  isAttackId,
  isVerificationSurface,
  surfacesCoveredBy,
  type AttackId,
  type NonEmptyReadonlyArray,
  type VerificationSurface,
} from './leak-classes.js';

export const ATTACK_STATUSES = ['passed', 'failed', 'not-run', 'errored'] as const;
export type AttackStatus = (typeof ATTACK_STATUSES)[number];

export type AttackOutcome = Readonly<{
  schemaVersion: 1;
  attackId: AttackId;
  status: AttackStatus;
  /** Occurrences the attack found. Only `0` is compatible with `passed`. */
  residualCount: number;
}>;

export type UnknownState = Readonly<{
  schemaVersion: 1;
  /** Stable code, e.g. `PDF_FILTER_UNSUPPORTED`. Never document content. */
  code: string;
  surface: VerificationSurface;
  /** Safe operator-facing detail. Never document content. */
  detail: string;
}>;

export type Limitation = Readonly<{
  schemaVersion: 1;
  area: string;
  statement: string;
}>;

/**
 * Limitations that are true of every result this tool will ever produce. They are
 * merged into every scope, which is what makes `notCovered` structurally non-empty.
 */
export const STANDING_LIMITATIONS: NonEmptyReadonlyArray<Limitation> = Object.freeze([
  Object.freeze({
    schemaVersion: 1 as const,
    area: 'legal',
    // Deliberately phrased without any banned phrase from BANNED_SAFETY_PHRASES, even
    // in negated form: a limitation line that quotes a universal claim can be clipped
    // out of context in a screenshot and read as the opposite of what it says.
    statement:
      'This is not a legal certification and does not establish that the document is fit for release.',
  }),
  Object.freeze({
    schemaVersion: 1 as const,
    area: 'attack-coverage',
    statement:
      'Only the attacks named in this result were run. Content hidden by a technique not listed here would not have been found.',
  }),
  Object.freeze({
    schemaVersion: 1 as const,
    area: 'viewer-behaviour',
    statement: 'Other PDF viewers may interpret this file differently from the parser used here.',
  }),
  Object.freeze({
    schemaVersion: 1 as const,
    area: 'steganography',
    statement: 'Steganographic or covertly encoded content is out of scope and is not detected.',
  }),
]);

export type VerificationScope = Readonly<{
  schemaVersion: 1;
  attacksPassed: NonEmptyReadonlyArray<AttackId>;
  surfacesCovered: NonEmptyReadonlyArray<VerificationSurface>;
  notCovered: NonEmptyReadonlyArray<Limitation>;
  /** I4: an empty tuple. A scope with any unknown state is not assignable here. */
  unknowns: readonly [];
  emittedBytesSha256: string;
}>;

export const NOT_VERIFIED_REASONS = [
  'unknown-structure',
  'attack-not-run',
  'attack-errored',
  'no-attacks-declared',
  'cancelled',
  'limit-exceeded',
] as const;

export type NotVerifiedReason = (typeof NOT_VERIFIED_REASONS)[number];

export type Verdict =
  | Readonly<{
      schemaVersion: 1;
      status: 'not-verified';
      reason: NotVerifiedReason;
      unknowns: readonly UnknownState[];
      attacks: readonly AttackOutcome[];
      limitations: NonEmptyReadonlyArray<Limitation>;
    }>
  | Readonly<{
      schemaVersion: 1;
      status: 'leak-confirmed';
      failures: NonEmptyReadonlyArray<AttackOutcome>;
      unknowns: readonly UnknownState[];
      attacks: readonly AttackOutcome[];
      limitations: NonEmptyReadonlyArray<Limitation>;
    }>
  | Readonly<{
      schemaVersion: 1;
      status: 'verified-within-scope';
      scope: VerificationScope;
      attacks: readonly AttackOutcome[];
    }>;

export type VerdictInput = Readonly<{
  attacks: readonly AttackOutcome[];
  unknowns: readonly UnknownState[];
  emittedBytesSha256: string;
  /** Extra limitations specific to this run, merged after the standing set. */
  additionalLimitations?: readonly Limitation[];
}>;

/**
 * The single place a verdict is decided. NOT VERIFIED is the default and the fallback:
 * every early return below is non-green, and green is reachable only after all four
 * conditions hold.
 */
export function deriveVerdict(input: VerdictInput): Verdict {
  const limitations = mergeLimitations(input.additionalLimitations ?? []);
  const attacks = Object.freeze([...input.attacks]);
  const unknowns = Object.freeze([...input.unknowns]);

  // I4: any unknown state ends the decision here, before anything else is considered.
  if (unknowns.length > 0) {
    return Object.freeze({
      schemaVersion: 1 as const,
      status: 'not-verified' as const,
      reason: 'unknown-structure' as const,
      unknowns,
      attacks,
      limitations,
    });
  }

  const failures = attacks.filter(
    (attack) => attack.status === 'failed' || attack.residualCount > 0,
  );
  const [firstFailure, ...restFailures] = failures;
  if (firstFailure !== undefined) {
    const confirmed: NonEmptyReadonlyArray<AttackOutcome> = [firstFailure, ...restFailures];
    return Object.freeze({
      schemaVersion: 1 as const,
      status: 'leak-confirmed' as const,
      failures: confirmed,
      unknowns,
      attacks,
      limitations,
    });
  }

  const errored = attacks.find((attack) => attack.status === 'errored');
  if (errored !== undefined) {
    return notVerified('attack-errored', attacks, limitations);
  }
  const notRun = attacks.find((attack) => attack.status === 'not-run');
  if (notRun !== undefined) {
    return notVerified('attack-not-run', attacks, limitations);
  }

  const passed = attacks.filter((attack) => attack.status === 'passed').map((a) => a.attackId);
  const [firstAttack, ...restAttacks] = [...new Set(passed)];
  if (firstAttack === undefined) {
    return notVerified('no-attacks-declared', attacks, limitations);
  }
  if (!isSha256Hex(input.emittedBytesSha256)) {
    return notVerified('unknown-structure', attacks, limitations);
  }

  const surfaces = [...surfacesCoveredBy([firstAttack, ...restAttacks])].sort((left, right) =>
    left.localeCompare(right),
  );
  const [firstSurface, ...restSurfaces] = surfaces;
  if (firstSurface === undefined) {
    return notVerified('no-attacks-declared', attacks, limitations);
  }

  const attacksPassed: NonEmptyReadonlyArray<AttackId> = [firstAttack, ...restAttacks];
  const surfacesCovered: NonEmptyReadonlyArray<VerificationSurface> = [
    firstSurface,
    ...restSurfaces,
  ];
  // I4 made concrete: the only value assignable to `readonly []` is the empty tuple.
  const noUnknowns: readonly [] = Object.freeze([] as const);
  const scope: VerificationScope = Object.freeze({
    schemaVersion: 1 as const,
    attacksPassed,
    surfacesCovered,
    notCovered: limitations,
    unknowns: noUnknowns,
    emittedBytesSha256: input.emittedBytesSha256,
  });
  return Object.freeze({
    schemaVersion: 1 as const,
    status: 'verified-within-scope' as const,
    scope,
    attacks,
  });
}

function notVerified(
  reason: NotVerifiedReason,
  attacks: readonly AttackOutcome[],
  limitations: NonEmptyReadonlyArray<Limitation>,
): Verdict {
  return Object.freeze({
    schemaVersion: 1 as const,
    status: 'not-verified' as const,
    reason,
    unknowns: Object.freeze([]),
    attacks,
    limitations,
  });
}

/**
 * `notCovered` is non-empty by construction rather than by validation: the standing
 * limitations are a non-empty tuple, so the merged result is one too. There is no
 * input, including an empty `additional`, that yields an empty scope.
 */
function mergeLimitations(additional: readonly Limitation[]): NonEmptyReadonlyArray<Limitation> {
  const [standing, ...moreStanding] = STANDING_LIMITATIONS;
  return [standing, ...moreStanding, ...additional];
}

/**
 * Renders a verdict as operator-facing text.
 *
 * A green verdict always enumerates its attacks and always states its limitations, so
 * the rendered form cannot be quoted out of context as a universal safety claim.
 */
export function summarizeVerdict(verdict: Verdict): string {
  if (verdict.status === 'verified-within-scope') {
    const attacks = verdict.scope.attacksPassed.join(', ');
    const limits = verdict.scope.notCovered.map((limit) => limit.statement).join(' ');
    return `NO RESIDUALS FOUND by these attacks: ${attacks}. Not covered: ${limits}`;
  }
  if (verdict.status === 'leak-confirmed') {
    const failed = verdict.failures.map((failure) => failure.attackId).join(', ');
    return `LEAK CONFIRMED by these attacks: ${failed}.`;
  }
  const unknowns = verdict.unknowns.map((unknown) => unknown.code).join(', ');
  return `NOT VERIFIED (${verdict.reason})${unknowns.length > 0 ? `: ${unknowns}` : ''}.`;
}

/**
 * Phrases this repository refuses to publish about a result. Used by the copy lint in
 * `tests/unit/verdict.test.ts` and by the UI so a future wording change cannot quietly
 * turn a scoped result into a universal one.
 */
export const BANNED_SAFETY_PHRASES: readonly string[] = Object.freeze([
  'completely safe',
  'fully safe',
  'guaranteed safe',
  'guaranteed secure',
  'no hidden content',
  'nothing is hidden',
  'safe to publish',
  '100% safe',
  'certified redacted',
  'fully redacted',
  'all secrets removed',
]);

/** Returns the banned phrases present in `copy`, case-insensitively. */
export function bannedSafetyPhrasesIn(copy: string): readonly string[] {
  const lowered = copy.toLowerCase();
  return BANNED_SAFETY_PHRASES.filter((phrase) => lowered.includes(phrase));
}

/** Boundary parser for attack outcomes arriving from a worker. */
export function parseAttackOutcome(input: unknown): AttackOutcome {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new FindingsBoundaryError('FINDINGS_VERDICT_UNKNOWNS_PRESENT', { reason: 'shape' });
  }
  const record = input as Record<string, unknown>;
  const attackId = record.attackId;
  const status = record.status;
  const residualCount = record.residualCount;
  if (
    record.schemaVersion !== 1 ||
    !isAttackId(attackId) ||
    typeof status !== 'string' ||
    !(ATTACK_STATUSES as readonly string[]).includes(status) ||
    typeof residualCount !== 'number' ||
    !Number.isSafeInteger(residualCount) ||
    residualCount < 0
  ) {
    throw new FindingsBoundaryError('FINDINGS_VERDICT_UNKNOWNS_PRESENT', { reason: 'fields' });
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    attackId,
    status: status as AttackStatus,
    residualCount,
  });
}

/** Boundary parser for unknown states arriving from a worker. */
export function parseUnknownState(input: unknown): UnknownState {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new FindingsBoundaryError('FINDINGS_VERDICT_UNKNOWNS_PRESENT', { reason: 'shape' });
  }
  const record = input as Record<string, unknown>;
  const code = record.code;
  const surface = record.surface;
  const detail = record.detail;
  if (
    record.schemaVersion !== 1 ||
    typeof code !== 'string' ||
    code.length === 0 ||
    !isVerificationSurface(surface) ||
    typeof detail !== 'string'
  ) {
    throw new FindingsBoundaryError('FINDINGS_VERDICT_UNKNOWNS_PRESENT', { reason: 'fields' });
  }
  return Object.freeze({ schemaVersion: 1 as const, code, surface, detail });
}
