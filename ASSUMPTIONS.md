# Assumptions Register

This register records decisions made without user input. Entries are append-only; when evidence invalidates an assumption, add a superseding entry rather than rewriting history.

## A-0001 — LTS toolchain is release authority

- **Recorded:** 2026-08-09
- **Assumption:** Node.js 24.19.0 LTS and npm 11.17.0 are the authoritative production and CI pins; Node.js `>=26.0.0 <27` is an explicitly supported compatibility runtime and Node.js 25 is unsupported.
- **Reasoning:** The LTS line minimizes production runtime churn. Node.js 25 is a non-LTS line outside the deliberately declared and tested engine policy, so a continuous `>=24 <27` range would make an unverified compatibility claim.
- **Cheapest verification:** Run the clean-checkout gate under 24.19.0 and separately under a declared Node.js 26 release; confirm bootstrap rejects Node.js 25 and every npm version except 11.17.0.
- **Status:** Open until CI evidence exists.

## A-0002 — Chromium is the initial browser test surface

- **Recorded:** 2026-08-09
- **Assumption:** Chromium is sufficient for the Tier 0 executable-contract slice; Firefox and WebKit remain unverified rather than implicitly supported.
- **Reasoning:** One real browser is enough to validate the foundation lifecycle without creating an unsupported cross-browser claim before any PDF feature exists.
- **Cheapest verification:** Complete the Chromium foundation E2E checks, then run the same committed suite in Firefox and WebKit before adding either to `SUPPORT_MATRIX.md`.
- **Status:** Open.

## A-0003 — All four allocated services start together

- **Recorded:** 2026-08-09
- **Assumption:** `dev:up` owns and starts ports 4210 through 4213 together, even though the adversarial fixture service exposes only a minimal synthetic fixture during Tier 0.
- **Reasoning:** `GOAL.md` section 0A requires every allocated service to participate in lifecycle readiness before downstream browser and fixture work depends on it.
- **Cheapest verification:** Run `npm run dev:up && npm run dev:health`, inspect each typed readiness response, and confirm `npm run dev:down` removes only recorded listeners.
- **Status:** Open until lifecycle evidence exists.

## A-0004 — Unsupported document behavior is absence, not simulation

- **Recorded:** 2026-08-09
- **Assumption:** Before Tier 1 and later PDF slices exist, the safest honest behavior is to expose no PDF input or processing path at all.
- **Reasoning:** A placeholder upload, mock result, or canned “safe” output would violate the prohibition on demo paths and could imply document safety.
- **Cheapest verification:** Browser-test the rendered foundation surface for the explicit limitation and the absence of file inputs, upload requests, report downloads, and green document verdicts.
- **Status:** Open until the browser refusal test exists.

## A-0005 — Dependency health is a point-in-time claim

- **Recorded:** 2026-08-09
- **Assumption:** Registry activity and exact-version advisory queries dated 2026-08-09 are adequate for the initial dependency register, provided automated lockfile audits remain blocking and no entry is described as permanently safe.
- **Reasoning:** Maintenance and advisory state can change after documentation is written. Pinning the observation date prevents a stale snapshot from becoming an evergreen claim.
- **Cheapest verification:** Regenerate package metadata and exact-version advisory queries during every dependency upgrade and supply-chain epoch, then update `docs/dependencies.md` with a new dated entry.
- **Status:** Accepted as documentation policy; must be revalidated continuously.

## A-0002 validation update — working-tree Chromium evidence exists

- **Recorded:** 2026-08-09
- **Evidence:** `npm run test:e2e` passed all four foundation checks and `npm run test:accessibility` passed both tagged checks in the working tree.
- **Remaining uncertainty:** A committed clean checkout and CI have not reproduced the result, so Chromium remains not supported in `SUPPORT_MATRIX.md`.
- **Status:** Open pending committed clean-checkout evidence.

## A-0003 validation update — lifecycle evidence exists

- **Recorded:** 2026-08-09
- **Evidence:** Idempotent preflight/up/health behavior, authenticated targeted shutdown code, lifecycle contract tests, and `evidence/dev-health.json` now exist. All allocated services are ready and reserved ports are free in the working tree.
- **Remaining uncertainty:** The complete down/restart sequence and authoritative Node.js 24.19.0 clean checkout still require durable evidence.
- **Status:** Open pending clean-checkout and CI reproduction.

