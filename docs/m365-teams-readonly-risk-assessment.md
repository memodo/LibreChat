# M365 MCP — Read-only Teams (Phase 2): Risk Assessment & Decision Memo

**Purpose:** Capture the risks of enabling read-only Teams access for the Microsoft 365 assistant so
they can be reviewed and signed off **before** the change is executed.
**Audience:** Service owner, security, and data-protection (DPO/governance) — the sign-off group.
**Companion (execution):** [`m365-teams-readonly-runbook.md`](m365-teams-readonly-runbook.md) — do not
execute until this assessment is reviewed and approved.
**Background:** `SDD/research/RESEARCH-018-obo-graph-assertion-audience.md`.

> **Framing.** Phase 1 (SharePoint) was low-risk: it exposed data the signed-in user already had
> personal access to, via scopes already consented and in use. **Phase 2 is a different category** —
> it ingests Teams **message content**, tenant-wide (per user), through **admin-consented** delegated
> scopes, into an AI pipeline whose PII controls do not currently see that content.

---

## What Phase 2 changes

Ten new **delegated** Microsoft Graph scopes are granted (admin consent) and requested by the OBO
exchange, and the sidecar is told to surface the corresponding tools. All are read-only, but "read"
includes message bodies (`ChannelMessage.Read.All`, `ChatMessage.Read`). See the runbook for the exact
scope list and steps.

---

## Risk register

| # | Category | Risk | Likelihood | Impact | Primary mitigation |
|---|---|---|---|---|---|
| R1 | Privacy / governance | Teams **message content** (tenant-wide, per user) is ingested into the assistant | High (once used) | High | Graduated enablement (Tier A first); DPIA update |
| R2 | Privacy / data flow | Ingested content is **egressed to Azure OpenAI** and **persisted** in MongoDB conversations + **indexed** in Meilisearch (+ possibly logs) | High | High | Retention/erasure review; scope who can use it |
| R3 | Privacy controls gap | **PII guard (redakt) does not scan tool outputs** — it is inbound-request middleware only (and currently fail-open) | Certain | Medium–High | Accept explicitly, or add tool-output scanning |
| R4 | Privacy / third parties | Content includes **other people's** messages (incl. external guests) who never consented to AI processing | Certain | High | DPIA; legal basis review; erasure scope |
| R5 | Security | **Prompt injection** from untrusted chat/channel content → confused-deputy / exfiltration via other outbound tools (`web_search`, `actions`) | Medium | High | Limit co-loaded outbound tools; injection-aware system prompts |
| R6 | Security | Larger **blast radius** if a session / cached OBO token is compromised (now unlocks all Teams history) | Low | High | Session hygiene; kill switch |
| R7 | Access breadth | Admin consent is **tenant-wide, all-at-once** — every M365-enabled LibreChat user gains Teams read | Certain | Medium | Gate *usage* via LibreChat MCP/agent ACLs; pilot cohort |
| R8 | Availability / regression | OBO is **all-or-nothing**: an unconsented/typo'd scope can break **all** M365 tools, not just Teams (`AADSTS65001`) | Medium | High | Consent-first; verify; keep prior `obo.scopes` rollback |
| R9 | Operational | **Config drift** between `obo.scopes` and `MS365_MCP_ALLOWED_SCOPES` → invisible or 403ing tools | Medium | Low | Single-source discipline; cross-referenced comments |
| R10 | Cost / performance | Large threads inflate **token cost / context** and trigger Graph **429 throttling** (per-user concurrency cap was removed) | Medium | Medium | Usage guidance; monitor cost + 429s |

---

## The top three, in detail

### R1–R4 — Data governance is the headline risk

A single "summarize this channel" pulls Teams message content into the LLM prompt (**egress to Azure
OpenAI**, out of the M365 tenant boundary), then that content is **persisted** in the MongoDB
conversation and **indexed** in Meilisearch — becoming searchable inside LibreChat and in-scope for any
data-subject erasure request. Crucially, the existing **redakt PII guard runs as inbound-request
middleware** (`api/server/middleware/detectPII.js`) — it scans the user's typed message, **not** tool
outputs — and is presently fail-open. So Teams content enters storage and the model with **no PII
redaction**. Because Teams messages are the personal data of *many* subjects (including external
guests), Phase 2 materially widens processing and should be backed by an updated **DPIA / records of
processing**, with the `gdpr-erasure.md` runbook extended to cover Teams-derived content.

