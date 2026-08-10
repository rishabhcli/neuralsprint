# I4 — A green verdict was produced with unknown state present

- **Invariant:** unknown parser/filter/structure state yields NOT VERIFIED
- **Event:** `verdict.green_with_unknowns` (**S1**, structurally impossible)
- **Encoding this alert protects:** `src/findings/verdict.ts`

## What fired, and what it means

The green verdict variant's `unknowns` field has the type `readonly []`. A green verdict
carrying an unknown state therefore should not be constructible. A non-zero count means
one of: the union was widened, a value was cast, a verdict was deserialized without going
through `deriveVerdict`, or the emitting build differs from the audited source.

A user was shown a scoped pass for a document the tool did not fully understand.

## Immediate containment

1. Emergency-disable the verdict surface; inspection findings may remain visible because
   findings never assert absence on their own.
2. Collect the correlation ids of every green verdict from the affected build.

## Diagnosis

```sh
npx vitest run tests/property/invariant-i4-unknown-yields-not-verified.property.test.ts
npm run typecheck
git log -p --follow src/findings/verdict.ts
```

Look for: a cast to `Verdict`; a construction of the green variant outside
`deriveVerdict`; a deserializer that trusts a stored verdict.

## Exit criteria

- Verdicts are constructed in exactly one place again.
- Any stored verdict schema gains a version check that refuses an unknown shape.
- A property test reproduces the construction path at 4,000 cases.
