# I1 — Egress attempted or refused

- **Invariant:** no document byte leaves the device by default
- **Events:** `pdf.egress.attempted` (**S1**, must be zero), `pdf.external_reference.refused` (**S3**, expected)
- **Encoding this alert protects:** `src/pdf/parser/device-local-bytes.ts`, `src/pdf/parser/external-reference.ts`

## What fired, and what it means

`pdf.external_reference.refused` is normal. Documents legitimately contain `/URI`
actions, remote go-to actions and external file specifications; the tool refuses them
and records that it did. A rising rate is interesting, not alarming.

`pdf.egress.attempted` means something in the process actually reached for a network
primitive while a document was loaded. That is a **structural** failure: the domain has
no network primitive, `resolveExternalTarget` returns `never`, and
`tests/security/runtime-network-surface.test.ts` refuses one statically. A non-zero
count means code outside the audited surface — a dependency, an injected script, a
browser extension — initiated it.

## Immediate containment

1. Exercise the emergency-disable path so no further document is accepted.
2. Preserve the correlation id, the build's release manifest digest, and the SBOM for
   the exact artifact that emitted the event. Do **not** collect the document.
3. Treat every document processed by that build as potentially exposed and notify per
   the incident policy. Length and origin metadata are the only document facts that may
   appear in the incident record.

## Diagnosis

```sh
npm run test:security                     # static network-surface refusal over src/
npm run boundaries                        # external imports inside a domain owner
node scripts/check-build.mjs              # emitted-artifact budgets and contents
npm run release:metadata                  # regenerate the SBOM and release manifest
```

Compare the SBOM of the deployed artifact with the SBOM of the tagged commit. A
difference is the most likely cause.

## Exit criteria

- The initiating code path is identified by file and line.
- A test that reproduces the attempt exists and fails before the fix.
- `pdf.egress.attempted` is zero across a full soak window after the fix.
- `SUPPORT_MATRIX.md` records the affected build range if any user could have been hit.
