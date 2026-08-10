# Progress Journal

This file is append-only. Failed commands, withdrawn claims, and superseded decisions remain part of the record.

## 2026-08-09T21:34:56-07:00 — Tier 0 development preflight attempted

- **Work selected by `GOAL.md` section 10.1:** Run the highest-priority development health gate, beginning with preflight.
- **Command:** `npm run dev:preflight`
- **Outcome:** Failed with exit code `1` because `scripts/dev-lifecycle.mjs` did not yet exist (`MODULE_NOT_FOUND`).
- **Evidence produced:** Terminal output only; no committed evidence artifact exists for this failure.
- **What became true:** The advertised package script was proven non-executable at this point in history. No development-health claim was made.
- **Risks:** Until the lifecycle implementation exists and all semantic probes pass, downstream browser or service evidence would be false green.
- **Migration / rollback:** Not applicable; this was a read-only command.
- **Blocked items:** None. Missing implementation is not an external blocker.
- **Next item selected:** Implement the Tier 0 lifecycle, then rerun `dev:preflight`, `dev:up`, and `dev:health` in order.

## 2026-08-09 — Tier 0 governance slice opened

- **Behavior delivered:** Added the toolchain/local-service ADR, direct-dependency register, assumptions ledger, blocker ledger, versioned foundation support matrix, and an executable README contract. No PDF behavior is claimed.
- **Boundaries touched:** Documentation and governance files only. `AGENTS.md`, `GOAL.md`, package/configuration, scripts, and source are unchanged by this slice.
- **Commands run:** Package metadata queries with `npm view`; repository and toolchain inspection; documentation formatting check to be appended after it runs.
- **Acceptance evidence:**
  - ADR-0001 exists and records context, alternatives, decision, consequences, and reversal.
  - `docs/dependencies.md` is generated against the direct entries in `package.json`; final parity check is pending package integration.
  - README and support matrix state “not yet in production” and explicitly mark PDF inspection, repair, verification, and export as unimplemented.
  - Passing `dev:health`, `verify-all`, CI, and clean-checkout artifacts do not yet exist at the time of this entry and are not claimed.
- **Risks:** Toolchain and lifecycle work is being integrated in parallel; exact-version drift must be reconciled before the dependency register can count as evidence.
- **Migrations:** None.
- **Rollback:** Revert only the governance files from this slice; no runtime or persisted data changes exist.
- **Blocked items:** None.
- **Next item selected:** The failing development gate remains first in `GOAL.md` section 10.1; rerun it after lifecycle integration, then append the result without rewriting this entry.

## 2026-08-09 — Tier 0 local-service gate recovered

- **Work selected by `GOAL.md` section 10.1:** Re-run the previously failing development gate after lifecycle integration.
- **Commands:** `npm run dev:preflight`; `npm run dev:up`; `npm run dev:health`.
- **Outcome:** All commands returned zero. Preflight reported ports 4210–4213 free; `dev:up` built the current static surface and reported all four allocated services ready; `dev:health` returned typed ready events for `app-dev`, `preview`, `playwright`, and `fixtures` on ports 4210–4213.
- **Evidence produced:** Working-tree terminal output only. No clean-checkout or committed `evidence/` artifact exists yet, so this is not Tier 0 release evidence.
- **What became true:** The highest-priority local development gate is healthy in this working tree. The earlier failed command remains recorded above.
- **Risks:** Ownership/refusal tests and clean-checkout reproduction must still prove that foreign processes are never signalled and stale/wrong service identities fail closed.
- **Migrations / rollback:** Runtime state is isolated under `.dev/`; `npm run dev:down` is the documented targeted rollback. Services remain up because health is a standing gate.
- **Blocked items:** None.
- **Next item selected:** Run the full repository gate and address its first failure; do not infer PDF capability or production from local-service health.

## 2026-08-09 — Governance documentation formatted and reconciled

- **Command:** `prettier --write` limited to the seven governance documents, followed by `prettier --check` over the same list.
- **Outcome:** All matched files use Prettier formatting.
- **Additional check:** A read-only package/document parity script found all 21 direct dependency/version pairs exactly once in `docs/dependencies.md` with no stale rows.
- **Evidence produced:** Working-tree terminal output only; no clean-checkout artifact yet.
- **What became true:** The governance slice is formatted and the dependency register matches the current `package.json` direct set (2 runtime, 19 development).
- **Next item selected:** Full repository verification remains the next Tier 0 gate.

