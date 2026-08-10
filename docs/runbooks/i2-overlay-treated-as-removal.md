# I2 — A finding was resolved without full surface coverage

- **Invariant:** a visual overlay is never treated as removal
- **Event:** `findings.resolution.without_full_surface_coverage` (**S1**, must be zero)
- **Encoding this alert protects:** `src/pdf/interpreter/coverage.ts`, `src/findings/removal.ts`

## What fired, and what it means

A finding reached the resolved state without an `IndependentAbsenceProof` covering every
surface its leak class declares in `LEAK_CLASS_REQUIRED_SURFACES`. The user was shown
"this is gone" when the evidence only supported "a viewer did not draw it".

This is the project's worst failure mode: a fake redaction reported as a real one.

## Immediate containment

1. Emergency-disable the repair and export path; inspection may stay available.
2. Identify every export produced by the affected build from the correlation ids.
3. Publish the affected build range where users act on results, not only in docs.

## Diagnosis

```sh
npx vitest run tests/property/invariant-i2-overlay-is-not-removal.property.test.ts
npx vitest run tests/integration/invariant-fault-injection.test.ts
npm run typecheck        # a widened ContentPresence union shows up here first
```

Check, in order: whether `CONTENT_PRESENCE` gained a member; whether `resolveFinding`
gained a caller that bypasses it; whether `LEAK_CLASS_REQUIRED_SURFACES` was weakened for
the affected class. A weakened required-surface list is a ratchet loosening and is
prohibited by `GOAL.md` section 8 without an ADR.

## Exit criteria

- The bypass is closed in a **type**, not in a runtime check alone.
- A property test reproduces the bypass and runs at least 2,000 cases.
- Every affected export is re-verified and the result communicated to whoever received it.
