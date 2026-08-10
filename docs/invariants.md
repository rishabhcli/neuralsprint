# Domain invariant register

- **Schema version:** 1
- **Recorded:** 2026-08-10
- **Tier:** `GOAL.md` section 6, Tier 1
- **Scope:** the seven invariants in `AGENTS.md` § Domain invariants

Tier 1 requires that each invariant stop being prose and become machine-enforced, and
that five questions be answered **in code** for every one of them:

1. Where is it encoded in a type, schema, database constraint, or protocol definition?
2. Which property test attacks it hardest, and how many cases does it run?
3. Which fault-injection scenario attacks it while a component is failing?
4. What is the observable behaviour at the boundary when malformed input violates it?
5. Which alert fires in production if it is ever violated, and which runbook does it link to?

Line references are to the commit that introduced this register; treat the symbol name
as authoritative if a later edit moves the line. Every alert below is **not yet wired to
a destination**, because no production deployment exists: `GOAL.md` section 5 clauses 5
and 9 are unmet. Each row names the event the alert will consume and the runbook it
already links to, so the wiring is a connection rather than a design.

---

## I1 — No document byte leaves the device by default

| Question            | Answer                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Encoding**        | `src/pdf/parser/device-local-bytes.ts:43` — `DeviceLocalBytes` is nominal (private constructor plus a `#private` field), so no structurally similar object is accepted; `adopt` copies the caller's buffer and records an on-device origin. `src/pdf/parser/external-reference.ts:43` — `refused` has the literal type `true`. `src/pdf/parser/external-reference.ts:202` — `resolveExternalTarget` returns `never`. |
| **Property test**   | `tests/property/invariant-i1-no-document-egress.property.test.ts` — `i1-refuses-every-target` **4,000 cases**, `i1-egress-shapes-are-flagged` **3,000**, `i1-resolution-always-throws` **2,000**, `i1-file-spec-slots` **2,000**, `i1-adoption-copies` **2,000**, `i1-serialization-carries-no-content` **2,000**.                                                                                                   |
| **Fault injection** | `tests/integration/invariant-fault-injection.test.ts` — the caller transfers and detaches the source `ArrayBuffer` immediately after adoption; and a recovery routine reaches for an external file while an `xref` parse is already throwing.                                                                                                                                                                        |
| **Malformed input** | A non-string, empty, or unparseable target classifies as `empty-or-unparseable` and is still `refused`. An unlisted scheme is reported as `unlisted-scheme` rather than echoed, so a crafted target cannot print content into a finding. Empty or oversized bytes raise `PDF_BYTES_EMPTY` / `PDF_BYTES_TOO_LARGE`.                                                                                                   |
| **Alert → runbook** | `pdf.external_reference.refused` (any occurrence in production is expected and informational) and `pdf.egress.attempted` (must be zero; page 1 severity) → [`docs/runbooks/i1-egress-attempt.md`](./runbooks/i1-egress-attempt.md).                                                                                                                                                                                  |

Additionally, `tests/security/runtime-network-surface.test.ts` statically refuses any
client network primitive or remote origin anywhere under `src/`, and
`scripts/check-boundaries.mjs` refuses every external import inside a domain owner.

---

## I2 — A visual overlay is never treated as removal

| Question            | Answer                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Encoding**        | `src/pdf/interpreter/coverage.ts:49` — `CONTENT_PRESENCE` has exactly two members and neither means absent. `src/pdf/interpreter/coverage.ts:59` — `presenceFromVisibility` is total and cannot return removal. `src/findings/removal.ts:196` — `ResolvedFinding` is nominal; `src/findings/removal.ts:243` — `resolveFinding` is its only constructor and demands full surface coverage. |
| **Property test**   | `tests/property/invariant-i2-overlay-is-not-removal.property.test.ts` — `i2-presence-is-never-absent` **4,000 cases**, `i2-full-cover-is-still-present` **3,000**, `i2-earlier-paint-cannot-hide` **2,000**, `i2-overlay-never-resolves` **2,000**, `i2-residual-blocks-proof` **2,000**.                                                                                                 |
| **Fault injection** | `tests/integration/invariant-fault-injection.test.ts` — the verification pass crashes after attacking one surface; the covered-text finding stays unresolved rather than inheriting the partial result.                                                                                                                                                                                   |
| **Malformed input** | `parseTextVisibility` refuses a fabricated `"removed"` kind, an out-of-range coverage fraction, a negative paint index, and an unsupported schema version, each with `PDF_STRUCTURE_AMBIGUOUS`.                                                                                                                                                                                           |
| **Alert → runbook** | `findings.resolution.without_full_surface_coverage` (must be zero) → [`docs/runbooks/i2-overlay-treated-as-removal.md`](./runbooks/i2-overlay-treated-as-removal.md).                                                                                                                                                                                                                     |