## A-0004 validation update — refusal behavior exists

- **Recorded:** 2026-08-09
- **Evidence:** The Chromium refusal E2E proves the explicit limitation, zero document controls, and loopback-only requests; `evidence/foundation-evaluation.json` independently evaluates the serialized fail-closed boundary.
- **Remaining uncertainty:** The evidence is from the working tree rather than a committed clean checkout.
- **Status:** Open pending clean-checkout reproduction.

## A-0006 — Foreign use anywhere in the reserved block fails closed

- **Recorded:** 2026-08-09
- **Assumption:** The preflight-wide foreign-listener refusal in `GOAL.md` section 0A.4 takes precedence over automatic in-block remapping in section 0A.2 item 5 while the foreign holder remains.
- **Reasoning:** A listener cannot both remain anywhere inside 4210–4219 and satisfy the literal requirement that preflight fail when any port in that block is foreign-held. Refusing without signalling or remapping is the stronger isolation guarantee and cannot disrupt a sibling process.
- **Cheapest verification:** The foreign-listener integration test must show `dev:down` returns non-zero, leaves the test-owned foreign PID alive, and restores all repository services only after that exact PID exits.
- **Status:** Accepted in ADR-0001; revisit only through a coherent port-contract change.

## A-0007 — Bounded deadlines include shared-host contention

- **Recorded:** 2026-08-10
- **Assumption:** Repository command, lifecycle, and integration-harness deadlines must remain finite while allowing the documented sixteen concurrent repositories enough scheduling margin to distinguish a slow correct result from a hang.
- **Reasoning:** Under real parallel load, otherwise-correct Node child startup, loopback HTTP, typecheck, and toolchain probes exceeded earlier 2–30 second harness bounds. Those false timeouts hid the actual assertion under test without improving cancellation safety. The revised bounds remain explicit and are paired with TERM/KILL escalation rather than becoming unbounded waits.
- **Cheapest verification:** Run the bounded-child unit suite repeatedly, the lifecycle integration suite, and `npm run verify-all` while the sibling workload is active; each must complete without relaxing any semantic assertion or leaving an owned child.
- **Status:** Open pending clean-checkout and CI reproduction.

## A-0008 — Explicit artifact budgets replace Rolldown's timing ratio heuristic

- **Recorded:** 2026-08-10
- **Assumption:** Rolldown's `pluginTimings` warning is not an appropriate blocking performance metric for this small foundation build; deterministic emitted-byte budgets are the Tier 0 build-performance authority.
- **Reasoning:** The heuristic warned when an expected Vite CSS hook consumed 1.4 seconds, solely because that was 42 percent of a 3.3-second build under shared-host contention. The result was within all explicit artifact budgets and the warning did not identify an incorrect or unsafe artifact. Disabling this one documented heuristic avoids load-dependent false failures; the repository still rejects every warning that tools emit.
- **Cheapest verification:** Run `npm run build && node scripts/check-build.mjs`, confirm the exact JavaScript/CSS/total budgets pass, and confirm an intentionally emitted warning still makes `verify-all` non-zero.
- **Status:** Accepted for Tier 0; revisit if build-duration SLOs replace the current artifact budget.

## A-0001 validation update — authoritative working-tree runtime is green

- **Recorded:** 2026-08-10
- **Evidence:** `npm run bootstrap` and `npm run evidence:verify-all` passed under Node.js 24.19.0 and npm 11.17.0. Bootstrap installed the exact lock graph and the full gate emitted `evidence/tier0-verify.log` with the authoritative runtime recorded.
- **Remaining uncertainty:** The same result has not yet been reproduced from a committed clean checkout or GitHub Actions.
- **Status:** Open pending clean-checkout and CI evidence.

## A-0003 validation update — shutdown, refusal, and restart are exercised

