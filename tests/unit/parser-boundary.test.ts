import { describe, expect, it } from 'vitest';

import {
  DEVICE_LOCAL_ORIGINS,
  DeviceLocalBytes,
  isDeviceLocalOrigin,
} from '../../src/pdf/parser/device-local-bytes.js';
import {
  PDF_ERROR_CODES,
  PdfBoundaryError,
  isPdfErrorCode,
  retryabilityOf,
  userMessageOf,
} from '../../src/pdf/parser/errors.js';
import {
  assessFileSpecification,
  classifyReferenceTarget,
  EXTERNAL_TARGET_KINDS,
  UNKNOWN_SCHEME_LABEL,
} from '../../src/pdf/parser/external-reference.js';
import {
  BudgetMeter,
  DEFAULT_DOCUMENT_LIMITS,
  parseDocumentLimits,
} from '../../src/pdf/parser/limits.js';

function ascii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return bytes;
}

describe('PdfBoundaryError', () => {
  it('gives every code a retryability classification and a safe user message', () => {
    for (const code of PDF_ERROR_CODES) {
      expect(retryabilityOf(code)).toMatch(/^(?:not-retryable|retryable-)/u);
      expect(userMessageOf(code).length).toBeGreaterThan(10);
      expect(isPdfErrorCode(code)).toBe(true);
    }
    expect(isPdfErrorCode('PDF_NOT_A_CODE')).toBe(false);
    expect(isPdfErrorCode(7)).toBe(false);
  });

  it('serializes code, classification, safe copy and structural context only', () => {
    const error = new PdfBoundaryError('PDF_FILTER_UNSUPPORTED', { objectNumber: 12, chain: 2 });
    expect(error.toJSON()).toStrictEqual({
      schemaVersion: 1,
      code: 'PDF_FILTER_UNSUPPORTED',
      retryability: 'not-retryable',
      userMessage: userMessageOf('PDF_FILTER_UNSUPPORTED'),
      context: { objectNumber: 12, chain: 2 },
    });
    expect(Object.keys(error.toJSON())).not.toContain('stack');
    expect(error.message).toContain('objectNumber=12');
    expect(error.name).toBe('PdfBoundaryError');
  });

  it('omits an empty context from the message', () => {
    expect(new PdfBoundaryError('PDF_BYTES_EMPTY').message).toBe(
      `PDF_BYTES_EMPTY: ${userMessageOf('PDF_BYTES_EMPTY')}`,
    );
  });
});

describe('DeviceLocalBytes', () => {
  const bytes = DeviceLocalBytes.adopt('test-vector', ascii('%PDF-1.7 hello world'), 1024);

  it('accepts an ArrayBuffer as well as a view, and copies either one', () => {
    const buffer = new ArrayBuffer(4);
    new Uint8Array(buffer).set(ascii('abcd'));
    const adopted = DeviceLocalBytes.adopt('generated-fixture', buffer, 16);
    expect(adopted.byteLength).toBe(4);
    expect(adopted.latin1Slice(0, 4)).toBe('abcd');
  });

  it('returns undefined outside the buffer rather than throwing or wrapping', () => {
    expect(bytes.byteAt(0)).toBe('%'.charCodeAt(0));
    expect(bytes.byteAt(-1)).toBeUndefined();
    expect(bytes.byteAt(bytes.byteLength)).toBeUndefined();
    expect(bytes.byteAt(1.5)).toBeUndefined();
  });

  it('clamps slices to the buffer instead of reading past it', () => {
    expect(bytes.latin1Slice(-10, 5)).toBe('%PDF-');
    expect(bytes.latin1Slice(5, 1)).toBe('');
    expect(bytes.slice(0, 10_000).byteLength).toBe(bytes.byteLength);
  });

  it('finds and refuses to find byte patterns at both ends', () => {
    expect(bytes.indexOf(ascii('hello'))).toBe(9);
    expect(bytes.indexOf(ascii('hello'), 10)).toBe(-1);
    expect(bytes.indexOf(ascii(''))).toBe(-1);
    expect(bytes.indexOf(ascii('x'.repeat(1_000)))).toBe(-1);
    expect(bytes.indexOf(ascii('nope'))).toBe(-1);
    expect(bytes.lastIndexOf(ascii('o'))).toBe(16);
    expect(bytes.lastIndexOf(ascii(''))).toBe(-1);
    expect(bytes.lastIndexOf(ascii('x'.repeat(1_000)))).toBe(-1);
    expect(bytes.lastIndexOf(ascii('%PDF'), 0)).toBe(0);
  });

  it('validates the declared origin vocabulary', () => {
    for (const origin of DEVICE_LOCAL_ORIGINS) expect(isDeviceLocalOrigin(origin)).toBe(true);
    expect(isDeviceLocalOrigin('network-fetch')).toBe(false);
    expect(isDeviceLocalOrigin(null)).toBe(false);
  });

  it('refuses a non-positive size budget at intake', () => {
    expect(() => DeviceLocalBytes.adopt('test-vector', ascii('a'), 0)).toThrow(
      /PDF_LIMIT_EXCEEDED/u,
    );
    expect(() => DeviceLocalBytes.adopt('test-vector', ascii('a'), 1.5)).toThrow(
      /PDF_LIMIT_EXCEEDED/u,
    );
  });
});

