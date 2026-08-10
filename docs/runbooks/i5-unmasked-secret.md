# I5 — Unmasked material reached a report, log, or telemetry payload

- **Invariant:** real secrets are masked in UI, logs, telemetry, screenshots, and reports by default
- **Events:** `findings.report.refused` with `reason=sensitive-channel` or `reason=needle-instance` (**S2**); any observation of secret material in a sink (**S1**)
- **Encoding this alert protects:** `src/findings/masking.ts`, `src/findings/sensitive.ts`

## What fired, and what it means

A refusal (`S2`) means `assertReportSafe` caught a payload carrying a needle or a
sensitive channel object before it reached a sink. Nothing leaked; a code path tried to
serialize the wrong thing.

An observation in a sink (`S1`) means masking was bypassed — most likely by reading
`toChannelPayload()` outside the sanitizer-to-verifier hop, or by a sink that reads
private state through a debugger hook or a heap snapshot.

## Immediate containment

1. Stop the affected sink: disable the exporter, the log shipper, or the telemetry
   pipeline for that event.
2. Purge the affected records from every downstream store, including backups within the
   retention window.
3. Rotate anything the exposed material grants access to, if applicable.

## Diagnosis

```sh
npx vitest run tests/property/invariant-i5-structural-masking.property.test.ts
npx vitest run tests/integration/invariant-fault-injection.test.ts
grep -rn "toChannelPayload" src/    # every legitimate call site is the worker hop
```

`toChannelPayload` is the only intentional serialization of a secret. Any call site that
is not the sanitizer-to-verifier boundary is the bug.

## Exit criteria

- The offending call site is removed or moved behind the worker boundary.
- `assertReportSafe` is applied at the sink, not only at the caller.
- A property test injects the payload at the depth that leaked, at 3,000 cases.
