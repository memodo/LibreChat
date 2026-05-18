---
adr: 0002
title: Default to read-only delegated Graph scopes for new MCP integrations
status: Accepted
date: 2026-05-18
supersedes: null
superseded_by: null
tags: [cross-cutting, security, mcp, graph-scopes]
---

# ADR 0002: Default to read-only delegated Graph scopes for new MCP integrations

## Status

Accepted (2026-05-18)

## Context

MemodoAI's LibreChat deployment is starting to expose Microsoft 365 surfaces to agents through MCP servers (SPEC-014, Softeria `@softeria/ms-365-mcp-server` sidecar). Every Graph call is issued as the signed-in user via the existing On-Behalf-Of (OBO) plumbing — `{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}` resolved by `GraphTokenService` (see ADR 0001 on the BYOT auth pattern). The set of delegated Graph scopes granted on the Memodo Entra app registration directly determines what every agent, on behalf of every user, is permitted to do in M365.

This ADR fixes the default security posture for that scope set across all current and future Graph-backed MCP integrations in this stack. SPEC-014 captures the immediate decision (REQ-008: `User.Read`, `Mail.Read`, `Calendars.Read`, `Files.Read.All`, `Sites.Read.All`, `Contacts.Read`, `Tasks.Read`, `Notes.Read.All`, `offline_access`; REQ-010: no `--org-mode` Teams admin tools; SEC-003: read-only blast radius; OD-4: soak-period gating before any promotion to write scopes). The Security / Compliance stakeholder requirement in SPEC-014 is framed as an invariant, not a phase boundary — "Phase-1 scopes must be read-only; every Graph call must carry a user-scoped delegated token (no app-only / `.default` daemon access)" — and RESEARCH-005's "Required Azure AD App Registration" section states the same principle as general guidance: start with `.Read` and expand only when justified.

Future delegated-Graph MCP integrations (e.g., Teams admin via `--org-mode`, additional Graph-backed servers for Power BI, Dynamics, Viva, or replacement MCP servers if Softeria proves unreliable) will land in the same Entra app registration and `OPENID_GRAPH_SCOPES` env. Without an explicit default, each future addition becomes an ad-hoc scope negotiation. This ADR makes the default explicit so future work can reference and challenge it deliberately.

## Decision

**Every new delegated-Graph MCP scope rollout in this stack starts in read-only posture.**

Specifically:

1. New scopes added to the Memodo Entra app registration (and the corresponding `OPENID_GRAPH_SCOPES` list) MUST be `.Read` flavors unless an ADR supersession or a SPEC-level decision explicitly promotes them.
2. Softeria's `--org-mode` flag (and any equivalent admin-mode flag on a future Graph MCP server) is OFF by default.
3. Write-class scopes — `.ReadWrite`, `.Send`, `.Create`, admin-only scopes that require `--org-mode`, and anything that mutates state in the user's tenant — are gated behind:
   - An explicit follow-up review (SPEC update or new ADR), AND
   - A soak period of the preceding read-only configuration in production. SPEC-014 OD-4 proposes 2 weeks as the initial soak length; the exact duration is not fixed by this ADR and may be tuned as operational experience accumulates.
4. The current shipping scope set (per SPEC-014 REQ-008) is:
   `User.Read`, `Mail.Read`, `Calendars.Read`, `Files.Read.All`, `Sites.Read.All`, `Contacts.Read`, `Tasks.Read`, `Notes.Read.All`, `offline_access`.

This ADR does not pre-approve any specific promotion. It establishes the default and the gate.

## Alternatives Considered

### Read-only by default with explicit promotion gate (chosen)

Minimizes blast radius for the always-on case. Each promotion is a deliberate, reviewable event with a soak window behind it. Admin-consent prompts are easier to defend to security-conscious users and IT (the prompt does not say "this app can send mail as you" until something actually needs to). Aligns with RESEARCH-005's general guidance and SPEC-014's Security / Compliance stakeholder requirement. Costs some short-term feature surface (no agent-composed-and-sent email in phase 1) in exchange for a defensible posture.

### Read-write from day 1 with audit logging

Rejected. The MCP container handles user-scoped tokens in flight (medium-risk module per SPEC-014 MODULE-001). Granting `.ReadWrite` and `.Send` at launch widens the blast radius of any token-handling bug, any consent-phishing scenario, and any malicious agent prompt-injection to include mail send, file deletion, and calendar invite creation. Audit logging is necessary regardless and does not substitute for not granting the scope in the first place. The admin-consent prompt would also become substantially more alarming, hurting adoption — especially in a deployment where the security stakeholder explicitly required read-only.

### Per-scope opt-in (mixed read/write at launch)

Rejected. Mixing some `.Read` and some `.ReadWrite` at launch makes the consent prompt simultaneously more alarming AND harder to reason about than a clean read-only baseline — without proven business value behind any specific write scope. It also fragments the decision: each scope gets its own ad-hoc justification, rather than a coherent default-plus-gate. A single read-only default with explicit per-scope promotion preserves optionality without paying the consent cost upfront.

## Consequences

### Positive

- Reduced blast radius if a user's LibreChat session or cached Graph token is compromised: no email-send, no file-delete, no calendar-creation, no SharePoint mutation, no Teams admin operation.
- Simpler admin-consent prompt at first sign-in — read scopes are less alarming to security-conscious users and IT admins, easing adoption.
- Cleaner per-user audit story (SPEC-014 SEC-004): every Graph call is a read, so audit-log reconstruction does not have to distinguish read from mutation per tool.
- Forces business value to be demonstrated before each write scope is granted, rather than granting on speculation.
- Establishes a precedent that future Graph MCP additions inherit, removing per-addition negotiation.

### Negative / Trade-offs accepted

- Agents cannot compose-and-send email, create or modify calendar events, modify SharePoint or OneDrive content, modify Tasks / Planner items, or post to Teams via MCP until each capability is individually promoted. Users who need these workflows must still context-switch.
- Adds an operational gate (soak period + explicit promotion review) to every future scope expansion, which is friction for sponsors who want to move fast.
- The 2-week soak (OD-4) is a proposal, not a hard rule; future ADRs or specs may need to tighten or loosen it based on real operational data, and that ambiguity must be resolved at promotion time.

### Neutral observations

- This ADR governs the *Graph delegated scope* surface only. Other MCP servers in this stack that do not use Graph (e.g., `docs.mcp.cloudflare.com`) are unaffected.
- Promotion of any single scope does NOT auto-promote the rest; each `.ReadWrite` or admin scope must clear the gate on its own merits.
- Stdio MCP servers (admin-only in LibreChat) are out of band for the streamable-http BYOT pattern but inherit the same read-only-by-default posture for any Graph scopes they would request — the gate is on the *scope*, not on the *transport*.

## References

- SDD/requirements/SPEC-014-m365-mcp-integration.md (REQ-008, REQ-010, SEC-003, SEC-004, OD-4, MODULE-003, Stakeholder Validation §Security/Compliance, Future Work §Phase 2)
- SDD/research/RESEARCH-005-m365-mcp-integration.md (§"Authentication Architecture", §"Required Azure AD App Registration" — "Start with read-only scopes (`.Read`) and expand to read-write (`.ReadWrite`) only when needed.")
- SDD/adr/0001-*.md (companion ADR — BYOT auth pattern for delegated-Graph MCP integrations; this ADR governs *which* scopes the BYOT token may exercise)
