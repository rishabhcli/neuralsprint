import { describe, expect, it } from 'vitest';

import {
  ReleaseBoundaryError,
  parseReleaseBoundary,
  releaseBoundary,
} from '../../src/config/release-boundary.js';

describe('release boundary', () => {
  it('exposes an immutable, fail-closed foundation state', () => {
    expect(releaseBoundary).toEqual({
      schemaVersion: 1,
      productionStatus: 'not-yet-in-production',
      documentProcessing: 'unavailable',
      documentSafetyClaim: 'none',
      runtimeNetworkDependencies: 'none',
    });
    expect(Object.isFrozen(releaseBoundary)).toBe(true);
  });

  it.each([
    null,
    [],
    {},
    { ...releaseBoundary, schemaVersion: 2 },
    { ...releaseBoundary, documentProcessing: 'available' },
    { ...releaseBoundary, unexpected: true },
  ])('rejects malformed or permissive input %#', (input) => {
    expect(() => parseReleaseBoundary(input)).toThrow(ReleaseBoundaryError);
  });
});
