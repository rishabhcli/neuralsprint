import { describe, expect, it } from 'vitest';

import {
  FINDINGS_ERROR_CODES,
  FindingsBoundaryError,
  findingsUserMessageOf,
} from '../../src/findings/errors.js';
import {
  ATTACK_IDS,
  ATTACK_SURFACE_COVERAGE,
  isAttackId,
  isLeakClass,
  isVerificationSurface,
  LEAK_CLASSES,
  LEAK_CLASS_REQUIRED_SURFACES,
  missingSurfacesFor,
  surfacesCoveredBy,
  VERIFICATION_SURFACES,
} from '../../src/findings/leak-classes.js';
import {
  CHARACTER_CLASS_SYMBOLS,
  classifyCodePoint,
  codePointCount,
  MAXIMUM_SKELETON_LENGTH,
  maskSecret,
  parseMaskedEvidence,
  renderMaskedEvidence,
} from '../../src/findings/masking.js';
import {
  IndependentAbsenceProof,
  resolveFinding,
  type Finding,
} from '../../src/findings/removal.js';
import { countByteOccurrences, SensitiveNeedle } from '../../src/findings/sensitive.js';
import {
  ATTACK_STATUSES,
  bannedSafetyPhrasesIn,
  deriveVerdict,
  parseAttackOutcome,
  parseUnknownState,
  summarizeVerdict,
} from '../../src/findings/verdict.js';
import { sha256Hex } from '../../src/pdf/parser/digest.js';

const DIGEST = sha256Hex(new Uint8Array([1]));

describe('findings error vocabulary', () => {
  it('gives every code a safe message and a structural serialization', () => {
    for (const code of FINDINGS_ERROR_CODES) {
      expect(findingsUserMessageOf(code).length).toBeGreaterThan(10);
    }
    const error = new FindingsBoundaryError('FINDINGS_ABSENCE_UNPROVEN', { leakClass: 'x' });
    expect(error.toJSON()).toStrictEqual({
      schemaVersion: 1,
      code: 'FINDINGS_ABSENCE_UNPROVEN',
      userMessage: findingsUserMessageOf('FINDINGS_ABSENCE_UNPROVEN'),
      context: { leakClass: 'x' },
    });
    expect(error.retryability).toBe('not-retryable');
    expect(error.name).toBe('FindingsBoundaryError');
  });
});

describe('leak class vocabulary', () => {
  it('declares required surfaces for every leak class and coverage for every attack', () => {
    for (const leakClass of LEAK_CLASSES) {
      expect(isLeakClass(leakClass)).toBe(true);
      const required = LEAK_CLASS_REQUIRED_SURFACES[leakClass];
      expect(required.length).toBeGreaterThan(0);
      for (const surface of required) expect(isVerificationSurface(surface)).toBe(true);
    }
    for (const attack of ATTACK_IDS) {
      expect(isAttackId(attack)).toBe(true);
      expect(ATTACK_SURFACE_COVERAGE[attack].length).toBeGreaterThan(0);
    }
    expect(isLeakClass('not-a-class')).toBe(false);
    expect(isAttackId(3)).toBe(false);
    expect(isVerificationSurface('nowhere')).toBe(false);
  });

  it('reports every required surface as missing when no attack has run', () => {
    expect(surfacesCoveredBy([]).size).toBe(0);
    expect(missingSurfacesFor('earlier-revision', [])).toStrictEqual([
      'incremental-revisions',
      'raw-bytes',
    ]);
    expect(missingSurfacesFor('earlier-revision', ['incremental-revision-scan'])).toStrictEqual([]);
  });

  it('names every surface used by at least one attack', () => {
    const covered = surfacesCoveredBy([...ATTACK_IDS]);
    for (const surface of VERIFICATION_SURFACES) {
      expect(covered.has(surface), `no attack reads ${surface}`).toBe(true);
    }
  });
});

