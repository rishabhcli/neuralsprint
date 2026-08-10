/**
 * Invariant I1 — no document byte leaves the device by default.
 *
 * Encoding under attack:
 * - `src/pdf/parser/external-reference.ts` — `classifyReferenceTarget`, whose `refused`
 *   field is the literal type `true`, and `resolveExternalTarget`, which returns `never`.
 * - `src/pdf/parser/device-local-bytes.ts` — `DeviceLocalBytes`, nominal, private
 *   constructor, copies on adoption, serializes provenance only.
 *
 * Case counts are declared per property in the test names below.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { DeviceLocalBytes, DEVICE_LOCAL_ORIGINS } from '../../src/pdf/parser/device-local-bytes.js';
import { PdfBoundaryError } from '../../src/pdf/parser/errors.js';
import {
  assessFileSpecification,
  classifyReferenceTarget,
  EXTERNAL_TARGET_KINDS,
  resolveExternalTarget,
  UNKNOWN_SCHEME_LABEL,
} from '../../src/pdf/parser/external-reference.js';

const SEED = 2_026_08_11;
const MAXIMUM_BYTES = 8 * 1024 * 1024;

/** Mirrors the production allowlist; a scheme outside it must never be echoed back. */
const KNOWN_SCHEME_VALUES: ReadonlySet<string> = new Set([
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

const originArbitrary = fc.constantFrom(...DEVICE_LOCAL_ORIGINS);

/** Target shapes a hostile PDF would use to name something off the device. */
const egressTargetArbitrary = fc.oneof(
  fc
    .tuple(
      fc.constantFrom('ftp', 'file', 'gopher', 'ws', 'wss', 'mailto', 'jar', 'smb'),
      fc.string({ minLength: 1, maxLength: 40 }),
    )
    .map(([scheme, rest]) => `${scheme}:${rest}`),
  fc.string({ minLength: 1, maxLength: 40 }).map((rest) => `//host.invalid/${rest}`),
  fc.string({ minLength: 1, maxLength: 40 }).map((rest) => `\\\\server\\share\\${rest}`),
  fc.string({ minLength: 1, maxLength: 40 }).map((rest) => `/etc/${rest}`),
  fc.string({ minLength: 1, maxLength: 40 }).map((rest) => `C:\\Users\\${rest}`),
  fc.string({ minLength: 1, maxLength: 40 }).map((rest) => `../${rest}`),
);

describe('I1 — no document byte leaves the device by default', () => {
  it('property i1-refuses-every-target: refuses every possible reference target (4000 cases)', () => {
    fc.assert(
      fc.property(fc.anything(), (candidate) => {
        const classification = classifyReferenceTarget(candidate);
        expect(classification.refused).toBe(true);
        expect(Object.isFrozen(classification)).toBe(true);
        expect(EXTERNAL_TARGET_KINDS).toContain(classification.kind);
        // Nothing attacker-controlled is echoed back: every string field is drawn from
        // a vocabulary this repository owns, so a crafted target such as
        // `<secret>:/path` cannot print the secret into a finding or a log line.
        expect(
          classification.scheme === null ||
            KNOWN_SCHEME_VALUES.has(classification.scheme) ||
            classification.scheme === UNKNOWN_SCHEME_LABEL,
        ).toBe(true);
      }),
      { numRuns: 4_000, seed: SEED },
    );
  });

  it('property i1-egress-shapes-are-flagged: every off-device shape is egress-capable (3000 cases)', () => {
    fc.assert(
      fc.property(egressTargetArbitrary, (target) => {
        const classification = classifyReferenceTarget(target);
        expect(classification.egressCapable).toBe(true);
        expect(classification.refused).toBe(true);
      }),
      { numRuns: 3_000, seed: SEED + 1 },
    );
  });

  it('property i1-resolution-always-throws: the only resolver-shaped function always refuses (2000 cases)', () => {
    fc.assert(
      fc.property(fc.anything(), fc.string({ maxLength: 24 }), (candidate, where) => {
        const classification = classifyReferenceTarget(candidate);
        expect(() => {
          resolveExternalTarget(classification, where);
        }).toThrow(PdfBoundaryError);
        try {
          resolveExternalTarget(classification, where);
        } catch (error: unknown) {
          expect(error).toBeInstanceOf(PdfBoundaryError);
          expect((error as PdfBoundaryError).code).toBe('PDF_EXTERNAL_REFERENCE_REFUSED');
          expect((error as PdfBoundaryError).retryability).toBe('not-retryable');
        }
      }),
      { numRuns: 2_000, seed: SEED + 2 },
    );
  });

  it('property i1-file-spec-slots: any populated file-specification slot is assessed and refused (2000 cases)', () => {
    fc.assert(
      fc.property(
        fc.record(
          {
            file: fc.option(egressTargetArbitrary, { nil: undefined }),
            unicodeFile: fc.option(egressTargetArbitrary, { nil: undefined }),
            dosFile: fc.option(egressTargetArbitrary, { nil: undefined }),
            macFile: fc.option(egressTargetArbitrary, { nil: undefined }),
            unixFile: fc.option(egressTargetArbitrary, { nil: undefined }),
          },
          { requiredKeys: [] },
        ),
        (specification) => {
          const assessment = assessFileSpecification(specification);
          expect(assessment.refused).toBe(true);
          const populated = Object.values(specification).filter(
            (value) => value !== undefined,
          ).length;
          expect(assessment.targets).toHaveLength(populated);
          expect(assessment.egressCapable).toBe(populated > 0);
        },
      ),
      { numRuns: 2_000, seed: SEED + 3 },
    );
  });

  it('property i1-adoption-copies: mutating the source after adoption never changes what was inspected (2000 cases)', () => {
    fc.assert(
      fc.property(
        originArbitrary,
        fc.uint8Array({ minLength: 1, maxLength: 512 }),
        fc.nat({ max: 511 }),
        fc.integer({ min: 0, max: 255 }),
        (origin, source, index, replacement) => {
          const adopted = DeviceLocalBytes.adopt(origin, source, MAXIMUM_BYTES);
          const before = adopted.slice(0, adopted.byteLength);
          const position = index % source.byteLength;
          source[position] = ((source[position] ?? 0) + replacement + 1) % 256;
          const after = adopted.slice(0, adopted.byteLength);
          expect(Array.from(after)).toStrictEqual(Array.from(before));
        },
      ),
      { numRuns: 2_000, seed: SEED + 4 },
    );
  });

  it('property i1-serialization-carries-no-content: serialized bytes disclose provenance and length only (2000 cases)', () => {
    fc.assert(
      fc.property(
        originArbitrary,
        fc.uint8Array({ minLength: 1, maxLength: 256 }),
        (origin, source) => {
          const adopted = DeviceLocalBytes.adopt(origin, source, MAXIMUM_BYTES);
          const serialized = JSON.stringify(adopted);
          expect(JSON.parse(serialized)).toStrictEqual({
            schemaVersion: 1,
            origin,
            byteLength: source.byteLength,
          });
          // Exact-shape assertion rather than a substring search: for short documents a
          // substring check would pass by coincidence rather than by design.
          expect(adopted.toString()).toBe(
            `DeviceLocalBytes(${origin}, ${String(source.byteLength)} bytes)`,
          );
        },
      ),
      { numRuns: 2_000, seed: SEED + 5 },
    );
  });

  it('refuses empty and oversized documents at the intake boundary', () => {
    expect(() => DeviceLocalBytes.adopt('user-file-input', new Uint8Array(0), 16)).toThrow(
      /PDF_BYTES_EMPTY/u,
    );
    expect(() => DeviceLocalBytes.adopt('user-file-input', new Uint8Array(32), 16)).toThrow(
      /PDF_BYTES_TOO_LARGE/u,
    );
    expect(() =>
      DeviceLocalBytes.adopt(
        'remote-download' as unknown as (typeof DEVICE_LOCAL_ORIGINS)[number],
        new Uint8Array(4),
        16,
      ),
    ).toThrow(/PDF_BYTES_NOT_DEVICE_LOCAL/u);
  });

  it('treats an inline data literal as non-egress but still refuses it', () => {
    const classification = classifyReferenceTarget('data:application/pdf;base64,AAAA');
    expect(classification.kind).toBe('inline-data-literal');
    expect(classification.egressCapable).toBe(false);
    expect(classification.refused).toBe(true);
  });
});