## 2026-08-09 — Full repository gate attempted

- **Command:** `npm run verify-all`.
- **Outcome:** Failed with exit code `1` at the first repository check, `npm run format:check`, after the toolchain probe passed on Node.js 26.5.1 compatibility runtime and npm 11.17.0.
- **Failure evidence:** Prettier reported 19 nonconforming files. The list included preserved authority documents (`AGENTS.md`, `GOAL.md`, `HACKATHON.md`, and `WINNING_IDEA.md`) as well as implementation/configuration/test files owned by parallel Tier 0 lanes.
- **Evidence produced:** Working-tree terminal output only; there is no passing `verify-all` artifact and no clean-checkout evidence.
- **What became true:** The single Tier 0 gate is executable and fails on its first unmet condition rather than reporting success. Tier 0 exit is not claimed.
- **Safety boundary:** Global format-write was not run because this governance lane must preserve `AGENTS.md` and `GOAL.md`, and broad formatting would create unrelated changes.
- **Next item selected:** Reconcile format scope without rewriting authoritative documents, format implementation files in their owning lanes, and rerun the full gate.

## 2026-08-09 — Chromium foundation E2E attempted

- **Command:** `npm run test:e2e` against the owned, healthy Playwright service on `127.0.0.1:4212`.
- **Outcome:** Failed. Two of four tests passed: render after network disable and 400% equivalent zoom/reflow. The release-boundary assertion did not find an exact nested text locator, and the axe test found one serious contrast violation (`#67695f` on `#e9e3d4`, measured 4.35:1 versus the 4.5:1 requirement).
- **Evidence produced:** Ignored Playwright traces, screenshots, videos, and error contexts under `.dev/tmp/playwright-results/`; no committed evidence artifact.
- **What remains false:** Chromium is not a supported browser yet, accessibility is not green, and `verify-all` cannot pass.
- **Next item selected:** Correct the UI/test locator ownership and contrast failure in the implementation lane, then rerun all four browser tests before changing the support matrix.

## 2026-08-09 — Chromium foundation E2E recovered

- **Commands:** `npm run dev:health && npm run test:e2e`.
- **Outcome:** Development health remained green for all four services. All four Chromium foundation checks then passed: explicit unsupported-document boundary with no dead control, rendering after network disable, automated axe scan, and 400% equivalent zoom/reflow.
- **Evidence produced:** Working-tree terminal output and ignored Playwright output only; no committed or clean-checkout artifact exists yet.
- **Warnings:** Playwright workers reported that `NO_COLOR` was ignored because `FORCE_COLOR` was set. The command returned zero, but warning-free gate policy still requires reconciliation.
- **What became true:** The two browser failures recorded above were fixed and the current Chromium working-tree suite passes 4/4. Chromium remains “not verified” in the support matrix until the same committed suite passes from a clean checkout.
- **Next item selected:** Rerun `verify-all` from the clean authority surface after format scope and warning policy are reconciled.

## 2026-08-09T23:16:55-07:00 — Repository-local browser-cache gate exposed a false local pass

- **Work selected by `GOAL.md` section 10.1:** Close the Tier 0 cache-isolation and clean-checkout gap by making every Playwright invocation use `.dev/cache/ms-playwright` instead of a shared user cache.
- **Command:** `npm run test:e2e` after the runner began enforcing `PLAYWRIGHT_BROWSERS_PATH` beneath this repository.
- **Outcome:** Failed 4/4 browser checks before test execution because the newly authoritative repository-local cache did not yet contain `chromium_headless_shell-1234`. Earlier working-tree browser passes had used a browser from a shared cache and therefore did not prove the documented namespace contract.
- **Evidence produced:** Ignored Playwright error contexts and traces under `.dev/tmp/playwright-results/`; no committed green artifact was produced from this failure.
- **What became true:** The browser runner now fails closed when the repository-owned browser payload is absent instead of silently borrowing shared machine state.
- **Remediation command:** `PLAYWRIGHT_BROWSERS_PATH="$PWD/.dev/cache/ms-playwright" npm exec -- playwright install chromium` installed the pinned Chromium, headless shell, and FFmpeg payloads beneath `.dev/cache/`; the next browser run passed all four checks, including the built-preview loopback/offline test.
- **Risks:** Direct installation is recovery evidence only. The committed `npm run bootstrap` path and a fresh checkout must reproduce the same cache location before Tier 0 can exit.
- **Migrations / rollback:** Browser/cache files are ignored repository-local state; removing `.dev/cache/ms-playwright` rolls them back without touching a shared cache. No user data exists.
- **Blocked items:** None.
- **Next item selected:** Finish the latest audit fixes, run the complete warning-refusing gate, and regenerate working-tree evidence before the first foundation commit.

