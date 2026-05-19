# SDD Governance

This directory holds **out-of-band governance artifacts** that block release
gates defined in SDD specs. They live in-repo so a future auditor can
reconstruct the chain — but the actual sign-off work happens with humans
(DPO-equivalent, legal, security) outside the implementation PR.

## Current artifacts

| File | Backs | Description |
|---|---|---|
| `OD-6-closure-template.md` | SPEC-014 §OD-6 | Template the DPO-equivalent fills out before each M365 MCP release event |

## How this works

Each spec that requires governance sign-off declares an **OD-N closure**
preconditioning some external action (typically: shipping to production,
expanding scope, onboarding a new sub-processor). The closure is not part
of the implementation PR — it is an authored markdown file produced by the
governance owner with their name, date, and a status field per precondition.

When an OD-N closure is required, this directory grows:

```
SDD/governance/
  OD-6-closure-template.md          # the structural template
  OD-6-closure-2026-MM-DD.md        # actual closure for a specific release event
  OD-6-closure-2027-MM-DD.md        # next release event
```

The closure filename includes the release event date so a release auditor
can reconcile each release tag against the governance file in effect at the
time. Templates are versioned in-place; closures are append-only.

## Naming

| Kind | Pattern |
|---|---|
| Template | `OD-<N>-closure-template.md` |
| Closure | `OD-<N>-closure-<YYYY-MM-DD>.md` |

## Out of scope here

- Storing actual signed legal documents (DPA amendments, contract addenda).
  Those live in the company-wide legal vault; the closure file references
  them by document ID + retrieval link.
- Storing PII or any production secrets.
- Replacing the DPO-equivalent's own records system.
