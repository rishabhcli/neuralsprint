/**
 * Invariants I2 and I6 — a visual overlay is never treated as removal, and removal is
 * only believed when emitted bytes were reloaded independently of sanitizer state.
 *
 * Encoding: "this content is gone" is not a boolean anyone can set. It is
 * {@link ResolvedFinding}, a nominal type with a private constructor, reachable only
 * through {@link resolveFinding}, which requires an {@link IndependentAbsenceProof}.
 * A proof is itself nominal and can only be minted from observations that all declare
 * `reloadedFromEmittedBytes: true`, `sharedSanitizerState: false`, zero residuals, and
 * one shared emitted-bytes digest.
 *
 * The consequence is structural: the interpreter, which is the only component that
 * knows about overlays, has no way to reach any of these constructors. Covering text
 * with a rectangle therefore cannot produce a resolved finding by any code path.
 */

import type { ContentPresence } from '../pdf/interpreter/coverage.js';
import { isSha256Hex } from '../pdf/parser/digest.js';
import { FindingsBoundaryError } from './errors.js';
import {
  isAttackId,
  isLeakClass,
  isVerificationSurface,
  missingSurfacesFor,
  type AttackId,
  type LeakClass,
  type NonEmptyReadonlyArray,
  type VerificationSurface,
} from './leak-classes.js';
import type { MaskedEvidence } from './masking.js';

export type FindingLocator = Readonly<{
  schemaVersion: 1;
  /** Zero-based page index, or `null` for document-level findings. */
  pageIndex: number | null;
  /** Indirect object number the content lives in, or `null` when not applicable. */
  objectNumber: number | null;
  /** Surface the finding was observed on. */
  surface: VerificationSurface;
}>;

export type Finding = Readonly<{
  schemaVersion: 1;
  findingId: string;
  leakClass: LeakClass;
  /**
   * Presence as the interpreter reported it. Its type has no "absent" member, so a
   * finding can never be born resolved.
   */
  presence: ContentPresence;
  /** Masked evidence only. The secret itself is never part of a finding. */
  evidence: MaskedEvidence;
  locator: FindingLocator;
  /** Id of the needle this finding relates to, or `null` for structural findings. */
  needleId: string | null;
}>;

export type AbsenceObservation = Readonly<{
  schemaVersion: 1;
  attackId: AttackId;
  surface: VerificationSurface;
  /** Occurrences still found. Any non-zero value makes the proof unmintable. */
  residualCount: number;
  /** Structurally `true`: the attack read reloaded emitted bytes. */
  reloadedFromEmittedBytes: true;
  /** Structurally `false`: the attack shared no state with the sanitizer. */
  sharedSanitizerState: false;
  /** Digest of the exact bytes the attack read. */
  emittedBytesSha256: string;
}>;

export class IndependentAbsenceProof {
  readonly emittedBytesSha256: string;
  readonly observations: NonEmptyReadonlyArray<AbsenceObservation>;
  readonly attacksPassed: NonEmptyReadonlyArray<AttackId>;
  readonly surfacesCovered: ReadonlySet<VerificationSurface>;

  private constructor(
    emittedBytesSha256: string,
    observations: NonEmptyReadonlyArray<AbsenceObservation>,
  ) {
    this.emittedBytesSha256 = emittedBytesSha256;
    this.observations = observations;
    const attacks = [...new Set(observations.map((observation) => observation.attackId))];
    const [firstAttack, ...restAttacks] = attacks;
    if (firstAttack === undefined) {
      throw new FindingsBoundaryError('FINDINGS_ABSENCE_PROOF_INVALID', { reason: 'no-attacks' });
    }
    this.attacksPassed = [firstAttack, ...restAttacks];
    this.surfacesCovered = new Set(observations.map((observation) => observation.surface));
  }

  /**
   * Mints a proof, or refuses.
   *
   * Refuses when: there are no observations; any observation still found a residual;
   * any observation was not produced by an independent reload; any observation shared
   * sanitizer state; or the observations disagree about which bytes they read.
   */
  static mint(observations: readonly unknown[]): IndependentAbsenceProof {
    if (observations.length === 0) {
      throw new FindingsBoundaryError('FINDINGS_ABSENCE_PROOF_INVALID', {
        reason: 'no-observations',
      });
    }

    const parsed: AbsenceObservation[] = [];
    for (const [index, candidate] of observations.entries()) {
      parsed.push(parseAbsenceObservation(candidate, index));
    }

    const [first, ...rest] = parsed;
    if (first === undefined) {
      throw new FindingsBoundaryError('FINDINGS_ABSENCE_PROOF_INVALID', {
        reason: 'no-observations',
      });
    }
    for (const observation of rest) {
      if (observation.emittedBytesSha256 !== first.emittedBytesSha256) {
        throw new FindingsBoundaryError('FINDINGS_ABSENCE_PROOF_INVALID', {
          reason: 'mixed-documents',
        });
      }
    }

    return new IndependentAbsenceProof(first.emittedBytesSha256, [first, ...rest]);
  }
}