## 2026-08-10T06:35:10-07:00 — Tier 0 control plane became strictly checked and load-resilient

- **Work selected by `GOAL.md` section 10.1:** Close the strict-compiler, bounded-child, lifecycle-refusal, and reproducible-verification gaps before regenerating Tier 0 evidence.
- **Behavior delivered:** Added a strict checked-JavaScript composite project for every `scripts/**/*.mjs` implementation, removed declaration sidecars that could shadow runtime code, redirected declarations/incremental state under `.dev/cache/typescript/`, and referenced the scripts project from the root and test projects. Added a non-interactive bounded child runner with aggregate output ceilings, per-command deadlines, parent-signal forwarding, process-group termination escalation, and stable coded failures. Hardened atomic lifecycle locking, service-spawn handoff, generated-fixture symlink handling, production-build environment isolation, supply-chain policy validation, production-only SBOM generation, and clean-evidence drift checks.
- **Commands and outcomes:** `npm run format:check`, `npm run lint`, `npm run typecheck`, and `npm run boundaries` passed after the checked-JavaScript conversion. The first focused bounded-child rerun failed 5/6 because a 2-second non-timeout harness deadline raced host scheduling; after keeping first-trigger-wins semantics, using a portable Node output flood, and separating semantic assertions from the dedicated timeout test, three consecutive focused runs passed 6/6 each. Initial lifecycle integration retries exposed 5-second HTTP/helper-start false timeouts and then a 30-second service-start false timeout under the documented sixteen-repository load; finite harness/lifecycle deadlines were increased without changing response, ownership, or refusal assertions. `npm run test:integration` then passed 7/7 in 148.74 seconds, including foreign-listener survival, exact preflight/down refusal codes, authenticated control refusal, typed liveness/readiness, malformed/dead lock behavior, and fixture symlink/traversal refusal. `npm run test:e2e` passed 4/4 in Chromium and `npm run test:accessibility` passed 2/2. A Node.js 24.19.0 production build launched with inherited `NODE_ENV=test` and a `VITE_*` canary passed asset budgets (193,134 JavaScript bytes, 3,673 CSS bytes, 197,451 total bytes) with neither the canary nor repository path in `dist/`. `npm run bootstrap` passed under Node.js 24.19.0/npm 11.17.0, installed the exact 202-package graph, and reported zero vulnerabilities.
- **Failed full-gate evidence retained:** The first Node.js 24 `npm run evidence:verify-all` attempt failed honestly at its first step when the 30-second wrapper killed an otherwise-correct toolchain probe before it emitted output. Earlier, Rolldown emitted a load-dependent `PLUGIN_TIMINGS` heuristic for an expected CSS hook, which the stderr-refusing integration harness also rejected. The orchestration deadlines remain bounded but now include measured shared-host margin. The percentage-based Rolldown heuristic is explicitly disabled in favor of deterministic emitted-byte budgets; all warnings that tools emit remain terminal.
- **Evidence produced:** Diagnostic logs under ignored `.dev/tmp/`, regenerated dependency evidence, browser artifacts under ignored Playwright paths, and the still-failing temporary capture `.dev/tmp/tier0-verify.log.capture`. None is clean-checkout or CI evidence, and the previously committed-path `evidence/tier0-verify.log` remains stale until the next complete pass.
- **Risks and rollback:** Larger finite deadlines can lengthen failure discovery under severe load but cannot turn an invalid response, foreign listener, warning, output flood, non-zero exit, or stale ownership record into success. Revert the timeout/configuration slice and checked-JavaScript project together only if an equal-or-stronger bounded runner, compiler surface, and deterministic performance gate replace them; no user data or migration exists.
- **Blocked items:** None. Shared-host contention is measured operating context, not an external blocker.
- **Next item selected:** Re-run the complete Node.js 24 working-tree evidence command after the documentation/static gates settle; fix its first real failure and do not claim Tier 0 exit until committed clean-checkout and CI evidence exist.

