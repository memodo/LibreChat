---
review_panel: false
eval_required: false
cross_cutting_decisions: none
delivery_mode: whole-feature
---

# SPEC-019-memory-write-fix

## Executive Summary

- **Based on Research:** RESEARCH-019-memory-write-fix.md
- **Creation Date:** 2026-07-23
- **Author:** Claude (lightweight-finish wrap-up)
- **Status:** Implementation Complete — Verified Live

This spec documents a **one-line, proven configuration fix**: automatic (post-turn) memory extraction silently stopped writing to MongoDB on `feature/015-m365-obo-v0.8.7` because v0.8.7 made the post-turn memory agent opt-in (`isMemoryAgentEnabled()` now requires `config.agent.enabled === true`), and this fork's `librechat.yaml` `memory.agent` block never set that key. READ (recalling existing memories) was unaffected; only WRITE silently no-opped, with a single one-time startup warn as the only log evidence. The fix — adding `memory.agent.enabled: true` to `librechat.yaml` — is already applied to the repo and to chat-test, and independently verified live via a real authenticated chat repro with a MongoDB before/after row-count diff.

**The specialist panel and the adversarial critical-review loop were intentionally skipped for this spec** (`review_panel: false`, `eval_required: false`). This is proportionate: the root cause is CONFIRMED (not hypothesized) via live repro with concrete DB evidence, the fix is a single YAML key with no code change, no new attack surface, and no architectural decision to review. The critical-review cycle already ran in full during the RESEARCH-019 investigation phase (`SDD/reviews/CRITICAL-RESEARCH-memory-write-fix-20260722.md`) — re-running a full panel/review loop over a one-line config diff would not surface additional risk.

## Research Foundation

- **RESEARCH-019-memory-write-fix.md** — full diagnostic investigation. See its "Root Cause — CONFIRMED (2026-07-23)" and "Live Confirmation (2026-07-23)" sections for the authoritative root-cause trace and before/after DB evidence. The bulk of that document (H1/H2 mechanism mapping, the cleared cleanup-race/Azure-env-leak/inline-capability/LangChain-config hypotheses) is retained there as a correctly-executed elimination process that ruled out every other candidate cause before the config gate was found.
- **Critical review:** `SDD/reviews/CRITICAL-RESEARCH-memory-write-fix-20260722.md` — adversarial review of the investigation's intermediate framing (H1/H2 co-equal hypotheses), all findings addressed in the research doc; a "Live Confirmation" addendum records that the runtime-only question the review flagged was resolved by the live repro described here, and that the actual root cause was none of the mechanisms either the research or the review were discriminating between.

## Intent

### Problem Statement

On `feature/015-m365-obo-v0.8.7`, users who ask the assistant to "remember" something receive a confirming reply ("Saved…" / "Noted…") but the fact is never persisted — no new `memoryentries` row, no error, no warning tied to the turn. Recall of previously-stored memories (all predating 2026-06-10) continues to work, which is why the failure went undetected through a 2026-07-15 smoke test that only checked for successful-looking assistant narration, not an actual DB delta.

### Root Cause (confirmed)

`isMemoryAgentEnabled()` (`packages/data-schemas/src/app/memory.ts:37-40`) returns `true` only when `config.agent.enabled === true` AND the agent has a valid provider+model. This fork's `librechat.yaml` `memory.agent` block had a valid provider/model but no `enabled` key, so the gate returned `false`. In `useMemory()` (`api/server/controllers/agents/client.js`), the `false` branch still runs `getRequestMemories` (READ — unaffected) but never builds the extraction agent or assigns `this.processMemory`, so `runMemory()`'s early return (`this.processMemory == null`) fires on every turn. `loadMemoryConfig` logs a one-time startup warning naming the exact missing key, which per-turn log scans never searched for. This opt-in gate is new in v0.8.7 (absent in v0.8.5, which prod still runs); it is not a bug in any of the three memory-adjacent commits from the v0.8.5→v0.8.7 merge that the investigation traced and cleared.

### Solution Approach

Add `enabled: true` under `memory.agent` in `librechat.yaml`. No code change. Already applied to the repo and to chat-test.

## Success Criteria

