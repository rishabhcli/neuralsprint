/**
 * Fault injection against every domain invariant.
 *
 * `GOAL.md` section 6, Tier 1 asks, for each invariant, "which fault-injection scenario
 * attacks it while a component is failing?" Each case below breaks a component on
 * purpose — a detached buffer, a mid-write truncation, an attack that throws, a
 * degraded worker message — and then asserts that the invariant still holds on the way
 * out. A passing happy path proves nothing about these paths.
 *
 * `structuredClone` is used as the real serialization boundary rather than a stub: it
 * is the exact mechanism `postMessage` uses, so what survives it here is what would
 * survive a real worker hop.
 */

import { describe, expect, it } from 'vitest';

import { FindingsBoundaryError } from '../../src/findings/errors.js';
import {
  IndependentAbsenceProof,
  resolveFinding,
  type Finding,
} from '../../src/findings/removal.js';
import { assertReportSafe, SensitiveNeedle } from '../../src/findings/sensitive.js';
import { maskSecret } from '../../src/findings/masking.js';
import { deriveVerdict, summarizeVerdict } from '../../src/findings/verdict.js';
import {
  classifyTextVisibility,
  presenceFromVisibility,
} from '../../src/pdf/interpreter/coverage.js';
import { normalizeRectangle } from '../../src/pdf/interpreter/geometry.js';
import { DeviceLocalBytes } from '../../src/pdf/parser/device-local-bytes.js';
import { sha256Hex } from '../../src/pdf/parser/digest.js';
import { PdfBoundaryError, userMessageOf } from '../../src/pdf/parser/errors.js';
import {
  classifyReferenceTarget,
  resolveExternalTarget,
} from '../../src/pdf/parser/external-reference.js';
import { SanitizerBoundaryError } from '../../src/sanitizer/errors.js';
import { FreshDocumentBytes } from '../../src/sanitizer/fresh-graph.js';
import { VerifierBoundaryError } from '../../src/verifier/errors.js';
import {
  acceptIndependentRequest,
  buildIndependentRequest,
  type VerificationPolicyV1,
} from '../../src/verifier/independence.js';

function ascii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
}

const FRESH_DOCUMENT = ascii(
  '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\n0 2\n' +
    '0000000000 65535 f \n0000000009 00000 n \ntrailer\n<< /Size 2 /Root 1 0 R >>\n' +
    'startxref\n90\n%%EOF\n',
);

const POLICY: VerificationPolicyV1 = {
  schemaVersion: 1,
  attacks: ['raw-byte-grep', 'structural-object-graph-scan'],
  coverageThreshold: 0.98,
  deadlineMs: 30_000,
};

describe('I1 fault injection — intake and reference resolution while failing', () => {
  it('survives the caller detaching the source buffer immediately after adoption', () => {
    const source = new Uint8Array(new ArrayBuffer(32)).fill(0x41);
    const adopted = DeviceLocalBytes.adopt('user-file-input', source, 1024);

    // Simulate the page transferring the user's ArrayBuffer to a worker mid-inspection.
    structuredClone(source.buffer, { transfer: [source.buffer] });

    expect(source.byteLength).toBe(0);
    expect(adopted.byteLength).toBe(32);
    expect(adopted.latin1Slice(0, 4)).toBe('AAAA');
  });

  it('still refuses an external target when the surrounding parse is already failing', () => {
    const failure = new PdfBoundaryError('PDF_XREF_UNREADABLE', { offset: 1024 });
    let refusal: unknown;
    try {
      try {
        throw failure;
      } finally {
        // Cleanup path: a recovery routine reaches for the referenced file.
        try {
          resolveExternalTarget(classifyReferenceTarget('ftp:host/original.pdf'), 'xref-recovery');
        } catch (error: unknown) {
          refusal = error;
        }
      }
    } catch {
      // The original parse failure is expected to propagate.
    }
    expect(refusal).toBeInstanceOf(PdfBoundaryError);
    expect((refusal as PdfBoundaryError).code).toBe('PDF_EXTERNAL_REFERENCE_REFUSED');
  });
});

