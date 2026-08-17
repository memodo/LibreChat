# GPT-5.6 (Terra) — Deferred Upgrade Dossier

**Status: 🟡 DEFERRED (decided 2026-08-17).** GPT-5.6 Terra is available on Azure and wanted, but the
upgrade was deliberately postponed. This file is the record of *why*, and everything needed to pick the
work up cold later without redoing the investigation.

**Purpose:** a pre-flight dossier, not a runbook. It states the two viable implementation paths, the exact
files each one touches, the one constraint that has no workaround, and the acceptance criteria that must
pass before GPT-5.6 goes anywhere near prod.

**Companion:** GPT-5.5 is a *separate, much smaller* change (yaml-only, zero code) covered in §7. The two
are compared throughout because the comparison is the main input to the decision.

## Provenance — what is verified vs. reported

Facts age. Everything below is tagged so a future reader knows what to re-check.

- **✅ VERIFIED** — read directly from this repo, from prod over ssh, or from Microsoft Learn on 2026-08-17.
- **📰 REPORTED** — from release coverage / web search, **not** confirmed against upstream source. GitHub
  rate-limited (HTTP 429) the attempt to read upstream's `tx.ts` and `tokens.ts` directly. **Re-verify
  before relying on any 📰 number.**

---

## 1. Decision record

| | |
|---|---|
| **Decision** | Do **not** upgrade to GPT-5.6 yet. |
| **Date** | 2026-08-17 |
| **Reason** | The code delta is small, but GPT-5.6 forces the Responses API for tool calling with **no fallback**, and our only historical Responses-API-plus-MCP evidence includes a silent-hang failure (§4). The verification burden, not the code, is the cost. |
| **Revisit when** | (a) upstream **v0.8.8 reaches GA** (it was `v0.8.8-rc1`, 3 days old, at decision time), **or** (b) a concrete demand for Terra's price point appears (§2). |
| **Not blocked by** | Azure availability or quota — Terra is deployable in Sweden Central today (§3). |

---

## 2. Why Terra is worth revisiting: the cost case

Terra is the **mid tier** of the GPT-5.6 family. Reported list pricing per 1M input/output tokens:

| Model | Input | Output | Note |
|---|---|---|---|
| gpt-5.6-sol | $5 | $30 | 📰 flagship tier |
| **gpt-5.6-terra** | **$2.50** | **$15** | 📰 the one we want |
| gpt-5.6-luna | $1 | $6 | 📰 cheap tier |
| gpt-5.5 | $5 | $30 | ✅ verified in `tx.ts:135` |
| gpt-5 (current) | $1.25 | $10 | ✅ verified in `tx.ts` |

**The point:** Terra is reportedly **half the price of GPT-5.5** while being a newer generation. If Terra
holds up on our workloads, it is the better default and the backport pays for itself. That is the whole
argument for not deferring this indefinitely.

`balance.enabled` is `false` in `librechat.yaml`, so there is **no automatic spend guardrail** — any model
we add is unmetered per-user. Watch the reporting dashboard for the first weeks after any model addition.

---

## 3. Azure prerequisites ✅ VERIFIED

`gpt-5.6-terra`, Azure model version `2026-07-09`, in **Sweden Central** (our chat resource
`memodo-openai-sweden`; embeddings live separately in Switzerland North and are untouched):

| Deployment type | Sweden Central | Note |
|---|---|---|
| **Data Zone Standard** | ✅ available | **Pick this** — keeps processing inside the EU data boundary |
| Global Standard | ✅ available | Processing may route anywhere globally — a data-residency change |
| Standard / Regional | ❌ **not offered** | No region-pinned option exists for any 5.5/5.6 model |

Quota: no access request needed; a **quota request may be required depending on subscription tier**
(Tier 5/6 have quota by default). A portal showing 0 TPM is a quota issue, not an availability issue.

### ⚠️ Name the deployment exactly `gpt-5.6-terra`

Not cosmetic. `packages/api/src/endpoints/openai/llm.ts:797` ends the Azure path with:

```js
llmConfig.model = updatedAzure.azureOpenAIApiDeploymentName;
```

The **deployment name becomes the model string** used for pricing and context-window lookups. A deployment
named `gpt56terra` matches no key in `tx.ts`, silently falls back to `defaultRate = 6` ($6/$6 per 1M), and
corrupts the admin reporting dashboard (SPEC-008) and the Grafana conv-log dashboards (SPEC-017) without
any error surfacing.

---

## 4. ⛔ The constraint with no workaround — read this first