describe('masking', () => {
  it('classifies each character class and renders without secret characters', () => {
    expect(classifyCodePoint('A')).toBe('uppercase');
    expect(classifyCodePoint('a')).toBe('lowercase');
    expect(classifyCodePoint('7')).toBe('digit');
    expect(classifyCodePoint(' ')).toBe('whitespace');
    expect(classifyCodePoint('-')).toBe('punctuation');
    expect(classifyCodePoint('$')).toBe('punctuation');
    expect(classifyCodePoint(String.fromCharCode(0x01))).toBe('other');
    expect(maskSecret('000-00-0000').classSkeleton).toBe(
      `${CHARACTER_CLASS_SYMBOLS.digit.repeat(3)}${CHARACTER_CLASS_SYMBOLS.punctuation}${CHARACTER_CLASS_SYMBOLS.digit.repeat(2)}${CHARACTER_CLASS_SYMBOLS.punctuation}${CHARACTER_CLASS_SYMBOLS.digit.repeat(4)}`,
    );
    expect(renderMaskedEvidence(maskSecret('ab'))).toBe('aa (2 characters)');
  });

  it('counts code points rather than UTF-16 units', () => {
    expect(codePointCount('abc')).toBe(3);
    expect(codePointCount('😀')).toBe(1);
    expect(maskSecret('😀').codePointLength).toBe(1);
  });

  it('truncates an unbounded skeleton with an explicit marker', () => {
    const masked = maskSecret('a'.repeat(MAXIMUM_SKELETON_LENGTH + 50));
    expect(masked.classSkeleton).toHaveLength(MAXIMUM_SKELETON_LENGTH + 1);
    expect(masked.codePointLength).toBe(MAXIMUM_SKELETON_LENGTH + 50);
    expect(parseMaskedEvidence(masked)).toStrictEqual(masked);
  });

  it('refuses evidence whose skeleton contains anything outside the class alphabet', () => {
    expect(parseMaskedEvidence(null)).toBeNull();
    expect(parseMaskedEvidence([])).toBeNull();
    expect(
      parseMaskedEvidence({ schemaVersion: 2, classSkeleton: 'AA', codePointLength: 2 }),
    ).toBeNull();
    expect(
      parseMaskedEvidence({ schemaVersion: 1, classSkeleton: 5, codePointLength: 2 }),
    ).toBeNull();
    expect(
      parseMaskedEvidence({ schemaVersion: 1, classSkeleton: 'AA', codePointLength: -1 }),
    ).toBeNull();
    // The leaked-secret case: a skeleton that still carries the original characters.
    expect(
      parseMaskedEvidence({ schemaVersion: 1, classSkeleton: '000-00-0000', codePointLength: 11 }),
    ).toBeNull();
    expect(
      parseMaskedEvidence({
        schemaVersion: 1,
        classSkeleton: 'A'.repeat(MAXIMUM_SKELETON_LENGTH + 5),
        codePointLength: 5,
      }),
    ).toBeNull();
  });
});

