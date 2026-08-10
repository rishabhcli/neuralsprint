import { describe, expect, it } from 'vitest';

import { SensitiveNeedle } from '../../src/findings/sensitive.js';
import { sha256Hex } from '../../src/pdf/parser/digest.js';
import {
  SANITIZER_ERROR_CODES,
  SanitizerBoundaryError,
  sanitizerUserMessageOf,
} from '../../src/sanitizer/errors.js';
import { auditFreshObjectGraph, FreshDocumentBytes } from '../../src/sanitizer/fresh-graph.js';
import {
  VERIFIER_ERROR_CODES,
  VerifierBoundaryError,
  verifierUserMessageOf,
} from '../../src/verifier/errors.js';
import {
  acceptIndependentRequest,
  assertStructuredCloneSafe,
  buildIndependentRequest,
  parseVerificationPolicy,
  type VerificationPolicyV1,
} from '../../src/verifier/independence.js';

function ascii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
}

const FRESH = ascii(
  '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\n0 2\n' +
    '0000000000 65535 f \n0000000009 00000 n \ntrailer\n<< /Size 2 /Root 1 0 R >>\n' +
    'startxref\n90\n%%EOF\n',
);

const POLICY: VerificationPolicyV1 = {
  schemaVersion: 1,
  attacks: ['raw-byte-grep'],
  coverageThreshold: 0.98,
  deadlineMs: 30_000,
};

describe('sanitizer error vocabulary', () => {
  it('gives every code a safe message and a structural serialization', () => {
    for (const code of SANITIZER_ERROR_CODES) {
      expect(sanitizerUserMessageOf(code).length).toBeGreaterThan(10);
    }
    const error = new SanitizerBoundaryError('SANITIZER_REBUILD_INCOMPLETE', { objects: 3 });
    expect(error.toJSON()).toStrictEqual({
      schemaVersion: 1,
      code: 'SANITIZER_REBUILD_INCOMPLETE',
      userMessage: sanitizerUserMessageOf('SANITIZER_REBUILD_INCOMPLETE'),
      context: { objects: 3 },
    });
    expect(error.retryability).toBe('not-retryable');
    expect(error.name).toBe('SanitizerBoundaryError');
    expect(new SanitizerBoundaryError('SANITIZER_OUTPUT_MALFORMED').message).not.toContain('(');
  });
});

describe('fresh object graph audit', () => {
  it('accepts trailing whitespace after the final marker but not trailing content', () => {
    expect(
      auditFreshObjectGraph(ascii('%PDF-1.7\nxref\ntrailer\nstartxref\n9\n%%EOF\n \t\r\n'))
        .endsWithEndOfFile,
    ).toBe(true);
    expect(
      auditFreshObjectGraph(ascii('%PDF-1.7\nstartxref\n9\n%%EOF\nGARBAGE')).endsWithEndOfFile,
    ).toBe(false);
  });

  it('reports each append signature separately so a failure names its cause', () => {
    const audit = auditFreshObjectGraph(
      ascii('%PDF-1.7\nstartxref\n1\n%%EOF\nstartxref\n2\n%%EOF\n'),
    );
    expect(audit.failures).toContain('startxref-count-2');
    expect(audit.failures).toContain('eof-count-2');
    expect(audit.passed).toBe(false);
  });

  it('serializes a sealed document as provenance plus audit, never as bytes', () => {
    const sealed = FreshDocumentBytes.seal(FRESH);
    expect(sealed.toJSON()).toStrictEqual({
      schemaVersion: 1,
      byteLength: FRESH.byteLength,
      sha256: sha256Hex(FRESH),
      audit: sealed.audit,
    });
    expect(JSON.stringify(sealed)).not.toContain('Catalog');
  });
});

describe('verifier error vocabulary', () => {
  it('gives every code a safe message and a structural serialization', () => {
    for (const code of VERIFIER_ERROR_CODES) {
      expect(verifierUserMessageOf(code).length).toBeGreaterThan(10);
    }
    const error = new VerifierBoundaryError('VERIFIER_CANCELLED', { elapsedMs: 12 });
    expect(error.toJSON()).toStrictEqual({
      schemaVersion: 1,
      code: 'VERIFIER_CANCELLED',
      userMessage: verifierUserMessageOf('VERIFIER_CANCELLED'),
      context: { elapsedMs: 12 },
    });
    expect(error.name).toBe('VerifierBoundaryError');
  });
});

