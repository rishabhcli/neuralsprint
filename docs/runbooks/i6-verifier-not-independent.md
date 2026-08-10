# I6 — Verification was not independent of sanitizer state

- **Invariant:** verification reloads emitted bytes independently from sanitizer state
- **Events:** `verifier.request.rejected` with `reason=class-instance` (**S2**), `verifier.digest.mismatch` (**S1**)
- **Encoding this alert protects:** `src/verifier/independence.ts`

## What fired, and what it means

`reason=class-instance` (`S2`) means the sanitizer tried to hand the verifier a live
object. The request was refused and no verification ran, so no wrong result reached a
user.

`verifier.digest.mismatch` (`S1`) means the bytes the verifier received are not the bytes
that were announced. Either the transfer was corrupted, or two different documents are in
flight under one correlation id. Any verdict associated with that id is meaningless.

## Immediate containment

1. Invalidate every verdict sharing the affected correlation id.
2. If mismatches are recurring, emergency-disable the verification surface: a verifier
   that cannot say which bytes it read cannot produce a trustworthy pass.

## Diagnosis

```sh
npx vitest run tests/property/invariant-i6-independent-verification.property.test.ts
npx vitest run tests/integration/invariant-fault-injection.test.ts
npm run boundaries    # refuses src/verifier importing src/sanitizer
```

For a mismatch, check whether the emitted buffer is being mutated after
`buildIndependentRequest` copies it, and whether any transfer list is detaching a buffer
that is still referenced.

## Exit criteria

- The verifier's input is a copy, taken once, digested once.
- The boundary check still refuses a `src/verifier` → `src/sanitizer` import.
- A property test reproduces the mismatch at 2,500 cases.
