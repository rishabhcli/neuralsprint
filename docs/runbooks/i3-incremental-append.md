# I3 — Emitted output carried an earlier revision

- **Invariant:** output is written as a fresh object graph, never an incremental append
- **Event:** `sanitizer.seal.refused` with `reason=source-is-prefix` (**S2**), or any sealed document whose audit later fails (**S1**)
- **Encoding this alert protects:** `src/sanitizer/fresh-graph.ts`

## What fired, and what it means

A refusal (`S2`) means the writer produced append-shaped bytes and the seal caught it.
No user received anything; the repair failed closed. This is the system working.

A sealed document that later fails its own audit (`S1`) means the audit and the writer
disagree, and a file containing the original content may have been exported.

## Immediate containment

1. For `S1`: emergency-disable export, then re-audit every export from the affected build
   with `auditFreshObjectGraph`.
2. For `S2`: no user impact. Capture the failing `failures` list from the event.

## Diagnosis

```sh
npx vitest run tests/property/invariant-i3-fresh-object-graph.property.test.ts
npx vitest run tests/integration/invariant-fault-injection.test.ts
```

The `failures` array names the exact signature: `startxref-count-N`, `eof-count-N`,
`previous-pointer-count-N`, `source-is-prefix`, `missing-header`, `missing-trailing-eof`.
Map that to the writer stage that produced it. `source-is-prefix` almost always means a
retry appended onto a previous attempt's buffer rather than starting from a new one.

## Exit criteria

- The writer stage is fixed, not the audit.
- A property test reproduces the exact signature and runs at least 2,000 cases.
- For `S1`, every affected export is re-issued and recipients notified.