---

## I3 — Output is written as a fresh object graph, never incremental append

| Question            | Answer                                                                                                                                                                                                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Encoding**        | `src/sanitizer/fresh-graph.ts:113` — `FreshDocumentBytes` is nominal with a private constructor; `src/sanitizer/fresh-graph.ts:150` — `seal` runs `auditFreshObjectGraph` (`:56`) over the **emitted bytes** and refuses more than one header, `startxref` or `%%EOF`, any `/Prev`, or output that begins with the source. |
| **Property test**   | `tests/property/invariant-i3-fresh-object-graph.property.test.ts` — `i3-append-always-refused` **3,000 cases**, `i3-previous-pointer-refused` **2,500**, `i3-source-prefix-refused` **2,500**, `i3-fresh-rebuild-seals` **2,000**, `i3-sealed-bytes-are-copies` **1,500**.                                                 |
| **Fault injection** | `tests/integration/invariant-fault-injection.test.ts` — the writer is truncated mid-emit, and a retry appends its second attempt onto the first.                                                                                                                                                                           |
| **Malformed input** | Output with no header, a duplicated header, or trailing content after `%%EOF` raises `SANITIZER_OUTPUT_MALFORMED`; append signatures raise `SANITIZER_INCREMENTAL_APPEND_REFUSED` or `SANITIZER_SOURCE_PREFIX_DETECTED`. No partial document is ever emitted.                                                              |
| **Alert → runbook** | `sanitizer.seal.refused` with `reason=source-is-prefix` (must be zero) → [`docs/runbooks/i3-incremental-append.md`](./runbooks/i3-incremental-append.md).                                                                                                                                                                  |

---

## I4 — Unknown parser/filter/structure state yields NOT VERIFIED

| Question            | Answer                                                                                                                                                                                                                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Encoding**        | `src/findings/verdict.ts:93` — the green variant's `unknowns` field is the empty tuple type `readonly []`, so a scope carrying any unknown state is not assignable. `src/findings/verdict.ts:145` — `deriveVerdict` returns NOT VERIFIED before evaluating anything else.                                                    |
| **Property test**   | `tests/property/invariant-i4-unknown-yields-not-verified.property.test.ts` — `i4-unknown-forces-not-verified` **4,000 cases**, `i4-green-requires-all-conditions` **4,000**, `i4-not-run-and-errored-are-failures-not-skips` **3,000**, `i4-residual-is-a-confirmed-leak` **3,000**, `i4-no-attacks-is-not-green` **2,000**. |
| **Fault injection** | `tests/integration/invariant-fault-injection.test.ts` — one attack errors after the others pass, and a run is cancelled with attacks still queued. Both are NOT VERIFIED, never a skip.                                                                                                                                      |
| **Malformed input** | `parseAttackOutcome` and `parseUnknownState` refuse unknown attack ids, unknown statuses, negative residual counts, unknown surfaces, and empty codes. An unusable emitted-bytes digest also forces NOT VERIFIED.                                                                                                            |
| **Alert → runbook** | `verdict.green_with_unknowns` (structurally impossible; a non-zero count means the type system was bypassed) → [`docs/runbooks/i4-unknown-state-green.md`](./runbooks/i4-unknown-state-green.md).                                                                                                                            |

---

## I5 — Real secrets are masked in UI, logs, telemetry, screenshots, and reports by default

| Question            | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Encoding**        | `src/findings/masking.ts:65` and `:87` — masking is a function of the character-class sequence alone. `src/findings/sensitive.ts:47` — the secret lives in a `#private` field, so spread, `Object.keys`, `structuredClone` and `JSON.stringify` cannot reach it; `toJSON`, `toString` and the inspection hook all emit the mask. `src/findings/sensitive.ts:267` — `assertReportSafe` refuses a sensitive channel payload at any depth. |
| **Property test**   | `tests/property/invariant-i5-structural-masking.property.test.ts` — `i5-class-invariance` **4,000 cases**, `i5-mask-alphabet-only` **4,000**, `i5-needle-never-serializes-its-value` **4,000**, `i5-report-safety-at-any-depth` **3,000**, `i5-report-safety-accepts-masked-only` **3,000**, `i5-byte-search-covers-real-encodings` **2,000**.                                                                                          |
| **Fault injection** | `tests/integration/invariant-fault-injection.test.ts` — a crash report serializes the whole failure context including a live needle, and a retry context captures the sensitive worker channel. The first masks; the second is refused.                                                                                                                                                                                                 |
| **Malformed input** | `parseMaskedEvidence` returns `null` for a skeleton containing anything outside the class alphabet — which is exactly what a leaked secret looks like — and for an over-length skeleton or a bad version. `SensitiveNeedle.adopt` refuses an empty value or a malformed id.                                                                                                                                                             |
| **Alert → runbook** | `findings.report.refused` with `reason=sensitive-channel` or `reason=needle-instance` (must be zero) → [`docs/runbooks/i5-unmasked-secret.md`](./runbooks/i5-unmasked-secret.md).                                                                                                                                                                                                                                                       |