- **Recorded:** 2026-08-10
- **Evidence:** The 7/7 lifecycle integration suite invokes down, proves exact preflight and down refusal while a foreign listener stays alive, then restarts all four owned services and verifies health. The complete working-tree gate independently runs down, preflight, up, typed health, and evidence capture.
- **Remaining uncertainty:** Committed clean-checkout and CI reproduction remain required.
- **Status:** Open pending clean-checkout and CI evidence.

## A-0007 validation update — loaded working-tree gates pass

- **Recorded:** 2026-08-10
- **Evidence:** Three consecutive bounded-child suites passed 6/6, the lifecycle integration suite passed 7/7 in 148.74 seconds, and the complete warning-refusing working-tree gate passed while sibling repositories remained active.
- **Remaining uncertainty:** Linux CI scheduling and a committed clean checkout have not yet reproduced these bounded deadlines.
- **Status:** Open pending clean-checkout and CI evidence.

## A-0008 validation update — emitted artifacts satisfy explicit budgets

- **Recorded:** 2026-08-10
- **Evidence:** An authoritative Node.js 24 build with inherited `NODE_ENV=test` and an injected `VITE_*` canary emitted a production artifact without the canary or repository path. `check-build` measured 193,134 JavaScript bytes, 3,673 CSS bytes, and 197,451 total bytes against limits of 204,800, 51,200, and 307,200 respectively.
- **Remaining uncertainty:** Build-duration SLOs are not a Tier 0 support claim; later performance tiers must add them before production.
- **Status:** Accepted for the Tier 0 artifact boundary.

## Tier 0 closure — clean-checkout and CI evidence now exist

- **Recorded:** 2026-08-10
- **Supersedes the open status of:** A-0001, A-0002, A-0003, A-0004, A-0007 validation updates that recorded clean-checkout or CI reproduction as pending.
- **Evidence:** `npm run evidence:clean-verify` ran at commit `afd2da487262ecf1de26e35d952e0ed42fbd1524` with `git status --porcelain=v1 --untracked-files=all` empty both before and after, producing `evidence/tier0-clean-verify.log` (287 lines, macOS 27 arm64, Node.js 24.19.0, npm 11.17.0). GitHub Actions run [31403907792](https://github.com/rishabhcli/neuralsprint/actions/runs/31403907792) completed successfully for the same commit on `ubuntu-24.04`, running the identical `npm run verify-all` contract from a fresh checkout and asserting deterministic regeneration with an empty `git status`.
- **What is now supported:** Node.js 24.19.0 with npm 11.17.0, macOS 27 arm64 and ubuntu-24.04 x86_64 hosts, and Playwright-pinned Chromium, scoped strictly to the Tier 0 foundation surface. `SUPPORT_MATRIX.md` has been updated to state exactly this and nothing more.
- **Remaining uncertainty:** Firefox, WebKit, mobile browsers, and Windows remain unverified. Clean-checkout evidence is a per-commit claim; every later commit needs its own regeneration.
- **Status:** Closed for Tier 0. Reopened automatically by any commit whose clean gate or CI run is not green.

## A-0009 — Domain packages parse PDF bytes without an external parser dependency

- **Recorded:** 2026-08-10
- **Assumption:** `src/pdf/parser`, `src/pdf/interpreter`, `src/findings`, `src/sanitizer`, and `src/verifier` implement the xref, object-graph, filter, revision, and content-stream layers in dependency-free TypeScript rather than delegating to PDF.js.
- **Reasoning:** `scripts/check-boundaries.mjs` already refuses every external import inside a domain owner, and `AGENTS.md` requires a lower-level xref/object/revision parser in addition to PDF.js. Forensic claims about hidden content, incremental revisions, and emitted bytes require byte-exact control that a rendering-oriented library does not expose, and an independent verifier that shares a parser with the sanitizer would violate invariant I6. PDF.js remains available to the UI/adapter layer for rendering and as a cross-parser comparison oracle, where its objects never cross into the domain.
- **Cheapest verification:** `npm run boundaries` must keep failing on any external import inside a domain owner, and the cross-parser comparison suite must show the domain parser and an independent parser agreeing on fixture object graphs.
- **Status:** Accepted; revisit only through an ADR that also explains how I6 independence survives a shared parser.
