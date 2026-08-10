/**
 * Stable failure vocabulary for the independent verifier.
 *
 * A verifier failure is never a skip. Each code below makes the run non-green, and
 * `deriveVerdict` maps every one of them to NOT VERIFIED rather than to a qualified
 * pass.
 */

export const VERIFIER_ERROR_CODES = [
  'VERIFIER_REQUEST_NOT_CLONE_SAFE',
  'VERIFIER_REQUEST_INVALID',
  'VERIFIER_BYTES_DIGEST_MISMATCH',
  'VERIFIER_SHARED_STATE_DETECTED',
  'VERIFIER_ATTACK_INCOMPLETE',
  'VERIFIER_CANCELLED',
] as const;

export type VerifierErrorCode = (typeof VERIFIER_ERROR_CODES)[number];

const USER_MESSAGES: Readonly<Record<VerifierErrorCode, string>> = {
  VERIFIER_REQUEST_NOT_CLONE_SAFE:
    'Verification was refused because the request carried live objects instead of plain data.',
  VERIFIER_REQUEST_INVALID: 'Verification was refused because the request was malformed.',
  VERIFIER_BYTES_DIGEST_MISMATCH:
    'The bytes received for verification are not the bytes that were announced, so nothing was verified.',
  VERIFIER_SHARED_STATE_DETECTED:
    'Verification was refused because it was asked to reuse the repair step’s own state.',
  VERIFIER_ATTACK_INCOMPLETE: 'An attack could not finish, so the result is NOT VERIFIED.',
  VERIFIER_CANCELLED: 'Verification was cancelled before it finished.',
};

export type VerifierErrorContextValue = string | number | boolean;
export type VerifierErrorContext = Readonly<Record<string, VerifierErrorContextValue>>;

/**
 * Renders structural context into the developer-facing `message`.
 *
 * Only offsets, counts, field names and stable reasons ever reach a context, so this
 * is safe to log; the clean, user-facing sentence stays available as `userMessage`.
 */
function describeContext(context: VerifierErrorContext): string {
  const pairs = Object.entries(context).map(([key, value]) => `${key}=${String(value)}`);
  return pairs.length === 0 ? '' : ` (${pairs.join('; ')})`;
}

export class VerifierBoundaryError extends Error {
  readonly code: VerifierErrorCode;
  readonly userMessage: string;
  readonly context: VerifierErrorContext;

  constructor(code: VerifierErrorCode, context: VerifierErrorContext = {}) {
    const userMessage = USER_MESSAGES[code];
    super(`${code}: ${userMessage}${describeContext(context)}`);
    this.name = 'VerifierBoundaryError';
    this.code = code;
    this.userMessage = userMessage;
    this.context = Object.freeze({ ...context });
  }

  toJSON(): Readonly<{
    schemaVersion: 1;
    code: VerifierErrorCode;
    userMessage: string;
    context: VerifierErrorContext;
  }> {
    return Object.freeze({
      schemaVersion: 1 as const,
      code: this.code,
      userMessage: this.userMessage,
      context: this.context,
    });
  }
}

export function verifierUserMessageOf(code: VerifierErrorCode): string {
  return USER_MESSAGES[code];
}