Microsoft's reasoning-models doc, feature-matrix footnote **^9^** ✅ VERIFIED:

> `gpt-5.6` and later models "support the Chat Completions API and function tools, **but not both at the
> same time unless `reasoning_effort` is `none`**. Use the Responses API for tool calling."

**Consequence:** every GPT-5.6 agent that touches the M365 MCP server must run on the Responses API.

**No refactor is needed to *do* that** — LibreChat already carries `useResponsesApi` as a per-spec preset
and a per-agent model parameter:

- `packages/data-provider/src/parameterSettings.ts:260` — exposed as an agent-builder parameter
- `api/server/controllers/agents/v1.js:67` — read from the agent's `model_parameters`
- Our `gpt-5` modelSpec already sets `useResponsesApi: true` (`librechat.yaml`), flipped on deliberately in
  commit `dc5e52d40` ("useResponsesApi back to true") after the SPEC-014 closeout.

**The risk is what that same yaml block documents.** The comment above the flag records that with
`useResponsesApi: true`, GPT-5 produced polite **text-only answers to MCP-tool prompts without ever
emitting `tool_calls`** — a silent hang, suspected to be the Responses-API tool-format adapter in
LibreChat / `@librechat/agents`. It was flipped back on and M365 OBO verification subsequently passed, so
it appears healthy today.

**The asymmetry that drove the deferral:**

| | Chat Completions + tools | Responses API + tools | Fallback if the adapter misbehaves? |
|---|---|---|---|
| **gpt-5.5** | ✅ supported | ✅ supported | **Yes** — drop to Chat Completions |
| **gpt-5.6-*** | ❌ forbidden (unless `reasoning_effort: none`) | ✅ required | **No** |

GPT-5.5 has an escape hatch. GPT-5.6 does not. That single row is why 5.6 was deferred and 5.5 was not.

---

## 5. Implementation path A — targeted backport (~half a day code, ~a day with verification)

Add Terra to four places. Do this **only** if there's concrete demand before v0.8.8 GA.

| # | File | Change |
|---|---|---|
| 1 | `packages/data-schemas/src/methods/tx.ts` | `tokenValues` entry (`'gpt-5.6-terra': { prompt: 2.5, completion: 15 }` 📰), a `cacheTokenValues` entry (near line 331), and a long-context threshold-tier entry (near line 377, alongside the existing `gpt-5.5` one) |
| 2 | `packages/api/src/utils/tokens.ts` | context window in `openAIModels` (**1,050,000** — 922,000 input / 128,000 output ✅) and `modelMaxOutputs` (**128,000** ✅) |
| 3 | `packages/data-provider/src/config.ts` | add to `sharedOpenAIModels` (near line 2006) so the model picker offers it |
| 4 | `librechat.yaml` | group `models:` entry + a `modelSpecs` entry with `useResponsesApi: true` (mandatory — see §4) |

### Two traps in path A

**⚠️ This is NOT a yaml-only deploy.** Items 1–3 live under `packages/*/src`, which means bind-mounted
`dist/`. Per `CLAUDE.md` deploy discipline the path is **`npm run build` (Node 22.18) → `./prod-sync.sh`**,
*not* git push/pull. Getting this wrong produces the classic stale-dist symptom: sources visible on prod,
api restarted, behavior unchanged. Verify with
`grep -c 'gpt-5.6-terra' /opt/docker/librechat/packages/data-schemas/dist/index.js` — zero means stale.

**⚠️ Copy the constants from upstream; do not type them.** The 📰 pricing above is from release coverage.
Lift the authoritative values verbatim from upstream `v0.8.8`'s `tx.ts` and `tokens.ts` — these numbers
feed cost reporting, and a typo is invisible until a finance question arrives.

### What path A does NOT give you

- **`max` reasoning effort** — our `ReasoningEffort` enum stops at `xhigh`
  (`packages/data-provider/src/schemas.ts:197`); `max` is 5.6 + Responses-API only. Adding it means the
  enum, the `parameterSettings.ts` options array, and an `com_ui_max` locale key.
- **`reasoning.mode` / `reasoning.context` controls** — 5.6 defaults to `all_turns` and supports persisted
  reasoning; 5.5 and earlier do not. 📰 Shipped in upstream v0.8.8.
- **Background tool calls for agents & model specs** — 📰 also v0.8.8.
- These likely need an `@librechat/agents` bump; we are pinned at **`^3.2.57`** ✅ (`packages/api/package.json:117`).

---

## 6. Implementation path B — merge upstream v0.8.8 (the real fix, multi-day)