describe('I2 fault injection — interpretation failing mid-page', () => {
  it('produces no presence value at all when the interpreter refuses its inputs', () => {
    const run = {
      paintIndex: 1,
      boundsPoints: normalizeRectangle({ x0Points: 0, y0Points: 0, x1Points: 10, y1Points: 10 }),
    };
    expect(() =>
      classifyTextVisibility({
        run,
        occluders: [],
        clippedOut: false,
        textRenderMode: 0,
        inHiddenOptionalContent: false,
        coverageThreshold: Number.NaN,
      }),
    ).toThrow(PdfBoundaryError);
  });

  it('keeps a covered run present when a later attack in the same pass throws', () => {
    const bounds = normalizeRectangle({ x0Points: 0, y0Points: 0, x1Points: 10, y1Points: 10 });
    const visibility = classifyTextVisibility({
      run: { paintIndex: 1, boundsPoints: bounds },
      occluders: [{ paintIndex: 2, alpha: 1, boundsPoints: bounds }],
      clippedOut: false,
      textRenderMode: 0,
      inHiddenOptionalContent: false,
      coverageThreshold: 0.9,
    });
    expect(presenceFromVisibility(visibility)).toBe('present-but-not-painted');

    const finding: Finding = {
      schemaVersion: 1,
      findingId: 'finding-1',
      leakClass: 'covered-selectable-text',
      presence: presenceFromVisibility(visibility),
      evidence: maskSecret('000-00-0000'),
      locator: {
        schemaVersion: 1,
        pageIndex: 0,
        objectNumber: 4,
        surface: 'decoded-streams',
      },
      needleId: 'token-1',
    };

    // The verification pass crashed after only one surface was attacked.
    const partial = IndependentAbsenceProof.mint([
      {
        schemaVersion: 1,
        attackId: 'raw-byte-grep',
        surface: 'raw-bytes',
        residualCount: 0,
        reloadedFromEmittedBytes: true,
        sharedSanitizerState: false,
        emittedBytesSha256: sha256Hex(FRESH_DOCUMENT),
      },
    ]);
    expect(() => resolveFinding(finding, partial)).toThrow(FindingsBoundaryError);
  });
});

describe('I3 fault injection — the writer crashing mid-emit', () => {
  it('refuses truncated output rather than sealing a partial document', () => {
    const truncated = FRESH_DOCUMENT.slice(0, FRESH_DOCUMENT.byteLength - 12);
    expect(() => FreshDocumentBytes.seal(truncated)).toThrow(SanitizerBoundaryError);
  });

  it('refuses a retry that appends the second attempt onto the first', () => {
    const doubled = new Uint8Array(FRESH_DOCUMENT.byteLength * 2);
    doubled.set(FRESH_DOCUMENT, 0);
    doubled.set(FRESH_DOCUMENT, FRESH_DOCUMENT.byteLength);
    expect(() => FreshDocumentBytes.seal(doubled, FRESH_DOCUMENT)).toThrow(
      /SANITIZER_SOURCE_PREFIX_DETECTED/u,
    );
  });
});

describe('I4 and I7 fault injection — attacks failing part-way through', () => {
  it('reports NOT VERIFIED when one attack throws after the others pass', () => {
    const verdict = deriveVerdict({
      attacks: [
        { schemaVersion: 1, attackId: 'raw-byte-grep', status: 'passed', residualCount: 0 },
        {
          schemaVersion: 1,
          attackId: 'ocr-of-rendered-pages',
          status: 'errored',
          residualCount: 0,
        },
      ],
      unknowns: [],
      emittedBytesSha256: sha256Hex(FRESH_DOCUMENT),
    });
    expect(verdict.status).toBe('not-verified');
    expect(summarizeVerdict(verdict)).toContain('NOT VERIFIED');
  });

  it('reports NOT VERIFIED when the run is cancelled with attacks still queued', () => {
    const verdict = deriveVerdict({
      attacks: [
        { schemaVersion: 1, attackId: 'raw-byte-grep', status: 'passed', residualCount: 0 },
        { schemaVersion: 1, attackId: 'pixel-difference', status: 'not-run', residualCount: 0 },
      ],
      unknowns: [],
      emittedBytesSha256: sha256Hex(FRESH_DOCUMENT),
    });
    expect(verdict.status).toBe('not-verified');
    if (verdict.status === 'not-verified') expect(verdict.reason).toBe('attack-not-run');
  });
});