describe('sensitive needles', () => {
  it('counts non-overlapping byte occurrences and refuses degenerate needles', () => {
    const haystack = new Uint8Array([1, 1, 1, 1]);
    expect(countByteOccurrences(haystack, new Uint8Array([1, 1]))).toBe(2);
    expect(countByteOccurrences(haystack, new Uint8Array([]))).toBe(0);
    expect(countByteOccurrences(haystack, new Uint8Array(9))).toBe(0);
    expect(countByteOccurrences(haystack, new Uint8Array([2]))).toBe(0);
  });

  it('exposes only encodings a PDF can actually carry, deduplicated', () => {
    const needle = SensitiveNeedle.adopt('token-1', 'AB');
    const forms = needle.encodedForms();
    expect(forms.length).toBeGreaterThanOrEqual(4);
    const keys = new Set(forms.map((form) => Array.from(form).join(',')));
    expect(keys.size).toBe(forms.length);
    expect(needle.occurrencesIn('AB AB')).toBe(2);
    expect(needle.occurrencesIn('none here')).toBe(0);
  });

  it('encodes astral code points as UTF-8 and round-trips them through the channel', () => {
    const needle = SensitiveNeedle.adopt('token-1', '😀x');
    const payload = needle.toChannelPayload();
    expect(payload.codePoints).toHaveLength(2);
    expect(SensitiveNeedle.fromChannelPayload(payload).masked).toStrictEqual(needle.masked);
  });

  it('refuses malformed channel payloads', () => {
    const payload = SensitiveNeedle.adopt('token-1', 'abc').toChannelPayload();
    expect(() => SensitiveNeedle.fromChannelPayload(null)).toThrow(/shape/u);
    expect(() => SensitiveNeedle.fromChannelPayload([payload])).toThrow(/shape/u);
    expect(() => SensitiveNeedle.fromChannelPayload({ ...payload, schemaVersion: 2 })).toThrow(
      /untagged/u,
    );
    expect(() => SensitiveNeedle.fromChannelPayload({ ...payload, codePoints: [] })).toThrow(
      /fields/u,
    );
    expect(() =>
      SensitiveNeedle.fromChannelPayload({ ...payload, codePoints: [0x110000] }),
    ).toThrow(/code-point/u);
    expect(() => SensitiveNeedle.fromChannelPayload({ ...payload, needleId: 5 })).toThrow(
      /fields/u,
    );
  });
});

describe('absence proofs and finding resolution', () => {
  const finding: Finding = Object.freeze({
    schemaVersion: 1 as const,
    findingId: 'finding-1',
    leakClass: 'earlier-revision' as const,
    presence: 'present-but-not-painted' as const,
    evidence: maskSecret('abc'),
    locator: Object.freeze({
      schemaVersion: 1 as const,
      pageIndex: null,
      objectNumber: null,
      surface: 'incremental-revisions' as const,
    }),
    needleId: null,
  });

  const observation = {
    schemaVersion: 1 as const,
    attackId: 'incremental-revision-scan' as const,
    surface: 'incremental-revisions' as const,
    residualCount: 0,
    reloadedFromEmittedBytes: true,
    sharedSanitizerState: false,
    emittedBytesSha256: DIGEST,
  };

  it('refuses to mint from nothing, from a mixed document set, or from malformed input', () => {
    expect(() => IndependentAbsenceProof.mint([])).toThrow(/no-observations/u);
    expect(() =>
      IndependentAbsenceProof.mint([
        observation,
        { ...observation, emittedBytesSha256: sha256Hex(new Uint8Array([2])) },
      ]),
    ).toThrow(/mixed-documents/u);
    expect(() => IndependentAbsenceProof.mint([null])).toThrow(/shape/u);
    expect(() => IndependentAbsenceProof.mint([{ ...observation, schemaVersion: 2 }])).toThrow(
      /version/u,
    );
    expect(() => IndependentAbsenceProof.mint([{ ...observation, attackId: 'nope' }])).toThrow(
      /unknown-attack/u,
    );
    expect(() => IndependentAbsenceProof.mint([{ ...observation, surface: 'nope' }])).toThrow(
      /unknown-surface/u,
    );
    expect(() => IndependentAbsenceProof.mint([{ ...observation, residualCount: 0.5 }])).toThrow(
      /residual-count/u,
    );
    expect(() =>
      IndependentAbsenceProof.mint([{ ...observation, emittedBytesSha256: 'short' }]),
    ).toThrow(/digest/u);
  });

  it('resolves only when the proof covers every required surface for the class', () => {
    const proof = IndependentAbsenceProof.mint([
      observation,
      { ...observation, attackId: 'raw-byte-grep', surface: 'raw-bytes' },
    ]);
    const resolved = resolveFinding(finding, proof);
    expect(resolved.attacksPassed).toContain('incremental-revision-scan');
    expect(resolved.toJSON().surfacesCovered).toStrictEqual(['incremental-revisions', 'raw-bytes']);

    // A leak class whose required surfaces no passed attack reads at all.
    const wrongAttack = IndependentAbsenceProof.mint([
      { ...observation, attackId: 'raw-byte-grep', surface: 'raw-bytes' },
    ]);
    expect(() => resolveFinding({ ...finding, leakClass: 'xmp-metadata' }, wrongAttack)).toThrow(
      /missingSurfaces/u,
    );
    expect(() =>
      resolveFinding({ ...finding, leakClass: 'not-a-class' as Finding['leakClass'] }, proof),
    ).toThrow(/unknown-leak-class/u);
  });

  it('refuses when an attack claims a surface it did not actually observe', () => {
    // `incremental-revision-scan` covers both revisions and raw bytes on paper, but this
    // proof only observed the revision surface, so the claim must still be rejected.
    const overclaiming = IndependentAbsenceProof.mint([observation]);
    expect(overclaiming.surfacesCovered.has('raw-bytes')).toBe(false);
    expect(() => resolveFinding(finding, overclaiming)).toThrow(/FINDINGS_ABSENCE_UNPROVEN/u);
  });
});