📰 Upstream **v0.8.8** adds GPT-5.6 (Sol/Terra/Luna), `reasoning.mode` + `reasoning.context` Responses-API
controls, and background tool calls — plus Claude Opus 5 / Sonnet 5 and Gemini 3.x. Our fork base is
**v0.8.7** ✅ (`package.json`). At decision time upstream was at **`v0.8.8-rc1`, published 2026-08-14**.

This is the correct long-term move, but size it honestly against our own records:

- **`docs/fork-upstream-divergences.md` lists 7 fork hooks into upstream; only entries 1–2 are automated**
  (PII/redakt and the reporting dashboard, via the `.husky/post-merge` hook). Entries **3–7 are manual
  re-checks**: M365 MCP native-OBO (which includes **fork-local patches to upstream MCP files**, flagged as
  an ADR-0004 follow-up), conv-log sidecar + guardrail mirror, Serper nav link, build-metadata injection,
  and compose bind-mounts.
- **CI does not run on the `pablo`/feature merge path** (SPEC-018 Item 15) — a dropped fork hook will not be
  caught automatically.
- The v0.8.7 merge surfaced toolchain traps that will recur: build with **Node 22.18** (not the shell
  default), install `unrun` out-of-band, **do not regenerate `package-lock`**, and cache-bust with
  `turbo build --force` (a stale `.turbo` replays old dist and reports a false all-cache-hit success).

**Do not put an rc on `chat.memodo.de`.** Wait for GA, then run this as a scheduled upgrade with the full
divergence-registry walk — not as a side effect of wanting one model.

---

## 7. For contrast: GPT-5.5 is the cheap, safe capacity add

> **⚠️ Superseded on cost (2026-08-17).** GPT-5.5 is no longer the cheapest safe option. **GPT-5.4 costs
> $2.50/$15 — half of GPT-5.5, identical to GPT-5.6 Terra's price — and needs the same zero-code, yaml-only
> change while keeping the Chat-Completions tool fallback.** See **`docs/gpt-5.4-upgrade-analysis.md`**.
> The section below remains accurate about GPT-5.5 itself; read it as the *premium* option, not the cheap one.

Recorded here because it is the natural "do this instead / do this first" option, and because the yaml
pattern is the one path A copies.

GPT-5.5 needs **zero code**. Upstream commit `ca26a2dc9` ("Add GPT-5.5 + Frontier OpenAI Models",
2026-06-09) landed **before** our v0.8.7 cutover, so the dist running on prod already knows it ✅:

- `packages/data-schemas/src/methods/tx.ts:135` — $5 / $30 per 1M; long-context tier at line 377
  (above 272,000 input tokens → $10 / $45); cache rates at line 331 (write $5, read $0.50)
- `packages/api/src/utils/tokens.ts:62` — 1,050,000 context; line 434 — 128,000 max output
- `packages/data-provider/src/config.ts:2006` — in `sharedOpenAIModels`
- Vision works automatically: `isVisionModel` uses `model.includes('gpt-5')`

The entire change is three lines in the `sweden-central` group plus an optional modelSpec, deployed via the
**yaml path** (`git push` → prod `git pull` → `./prod.sh restart api`) with no build and no rsync.

```yaml
        models:
          gpt-5:
            deploymentName: "gpt-5"
          gpt-5-mini:
            deploymentName: "gpt-5-mini"
          gpt-5.5:
            deploymentName: "gpt-5.5"
```

```yaml
    - name: "gpt-5.5"
      label: "GPT-5.5"
      description: "GPT-5.5 — 1M-token context, document upload support"
      group: "MemodoAI"
      groupIcon: "azureOpenAI"
      preset:
        endpoint: "azureOpenAI"
        model: "gpt-5.5"
        useResponsesApi: true
```

Azure-side prerequisites are identical to §3 (`gpt-5.5`, version `2026-04-24`, Data Zone Standard in Sweden
Central ✅, same deployment-naming rule).

### On the `version: "2025-04-01-preview"` pin ✅ VERIFIED

The group pins a dated api-version, but it only applies to one of two paths:

- **With `useResponsesApi: true`**, LibreChat rewrites the base URL to
  `https://<instance>.openai.azure.com/openai/v1` with `api-version=preview` and **ignores the group's
  `version` entirely** (`packages/api/src/endpoints/openai/config.ts:257–279`). This path automatically
  tracks Azure's modern v1 surface.
- **The Chat Completions path** (agent runs without the flag, title generation, memory agent) *does* use the
  pinned `2025-04-01-preview`. Adequate for 5.5 basics — `reasoning_effort` exists since
  `2024-12-01-preview`, `max_completion_tokens` since `2024-09-01-preview`.

