# Support Matrix

- **Schema version:** 1
- **Matrix revision:** 0.1.0-foundation
- **Observed date:** 2026-08-10
- **Repository state:** Tier 0 foundation; not yet in production

Every supported entry is a claim that requires executable evidence. “Not implemented” and “not verified” do not mean partial support.

## Current executable surface

| Surface                      | Status                             | Exact boundary                                                                                                              | Behavior outside boundary                                                                  | Evidence state                                                                                                                                             |
| ---------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundation status page       | Implemented; working-tree verified | Static React page that states the release boundary and exposes no document controls                                         | No PDF is accepted and no safety verdict is produced                                       | Node.js 24 working-tree evidence passed 4/4 foundation E2E and 2/2 tagged accessibility checks; clean-checkout evidence pending                            |
| Local service lifecycle      | Implemented; working-tree verified | Four loopback services on `127.0.0.1:4210`–`4213`; typed liveness and semantic readiness routes                             | A foreign listener, wrong identity, stale build, or failed semantic probe must fail closed | [`evidence/dev-health.json`](./evidence/dev-health.json) plus 7/7 real-boundary integration checks passed; clean-checkout evidence pending                 |
| Repository verification      | Implemented; working-tree verified | Exact pinned toolchain; format, lint, type, boundaries, tests, browser checks, build, and audits block `npm run verify-all` | Any required failure or warning makes the command non-zero                                 | [`evidence/tier0-verify.log`](./evidence/tier0-verify.log) records a Node.js 24 working-tree pass; committed clean-checkout and CI evidence remain pending |
| PDF inspection               | Not implemented                    | None                                                                                                                        | There is no file-input or parser path                                                      | The working-tree refusal E2E and [`evidence/foundation-evaluation.json`](./evidence/foundation-evaluation.json) prove absence; clean evidence pending      |
| PDF repair                   | Not implemented                    | None                                                                                                                        | No output PDF is generated                                                                 | No positive claim                                                                                                                                          |
| Independent PDF verification | Not implemented                    | None                                                                                                                        | No green or “safe” document result is available                                            | No positive claim                                                                                                                                          |
| Verification report export   | Not implemented                    | None                                                                                                                        | No report is generated or signed                                                           | No positive claim                                                                                                                                          |

## Development platform matrix

| Dimension                | Current evidence                                                                                                      | Not verified / unsupported                                                                       | Notes                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Node.js                  | `24.19.0` LTS passed bootstrap and the complete working-tree gate; Node.js 26.5.1 passed the compatibility gate       | Node.js 24 clean-checkout authority is pending; Node.js 25 and other major lines are unsupported | Bootstrap must fail on any undeclared version                                |
| npm                      | `11.17.0` is pinned and working-tree verified                                                                         | Committed clean-checkout evidence is pending; all other versions are unsupported                 | Lockfile v3 and `npm ci` are required                                        |
| Host OS                  | macOS 27 arm64 passed the working-tree foundation gate                                                                | No host OS is supported until committed clean evidence; Linux and Windows remain unverified      | POSIX process and port ownership behavior needs separate evidence per OS     |
| Browser                  | Chromium passed 4/4 working-tree foundation E2E and 2/2 tagged accessibility checks; no browser is supported yet      | Chromium support awaits committed clean evidence; Firefox, WebKit, and mobile remain unverified  | Browser support is scoped to the implemented foundation surface              |
| Network binding          | The working-tree lifecycle proves loopback IPv4 on ports `4210`–`4213` and verifies reserved ports `4214`–`4219` free | LAN/public bind, framework defaults, dynamically selected ports                                  | Committed clean evidence is still required; reserved ports are not allocated |
| Runtime document network | No document network path exists in this foundation                                                                    | Offline PDF processing is not yet implemented or verified                                        | “No path exists” is not evidence that future processing is offline-safe      |

## Planned PDF matrix — no current support

These rows describe the intended order of evidence, not shipped capability.

| Input or behavior                                                           | Current status                               | Required future behavior                                                                      |
| --------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Born-digital PDF                                                            | Not implemented                              | Parse structure and paint order, present masked findings, and refuse unknown states           |
| Image-only PDF                                                              | Not implemented                              | High-assurance local raster path plus independent OCR verification                            |
| PDF with OCR text layer                                                     | Not implemented                              | Inventory both pixels and text layer; never trust one surface alone                           |
| Incrementally saved PDF                                                     | Not implemented                              | Walk revision history and rebuild into fresh bytes                                            |
| Encrypted PDF                                                               | Unsupported                                  | Refuse with a typed, non-green result unless an explicitly supported encryption path is added |
| Malformed xref, unknown filter, or ambiguous structure                      | Unsupported                                  | Return NOT VERIFIED; never qualify or soften a green result                                   |
| PDF attachment, annotation, form, metadata, optional content, or JavaScript | Not implemented                              | Inventory, allowlist rebuild, and independent absence checks                                  |
| DOCX, PPTX, images as standalone inputs, archives                           | Unsupported                                  | Refuse; no format expansion before PDF release gates pass                                     |
| Legal certification or universal safety guarantee                           | Permanently outside current product contract | Never claim; report only named attacks and their outcomes                                     |
| Cloud upload, storage, accounts, or team workspace                          | Outside approved scope                       | Requires explicit approval, threat analysis, and a new ADR                                    |

## Truthful status semantics

- **Supported:** a committed test exercises the complete stated outcome on the named platform.
- **Not verified:** code or configuration may exist, but the required evidence is missing or stale.
- **Not implemented:** no runtime path exists.
- **Unsupported:** the system must refuse rather than fall back, guess, or show green.
- **Not yet in production:** every clause of `GOAL.md` section 5 has not been simultaneously and independently verified.

No row in this matrix is a legal, compliance, or universal safety guarantee.