- **REQ-001 (fix present and effective):** `librechat.yaml`'s `memory.agent` block includes `enabled: true`. With this key present, `isMemoryAgentEnabled()` returns `true`, the post-turn extraction agent is built and assigned on every applicable turn, and a "remember X" turn produces a persisted `memoryentries` row (verified: 14→16 rows on chat-test, two new keys `team_affiliation_frontend` and `communication_preference_bulleted_concise`, `updated_at` 2026-07-23T07:26:27Z). **Status: MET, verified live.**
- **OPS-001 (deploy mechanism):** This is a config-only (`librechat.yaml`) change. Deploy is `git pull` on the target environment + an api restart/recreate (`./prod.sh restart api` or equivalent) — **no** `npm run build`, **no** `prod-sync.sh`, no dist rsync, because no `packages/*/src` or `client/src` file changed. **Status: MET — this is how the fix was deployed to chat-test.**
- **OPS-002 (prod-cutover requirement):** Prod is currently on v0.8.5 and does not have the opt-in gate, so it is unaffected today. At the v0.8.7+M365 prod cutover, prod's `librechat.yaml` `memory.agent` block MUST include `enabled: true` in the same change, or prod memory writes will silently break identically to how they broke on chat-test. This is tracked as deploy-checklist item 1d (`docs/deploy-checklist-015-m365-obo-v0.8.7.md`). **Status: OPEN — pending the prod cutover; not yet applicable since prod hasn't upgraded.**
- **UX/Observability note:** The missing flag fails **silently** from the user's perspective — the assistant narrates a successful save regardless of whether the background extraction agent exists at all, because the primary chat turn and the post-turn extraction are separate, uncorrelated LLM calls. The only server-side signal is a one-time startup warning (`"[memory] Agent config detected without explicit \`enabled: true\`. Automatic memory extraction is now opt-in. Add \`memory.agent.enabled: true\` to keep automatic memory updates."`), not a per-turn log line — any future regression of this kind should be caught by an integration test asserting an actual DB row (see Verification Plan), not by assistant narration or by log-grepping alone.

## Out of Scope

- **Code changes of any kind.** This is a YAML-only fix; no `packages/api/src`, `api/`, or `client/src` file is touched.
- **The cleared hypotheses from the investigation**, none of which are the cause and none of which should be revisited for this bug:
  - The `awaitMemoryWithTimeout` 3-second cleanup race (`client.js`) — already present in v0.8.5, not a regression.
  - The legacy `AZURE_OPENAI_ENDPOINT`/`AZURE_OPENAI_API_KEY` env-var leak — unrelated, empty on the box, tracked separately (deploy-checklist item 1b).
  - `gpt-5-mini` as the memory model — in place since 2026-03-30, wrote memories successfully through 2026-06-10.
  - `397ddc536` (PR #13869, "Memory as an Agent Capability," inline `set_memory`/`delete_memory` tools) — traced and cleared; does not touch the post-turn write path, and is additionally gated behind the per-turn "Use memory" composer toggle, which the reported repro does not enable. Verifying this inline mechanism independently (toggle ON) remains a separate, non-blocking, lower-priority follow-up (RESEARCH-019 Fix Option B) and is explicitly not part of this spec.
  - `1b79e0b78` ("Align LibreChat With Agents LangChain Upgrade," `normalizeMemoryLLMConfig`) — traced and cleared; only inspects a field (`.apiKey`) this fork's Azure config never populates.
  - Any "model completes with no tool call" tool-calling investigation — superseded; the extraction processor was never installed in the first place, so there was no tool call to trace.

## Implementation Plan

The entire implementation is a single YAML edit, already applied:

```yaml
memory:
  disabled: false
  personalize: true
  tokenLimit: 10000
  agent:
    # (packages/data-schemas/src/app/memory.ts) requires agent.enabled === true.
    provider: azureOpenAI
    model: gpt-5-mini
    model_parameters:
      temperature: 0.1
    enabled: true
```

- Applied to the repo's `librechat.yaml` (~L266-271, with an explanatory comment pointing at `memory.ts`).
- Applied to chat-test's running `librechat.yaml` (verified — matches the repo).
- **Prod:** not yet applied (prod is still v0.8.5, where the gate doesn't exist). Must be applied as part of the v0.8.7+M365 cutover change — see deploy-checklist item 1d.

## Verification Plan

Live, reproducible, real authenticated GPT-5 chat repro on chat-test (not a mock, not a unit test — an actual end-to-end DB-backed verification):

1. **BEFORE** (flag absent): repro turn — "From now on, please remember that I'm on the Frontend team and I prefer concise, bulleted answers." Assistant replies "Saved…" (unreliable narration). `db.memoryentries` for the test user: 14 rows, newest `updated_at` 2026-06-10 — unchanged, 0 new rows.
2. Add `enabled: true`; recreate/restart api (healthy, restarts=0); confirm the one-time opt-in warning is gone from fresh startup logs.
3. **AFTER**: identical repro. `db.memoryentries` for the same user: 14 → 16 rows, two new rows at `updated_at` 2026-07-23T07:26:27Z (`team_affiliation_frontend`, `communication_preference_bulleted_concise`).
4. This before/after delta is the acceptance criterion — reproducible on any environment by the same three steps.
5. Recommended regression coverage (not yet added, tracked as a follow-up, not blocking this fix): an integration test that asserts a real `set_memory` tool call during `processMemory` produces an actual `memoryentries` row via `mongodb-memory-server`, per CLAUDE.md's "real logic over mocks" — so a future config or code regression that silently disables extraction is caught by CI rather than requiring another live repro.

## Rollback

Remove (or set `false`) `memory.agent.enabled` in `librechat.yaml`. This reverts to READ-only behavior (existing memories still recall correctly; no new writes occur) — the pre-fix state, which is safe (no data loss, no error surface, just the original silent-no-write symptom). No DB migration, no code path, no other config is affected by rollback.
