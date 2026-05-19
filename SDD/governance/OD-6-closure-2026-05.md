# OD-6 Closure — M365 MCP Release Event — 2026-05

Backs **SPEC-014 §OD-6 (DPO-equivalent closure)**. Satisfies the prod-deploy
gate `test -f SDD/governance/OD-6-closure-*.md` in Implementation Plan §6.

## Release event metadata

| Field | Value |
|---|---|
| Release event date | 2026-05-19 |
| Release tag / commit | feature/014 — planning d7dc62b14 + implementation 986ab2b47 |
| Closure author | Pablo Oliva, MemodoAI operator (DPO-equivalent function) |
| Closure date | 2026-05-19 |
| Spec version | SPEC-014 (M365 MCP Integration, phase 1 read-only) |
| Scope of this closure | Phase 1 read-only initial production rollout |

## Preconditions

All five preconditions are DEFERRED for this release event. MemodoAI is a
small-team deployment without a formal DPO function or pre-existing
DPA/sub-processor/retention/DSR/privacy-notice artifact set; all five
governance items are consolidated into a single follow-up workstream
targeted for closure before wider user rollout.

### 1. DPA amendment — Softeria-as-software-supplier classification

- **Status:** DEFERRED
- **Description:** Data Processing Agreement (or equivalent) amendment that
  classifies `@softeria/ms-365-mcp-server` as a *software supplier* (open-source
  npm package consumed in-process), not a *sub-processor* (no PII transit to
  Softeria infrastructure occurs).
- **Reference / Document ID:** _(not yet drafted)_
- **Owner if DEFERRED:** Pablo Oliva, MemodoAI operator
- **Re-close by:** 2026-08-17 (90 days)
- **Rationale (if DEFERRED):** Small-team deployment without formal DPO
  function; deferring to consolidate all five governance artifacts in a
  single follow-up workstream before wider user rollout. The
  Softeria-as-software-supplier classification is engineering-side accurate
  (npm package, no outbound PII to Softeria infrastructure) and accepted as
  residual risk for the 90-day window.

### 2. Sub-processor registry update

- **Status:** DEFERRED
- **Description:** Microsoft (as Graph API operator) is the sub-processor
  reached by the M365 MCP sidecar. The company-wide sub-processor registry
  is updated with: scope (delegated Graph access on behalf of signed-in
  users), data classes (mail headers/bodies, calendar events, file content,
  contacts, tasks, notes), regional processing footprint (Memodo Entra
  tenant region — EU), and the Microsoft DPA reference.
- **Reference / Document ID:** _(not yet drafted)_
- **Owner if DEFERRED:** Pablo Oliva, MemodoAI operator
- **Re-close by:** 2026-08-17 (90 days)
- **Rationale (if DEFERRED):** Microsoft is already implicitly a
  sub-processor for the existing OIDC sign-in flow (the same Entra app
  registration consumed for SPEC-014 OBO exchange). SPEC-014 expands the
  data-class footprint via the new delegated Graph scopes; the registry
  update is the documentation pass that catches up with the existing
  technical reality. Deferred to the 90-day workstream.

### 3. Retention policy ratification

- **Status:** DEFERRED
- **Description:** Retention policy explicitly addresses M365-sourced data
  that appears in conversation logs and Mongo `messages` collection.
  Confirms inheritance of the standard LibreChat retention window OR
  introduces a tighter window for this data class.
- **Reference / Document ID:** _(not yet drafted)_
- **Owner if DEFERRED:** Pablo Oliva, MemodoAI operator
- **Re-close by:** 2026-08-17 (90 days)
- **Rationale (if DEFERRED):** SPEC-014 REQ-029 commits to conversation-
  inherited retention (12-month default per the spec; M365-sourced data
  cascades through the standard LibreChat erasure path). Engineering
  posture matches the deferred policy doc; formal ratification is the
  follow-up.

### 4. DSR runbook authoring

- **Status:** DEFERRED
- **Description:** Data Subject Rights runbook covers the M365 MCP path:
  - Access requests — extract a user's M365-sourced conversation content from logs.
  - Erasure requests — what to delete in LibreChat vs. redirect to Microsoft 365 native deletion (since LibreChat doesn't own the source data).
  - Rectification — LibreChat-side rectification is not meaningful for M365-sourced data; user must edit at the source.
- **Reference / Document ID:** _(not yet drafted)_
- **Owner if DEFERRED:** Pablo Oliva, MemodoAI operator
- **Re-close by:** 2026-08-17 (90 days)
- **Rationale (if DEFERRED):** SPEC-014 REQ-030 commits to DSR cascade via
  the existing LibreChat conversation-erasure mechanism (M365 tool output
  lives only in `messages`; standard erasure removes it). Engineering
  posture supports the DSR flows; the runbook is the documentation/training
  layer to be authored before user-facing DSR processes are exercised.

### 5. Privacy notice rewrite — Art. 13/14 transparency

- **Status:** DEFERRED
- **Description:** Privacy notice (employee-facing + customer-facing as
  applicable) addresses the M365 data classes now reachable via LibreChat:
  - Mail headers + bodies, calendar events, OneDrive file contents, SharePoint files, contacts, OneNote pages, Planner/To Do items, Graph search results.
  - GDPR Art. 13/14 transparency requirements before any production user can invoke the integration.
- **Reference / Document ID:** _(not yet drafted)_
- **Owner if DEFERRED:** Pablo Oliva, MemodoAI operator
- **Re-close by:** 2026-08-17 (90 days)
- **Rationale (if DEFERRED):** Phase-1 production users are MemodoAI
  internal accounts (the operator + close collaborators) with informed
  consent to the integration scope obtained out-of-band. Wider user
  rollout is gated on the privacy-notice rewrite. Acceptance of residual
  risk applies only to the named internal users until the notice lands.

## Closure sign-off

By signing below, the named DPO-equivalent affirms that all preconditions
are either CLOSED with a referenced artifact, or DEFERRED with a documented
rationale, a named owner, and a re-close deadline.

- **Signed:** Pablo Oliva, MemodoAI operator (DPO-equivalent function)
- **Date:** 2026-05-19
- **Next review:** 2026-08-17 (90 days; all five preconditions deferred)

## Scope-limitation note

This closure authorizes phase-1 production rollout to a small named set of
MemodoAI internal users. Wider rollout (third-party access, customer-facing
exposure, or additional Entra tenants) is OUT OF SCOPE of this closure and
requires a fresh OD-6 closure record after the 5 preconditions land as
CLOSED.