describe('I5 fault injection — logging on the failure path', () => {
  it('masks the needle when a crash report serializes the whole failure context', () => {
    const needle = SensitiveNeedle.adopt('token-1', 'PATIENT-000-00-0000');
    const crashContext = {
      stage: 'sanitize',
      error: new PdfBoundaryError('PDF_FILTER_CORRUPT', { objectNumber: 9 }).toJSON(),
      needle,
    };
    const serialized = JSON.stringify(crashContext);
    expect(serialized).not.toContain('PATIENT-000-00-0000');
    expect(JSON.parse(serialized)).toStrictEqual({
      stage: 'sanitize',
      error: {
        schemaVersion: 1,
        code: 'PDF_FILTER_CORRUPT',
        retryability: 'retryable-with-different-input',
        userMessage: userMessageOf('PDF_FILTER_CORRUPT'),
        context: { objectNumber: 9 },
      },
      needle: maskSecret('PATIENT-000-00-0000'),
    });
  });

  it('refuses to emit a report that captured the sensitive channel during a retry', () => {
    const retryContext = {
      attempt: 2,
      lastRequest: { needles: [SensitiveNeedle.adopt('token-1', 'abc').toChannelPayload()] },
    };
    expect(() => {
      assertReportSafe(retryContext);
    }).toThrow(FindingsBoundaryError);
  });
});

describe('I6 fault injection — the worker boundary degrading', () => {
  it('refuses a sanitizer handle that lost its class identity crossing the boundary', () => {
    const sealed = FreshDocumentBytes.seal(FRESH_DOCUMENT);
    const degraded: unknown = structuredClone({
      schemaVersion: 1,
      requestId: 'request-1',
      emittedBytes: sealed.toJSON(),
      emittedBytesSha256: sealed.sha256,
      policy: POLICY,
      needles: [],
    });
    expect(() => acceptIndependentRequest(degraded)).toThrow(/bytes/u);
  });

  it('refuses a message whose payload was truncated in transit', () => {
    const request = buildIndependentRequest({
      requestId: 'request-1',
      emittedBytes: FRESH_DOCUMENT,
      policy: POLICY,
      needles: [],
    });
    const hopped = structuredClone(request) as { emittedBytes: Uint8Array };
    const truncated = { ...hopped, emittedBytes: hopped.emittedBytes.slice(0, 32) };
    expect(() => acceptIndependentRequest(truncated)).toThrow(VerifierBoundaryError);
    try {
      acceptIndependentRequest(truncated);
    } catch (error: unknown) {
      expect((error as VerifierBoundaryError).code).toBe('VERIFIER_BYTES_DIGEST_MISMATCH');
    }
  });

  it('survives a clean hop and re-derives the same digest on the far side', () => {
    const request = buildIndependentRequest({
      requestId: 'request-1',
      emittedBytes: FRESH_DOCUMENT,
      policy: POLICY,
      needles: [SensitiveNeedle.adopt('token-1', 'abc').toChannelPayload()],
    });
    const accepted = acceptIndependentRequest(structuredClone(request));
    expect(accepted.emittedBytesSha256).toBe(sha256Hex(FRESH_DOCUMENT));
    expect(accepted.needles).toHaveLength(1);
  });

  it('cannot carry a live sanitizer object across the boundary at all', () => {
    const sealed = FreshDocumentBytes.seal(FRESH_DOCUMENT);
    // structuredClone strips the prototype and every private field, so what arrives is
    // not a sealed document and cannot be mistaken for one.
    const hopped = structuredClone({ sealed }) as unknown as { sealed: Record<string, unknown> };
    expect(hopped.sealed).not.toBeInstanceOf(FreshDocumentBytes);
    expect(Object.keys(hopped.sealed).sort((a, b) => a.localeCompare(b))).toStrictEqual([
      'audit',
      'byteLength',
      'sha256',
    ]);
    expect(() => structuredClone({ callback: () => sealed })).toThrow();
  });
});