describe('structured-clone safety', () => {
  it('accepts primitives, plain containers, byte arrays and null-prototype records', () => {
    const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, { a: 1 });
    for (const value of [null, 'x', 1, true, [], {}, new Uint8Array([1]), nullPrototype]) {
      expect(() => {
        assertStructuredCloneSafe(value);
      }).not.toThrow();
    }
  });

  it('refuses undefined, bigint, symbols and excessive depth', () => {
    expect(() => {
      assertStructuredCloneSafe(undefined);
    }).toThrow(/undefined/u);
    expect(() => {
      assertStructuredCloneSafe(1n);
    }).toThrow(/bigint/u);
    expect(() => {
      assertStructuredCloneSafe(Symbol('x'));
    }).toThrow(/symbol/u);

    let deep: unknown = 1;
    for (let level = 0; level < 40; level += 1) deep = [deep];
    expect(() => {
      assertStructuredCloneSafe(deep);
    }).toThrow(/too-deep/u);
  });
});

describe('independent verification request', () => {
  it('refuses a malformed request id or an empty payload at build time', () => {
    expect(() =>
      buildIndependentRequest({
        requestId: 'Request 1',
        emittedBytes: FRESH,
        policy: POLICY,
        needles: [],
      }),
    ).toThrow(/request-id/u);
    expect(() =>
      buildIndependentRequest({
        requestId: 'request-1',
        emittedBytes: new Uint8Array(0),
        policy: POLICY,
        needles: [],
      }),
    ).toThrow(/no-bytes/u);
  });

  it('re-validates every field on the worker side', () => {
    const request = buildIndependentRequest({
      requestId: 'request-1',
      emittedBytes: FRESH,
      policy: POLICY,
      needles: [SensitiveNeedle.adopt('token-1', 'abc').toChannelPayload()],
    });
    expect(acceptIndependentRequest(request).needles).toHaveLength(1);
    expect(() => acceptIndependentRequest(null)).toThrow(/shape/u);
    expect(() => acceptIndependentRequest([request])).toThrow(/shape/u);
    expect(() => acceptIndependentRequest({ ...request, schemaVersion: 2 })).toThrow(/version/u);
    expect(() => acceptIndependentRequest({ ...request, requestId: 'BAD ID' })).toThrow(
      /request-id/u,
    );
    expect(() => acceptIndependentRequest({ ...request, emittedBytes: [1, 2, 3] })).toThrow(
      /bytes/u,
    );
    expect(() => acceptIndependentRequest({ ...request, emittedBytesSha256: 'x' })).toThrow(
      /digest-format/u,
    );
    expect(() => acceptIndependentRequest({ ...request, needles: 'none' })).toThrow(/needles/u);
  });

  it('refuses every malformed policy field', () => {
    expect(parseVerificationPolicy(POLICY)).toStrictEqual(POLICY);
    expect(() => parseVerificationPolicy(null)).toThrow(/policy-shape/u);
    expect(() => parseVerificationPolicy([POLICY])).toThrow(/policy-shape/u);
    expect(() => parseVerificationPolicy({ ...POLICY, schemaVersion: 2 })).toThrow(
      /policy-version/u,
    );
    expect(() => parseVerificationPolicy({ ...POLICY, attacks: [] })).toThrow(/policy-attacks/u);
    expect(() => parseVerificationPolicy({ ...POLICY, attacks: 'raw-byte-grep' })).toThrow(
      /policy-attacks/u,
    );
    expect(() => parseVerificationPolicy({ ...POLICY, coverageThreshold: 0 })).toThrow(
      /policy-threshold/u,
    );
    expect(() => parseVerificationPolicy({ ...POLICY, coverageThreshold: 1.5 })).toThrow(
      /policy-threshold/u,
    );
    expect(() => parseVerificationPolicy({ ...POLICY, deadlineMs: 0 })).toThrow(/policy-deadline/u);
    expect(() => parseVerificationPolicy({ ...POLICY, deadlineMs: 1.5 })).toThrow(
      /policy-deadline/u,
    );
  });

  it('refuses every malformed needle payload', () => {
    const payload = SensitiveNeedle.adopt('token-1', 'abc').toChannelPayload();
    const request = buildIndependentRequest({
      requestId: 'request-1',
      emittedBytes: FRESH,
      policy: POLICY,
      needles: [],
    });
    for (const bad of [
      null,
      [payload],
      { ...payload, sensitiveChannel: false },
      { ...payload, needleId: 5 },
      { ...payload, codePoints: [] },
      { ...payload, masked: null },
    ]) {
      expect(() => acceptIndependentRequest({ ...request, needles: [bad] })).toThrow(
        VerifierBoundaryError,
      );
    }
  });
});
