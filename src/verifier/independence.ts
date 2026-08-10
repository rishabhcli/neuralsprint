/**
 * Invariant I6 — verification reloads emitted bytes independently from sanitizer state.
 *
 * The prohibited shortcut named in `AGENTS.md` is "using the same in-memory result as
 * both sanitizer and verifier authority". If the verifier can see the sanitizer's
 * object graph, its findings list, or its intent, then it is checking the sanitizer's
 * belief rather than the file the user will actually send.
 *
 * Encoding: the verifier's only entry point takes an
 * {@link IndependentVerificationRequest}, which is restricted to structured-clone-safe
 * plain data — bytes, strings, numbers, booleans, plain objects and arrays. Class
 * instances, functions, symbols, accessors and prototypes other than `Object` and
 * `Array` are refused by {@link assertStructuredCloneSafe}. A sanitizer object cannot
 * be smuggled in at any depth, because there is no representation for it.
 *
 * The worker side then re-derives the digest of the bytes it actually received and
 * refuses if it disagrees with the announced digest, so the verifier's notion of
 * "which file" comes from the bytes rather than from the caller.
 *
 * Boundary enforcement is also structural at the module level:
 * `scripts/check-boundaries.mjs` forbids `src/verifier` from importing `src/sanitizer`.
 */

import type { AttackId, NonEmptyReadonlyArray } from '../findings/leak-classes.js';
import { isAttackId } from '../findings/leak-classes.js';
import { SENSITIVE_CHANNEL_TAG, type SensitiveChannelPayload } from '../findings/sensitive.js';
import { isSha256Hex, sha256Hex } from '../pdf/parser/digest.js';
import { VerifierBoundaryError } from './errors.js';

const MAXIMUM_REQUEST_DEPTH = 24;

/**
 * Refuses any value that structured clone would drop, alter, or that would carry live
 * behaviour across the boundary.
 *
 * `Uint8Array` is permitted because it is clone-safe and is the document payload.
 * Everything else must be a primitive, a plain array, or a plain object.
 */
export function assertStructuredCloneSafe(value: unknown, path = '$', depth = 0): void {
  if (depth > MAXIMUM_REQUEST_DEPTH) {
    throw new VerifierBoundaryError('VERIFIER_REQUEST_NOT_CLONE_SAFE', {
      path,
      reason: 'too-deep',
    });
  }

  const kind = typeof value;
  if (value === null || kind === 'string' || kind === 'number' || kind === 'boolean') return;
  if (kind === 'undefined') {
    throw new VerifierBoundaryError('VERIFIER_REQUEST_NOT_CLONE_SAFE', {
      path,
      reason: 'undefined',
    });
  }
  if (kind === 'function' || kind === 'symbol' || kind === 'bigint') {
    throw new VerifierBoundaryError('VERIFIER_REQUEST_NOT_CLONE_SAFE', { path, reason: kind });
  }

  if (value instanceof Uint8Array) return;

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertStructuredCloneSafe(entry, `${path}[${String(index)}]`, depth + 1);
    });
    return;
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new VerifierBoundaryError('VERIFIER_REQUEST_NOT_CLONE_SAFE', {
      path,
      reason: 'class-instance',
    });
  }

  const record = value as Record<string, unknown>;
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key === 'symbol') {
      throw new VerifierBoundaryError('VERIFIER_REQUEST_NOT_CLONE_SAFE', {
        path,
        reason: 'symbol-key',
      });
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor === undefined) continue;
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new VerifierBoundaryError('VERIFIER_REQUEST_NOT_CLONE_SAFE', {
        path: `${path}.${key}`,
        reason: 'accessor',
      });
    }
    assertStructuredCloneSafe(descriptor.value, `${path}.${key}`, depth + 1);
  }
}

export type VerificationPolicyV1 = Readonly<{
  schemaVersion: 1;
  attacks: NonEmptyReadonlyArray<AttackId>;
  /** Fraction of a text run that must be covered before it counts as hidden. */
  coverageThreshold: number;
  /** Wall-clock deadline for the whole verification pass. */
  deadlineMs: number;
}>;

export type IndependentVerificationRequest = Readonly<{
  schemaVersion: 1;
  requestId: string;
  /** The emitted bytes themselves, not a handle into sanitizer memory. */
  emittedBytes: Uint8Array;
  /** Announced digest; the worker re-derives it and refuses on disagreement. */
  emittedBytesSha256: string;
  policy: VerificationPolicyV1;
  needles: readonly SensitiveChannelPayload[];
}>;

const REQUEST_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

/**
 * Builds a request on the sanitizer side. The digest is computed here from the bytes
 * being sent, so an announced digest can never be inherited from sanitizer state.
 */
