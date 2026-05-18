# RESEARCH-014: Microsoft 365 MCP Integration — Sequence Pointer

**Date:** 2026-05-13
**Status:** Pointer doc — no fresh research produced at this sequence number
**Primary research:** [RESEARCH-005-m365-mcp-integration.md](./RESEARCH-005-m365-mcp-integration.md)
**Successor spec:** [SPEC-014-m365-mcp-integration.md](../requirements/SPEC-014-m365-mcp-integration.md)

---

## Why this doc exists

The substantive research for the M365 MCP integration was completed earlier in the project timeline and lives at **RESEARCH-005**. When the SPEC for this initiative was finally authored on **2026-05-13** — after SPEC-008 (admin reporting), SPEC-009 (PII detection), SPEC-010 (production readiness), and SPEC-012 (post-merge e2e) had all been written — we promoted the SPEC number to **014** to communicate chronology: this is *newer* work than the SPEC-008..012 cluster, not something that pre-dates them.

This repo's convention has been **RESEARCH-N ↔ SPEC-N**, so renumbering the SPEC alone would have broken the cross-reference invariant. Rather than re-author the M365 research at the new sequence number (which would duplicate content), this thin pointer doc occupies the RESEARCH-014 slot.

## Why no fresh research was needed

- RESEARCH-005 already enumerates the M365 MCP server landscape (Softeria, pnp, elyxlz, Microsoft Agent 365 / Work IQ, etc.).
- RESEARCH-005 already identifies LibreChat's existing OBO plumbing (`{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}`, `GraphTokenService`) as the right integration point.
- **May 2026 verification pass (inlined here so future readers do not depend on an external Obsidian note that is not in the repo):** RESEARCH-005's findings were re-confirmed against the current state of LibreChat (v0.8.4-rc) and Microsoft's MCP ecosystem. Key findings: (a) Softeria's `@softeria/ms-365-mcp-server` remains the recommended option for self-hosted M365 MCP access; no upstream replacement has emerged. (b) The OBO plumbing (`GraphTokenService.getGraphApiToken`, `resolveGraphTokenPlaceholder`, `processMCPEnv` placeholder substitution) is intact in v0.8.4-rc and is the correct integration point. (c) The BYOT pattern via LibreChat PR #10867 (merged late 2025) collapses the previously-open auth decision (Softeria-side OAuth vs. LibreChat-side OBO) — the LibreChat-side answer is now the de facto community choice and is what SPEC-014 adopts. (d) No RESEARCH-005 conclusion was invalidated; minor refinements (Teams/Chat tool surfaces gated on `--org-mode`; SSE transport deprecated March 2025 by MCP spec, `streamable-http` chosen) are folded into SPEC-014 directly.

## Where to read

| Question | Document |
|---|---|
| What M365 MCP servers exist and how do they compare? | RESEARCH-005 §"MCP Server Options" |
| What's the recommended option for MemodoAI? | RESEARCH-005 §"Option 1: Softeria ms-365-mcp-server (Recommended)" |
| What's the current LibreChat-side state for the integration? | RESEARCH-005 §"LibreChat's Existing M365 Integration Points" |
| 2026 verification of the above against current LibreChat | This doc, §"Why no fresh research was needed" (inlined above) |
| What are we actually going to build, and how? | **SPEC-014** §"Implementation Plan" + §"Success Criteria" |
| What's deferred to phase 2? | SPEC-014 §"Out of Scope" |
| How will we verify the deploy? | SPEC-014 §"Verification Plan" |

## Convention going forward

If a future SPEC is similarly delayed beyond its original research's sequence number, follow the same pattern:

1. Write the SPEC at the next free sequence number (so the requirements directory communicates chronology).
2. Leave the original RESEARCH doc in place at its historical number.
3. Drop a thin pointer doc (this one's structure) at the matching new RESEARCH-N slot so the N:N invariant holds.

If the original research is found to be stale, do not use a pointer doc — author a fresh RESEARCH-N with the updated findings.
