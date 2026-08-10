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