export function buildIndependentRequest(input: {
  requestId: string;
  emittedBytes: Uint8Array;
  policy: VerificationPolicyV1;
  needles: readonly SensitiveChannelPayload[];
}): IndependentVerificationRequest {
  if (!REQUEST_ID_PATTERN.test(input.requestId)) {
    throw new VerifierBoundaryError('VERIFIER_REQUEST_INVALID', { reason: 'request-id' });
  }
  if (input.emittedBytes.byteLength === 0) {
    throw new VerifierBoundaryError('VERIFIER_REQUEST_INVALID', { reason: 'no-bytes' });
  }
  const bytes = input.emittedBytes.slice();
  const request: IndependentVerificationRequest = Object.freeze({
    schemaVersion: 1 as const,
    requestId: input.requestId,
    emittedBytes: bytes,
    emittedBytesSha256: sha256Hex(bytes),
    policy: parseVerificationPolicy(input.policy),
    needles: Object.freeze(input.needles.map(parseSensitiveChannelPayload)),
  });
  assertStructuredCloneSafe(request);
  return request;
}

/**
 * Worker-side boundary parser. Everything about the request is re-validated here,
 * including the digest, because the worker treats its caller as untrusted.
 */
export function acceptIndependentRequest(message: unknown): IndependentVerificationRequest {
  assertStructuredCloneSafe(message, '$message');

  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    throw new VerifierBoundaryError('VERIFIER_REQUEST_INVALID', { reason: 'shape' });
  }
  const record = message as Record<string, unknown>;
  if (record.schemaVersion !== 1) {
    throw new VerifierBoundaryError('VERIFIER_REQUEST_INVALID', { reason: 'version' });
  }
  const requestId = record.requestId;
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
    throw new VerifierBoundaryError('VERIFIER_REQUEST_INVALID', { reason: 'request-id' });
  }
  const emittedBytes = record.emittedBytes;
  if (!(emittedBytes instanceof Uint8Array) || emittedBytes.byteLength === 0) {
    throw new VerifierBoundaryError('VERIFIER_REQUEST_INVALID', { reason: 'bytes' });
  }
  const announced = record.emittedBytesSha256;
  if (!isSha256Hex(announced)) {
    throw new VerifierBoundaryError('VERIFIER_REQUEST_INVALID', { reason: 'digest-format' });
  }

  const observed = sha256Hex(emittedBytes);
  if (observed !== announced) {
    throw new VerifierBoundaryError('VERIFIER_BYTES_DIGEST_MISMATCH', {
      reason: 'announced-differs-from-received',
    });
  }

  const needlesInput = record.needles;
  if (!Array.isArray(needlesInput)) {
    throw new VerifierBoundaryError('VERIFIER_REQUEST_INVALID', { reason: 'needles' });
  }

  return Object.freeze({
    schemaVersion: 1 as const,
    requestId,
    emittedBytes: emittedBytes.slice(),
    emittedBytesSha256: observed,
    policy: parseVerificationPolicy(record.policy),
    needles: Object.freeze(needlesInput.map(parseSensitiveChannelPayload)),
  });
}

export function parseVerificationPolicy(input: unknown): VerificationPolicyV1 {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new VerifierBoundaryError('VERIFIER_REQUEST_INVALID', { reason: 'policy-shape' });
  }
  const record = input as Record<string, unknown>;
  if (record.schemaVersion !== 1) {
    throw new VerifierBoundaryError('VERIFIER_REQUEST_INVALID', { reason: 'policy-version' });
  }
  const attacks = record.attacks;
  if (!Array.isArray(attacks) || attacks.length === 0 || !attacks.every(isAttackId)) {
    throw new VerifierBoundaryError('VERIFIER_REQUEST_INVALID', { reason: 'policy-attacks' });
  }
  const threshold = record.coverageThreshold;
  if (
    typeof threshold !== 'number' ||
    !Number.isFinite(threshold) ||
    threshold <= 0 ||
    threshold > 1
  ) {
    throw new VerifierBoundaryError('VERIFIER_REQUEST_INVALID', { reason: 'policy-threshold' });
  }
  const deadline = record.deadlineMs;
  if (typeof deadline !== 'number' || !Number.isSafeInteger(deadline) || deadline <= 0) {
    throw new VerifierBoundaryError('VERIFIER_REQUEST_INVALID', { reason: 'policy-deadline' });
  }

  const [first, ...rest] = attacks;
  if (first === undefined) {
    throw new VerifierBoundaryError('VERIFIER_REQUEST_INVALID', { reason: 'policy-attacks' });
  }
  const declared: NonEmptyReadonlyArray<AttackId> = [first, ...rest];
  return Object.freeze({
    schemaVersion: 1 as const,
    attacks: declared,
    coverageThreshold: threshold,
    deadlineMs: deadline,
  });
}

function parseSensitiveChannelPayload(input: unknown): SensitiveChannelPayload {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new VerifierBoundaryError('VERIFIER_REQUEST_INVALID', { reason: 'needle-shape' });
  }
  const record = input as Record<string, unknown>;
  if (record.schemaVersion !== 1 || record[SENSITIVE_CHANNEL_TAG] !== true) {
    throw new VerifierBoundaryError('VERIFIER_REQUEST_INVALID', { reason: 'needle-untagged' });
  }
  const needleId = record.needleId;
  const codePoints = record.codePoints;
  const masked = record.masked;
  if (
    typeof needleId !== 'string' ||
    !Array.isArray(codePoints) ||
    codePoints.length === 0 ||
    typeof masked !== 'object' ||
    masked === null
  ) {
    throw new VerifierBoundaryError('VERIFIER_REQUEST_INVALID', { reason: 'needle-fields' });
  }
  return input as SensitiveChannelPayload;
}
