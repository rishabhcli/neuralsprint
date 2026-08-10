import releaseBoundaryInput from '../../config/release-boundary.json';

export type ReleaseBoundary = Readonly<{
  schemaVersion: 1;
  productionStatus: 'not-yet-in-production';
  documentProcessing: 'unavailable';
  documentSafetyClaim: 'none';
  runtimeNetworkDependencies: 'none';
}>;

export class ReleaseBoundaryError extends Error {
  readonly code = 'RELEASE_BOUNDARY_INVALID';
  readonly retryable = false;

  constructor(readonly invalidField: string) {
    super(`Release boundary configuration is invalid at ${invalidField}.`);
    this.name = 'ReleaseBoundaryError';
  }
}

const expectedEntries = {
  schemaVersion: 1,
  productionStatus: 'not-yet-in-production',
  documentProcessing: 'unavailable',
  documentSafetyClaim: 'none',
  runtimeNetworkDependencies: 'none',
} as const satisfies ReleaseBoundary;

export function parseReleaseBoundary(input: unknown): ReleaseBoundary {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ReleaseBoundaryError('$');
  }

  const record = input as Record<string, unknown>;
  const expectedKeys = Object.keys(expectedEntries);
  const actualKeys = Object.keys(record);

  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key) => !expectedKeys.includes(key))
  ) {
    throw new ReleaseBoundaryError('keys');
  }

  for (const key of expectedKeys) {
    if (record[key] !== expectedEntries[key as keyof typeof expectedEntries]) {
      throw new ReleaseBoundaryError(key);
    }
  }

  return Object.freeze({ ...expectedEntries });
}

export const releaseBoundary = parseReleaseBoundary(releaseBoundaryInput);
