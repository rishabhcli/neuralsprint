/**
 * Stable failure vocabulary for the findings, verdict, and report surfaces.
 *
 * These are separate from the parser's codes because they describe refusals about
 * *claims* rather than about bytes: an unsafe report payload, an unproven removal, an
 * unconstructable verdict. Keeping them distinct means an operator reading a code can
 * tell immediately whether the document or the conclusion was rejected.
 */

export const FINDINGS_ERROR_CODES = [
  'FINDINGS_REPORT_UNSAFE',
  'FINDINGS_ABSENCE_UNPROVEN',
  'FINDINGS_ABSENCE_PROOF_INVALID',
  'FINDINGS_VERDICT_SCOPE_EMPTY',
  'FINDINGS_VERDICT_UNKNOWNS_PRESENT',
  'FINDINGS_EVIDENCE_UNMASKED',
  'FINDINGS_NEEDLE_INVALID',
] as const;

export type FindingsErrorCode = (typeof FINDINGS_ERROR_CODES)[number];

type MessageByCode = Readonly<Record<FindingsErrorCode, string>>;

const USER_MESSAGES: MessageByCode = {
  FINDINGS_REPORT_UNSAFE:
    'This report was refused because it still carried unmasked sensitive material.',
  FINDINGS_ABSENCE_UNPROVEN:
    'Nothing here proves the content was removed, so it is still reported as present.',
  FINDINGS_ABSENCE_PROOF_INVALID:
    'An absence proof was rejected because it did not come from an independent reload with zero residuals.',
  FINDINGS_VERDICT_SCOPE_EMPTY:
    'A verified result must name the attacks it passed and what it does not cover.',
  FINDINGS_VERDICT_UNKNOWNS_PRESENT:
    'Something about this document is unknown, so the result is NOT VERIFIED.',
  FINDINGS_EVIDENCE_UNMASKED: 'Evidence was refused because it was not structurally masked.',
  FINDINGS_NEEDLE_INVALID: 'A search token was refused because it was empty or malformed.',
};

export type FindingsErrorContextValue = string | number | boolean;
export type FindingsErrorContext = Readonly<Record<string, FindingsErrorContextValue>>;

/**
 * Renders structural context into the developer-facing `message`.
 *
 * Only offsets, counts, field names and stable reasons ever reach a context, so this
 * is safe to log; the clean, user-facing sentence stays available as `userMessage`.
 */
function describeContext(context: FindingsErrorContext): string {
  const pairs = Object.entries(context).map(([key, value]) => `${key}=${String(value)}`);
  return pairs.length === 0 ? '' : ` (${pairs.join('; ')})`;
}

export class FindingsBoundaryError extends Error {
  readonly code: FindingsErrorCode;
  readonly retryability = 'not-retryable' as const;
  readonly userMessage: string;
  readonly context: FindingsErrorContext;

  constructor(code: FindingsErrorCode, context: FindingsErrorContext = {}) {
    const userMessage = USER_MESSAGES[code];
    super(`${code}: ${userMessage}${describeContext(context)}`);
    this.name = 'FindingsBoundaryError';
    this.code = code;
    this.userMessage = userMessage;
    this.context = Object.freeze({ ...context });
  }

  toJSON(): Readonly<{
    schemaVersion: 1;
    code: FindingsErrorCode;
    userMessage: string;
    context: FindingsErrorContext;
  }> {
    return Object.freeze({
      schemaVersion: 1 as const,
      code: this.code,
      userMessage: this.userMessage,
      context: this.context,
    });
  }
}

export function findingsUserMessageOf(code: FindingsErrorCode): string {
  return USER_MESSAGES[code];
}