describe('external reference classification', () => {
  it('classifies each externally reachable shape', () => {
    expect(classifyReferenceTarget('ftp:host/x').kind).toBe('scheme-qualified');
    expect(classifyReferenceTarget('//host/x').kind).toBe('protocol-relative');
    expect(classifyReferenceTarget('\\\\server\\share').kind).toBe('unc-path');
    expect(classifyReferenceTarget('/etc/passwd').kind).toBe('absolute-file-path');
    expect(classifyReferenceTarget('\\windows\\x').kind).toBe('absolute-file-path');
    expect(classifyReferenceTarget('C:\\Users\\x').kind).toBe('absolute-file-path');
    expect(classifyReferenceTarget('../secret.pdf').kind).toBe('relative-file-path');
    expect(classifyReferenceTarget('data:text/plain,x').kind).toBe('inline-data-literal');
    expect(classifyReferenceTarget('   ').kind).toBe('empty-or-unparseable');
    expect(classifyReferenceTarget(42).kind).toBe('empty-or-unparseable');
    for (const kind of EXTERNAL_TARGET_KINDS) expect(typeof kind).toBe('string');
  });

  it('never echoes an unlisted scheme, because a scheme is attacker-controlled text', () => {
    const crafted = classifyReferenceTarget('ssn-000-00-0000:/payload');
    expect(crafted.kind).toBe('scheme-qualified');
    expect(crafted.scheme).toBe(UNKNOWN_SCHEME_LABEL);
    expect(JSON.stringify(crafted)).not.toContain('000-00-0000');
    // A digit-leading target is not a scheme at all under the PDF/URI grammar.
    expect(classifyReferenceTarget('000-00-0000:/payload').kind).toBe('relative-file-path');
  });

  it('reports an empty file specification as populated by nothing', () => {
    const assessment = assessFileSpecification({});
    expect(assessment.targets).toStrictEqual([]);
    expect(assessment.egressCapable).toBe(false);
    expect(assessment.refused).toBe(true);
  });

  it('skips null slots and assesses populated ones', () => {
    const assessment = assessFileSpecification({ file: null, unixFile: '/etc/shadow' });
    expect(assessment.targets).toHaveLength(1);
    expect(assessment.egressCapable).toBe(true);
  });
});

describe('document limits', () => {
  it('accepts the committed defaults and rejects every malformed variant', () => {
    expect(parseDocumentLimits(DEFAULT_DOCUMENT_LIMITS)).toStrictEqual(DEFAULT_DOCUMENT_LIMITS);
    expect(() => parseDocumentLimits(null)).toThrow(/PDF_LIMIT_EXCEEDED/u);
    expect(() => parseDocumentLimits([])).toThrow(/not-an-object/u);
    expect(() => parseDocumentLimits({ ...DEFAULT_DOCUMENT_LIMITS, schemaVersion: 2 })).toThrow(
      /unsupported-version/u,
    );
    expect(() =>
      parseDocumentLimits({ ...DEFAULT_DOCUMENT_LIMITS, maximumObjectCount: 0 }),
    ).toThrow(/not-positive/u);
    expect(() =>
      parseDocumentLimits({
        ...DEFAULT_DOCUMENT_LIMITS,
        inspectionDeadlineMs: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(/not-positive/u);
    expect(() => parseDocumentLimits({ ...DEFAULT_DOCUMENT_LIMITS, unexpectedBudget: 5 })).toThrow(
      /unknown-field/u,
    );
  });

  it('has no representation for an unlimited budget', () => {
    expect(() => new BudgetMeter('bytes', 0)).toThrow(/PDF_LIMIT_EXCEEDED/u);
    expect(() => new BudgetMeter('bytes', -1)).toThrow(/PDF_LIMIT_EXCEEDED/u);
  });

  it('consumes monotonically and refuses to exceed rather than truncating', () => {
    const meter = new BudgetMeter('decoded-bytes', 100);
    meter.consume(40);
    expect(meter.used).toBe(40);
    expect(meter.remaining).toBe(60);
    expect(meter.wouldFit(60)).toBe(true);
    expect(meter.wouldFit(61)).toBe(false);
    expect(meter.wouldFit(-1)).toBe(false);
    meter.consume(0);
    expect(() => meter.consume(61)).toThrow(/PDF_LIMIT_EXCEEDED/u);
    expect(() => meter.consume(-1)).toThrow(/invalid-amount/u);
    expect(() => meter.consume(1.5)).toThrow(/invalid-amount/u);
    expect(meter.used).toBe(40);
  });
});