describe('verdict boundary parsing', () => {
  const outcome = {
    schemaVersion: 1,
    attackId: 'raw-byte-grep',
    status: 'passed',
    residualCount: 0,
  };

  it('accepts well-formed outcomes and unknown states', () => {
    expect(parseAttackOutcome(outcome)).toStrictEqual(outcome);
    for (const status of ATTACK_STATUSES) {
      expect(parseAttackOutcome({ ...outcome, status }).status).toBe(status);
    }
    const unknown = {
      schemaVersion: 1,
      code: 'PDF_FILTER_UNSUPPORTED',
      surface: 'decoded-streams',
      detail: 'object 7 0',
    };
    expect(parseUnknownState(unknown)).toStrictEqual(unknown);
  });

  it('refuses malformed outcomes and unknown states', () => {
    expect(() => parseAttackOutcome(null)).toThrow(/shape/u);
    expect(() => parseAttackOutcome([outcome])).toThrow(/shape/u);
    expect(() => parseAttackOutcome({ ...outcome, attackId: 'nope' })).toThrow(/fields/u);
    expect(() => parseAttackOutcome({ ...outcome, status: 'maybe' })).toThrow(/fields/u);
    expect(() => parseAttackOutcome({ ...outcome, residualCount: -1 })).toThrow(/fields/u);
    expect(() => parseUnknownState(null)).toThrow(/shape/u);
    expect(() =>
      parseUnknownState({ schemaVersion: 1, code: '', surface: 'raw-bytes', detail: 'x' }),
    ).toThrow(/fields/u);
    expect(() =>
      parseUnknownState({ schemaVersion: 1, code: 'X', surface: 'nowhere', detail: 'x' }),
    ).toThrow(/fields/u);
  });

  it('summarizes a confirmed leak by naming the attacks that found it', () => {
    const verdict = deriveVerdict({
      attacks: [
        { schemaVersion: 1, attackId: 'raw-byte-grep', status: 'failed', residualCount: 3 },
      ],
      unknowns: [],
      emittedBytesSha256: DIGEST,
    });
    expect(verdict.status).toBe('leak-confirmed');
    expect(summarizeVerdict(verdict)).toBe('LEAK CONFIRMED by these attacks: raw-byte-grep.');
  });

  it('reports NOT VERIFIED without unknown codes when the digest is unusable', () => {
    const verdict = deriveVerdict({
      attacks: [
        { schemaVersion: 1, attackId: 'raw-byte-grep', status: 'passed', residualCount: 0 },
      ],
      unknowns: [],
      emittedBytesSha256: 'not-a-digest',
    });
    expect(summarizeVerdict(verdict)).toBe('NOT VERIFIED (unknown-structure).');
    expect(bannedSafetyPhrasesIn(summarizeVerdict(verdict))).toStrictEqual([]);
  });
});
