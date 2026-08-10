# I7 — Published copy implied universal safety

- **Invariant:** a green result names exactly which attacks passed and never implies universal safety
- **Event:** `verdict.copy.banned_phrase` (**S2**, must be zero)
- **Encoding this alert protects:** `src/findings/verdict.ts`

## What fired, and what it means

Copy rendered next to a result matched `BANNED_SAFETY_PHRASES`. Even when the underlying
verdict is correctly scoped, the wording invites a user to treat a scoped pass as a
guarantee — and a screenshot of that wording outlives the context it was written in.

This also fires for negated phrasing ("not completely safe"), deliberately: a clipped
screenshot loses the negation.

## Immediate containment

1. Replace the copy with the rendered `summarizeVerdict` output, which always names the
   attacks and the limitations.
2. If the phrase shipped in a screenshot, a demo video, or a submission, withdraw or
   annotate that artifact. `GOAL.md` Tier 13 forbids a submission claim the system cannot
   support.

## Diagnosis

```sh
npx vitest run tests/property/invariant-i7-green-names-its-attacks.property.test.ts
grep -rn "safe\b" src/ui/    # every user-facing safety word needs a scope beside it
```

## Exit criteria

- The phrase is gone from source, from published artifacts, and from any cached copy.
- If the phrase was legitimate and the list is wrong, the list changes only through an
  ADR that explains why the weaker wording is still honest.
- The copy lint covers the new phrasing.
