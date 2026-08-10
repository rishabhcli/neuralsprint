/**
 * Explicit budgets for every untrusted document boundary.
 *
 * `AGENTS.md` treats an unbounded boundary as a defect even when it has never been
 * exceeded. Each budget is a named, typed value so that exceeding it produces
 * `PDF_LIMIT_EXCEEDED` rather than an unbounded allocation or an unbounded loop.
 */

import { PdfBoundaryError } from './errors.js';

export type DocumentLimits = Readonly<{
  schemaVersion: 1;
  /** Largest document accepted for inspection, in bytes. */
  maximumDocumentBytes: number;
  /** Largest single decoded stream retained in memory, in bytes. */
  maximumDecodedStreamBytes: number;
  /** Largest total decoded byte volume across one inspection, in bytes. */
  maximumDecodedTotalBytes: number;
  /** Largest number of indirect objects walked in one inspection. */
  maximumObjectCount: number;
  /** Largest number of incremental revisions walked before refusing. */
  maximumRevisionCount: number;
  /** Largest indirect-reference resolution depth before refusing. */
  maximumResolutionDepth: number;
  /** Largest number of content-stream operators interpreted per page. */
  maximumOperatorsPerPage: number;
  /** Largest number of filters chained on one stream. */
  maximumFilterChainLength: number;
  /** Wall-clock deadline for one inspection, in milliseconds. */
  inspectionDeadlineMs: number;
}>;

/**
 * Epoch-1 budgets. `GOAL.md` section 8 ratchets `maximumDocumentBytes` from 50MB
 * upward; every increase must be accompanied by regenerated large-document evidence.
 */
export const DEFAULT_DOCUMENT_LIMITS: DocumentLimits = Object.freeze({
  schemaVersion: 1 as const,
  maximumDocumentBytes: 50 * 1024 * 1024,
  maximumDecodedStreamBytes: 64 * 1024 * 1024,
  maximumDecodedTotalBytes: 256 * 1024 * 1024,
  maximumObjectCount: 500_000,
  maximumRevisionCount: 256,
  maximumResolutionDepth: 64,
  maximumOperatorsPerPage: 2_000_000,
  maximumFilterChainLength: 8,
  inspectionDeadlineMs: 120_000,
});

const POSITIVE_INTEGER_KEYS = [
  'maximumDocumentBytes',
  'maximumDecodedStreamBytes',
  'maximumDecodedTotalBytes',
  'maximumObjectCount',
  'maximumRevisionCount',
  'maximumResolutionDepth',
  'maximumOperatorsPerPage',
  'maximumFilterChainLength',
  'inspectionDeadlineMs',
] as const satisfies readonly (keyof DocumentLimits)[];

/**
 * Validates a limit set at the trust boundary. Zero, negative, fractional, and
 * non-finite budgets are refused: an "unlimited" budget is not representable.
 */
export function parseDocumentLimits(input: unknown): DocumentLimits {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new PdfBoundaryError('PDF_LIMIT_EXCEEDED', { field: '$', reason: 'not-an-object' });
  }
  const record = input as Record<string, unknown>;
  if (record.schemaVersion !== 1) {
    throw new PdfBoundaryError('PDF_LIMIT_EXCEEDED', {
      field: 'schemaVersion',
      reason: 'unsupported-version',
    });
  }

  const draft: Record<string, number> = {};
  for (const key of POSITIVE_INTEGER_KEYS) {
    const value = record[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
      throw new PdfBoundaryError('PDF_LIMIT_EXCEEDED', { field: key, reason: 'not-positive' });
    }
    draft[key] = value;
  }

  const known = new Set<string>([...POSITIVE_INTEGER_KEYS, 'schemaVersion']);
  for (const key of Object.keys(record)) {
    if (!known.has(key)) {
      throw new PdfBoundaryError('PDF_LIMIT_EXCEEDED', { field: key, reason: 'unknown-field' });
    }
  }

  return Object.freeze({ schemaVersion: 1 as const, ...draft }) as DocumentLimits;
}

/** A monotonically consumed budget. Consumption never silently saturates. */
export class BudgetMeter {
  readonly limit: number;
  readonly label: string;
  #used = 0;

  constructor(label: string, limit: number) {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new PdfBoundaryError('PDF_LIMIT_EXCEEDED', { field: label, reason: 'not-positive' });
    }
    this.label = label;
    this.limit = limit;
  }

  get used(): number {
    return this.#used;
  }

  get remaining(): number {
    return this.limit - this.#used;
  }

  /** Consumes `amount`; throws `PDF_LIMIT_EXCEEDED` rather than truncating work silently. */
  consume(amount: number): void {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new PdfBoundaryError('PDF_LIMIT_EXCEEDED', {
        field: this.label,
        reason: 'invalid-amount',
      });
    }
    const next = this.#used + amount;
    if (next > this.limit) {
      throw new PdfBoundaryError('PDF_LIMIT_EXCEEDED', {
        field: this.label,
        limit: this.limit,
        requested: next,
      });
    }
    this.#used = next;
  }

  /** True when `amount` would fit, without consuming it. */
  wouldFit(amount: number): boolean {
    return Number.isSafeInteger(amount) && amount >= 0 && this.#used + amount <= this.limit;
  }
}
