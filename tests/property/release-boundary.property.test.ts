import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  ReleaseBoundaryError,
  parseReleaseBoundary,
  releaseBoundary,
} from '../../src/config/release-boundary.js';

describe('release boundary properties', () => {
  it('never accepts an arbitrary value unless it is the exact fail-closed contract', () => {
    fc.assert(
      fc.property(fc.anything(), (candidate) => {
        try {
          expect(parseReleaseBoundary(candidate)).toEqual(releaseBoundary);
          expect(candidate).toEqual(releaseBoundary);
        } catch (error: unknown) {
          expect(error).toBeInstanceOf(ReleaseBoundaryError);
          expect(candidate).not.toEqual(releaseBoundary);
        }
      }),
      { numRuns: 1_000, seed: 2_026_08_09 },
    );
  });

  it('rejects every mutation of a required field', () => {
    const fields = Object.keys(releaseBoundary) as (keyof typeof releaseBoundary)[];

    fc.assert(
      fc.property(fc.constantFrom(...fields), fc.anything(), (field, value) => {
        fc.pre(value !== releaseBoundary[field]);
        expect(() => parseReleaseBoundary({ ...releaseBoundary, [field]: value })).toThrow(
          ReleaseBoundaryError,
        );
      }),
      { numRuns: 1_000, seed: 2_026_08_10 },
    );
  });
});