### R5 — Prompt injection on untrusted, attacker-influenceable content

Teams messages are authored by anyone in the org (or external guests). When the assistant reads a
channel/chat, injected instructions enter the model's context. Agents here also carry `web_search`
(Serper) and `actions`, which are plausible **exfiltration channels** (data encoded into a search
string or an outbound action). Read-only M365 bounds damage *within Graph* but does **not** neutralize
the confused-deputy risk once outbound-capable tools share the agent.

### R8 — Regression risk to the *working* integration

The OBO exchange requests the full `obo.scopes` set. A single unconsented or misspelled scope can make
Entra reject the exchange, breaking **all** M365 tools (mail/calendar/files that work today). This is
the most likely way Phase 2 causes an outage — hence **consent-first, verify, rollback ready.**

---

## Recommended risk reduction: graduate the grant

You do **not** have to grant message-content scopes to get useful Teams capability. Two tiers:

**Tier A — navigation only (low exposure).** Grant `Team.ReadBasic.All`, `Channel.ReadBasic.All`,
`TeamMember.Read.All`, `ChannelSettings.Read.All`, `TeamsTab.Read.All`,
`TeamsAppInstallation.ReadForUser`. This surfaces team/channel **structure and membership** with **no
message bodies** — the message-reading tools simply won't register (allowed-scopes filter). Note: chats
are excluded entirely in this tier, because `list-chats` requires `Chat.Read`, which includes chat
message content (there is no metadata-only chat tool in this sidecar). This tier neutralizes R1, R3,
R4, and most of R5.

**Tier B — message content (high value, high exposure).** Additionally grant `ChannelMessage.Read.All`,
`Chat.Read`, `ChatMessage.Read`, `ChatMember.Read`. This is the full read capability and carries the
full R1–R5 exposure. Treat it as a **separate, DPIA-backed decision** after Tier A is in use.

**Recommendation:** if proceeding, start with **Tier A**, and gate Tier B behind an explicit
data-governance sign-off.

---

## Pre-conditions before executing (regardless of tier)

1. **Sign-off recorded** below by service owner + security + DPO/governance.
2. **DPIA / records of processing updated** (Tier B especially); `gdpr-erasure.md` extended to
   Teams-derived content.
3. **Pilot cohort** — restrict the M365 MCP server/agent to a small group via LibreChat ACLs before
   broad use (the Entra grant is tenant-wide; usage is gated in LibreChat).
4. **Consent-first** in Entra, then verify mail/calendar/files still work before/after the
   `obo.scopes` change; keep the prior value for rollback (R8).
5. **PII gap decision** — explicitly accept that tool outputs are unscanned, or add tool-output
   scanning first (R3).
6. **Monitoring** — watch Azure OpenAI cost and Graph 429s after rollout (R10).

## Kill switch & rollback

Fastest kill switch is the **sidecar**, not Entra: trim the Teams scopes from
`MS365_MCP_ALLOWED_SCOPES` and recreate `mcp-m365` → Teams tools disappear immediately, no Entra
round-trip. Full rollback: remove from `obo.scopes` (redeploy/api restart) and, if desired, revoke the
delegated permissions / admin consent in Entra. See the runbook's Rollback section.

---

## Decision & sign-off

| Role | Name | Decision (Tier A / Tier B / Do not proceed) | Date |
|---|---|---|---|
| Service owner | | | |
| Security | | | |
| Data protection (DPO/governance) | | | |

**Conditions / notes:**

---

## References

- Execution steps: [`m365-teams-readonly-runbook.md`](m365-teams-readonly-runbook.md)
- Phase 1 (SharePoint, low-risk, config-only): [`m365-sharepoint-readonly-runbook.md`](m365-sharepoint-readonly-runbook.md)
- OBO background & app identifiers: [`m365-obo-entra-admin-runbook.md`](m365-obo-entra-admin-runbook.md)
- Root-cause / architecture context: `SDD/research/RESEARCH-018-obo-graph-assertion-audience.md`
- GDPR erasure procedure (to be extended): [`runbooks/gdpr-erasure.md`](runbooks/gdpr-erasure.md)
