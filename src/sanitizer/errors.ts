/**
 * Stable failure vocabulary for the sanitizer.
 *
 * Every code here describes a refusal to emit, never a degraded emission. The
 * sanitizer has no "best effort" outcome: if it cannot rebuild a document as a fresh
 * object graph, it produces no bytes at all.
 */

export const SANITIZER_ERROR_CODES = [
  'SANITIZER_INCREMENTAL_APPEND_REFUSED',
  'SANITIZER_OUTPUT_MALFORMED',
  'SANITIZER_SOURCE_PREFIX_DETECTED',
  'SANITIZER_REBUILD_INCOMPLETE',
  'SANITIZER_ALLOWLIST_VIOLATION',
] as const;

export type SanitizerErrorCode = (typeof SANITIZER_ERROR_CODES)[number];

const USER_MESSAGES: Readonly<Record<SanitizerErrorCode, string>> = {
  SANITIZER_INCREMENTAL_APPEND_REFUSED:
    'The rebuilt file still contained an earlier revision, so it was not emitted.',
  SANITIZER_OUTPUT_MALFORMED: 'The rebuilt file did not form a single valid document structure.',
  SANITIZER_SOURCE_PREFIX_DETECTED:
    'The rebuilt file began with the original file, which is an append rather than a rebuild.',
  SANITIZER_REBUILD_INCOMPLETE:
    'The rebuild did not cover every object it was asked to cover, so nothing was emitted.',
  SANITIZER_ALLOWLIST_VIOLATION:
    'The rebuild tried to carry over a structure that is not on the allowlist.',
};

export type SanitizerErrorContextValue = string | number | boolean;
export type SanitizerErrorContext = Readonly<Record<string, SanitizerErrorContextValue>>;

/**
 * Renders structural context into the developer-facing `message`.
 *
 * Only offsets, counts, field names and stable reasons ever reach a context, so this
 * is safe to log; the clean, user-facing sentence stays available as `userMessage`.
 */
function describeContext(context: SanitizerErrorContext): string {
  const pairs = Object.entries(context).map(([key, value]) => `${key}=${String(value)}`);
  return pairs.length === 0 ? '' : ` (${pairs.join('; ')})`;
}

export class SanitizerBoundaryError extends Error {
  readonly code: SanitizerErrorCode;
  readonly retryability = 'not-retryable' as const;
  readonly userMessage: string;
  readonly context: SanitizerErrorContext;

  constructor(code: SanitizerErrorCode, context: SanitizerErrorContext = {}) {
    const userMessage = USER_MESSAGES[code];
    super(`${code}: ${userMessage}${describeContext(context)}`);
    this.name = 'SanitizerBoundaryError';
    this.code = code;
    this.userMessage = userMessage;
    this.context = Object.freeze({ ...context });
  }

  toJSON(): Readonly<{
    schemaVersion: 1;
    code: SanitizerErrorCode;
    userMessage: string;
    context: SanitizerErrorContext;
  }> {
    return Object.freeze({
      schemaVersion: 1 as const,
      code: this.code,
      userMessage: this.userMessage,
      context: this.context,
    });
  }
}

export function sanitizerUserMessageOf(code: SanitizerErrorCode): string {
  return USER_MESSAGES[code];
}