## 2026-08-10T07:07:07-07:00 — Authoritative Node.js 24 working-tree gate passed

- **Work selected by `GOAL.md` section 10.1:** Re-run the first failing Tier 0 release gate after the bounded-deadline and warning-source corrections.
- **Command:** `PATH=/opt/homebrew/opt/node@24/bin:$PATH NO_COLOR=1 npm run evidence:verify-all`.
- **Outcome:** Passed. The command verified the exact Node.js 24.19.0/npm 11.17.0 toolchain; formatting; zero-warning lint; strict TypeScript plus checked-JavaScript project references; ownership boundaries; 21 direct and 225 resolved dependency records; full and production npm audits; targeted down/preflight/up/health; regenerated health evidence; 27/27 Vitest checks across six files; 4/4 Chromium E2E; 2/2 tagged accessibility checks; the fail-closed foundation evaluation; a production build; explicit byte budgets; a three-component production SBOM; and a three-artifact hashed release manifest.
- **Evidence and measurements:** [`evidence/tier0-verify.log`](./evidence/tier0-verify.log) records the working-tree command, seed, dirty-checkout status, and complete warning-free output. V8 coverage remains explicitly scoped to 19/19 statements in `src/config`; it is not a repository-wide claim. The emitted application measured 193,134 JavaScript bytes, 3,673 CSS bytes, and 197,451 total bytes. Post-run validation confirmed the lock SHA in dependency evidence and the release manifest is `3da6d59b057c6fce3201231b387b8e8a5ba9de19666daa3389d03c798c0119a8`, all three manifest artifact hashes match `dist/`, the production SBOM contains only React, React DOM, and Scheduler, and no evidence or build artifact contains the repository path, the build canary, or ANSI escape bytes.
- **What became true:** The Tier 0 executable contract passes completely in the mutable working tree under its authoritative runtime. This is diagnostic evidence only; Tier 0 has not exited because there is no committed clean-checkout capture or CI run URL/log.
- **Risks and rollback:** Host contention remains high, but all waits are finite and semantic/ownership failures remain terminal. The support matrix continues to mark every PDF outcome unimplemented and every platform unsupported until stronger evidence exists. Rollback is the coherent revert of the Tier 0 foundation; no persisted user data exists.
- **Blocked items:** None.
- **Next item selected:** Review the exact diff, commit the coherent Tier 0 foundation, reproduce `verify-all` from a clean checkout at that commit, then push and obtain CI evidence before beginning Tier 1 immediately.

## 2026-08-10T08:27:28-07:00 — Current application progress audit and next-agent handoff

This entry is a repository-wide implementation audit, not a claim that the product is complete. It
describes committed `main` at `cf6a7238b021883cb71bd6bafe8e4cb73997f3eb`, the durable CI result for
that commit, and the local development-health result observed immediately before this entry.

### Executive status

- **Production state:** Not yet in production. None of the 18 simultaneous production conditions in
  `GOAL.md` section 5 has been demonstrated as a complete set.
- **Application state:** The repository has a strong executable Tier 0 foundation and an honest static
  status page. It still has no user document input, PDF parser, findings engine, sanitizer, independent
  verifier, OCR path, region editor, sanitized-PDF export, or verification-report export.
- **Current goal position:** Tier 0 implementation is committed and the same commit passed the Linux
  clean-install CI workflow. ADR-0001's separately named `npm run evidence:clean-verify` artifact is
  not committed, and several status documents still say clean CI is pending. Treat Tier 0 as
  implemented and CI-verified but with evidence/documentation closure still open; do not round that
  gap up to a Tier 1 or production claim.
- **Next product tier:** Tier 1, machine-enforcing all seven document-safety invariants before any
  document ingestion path is exposed.
- **External blockers:** None are recorded in `BLOCKED.md` and none were discovered in this audit.

### Evidence that is currently real

- `origin/main` and the audited working branch both pointed to
  `cf6a7238b021883cb71bd6bafe8e4cb73997f3eb` at the start of this entry.