---

## I6 — Verification reloads emitted bytes independently from sanitizer state

| Question            | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Encoding**        | `src/verifier/independence.ts:105` — `IndependentVerificationRequest` carries bytes and plain data only. `src/verifier/independence.ts:39` — `assertStructuredCloneSafe` refuses functions, symbols, bigints, accessors, symbol keys, and any prototype other than `Object` or `null`. `src/verifier/independence.ts:151` — `acceptIndependentRequest` re-derives the digest of the bytes it actually received. `scripts/check-boundaries.mjs` forbids `src/verifier` from importing `src/sanitizer`. |
| **Property test**   | `tests/property/invariant-i6-independent-verification.property.test.ts` — `i6-live-values-refused` **3,000 cases**, `i6-plain-data-accepted` **3,000**, `i6-digest-is-rederived` **2,500**, `i6-announced-digest-cannot-lie` **2,500**, `i6-sanitizer-handle-cannot-cross` **2,000**.                                                                                                                                                                                                                 |
| **Fault injection** | `tests/integration/invariant-fault-injection.test.ts` — a real `structuredClone` hop degrades a sealed sanitizer handle into a plain record, and a payload is truncated in transit. Both are refused; the truncation is refused specifically as `VERIFIER_BYTES_DIGEST_MISMATCH`.                                                                                                                                                                                                                     |
| **Malformed input** | Every request field is re-validated worker-side: bad version, bad request id, non-`Uint8Array` bytes, malformed digest, non-array needles, and every malformed policy field raise `VERIFIER_REQUEST_INVALID`.                                                                                                                                                                                                                                                                                         |
| **Alert → runbook** | `verifier.request.rejected` with `reason=class-instance` and `verifier.digest.mismatch` (both must be zero) → [`docs/runbooks/i6-verifier-not-independent.md`](./runbooks/i6-verifier-not-independent.md).                                                                                                                                                                                                                                                                                            |

---

## I7 — A green result names exactly which attacks passed and never implies universal safety

| Question            | Answer                                                                                                                                                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Encoding**        | `src/findings/verdict.ts:89` and `:91` — `attacksPassed` and `notCovered` are non-empty tuple types. `src/findings/verdict.ts:58` — `STANDING_LIMITATIONS` is merged into every scope, so an empty limitation list has no representation. `summarizeVerdict` renders both. |
| **Property test**   | `tests/property/invariant-i7-green-names-its-attacks.property.test.ts` — `i7-green-names-every-attack` **4,000 cases**, `i7-scope-surfaces-match-attacks` **3,000**, `i7-never-universal` **4,000**, `i7-additional-limitations-are-additive` **2,000**.                   |
| **Fault injection** | `tests/integration/invariant-fault-injection.test.ts` — a partially completed attack set is rendered; the summary says NOT VERIFIED and names no scope.                                                                                                                    |
| **Malformed input** | A scope can only name attacks that reported `passed`; the surface list is derived from `ATTACK_SURFACE_COVERAGE` rather than supplied, so a caller cannot widen it. `bannedSafetyPhrasesIn` refuses universal-safety copy.                                                 |
| **Alert → runbook** | `verdict.copy.banned_phrase` (must be zero; also enforced at build time by the copy lint) → [`docs/runbooks/i7-universal-safety-claim.md`](./runbooks/i7-universal-safety-claim.md).                                                                                       |

---

## Regenerating this register's evidence

```sh
npm run test:unit        # unit and property layers, including every case count above
npm run test:integration # fault-injection layer
npm run test             # both, with coverage thresholds
```

Case counts are declared inside each test name and asserted by `fast-check`'s `numRuns`;
lowering one is a visible diff in both the test name and the run configuration.
