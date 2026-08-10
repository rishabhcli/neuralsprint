# Runbooks

One runbook per invariant alert declared in [`../invariants.md`](../invariants.md).

Every runbook answers the same four questions in the same order, so an operator paged at
03:00 does not have to learn a new layout per alert:

1. **What fired, and what it means.**
2. **Immediate containment** — what to do in the first five minutes.
3. **Diagnosis** — the exact commands to run.
4. **Exit criteria** — what must be true before the incident is closed, including the
   regression test that must exist.

**Current status:** no production deployment exists, so no alert has a destination yet
(`GOAL.md` section 5, clauses 5 and 9 are unmet). Each runbook names the event it will
consume. Wiring is a connection step, not a design step.

Severity vocabulary used below:

| Severity | Meaning                                                                     | Response                                      |
| -------- | --------------------------------------------------------------------------- | --------------------------------------------- |
| **S1**   | A user may have acted on a wrong safety result, or a secret may have left.  | Page immediately; consider emergency disable. |
| **S2**   | An invariant's enforcement path failed, but no wrong result reached a user. | Page during working hours.                    |
| **S3**   | Expected refusal telemetry, useful for trend analysis only.                 | No page.                                      |