If a 400 on an unrecognized parameter ever appears, the clean fix is a **per-model version override**, which
the schema supports (`packages/data-provider/src/config.ts:469`) without disturbing `gpt-5`:

```yaml
          gpt-5.5:
            deploymentName: "gpt-5.5"
            version: "2026-04-01-preview"   # only if needed
```

### Default-model behaviour

`modelSpecs.prioritize` is unset and **defaults to `true`** (`packages/data-provider/src/models.ts:98`). With
no spec marked `default`, `getDefaultModelSpec` falls back to `list[0]`, so new chats keep opening on
whichever spec is listed first. To change the default, either reorder `list` or set `default: true` on a
spec (explicit `default` beats position and beats last-used).

---

## 8. Acceptance criteria — must pass before GPT-5.6 reaches prod

Run all of these on **chat-test** (`ssh memodo-eng-test`) first. Item 2 is the one that actually gates the
upgrade; the rest are routine.

1. **Model appears and answers.** GPT-5.6 Terra is selectable and completes a plain chat turn.
2. **⛔ GATING — Responses API emits real tool calls.** An agent with **M365 MCP tools attached** and
   `useResponsesApi: true` must return actual `tool_calls` and real Graph data — **not** a polite text-only
   paragraph. This is the §4 failure mode. If it reproduces, **stop**; there is no fallback for 5.6.
3. **Cost accounting is correct.** After a turn, the recorded model string is `gpt-5.6-terra` and the
   transaction rate matches §2 — **not** the $6 default rate. Check the admin reporting dashboard.
4. **Context window reports correctly** in the UI (1,050,000, not a fallback value).
5. **Streaming works** (✅ supported per the Microsoft matrix).
6. **No regression to `gpt-5` / `gpt-5-mini`** — title generation, the summary model, and the memory agent
   all still work; they stay on `gpt-5-mini` deliberately (cost).
7. **dist actually shipped** — `grep -c 'gpt-5.6-terra'` against the prod `dist` bundles returns non-zero.
8. **Browser cache** — hard-reload before concluding anything failed; an open tab does not refetch the
   startup config (see the `fileConfig` browser-cache gotcha).

---

## 9. Re-verify at pickup time

State captured 2026-08-17; these are the things most likely to have moved:

- [ ] Is **v0.8.8 GA** yet? If so, path B replaces path A.
- [ ] Confirm **Terra pricing** against upstream `tx.ts` — all 📰 figures in §2 and §5.
- [ ] Confirm the **§4 footnote ^9^ constraint** still reads the same on Microsoft Learn (and whether it now
  extends to further model families).
- [ ] Confirm **Sweden Central Data Zone Standard** availability still holds for the target model.
- [ ] Check whether `@librechat/agents` (pinned `^3.2.57`) needs a bump.
- [ ] Re-read `docs/fork-upstream-divergences.md` in full before any upstream merge — it is the merge gate.

### Environment snapshot at decision time ✅

| | |
|---|---|
| Fork base | v0.8.7 |
| Local branch tip | `b187686af` (pablo) |
| Prod HEAD | `200f5be03`, working tree **clean**, `librechat.yaml` azure block identical to local |
| `@librechat/agents` | `^3.2.57` (installed 3.2.57) |
| `gpt-5.6` in tree | **absent** — no source, no tests |
| Azure chat resource | `memodo-openai-sweden` (Sweden Central); embeddings separate in Switzerland North |

---

## Sources

- [Azure reasoning models — feature matrix + footnote ^9^](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/reasoning)
- [Azure region availability for models sold by Azure](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure-region-availability)
- [Azure OpenAI v1 API / api-version lifecycle](https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle)
- [LibreChat changelog](https://www.librechat.ai/changelog) · [LibreChat releases](https://github.com/danny-avila/LibreChat/releases)
- [GPT-5.6 Sol/Terra/Luna overview](https://help.openai.com/en/articles/20001325-a-preview-of-gpt-56-sol-terra-and-luna)

## Related internal docs

- `docs/fork-upstream-divergences.md` — **the merge gate**; walk all 7 entries before any upstream merge
- `docs/v0.8.7-feature-adoption-decisions.md` — the equivalent decision aid for the last upgrade
- `docs/upgrade-v0.8.7-rc1-changes.md` — what the previous upstream merge actually involved
- `CLAUDE.md` § Production Deploy Discipline — why path A needs `prod-sync.sh` and path §7 does not
