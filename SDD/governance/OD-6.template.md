# OD-6 Closure — M365 MCP Release Event — TEMPLATE

> **THIS IS A TEMPLATE.** It is not itself a closure record. Copy this file
> to `OD-6-closure-<YYYY-MM-DD>.md` for the upcoming release event, populate
> every field, and obtain DPO-equivalent sign-off before the release tag is
> cut.

Backs **SPEC-014 §OD-6 (DPO-equivalent closure)**.

## Release event metadata

| Field | Value |
|---|---|
| Release event date | `<YYYY-MM-DD>` |
| Release tag / commit | `<tag-or-sha>` |
| Closure author | `<Name, Role>` (DPO-equivalent or delegate) |
| Closure date | `<YYYY-MM-DD>` |
| Spec version | SPEC-014 (M365 MCP Integration) |
| Scope of this closure | Phase 1 read-only / Phase 2 / scope expansion / sub-processor change |

## Preconditions

Each precondition must be **CLOSED** or **DEFERRED with rationale**. A
DEFERRED precondition requires an explicit deferral end-date and the named
owner accountable for re-closing.

### 1. DPA amendment — Softeria-as-software-supplier classification

- **Status:** CLOSED | DEFERRED
- **Description:** Data Processing Agreement (or equivalent) amendment that
  classifies `@softeria/ms-365-mcp-server` as a *software supplier* (open-source
  package consumed in-process), not a *sub-processor* (no PII transit to
  Softeria infrastructure occurs).
- **Reference / Document ID:** `<vault link or doc id>`
- **Signed by:** `<Name, Role>` on `<YYYY-MM-DD>`
- **Owner if DEFERRED:** `<Name>` — re-close by `<YYYY-MM-DD>`
- **Rationale (if DEFERRED):** `<text>`

### 2. Sub-processor registry update

- **Status:** CLOSED | DEFERRED
- **Description:** Microsoft (as Graph API operator) is the new
  sub-processor reached by the M365 MCP sidecar. The company-wide
  sub-processor registry is updated with: scope, data classes, regional
  processing footprint, and the Microsoft DPA reference.
- **Reference / Document ID:** `<vault link or doc id>`
- **Signed by:** `<Name, Role>` on `<YYYY-MM-DD>`
- **Owner if DEFERRED:** `<Name>` — re-close by `<YYYY-MM-DD>`
- **Rationale (if DEFERRED):** `<text>`

### 3. Retention policy ratification

- **Status:** CLOSED | DEFERRED
- **Description:** Retention policy explicitly addresses M365-sourced data
  that appears in conversation logs and Mongo `messages` collection.
  Confirms inheritance of the standard LibreChat retention window OR
  introduces a tighter window for this data class.
- **Reference / Document ID:** `<vault link or doc id>`
- **Signed by:** `<Name, Role>` on `<YYYY-MM-DD>`
- **Owner if DEFERRED:** `<Name>` — re-close by `<YYYY-MM-DD>`
- **Rationale (if DEFERRED):** `<text>`

### 4. DSR runbook authoring

- **Status:** CLOSED | DEFERRED
- **Description:** Data Subject Rights runbook covers the M365 MCP path:
  - Access requests — how to extract a user's M365-sourced conversation content from logs.
  - Erasure requests — what to delete in LibreChat vs. what to redirect to Microsoft 365 native deletion (since LibreChat doesn't own the source data).
  - Rectification — guidance that LibreChat-side rectification is not meaningful for M365-sourced data; user must edit at the source.
- **Reference / Document ID:** `<vault link or doc id>`
- **Signed by:** `<Name, Role>` on `<YYYY-MM-DD>`
- **Owner if DEFERRED:** `<Name>` — re-close by `<YYYY-MM-DD>`
- **Rationale (if DEFERRED):** `<text>`

### 5. Privacy notice rewrite — Art. 13/14 transparency

- **Status:** CLOSED | DEFERRED
- **Description:** Privacy notice (employee-facing + customer-facing as
  applicable) addresses the M365 data classes now reachable via LibreChat:
  - Mail headers + bodies, calendar events, OneDrive file contents, SharePoint files, contacts, OneNote pages, Planner/To Do items, Graph search results.
  - The transparency requirements under GDPR Art. 13/14 must be met before any production user can invoke the integration.
- **Reference / Document ID:** `<vault link or doc id>`
- **Signed by:** `<Name, Role>` on `<YYYY-MM-DD>`
- **Owner if DEFERRED:** `<Name>` — re-close by `<YYYY-MM-DD>`
- **Rationale (if DEFERRED):** `<text>`

## Closure sign-off

> By signing below, the named DPO-equivalent affirms that all preconditions
> are either CLOSED with a referenced artifact, or DEFERRED with a documented
> rationale, a named owner, and a re-close deadline.

- **Signed:** `<Name, Role>`
- **Date:** `<YYYY-MM-DD>`
- **Next review:** `<YYYY-MM-DD>` (typically 12 months from closure, or
  sooner if any precondition is DEFERRED)