- GitHub Actions run
  [31402757094](https://github.com/rishabhcli/neuralsprint/actions/runs/31402757094) completed
  successfully for that exact commit. The workflow checked out a clean tree, installed Node.js
  24.19.0 and npm 11.17.0, ran `npm run bootstrap`, ran the complete `npm run verify-all` contract,
  and required deterministic regeneration with no resulting Git diff.
- `npm run dev:preflight && npm run dev:up && npm run dev:health` passed during this audit. The four
  repository-owned services were semantically ready on `127.0.0.1:4210` through `4213`; reserved
  ports `4214` through `4219` were free.
- The committed working-tree log records 27/27 Vitest checks, 4/4 Chromium foundation E2E checks,
  and 2/2 tagged accessibility checks. Its V8 percentage covers only `src/config`; it is not
  repository-wide or PDF-domain coverage.
- One deterministic, synthetic covered-text smoke PDF is generated under ignored `.dev/` state and
  validated by an integration test. It is fixture-service evidence only: there are zero tracked PDF
  corpus files, and no code detects or repairs the seeded token.
- Release metadata currently describes a static three-artifact browser build and a three-component
  production SBOM. It does not describe a PDF-processing release.

### Canonical user workflow scorecard

| Required user outcome                                                      | Current state   | What must exist before this row can pass                                                                                 |
| -------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1. Parse and inventory the entire PDF locally                              | Not implemented | Bounded file ingestion, xref tables and streams, object graph, filters, revision chain, typed refusals, and parser tests |
| 2. Map paint order, text, OCR, revisions, forms, metadata, and attachments | Not implemented | Interpreter geometry plus typed leak inventory across every declared surface                                             |
| 3. Let the user confirm sensitive regions or tokens                        | Not implemented | Accessible page review, masked findings, keyboard/numeric region editing, and safe reveal behavior                       |
| 4. Choose vector-preserving or high-assurance raster repair                | Not implemented | Explicit repair policy, ambiguity defaults, cancellation, limits, and truthful trade-off copy                            |
| 5. Rebuild fresh bytes rather than append an edit                          | Not implemented | Allowlisted fresh-object-graph sanitizer, raster fallback, and revision-absence proof                                    |
| 6. Independently reload and re-attack emitted bytes                        | Not implemented | Fresh worker/process contract with no sanitizer state plus structural, text, byte, OCR, and pixel attacks                |
| 7. Export a sanitized PDF and scoped report                                | Not implemented | Downloadable fresh PDF, versioned report schema, masked evidence, hashes, and exact named-attack results                 |

The product workflow is therefore not partially available: the UI intentionally exposes no file input
or document-safety verdict until these boundaries exist.

### `GOAL.md` ladder status

|                               Tier | Audited status                                 | Repository evidence or gap                                                                                                                                                                                                                    |
| ---------------------------------: | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|          0 — executable foundation | Implemented and CI-verified; closure task open | Strict toolchain, lockfile, commands, CI, lifecycle, boundaries, governance, threat model, support matrix, SBOM, and manifest exist. A committed `evidence/tier0-clean-verify.log` and reconciliation of stale "CI pending" text remain open. |
|              1 — domain invariants | Not delivered                                  | `src/config/release-boundary.ts` fail-closes the foundation and has two 1,000-run properties, but it does not encode the seven PDF-domain invariants or their required alert/fault/refusal contracts.                                         |
|            2 — hard technical core | Not started                                    | No tracked parser, interpreter, findings, sanitizer, verifier, OCR, or committed adversarial corpus exists.                                                                                                                                   |
|     3 — ingestion/trust boundaries | Not started for documents                      | Tier 0 loopback and fixture boundaries are hardened; there is no document-ingestion schema, size/memory/time budget, parser adapter, worker protocol, or document threat analysis.                                                            |
|           4 — first vertical slice | Not started                                    | No inspect-confirm-repair-reload-export user outcome exists.                                                                                                                                                                                  |
|         5 — refusal and abstention | Foundation refusal only                        | The static release boundary refuses all document processing. Product-specific malformed PDF, unknown filter, incomplete verification, cancellation, and recovery states do not exist yet.                                                     |
|                6 — ownership areas | UI foundation only                             | `src/ui` has two tracked files. `src/pdf/parser`, `src/pdf/interpreter`, `src/findings`, `src/sanitizer`, and `src/verifier` are absent.                                                                                                      |
|           7 — verification lattice | Foundation-only tests                          | Unit, property, integration, contract, E2E, security, accessibility, build-budget, and audit commands exist, but none verifies a PDF user outcome. OCR, pixel, byte, revision, mutation, fuzz, and large-document coverage are absent.        |
|            8 — evaluation/evidence | Foundation evaluation only                     | `npm run eval` proves that document processing is unavailable; it publishes no PDF detection, repair, residual, or false-green metric.                                                                                                        |
|   9 — performance/resilience/chaos | Foundation controls only                       | Static bundle-byte budgets and bounded child/lifecycle failure tests exist. PDF latency, memory, cancellation, recovery, worker crash, and chaos budgets do not.                                                                              |
| 10 — security/privacy/supply chain | Tier 0 only                                    | A Tier 0 threat model, exact dependencies, audits, SBOM, and no-client-network scan exist. There is no threat model or structural privacy proof for user document bytes because ingestion is absent.                                          |
|         11 — operational readiness | Development health only                        | Typed local liveness/readiness exists. Production SLOs, telemetry destination, dashboard, deployment, rollback, emergency disable, incident process, and relevant restore drill do not.                                                       |
|    12 — production/soak/real usage | Not started                                    | No tagged deployment, reproducibility drill, authoring-tool corpus, soak window, non-author user outcome, incident exercise, dependency-upgrade proof, or rollback drill.                                                                     |
|           13 — submission artifact | Draft record only                              | `HACKATHON.md` records draft submission `1131630`; no approved product name, production try-it-out link, evidence-checked copy, screenshots, public demo video, or finalized submission is committed.                                         |

### Domain-invariant gap audit

| Invariant                                                 | Current enforcement                                                                           | Required Tier 1 closure                                                                                                      |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| I1. No document byte leaves the device by default         | The foundation contains no client network primitive and accepts no document.                  | Encode a local-only document protocol before file input exists; property-test egress attempts and fault/cancellation paths.  |
| I2. A visual overlay is never removal                     | The smoke fixture contains text followed by a filled rectangle, but no product interprets it. | Make overlay detection a leak finding that can never transition directly to removed/verified.                                |
| I3. Output is always a fresh object graph                 | No output path exists.                                                                        | Brand or otherwise type fresh rebuild output so incremental append cannot satisfy the sanitizer contract.                    |
| I4. Unknown state yields NOT VERIFIED                     | The foundation release configuration rejects permissive mutations.                            | Add document verdict and error unions in which unknown parser/filter/structure state has no green transition.                |
| I5. Secrets are masked structurally by default            | Only a synthetic token exists in ignored fixture bytes; no finding/report type exists.        | Introduce masked-evidence domain types and tests covering UI, logs, telemetry, screenshots, and report serialization.        |
| I6. Verification independently reloads emitted bytes      | No sanitizer or verifier exists.                                                              | Define a serialized worker/process boundary that accepts emitted bytes and policy only, never sanitizer-owned mutable state. |
| I7. Green names the attacks passed and is never universal | The foundation makes no safety claim.                                                         | Make a verified verdict require a non-empty, versioned list of passed attacks and scoped limitation text by construction.    |

For every row, Tier 1 also requires a named property-test count, malformed-boundary behavior,
fault-injection scenario, observable event, and future alert/runbook reference. Prose alone is not exit
evidence.

### Release-gate status

| Gate                                                          | Current status          | Reason                                                                                                                                |
| ------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| G1. Required fixture classes detect and repair                | Failing / unavailable   | One ephemeral smoke fixture is generated; no fixture is detected or repaired, and the required adversarial corpus is absent.          |
| G2. Zero seeded-token residuals across all attacks            | Unavailable             | There is no sanitizer or independent verifier.                                                                                        |
| G3. Unsupported and malformed inputs never show green         | Foundation-only refusal | There is no PDF input or green document state, so product behavior has not been tested.                                               |
| G4. No-network/document privacy                               | Foundation-only pass    | Static source/bundle and browser loopback checks pass; no document path exists to exercise success, error, cancellation, or recovery. |
| G5. Large-file memory/cancel/recovery budgets                 | Unavailable             | No PDF processing or declared document resource budget exists.                                                                        |
| G6. Versioned threat model, support matrix, and report schema | Partial                 | Tier 0 threat model and support matrix exist; the document threat model and verification-report schema do not.                        |

### Documentation drift found by this audit

- `SUPPORT_MATRIX.md` and several append-only validation entries in `ASSUMPTIONS.md` still describe
  committed CI evidence as pending, although CI run 31402757094 succeeded for `cf6a723`.
- ADR-0001 explicitly names a separate clean-checkout capture as validation, but
  `evidence/tier0-clean-verify.log` is absent. Do not replace that missing artifact with the mutable
  working-tree `evidence/tier0-verify.log`.
- `HACKATHON.md` and `WINNING_IDEA.md` contain historical snapshot language saying no code or
  implementation existed when those dossiers were written. They remain authorities for external
  facts and selected design, not the current implementation-status source; this journal and the
  support matrix must carry current status without silently rewriting historical evidence.
- The current README accurately refuses PDF capability, but its "Tier 0" wording should be
  reconciled only after the evidence closure above, not optimistically advanced.

### Next work, in required order

1. **Close Tier 0 evidence and documentation drift on the current clean `main`.** Keep
   `dev:health` green; run `npm run evidence:clean-verify` from a clean checkout; inspect the exact
   generated file and commit metadata; record the new successful CI run URL; append superseding
   validation entries to `ASSUMPTIONS.md`; and update `SUPPORT_MATRIX.md` without deleting historical
   journal entries. If the clean gate fails, fix its first failure before any Tier 1 work.
2. **Design the Tier 1 document-safety contract before adding an upload control.** Update the threat
   model and add an ADR if the slice introduces the first document input, worker protocol, parser
   dependency, persistent data, or major algorithm. Define ownership, provenance, size/time/memory
   limits, cancellation, stable error codes, redacted observability, and rollback.
3. **Machine-encode I1 through I7 together.** Use domain types/tagged unions and runtime schemas so
   invalid transitions are unrepresentable. Add seeded property tests, malformed-input tests, and
   fault/refusal tests with named case counts. Do not treat the current static no-network scan as the
   final I1 control.
4. **Run the five-fixture kill-test slice only after the invariant boundary is real.** Promote fixtures
   from an ignored lifecycle smoke PDF into a committed, versioned adversarial manifest covering
   rectangle-over-text, unapplied redaction annotation, OCR layer, incremental history, and
   attachment leakage. The first correctness oracle must prove findings, not merely valid PDF bytes.
5. **Do not build visual workflow polish before the technical core.** The next interface control must
   belong to a complete inspect/refuse/observe slice, not a dead upload, canned finding, fake progress
   indicator, or safety badge.

### Acceptance checks for the next handoff

- The exact `main` commit has a durable clean verification artifact and successful CI URL.
- Status documents no longer claim that already-obtained CI evidence is pending.
- Each of I1 through I7 points to a concrete type/schema/boundary assertion and a named seeded
  property test; unknown states cannot construct a green verdict.
- The document boundary has explicit byte, page, time, memory, and concurrency limits plus
  cancellation and safe error codes before browser file input is enabled.
- Any new fixture evidence is committed, deterministic, synthetic, provenance-aware, and paired with
  expected findings; a generated valid PDF alone is not detection evidence.
- No PDF byte leaves loopback/device boundaries in success, refusal, failure, or cancellation tests.
- The handoff names commands, evidence, risks, rollback, blockers, and the next `GOAL.md` section 10
  item without claiming production.

### This documentation slice

- **Repository changes:** This append-only `PROGRESS.md` entry only; no runtime, dependency,
  persistent-data, port, or architecture change.
- **Commands used for the audit:** Authority-document reads; tracked-file, source, test, dependency,
  evidence, branch, and history inspection; `git fetch origin main`; `gh run list`; and
  `npm run dev:preflight && npm run dev:up && npm run dev:health`.
- **Risk:** This is a point-in-time map. Executable evidence and the support matrix remain the
  authority for capability claims after future commits.
- **Rollback:** Revert this documentation commit only. No application state or user data exists.
- **Next item selected by `GOAL.md` section 10.1:** Close the missing clean-evidence and stale-status
  documentation gap, then begin Tier 1 invariant encoding. No unrelated feature work outranks it.
