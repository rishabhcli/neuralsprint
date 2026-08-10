# ADR-0001: Toolchain and local-service contract

- **Status:** Accepted
- **Date:** 2026-08-09
- **Decision owners:** repository maintainers
- **Scope:** Tier 0 repository foundation only

## Context

The repository must establish an executable, reproducible contract before any PDF parser, sanitizer, or verifier is added. The target application is a static, local-first browser application. Its eventual safety claims depend on strict types, deterministic tests, independent browser checks, pinned dependencies, and a development lifecycle that cannot collide with the other repositories running on the same machine.

The current foundation does **not** inspect, repair, or verify PDFs. It must say so visibly and must not use a running status page or a healthy development server as evidence that document processing exists. The repository is not yet in production under `GOAL.md` section 5.

The loopback HTTP routes, fixture filesystem surface, PID-based shutdown authority, browser runner, and dependency execution graph are external-input or side-effect boundaries. Their Tier 0 threats and residual risks are reviewed in `docs/threat-model-tier0.md`.

## Decision

### Runtime and package management

1. Use Node.js `24.19.0` LTS and npm `11.17.0` as the authoritative development and CI toolchain. Pin both in repository metadata and install dependencies with `npm ci` from lockfile version 3.
2. Treat Node.js `>=26.0.0 <27` as an explicitly supported compatibility runtime, not as release authority. Do not admit Node.js 25: it is a non-LTS line outside the deliberately declared and tested engine policy, so the range is discontinuous rather than an unverified `>=24 <27` claim.
3. Save every direct dependency at an exact version. The lockfile pins transitive dependencies. npm must reject engine, peer-dependency, and unreviewed install-script mismatches rather than resolving or executing them permissively. The current name-level `fsevents: false` policy denies the unnecessary native rebuild lifecycle for both locked optional versions.
4. Keep runtime dependencies limited to code that must ship in the browser. Tooling, browser automation, accessibility checks, and property-test libraries remain development-only.

### Application and type system

1. Use React 19 with Vite 8 for the static browser surface. This is a delivery shell, not permission to move domain rules into UI components.
2. Use TypeScript 6.0.3, the newest selected version inside the supported `typescript-eslint` range at this decision date.
3. Enable strict compiler checks from the foundation: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, unused-code checks, case consistency, isolated modules, and verbatim module syntax.
4. Use TypeScript project references for browser code, Node-based configuration, control-plane scripts, and tests. Every `scripts/**/*.mjs` implementation is compiled through an `allowJs` plus `checkJs` composite project; generated declarations and incremental state exist only beneath `.dev/cache/typescript/`. A declaration sidecar may not shadow an implementation. Boundary validation is a blocking build step, not a review convention.

### Verification stack

1. Use Vitest with V8 coverage for deterministic unit, property, integration, security, and performance suites.
2. Use `fast-check` for seeded property tests and record case counts when invariants are added.
3. Use Playwright for browser end-to-end checks and `@axe-core/playwright` for automated accessibility checks. Chromium is the initial executable browser surface; adding another browser requires support-matrix evidence.
4. Use ESLint with a zero-warning budget, Prettier in check mode, and a repository-owned deterministic boundary checker built on the exact-pinned TypeScript parser. The checker deny-by-defaults every external or unowned import from domain packages and runs policy self-tests even before those ownership directories contain production code.
5. `npm run verify-all` is the single repository gate. It must run non-interactively, aggregate blocking checks, and return non-zero when any required check fails. A clean checkout is the release-evidence authority; a working-tree pass is diagnostic only.
6. Route long-running child commands through the repository bounded-process runner. It ignores child stdin, applies per-command deadlines and aggregate output ceilings, forwards parent interruption, terminates the owned process group with bounded escalation, and preserves a stable coded failure plus captured diagnostics.
7. Disable Rolldown's percentage-based `pluginTimings` heuristic. On a tiny build it can emit a warning solely because an expected Vite CSS hook is a large fraction of a short wall time, especially under host contention. This is not a general warning waiver: all emitted warning lines remain terminal, and the deterministic `check-build` command enforces explicit JavaScript, CSS, and total-byte budgets over the emitted artifact.

### Local-service lifecycle

All services bind to `127.0.0.1` and only to the repository-owned block `4210`–`4219`:

|          Port | Service                              |
| ------------: | ------------------------------------ |
|        `4210` | Vite application development server  |
|        `4211` | built-asset preview server           |
|        `4212` | Playwright test-harness server       |
|        `4213` | generated adversarial-fixture server |
| `4214`–`4219` | reserved; unallocated                |

Each allocated service exposes `GET /__neuralsprint/live` and `GET /__neuralsprint/ready`. Readiness must validate the service identity and a semantic capability, not merely accept a TCP connection. The lifecycle contract is:

- `npm run dev:preflight` inspects all repository-owned ports, rejects foreign listeners, and prepares only git-ignored `.dev/` state;
- `npm run dev:up` starts the allocated services idempotently and records tokenized ownership metadata beneath `.dev/pids/`;
- `npm run dev:health` verifies typed identity plus semantic readiness for every allocated service;
- `npm run dev:down` validates PID, command, ownership token, and listener before signalling only a process started by this repository.