function parseAbsenceObservation(input: unknown, index: number): AbsenceObservation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new FindingsBoundaryError('FINDINGS_ABSENCE_PROOF_INVALID', { index, reason: 'shape' });
  }
  const record = input as Record<string, unknown>;
  if (record.schemaVersion !== 1) {
    throw new FindingsBoundaryError('FINDINGS_ABSENCE_PROOF_INVALID', { index, reason: 'version' });
  }
  const attackId = record.attackId;
  const surface = record.surface;
  const residualCount = record.residualCount;
  const digest = record.emittedBytesSha256;

  if (!isAttackId(attackId)) {
    throw new FindingsBoundaryError('FINDINGS_ABSENCE_PROOF_INVALID', {
      index,
      reason: 'unknown-attack',
    });
  }
  if (!isVerificationSurface(surface)) {
    throw new FindingsBoundaryError('FINDINGS_ABSENCE_PROOF_INVALID', {
      index,
      reason: 'unknown-surface',
    });
  }
  if (typeof residualCount !== 'number' || !Number.isSafeInteger(residualCount)) {
    throw new FindingsBoundaryError('FINDINGS_ABSENCE_PROOF_INVALID', {
      index,
      reason: 'residual-count',
    });
  }
  if (residualCount !== 0) {
    throw new FindingsBoundaryError('FINDINGS_ABSENCE_PROOF_INVALID', {
      index,
      reason: 'residual-present',
      residualCount,
    });
  }
  if (record.reloadedFromEmittedBytes !== true) {
    throw new FindingsBoundaryError('FINDINGS_ABSENCE_PROOF_INVALID', {
      index,
      reason: 'not-reloaded',
    });
  }
  if (record.sharedSanitizerState !== false) {
    throw new FindingsBoundaryError('FINDINGS_ABSENCE_PROOF_INVALID', {
      index,
      reason: 'shared-sanitizer-state',
    });
  }
  if (!isSha256Hex(digest)) {
    throw new FindingsBoundaryError('FINDINGS_ABSENCE_PROOF_INVALID', { index, reason: 'digest' });
  }

  return Object.freeze({
    schemaVersion: 1 as const,
    attackId,
    surface,
    residualCount: 0,
    reloadedFromEmittedBytes: true as const,
    sharedSanitizerState: false as const,
    emittedBytesSha256: digest,
  });
}

/** A finding that has been proven absent from independently reloaded emitted bytes. */
export class ResolvedFinding {
  readonly finding: Finding;
  readonly proof: IndependentAbsenceProof;
  readonly attacksPassed: NonEmptyReadonlyArray<AttackId>;

  private constructor(finding: Finding, proof: IndependentAbsenceProof) {
    this.finding = finding;
    this.proof = proof;
    this.attacksPassed = proof.attacksPassed;
  }

  /**
   * The only constructor of `ResolvedFinding` in the repository.
   *
   * @internal Callable only from {@link resolveFinding}, which enforces surface coverage.
   */
  static create(finding: Finding, proof: IndependentAbsenceProof): ResolvedFinding {
    return new ResolvedFinding(finding, proof);
  }

  toJSON(): Readonly<{
    schemaVersion: 1;
    finding: Finding;
    emittedBytesSha256: string;
    attacksPassed: readonly AttackId[];
    surfacesCovered: readonly VerificationSurface[];
  }> {
    return Object.freeze({
      schemaVersion: 1 as const,
      finding: this.finding,
      emittedBytesSha256: this.proof.emittedBytesSha256,
      attacksPassed: [...this.attacksPassed],
      surfacesCovered: [...this.proof.surfacesCovered].sort((left, right) =>
        left.localeCompare(right),
      ),
    });
  }
}

/**
 * Resolves a finding, or refuses because the proof does not cover every surface the
 * leak class requires.
 *
 * This is where I2 becomes unavoidable: a covered-text finding requires the object
 * graph, decoded streams, raw bytes, text extraction, and the revision chain to have
 * been attacked. Drawing a rectangle satisfies none of them.
 */
export function resolveFinding(finding: Finding, proof: IndependentAbsenceProof): ResolvedFinding {
  if (!isLeakClass(finding.leakClass)) {
    throw new FindingsBoundaryError('FINDINGS_ABSENCE_UNPROVEN', { reason: 'unknown-leak-class' });
  }
  const missing = missingSurfacesFor(finding.leakClass, [...proof.attacksPassed]);
  if (missing.length > 0) {
    throw new FindingsBoundaryError('FINDINGS_ABSENCE_UNPROVEN', {
      leakClass: finding.leakClass,
      missingSurfaces: missing.join(','),
    });
  }
  for (const surface of missingSurfacesFor(finding.leakClass, [])) {
    if (!proof.surfacesCovered.has(surface)) {
      throw new FindingsBoundaryError('FINDINGS_ABSENCE_UNPROVEN', {
        leakClass: finding.leakClass,
        reason: 'surface-not-observed',
        surface,
      });
    }
  }
  return ResolvedFinding.create(finding, proof);
}