Playwright uses port `4212` explicitly and does not reuse an unverified server. Runtime state, logs, profiles, caches, and temporary files remain beneath `.dev/`. Broad process termination and dynamic framework-default ports are prohibited. Startup and health polling remain bounded, but their outer deadlines allow for the documented sixteen-repository host contention; semantic failures are never converted into success merely because a larger deadline is available.

#### Resolution of the foreign-port clauses

`GOAL.md` section 0A.2 item 5 says an allocated service may move to a reserved in-block port after a foreign holder is identified, while section 0A.4 requires preflight to fail when **any** port in the block has a foreign holder. Moving within the block cannot satisfy both clauses while that holder remains. The lifecycle therefore applies the stronger fail-closed reading of section 0A.4: it inventories every port, names foreign holders, never kills or automatically remaps them, and refuses startup while any foreign listener remains. A future reassignment requires a coherent change to `ports.env`, the typed service map, tests, support matrix, this ADR, and assumptions after the block is clear. This deliberately favors isolation and diagnostic truth over availability.

### Dependency and evidence policy

`docs/dependencies.md` is the direct-dependency register. It records licence, maintenance state, known security history, native or binary implications, and cost for every direct package. `npm run dependencies:check` rejects package/version/licence drift, verifies exact lockfile entries, and regenerates `evidence/dependency-register.json`. The lockfile plus automated audits are the authority for the resolved transitive graph. Package-registry size is not represented as application bundle size; a bundle claim requires a committed measurement command over `dist/`.

`PROGRESS.md` is append-only. Failed commands remain in the journal after they are fixed. `evidence/` may contain only regenerable artifacts that name their producing command and seed where applicable. Release metadata owns a fresh production build, a production-dependency-only CycloneDX SBOM, and a content-hashed manifest so platform-specific development binaries cannot masquerade as shipped runtime components.

## Alternatives considered

### pnpm, Yarn, or Bun

Rejected for the foundation. They add another runtime or package-manager contract without improving the local static application. npm is bundled with the selected Node release and supports immutable clean installs through `npm ci`. This can be revisited only with migration evidence and a regenerated lockfile.

### Node.js Current as the sole authority

Rejected. The pinned LTS line is the production baseline. The declared Node.js 26 range remains useful as a non-authoritative compatibility runtime.

### JavaScript without strict project references

Rejected. The product's fail-closed state machine and package ownership rules require compile-time pressure from the first executable slice. This applies to the `.mjs` lifecycle/evidence control plane as well as application TypeScript. Retrofitting strictness after PDF logic exists would hide invalid states and boundary violations.

### Next.js, a server application, Electron, or cloud processing

Rejected for Tier 0. They add server, packaging, credential, and data-egress surfaces that are unnecessary for the approved static/offline-capable direction. No document byte should leave the device by default.

### Framework-default or dynamically selected ports

Rejected. Parallel repositories share the host. Defaults and “next free port” behavior can silently target or disrupt another process and make browser evidence non-reproducible.

### TCP-only health checks

Rejected. A listener can be alive while serving the wrong repository, stale assets, or no usable application. Readiness must prove identity and the capability expected from that service.

## Consequences

### Positive

- Clean-checkout commands have one explicit runtime and one immutable dependency graph.
- Type, lint, architecture, test, build, audit, and browser failures can block the same gate.
- Four local services can coexist with sibling repositories without shared ports or runtime state.
- The foundation exposes its limitations rather than implying PDF safety.

### Costs and risks

- Playwright installs large browser binaries for test use.
- Vite 8 brings platform-specific native tooling transitively, so the lockfile contains optional artifacts for multiple platforms.
- Exact pins require deliberate dependency upgrades and recurring security review.
- A strict clean-checkout gate is slower than a compilation-only check.
- The initial browser support claim is intentionally narrow until additional engines have evidence.

## Reversal and migration

This decision is reversible through a superseding ADR. A change must update the runtime pins, engine policy, lockfile, CI matrix, dependency register, lifecycle scripts, support matrix, and clean-checkout evidence together. Port assignments may move only within `4210`–`4219`, after the holder is identified and the change is recorded in `ports.env` and `ASSUMPTIONS.md`. Rollback is the coherent revert of the superseding toolchain commit; mixing old scripts with a new lockfile is unsupported.

## Validation

The decision is considered implemented only when the lifecycle shutdown/restart sequence, clean-checkout capture, and CI all produce committed or externally durable evidence:

```sh
npm run dev:preflight
npm run dev:up
npm run dev:health
npm run dev:down
npm run dev:up
npm run dev:health
npm run evidence:verify-all
npm run evidence:clean-verify
```

`evidence:verify-all` is working-tree diagnostic evidence. `evidence:clean-verify` must name the exact clean commit, and the same commit must pass `.github/workflows/ci.yml` with its CI run URL or retained log recorded. A successful run validates the Tier 0 foundation only. It is not evidence of PDF parsing, sanitization, independent verification, later release-gate completion, or production.
