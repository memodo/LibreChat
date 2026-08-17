# GPT-5.4 — Upgrade Analysis

**Status: 🟢 RECOMMENDED — awaiting decision (analysed 2026-08-17).** GPT-5.4 is deployable today with
**zero code changes**, at **half the cost of GPT-5.5**, and without the tool-calling constraint that caused
GPT-5.6 to be deferred.

**Purpose:** evaluate what it takes to add GPT-5.4 to the MemodoAI deployment, and how it compares against
the two alternatives already investigated (GPT-5.5 and GPT-5.6 Terra). Self-contained — you can act on this
file alone.

**Context:** this analysis was prompted by the two objections that ruled out the other options —
GPT-5.6 carries integration complications (`docs/gpt-5.6-upgrade-notes.md`) and GPT-5.5 raises costs
significantly. GPT-5.4 was evaluated as the answer to both.

## Provenance — verified vs. reported

- **✅ VERIFIED** — read directly from this repo, from the **running prod bundles** over ssh, or from
  Microsoft Learn on 2026-08-17.
- **📰 REPORTED** — from release coverage, not confirmed against source. Only one figure here is 📰
  (GPT-5.6 Terra's price, used for comparison). Everything about GPT-5.4 is ✅.

---

## 1. Recommendation

| | |
|---|---|
| **Recommendation** | **Add GPT-5.4.** It is the best available trade of capability against cost and effort. |
| **Effort** | ~15 minutes: 3 lines in `librechat.yaml` + an optional modelSpec. **No code, no build, no `prod-sync.sh`.** |
| **Cost** | $2.50 / $15 per 1M in/out — **half of GPT-5.5**, identical to GPT-5.6 Terra's reported price. |
| **Risk** | Low. GPT-5.4 supports **both** the Chat Completions and Responses APIs with tools, so the tool-calling fallback is preserved (§4). |
| **Suggested shape** | Add it as an **opt-in spec, leaving `gpt-5` as the default** (§7) so baseline spend does not move. |
| **Open decision** | Whether the 2× input / 1.5× output increase over today's `gpt-5` is worth it at all, or only as an opt-in (§9). |

---

## 2. Cost analysis

Per 1M tokens, all GPT-5.4 figures ✅ verified in `packages/data-schemas/src/methods/tx.ts`:

| Model | Input | Output | vs. current `gpt-5` | Cache write / read | >272k input tier |
|---|---|---|---|---|---|
| **gpt-5** (current default) | $1.25 | $10 | — | $1.25 / $0.125 | n/a |
| **gpt-5.4** | **$2.50** | **$15** | **2× / 1.5×** | $2.50 / $0.25 | $5 / $22.50 |
| gpt-5.5 | $5 | $30 | 4× / 3× | $5 / $0.50 | $10 / $45 |
| gpt-5.6-terra | $2.50 📰 | $15 📰 | 2× / 1.5× | — | — |

Source lines: `tokenValues` at `tx.ts:131`, cache rates at `tx.ts:328`, long-context tier at `tx.ts:375`.

**The two conclusions that matter:**

1. **GPT-5.4 is exactly half the price of GPT-5.5** on both input and output, and on the long-context tier
   too. It answers the cost objection directly.
2. **GPT-5.4 costs the same as GPT-5.6 Terra** — the model we deferred. So the entire cost case for Terra
   is available today without the merge, the backport, or the Responses-API risk.

### The rest of the 5.4 family ✅

| Model | Input | Output | Context | Note |
|---|---|---|---|---|
| gpt-5.4 | $2.50 | $15 | 1,050,000 | the one to add |
| gpt-5.4-mini | $0.75 | $4.50 | 400,000 | **3× the price of `gpt-5-mini`** — see §7 |
| gpt-5.4-nano | $0.20 | $1.25 | 400,000 | not available Data Zone Standard in the EU (§5) |
| gpt-5.4-pro | $30 | $180 | 1,050,000 | no Chat Completions support; not EU Data Zone |

### Honest caveat

GPT-5.4 is still **2× input / 1.5× output over today's `gpt-5`**. It halves the increase GPT-5.5 would have
caused; it does not hold spend flat. `balance.enabled` is `false` in `librechat.yaml`, so there is **no
automatic per-user guardrail** — which is why §7 recommends adding it opt-in rather than as the default.

---

## 3. Zero code required — verified in the running prod bundles ✅

GPT-5.4 is already fully supported by the code **currently deployed on prod**. This was confirmed by
grepping the shipped bundles over ssh on 2026-08-17, not by inference:

```
packages/data-schemas/dist/index.cjs    gpt-5.4: 9 hits    gpt-5.5: 5    gpt-5.6: 0
packages/api/dist/index.cjs             gpt-5.4: 8 hits
```

Those counts reconcile exactly with source, which is what makes them conclusive:

- **9** in `data-schemas` = 4 `tokenValues` entries (`gpt-5.4`, `-pro`, `-mini`, `-nano`) + 3
  `cacheTokenValues` entries + 2 `premiumTokenValues` long-context tiers.
- **8** in `api` = 4 context-window entries in `openAIModels` + 4 `modelMaxOutputs` entries.

Source locations, for anyone auditing later:

| Concern | File | Lines |
|---|---|---|
| Pricing | `packages/data-schemas/src/methods/tx.ts` | 131–134 |
| Cache pricing | `packages/data-schemas/src/methods/tx.ts` | 328–330 |
| Long-context tier | `packages/data-schemas/src/methods/tx.ts` | 375–376 |
| Context window | `packages/api/src/utils/tokens.ts` | 58–61 |
| Max output (128,000) | `packages/api/src/utils/tokens.ts` | 430 |
| Model picker list | `packages/data-provider/src/config.ts` | 2009–2012 |

Vision/image input also works automatically — `isVisionModel` matches via `model.includes('gpt-5')`.

**Consequence:** this is a **yaml-only change**, deployed via `git push` → prod `git pull` →
`./prod.sh restart api`. It does **not** touch `packages/*/src`, so the bind-mounted `dist` deploy path
(`npm run build` + `prod-sync.sh`) does **not** apply. That is the single biggest practical difference
against the GPT-5.6 backport.

---

## 4. Capability comparison — there is no capability cliff below 5.5 ✅

The expectation going in was that 5.4 would be missing something material. It isn't.

| Capability | gpt-5.4 | gpt-5.5 | gpt-5.6 |
|---|---|---|---|
| Context window | 1,050,000 (922k in / 128k out) | identical | identical |
| Chat Completions API | ✅ | ✅ | ⚠️ see below |
| Responses API | ✅ | ✅ | ✅ |
| Functions / tools | ✅ | ✅ | ⚠️ see below |
| Parallel tool calls | ✅ | ✅ | ✅ |
| Streaming | ✅ | ✅ | ✅ |
| Image input | ✅ | ✅ | ✅ |
| Structured outputs | ✅ | ✅ | ✅ |
| `reasoning_effort` incl. `xhigh` | ✅ | ✅ | ✅ |
| `reasoning_effort: none` | ✅ | ✅ | ✅ |
| Interleaved thinking (Responses API) | ✅ | ✅ | ✅ |
| Persisted reasoning / `reasoning.context: all_turns` | ❌ | ❌ | ✅ |

`xhigh` reasoning effort is restricted to "gpt-5.6, gpt-5.5, **gpt-5.4**, and gpt-5.1-codex-max", and
interleaved thinking is called out specifically for "**gpt-5.4** and gpt-5.5". The only row 5.4 loses to
5.5 is persisted reasoning — which is **5.6-exclusive**, and which we could not use anyway without the
v0.8.8 merge.

**So the 5.4-vs-5.5 choice is purely raw model quality against 2× the price, with no feature to work
around.**

### ⛔ Why this matters most: 5.4 sits below the footnote ^9^ cutoff

The constraint that caused GPT-5.6 to be deferred —

> `gpt-5.6` **and later** "support the Chat Completions API and function tools, but not both at the same
> time unless `reasoning_effort` is `none`. Use the Responses API for tool calling."

— **starts at 5.6**. GPT-5.4 supports both surfaces with tools:

| | Chat Completions + tools | Responses API + tools | Fallback available? |
|---|---|---|---|
| **gpt-5.4** | ✅ | ✅ | **Yes** |
| gpt-5.5 | ✅ | ✅ | **Yes** |
| gpt-5.6-* | ❌ | ✅ required | **No** |

That fallback is what makes this low-risk. If the Responses-API tool-format adapter ever misbehaves the way
it did historically (silent hang: polite text-only replies to MCP-tool prompts, no `tool_calls` emitted —
recorded in the `librechat.yaml` comment above the `useResponsesApi` flag), a 5.4 agent can drop to Chat
Completions. A 5.6 agent cannot. See `docs/gpt-5.6-upgrade-notes.md` §4 for the full history.

---

## 5. Azure prerequisites ✅

`gpt-5.4`, Azure model version `2026-03-05` (mini/nano are `2026-03-17`), in **Sweden Central** — our chat
resource `memodo-openai-sweden`. Embeddings remain separate in Switzerland North and are untouched.

| Deployment type | gpt-5.4 | gpt-5.4-mini | gpt-5.4-nano | gpt-5.4-pro |
|---|---|---|---|---|
| **Data Zone Standard** (EU boundary — **pick this**) | ✅ | ✅ | ❌ | ❌ |
| Global Standard | ✅ | ✅ | ✅ | ✅ |
| Standard / Regional | ❌ | ❌ | ❌ | ❌ |

Notes:

- **Data Zone Standard is the right choice** — it keeps processing inside the EU data boundary. Global
  Standard may route anywhere globally, which is a data-residency change, not just a performance knob.
- **No 5.x model except `gpt-5.1` is offered as Standard/Regional** in Sweden Central, so a region-pinned
  deployment is not an option for any of the candidates.
- `gpt-5.4-nano` and `gpt-5.4-pro` are **Global Standard only in the EU** — relevant if nano is ever
  considered as a cheap tier.
- Quota: no access request needed; a quota request may be required depending on subscription tier
  (Tier 5/6 have quota by default). A portal showing 0 TPM is a quota issue, not availability.

### ⚠️ Name the deployment exactly `gpt-5.4`

`packages/api/src/endpoints/openai/llm.ts:797` ends the Azure path with:

```js
llmConfig.model = updatedAzure.azureOpenAIApiDeploymentName;
```

The **deployment name becomes the model string** used for pricing and context lookups. A deployment named
`gpt54` or `memodo-gpt-5-4` matches no key in `tx.ts`, silently falls back to `defaultRate = 6` ($6/$6 per
1M), and quietly corrupts the admin reporting dashboard (SPEC-008) and Grafana conv-log dashboards
(SPEC-017) with no error surfacing anywhere.

---

## 6. The change

### `librechat.yaml` — the `sweden-central` group

```yaml
        models:
          gpt-5:
            deploymentName: "gpt-5"
          gpt-5-mini:
            deploymentName: "gpt-5-mini"
          gpt-5.4:
            deploymentName: "gpt-5.4"
```

### `librechat.yaml` — optional modelSpec

Add **after** the existing `gpt-5` entry so it does not become the default (§7):

```yaml
    - name: "gpt-5.4"
      label: "GPT-5.4"
      description: "GPT-5.4 — 1M-token context, document upload support"
      group: "MemodoAI"
      groupIcon: "azureOpenAI"
      preset:
        endpoint: "azureOpenAI"
        model: "gpt-5.4"
        useResponsesApi: true
```

### Deploy path — the **yaml** path

```bash
git push                                                    # local
ssh memodo-eng-prod 'cd /opt/docker/librechat && git pull && ./prod.sh restart api'
```

No `npm run build`. No `prod-sync.sh`. Stage on **chat-test** (`ssh memodo-eng-test`) first.

### On the group's `version: "2025-04-01-preview"` pin ✅

It only applies to one of two paths:

- **With `useResponsesApi: true`**, LibreChat rewrites the base URL to
  `https://<instance>.openai.azure.com/openai/v1` with `api-version=preview` and **ignores the group's
  `version` entirely** (`packages/api/src/endpoints/openai/config.ts:257–279`).
- **The Chat Completions path** (agent runs without the flag, title generation, memory agent) does use the
  pinned version. Adequate here — `reasoning_effort` exists since `2024-12-01-preview` and
  `max_completion_tokens` since `2024-09-01-preview`.

If a 400 on an unrecognized parameter ever appears, use a **per-model version override**, supported by the
schema (`packages/data-provider/src/config.ts:469`) without disturbing `gpt-5`:

```yaml
          gpt-5.4:
            deploymentName: "gpt-5.4"
            version: "2026-04-01-preview"   # only if needed
```

---

## 7. Cost-control recommendations

**Keep `gpt-5` as the default; add GPT-5.4 opt-in.** `modelSpecs.prioritize` is unset and defaults to
`true` (`packages/data-provider/src/models.ts:98`); with no spec marked `default`, `getDefaultModelSpec`
falls back to `list[0]`. Listing the 5.4 spec **after** `gpt-5` therefore keeps new chats opening on
`gpt-5`, and baseline spend does not move — only deliberate 5.4 use costs more. To change that later,
either reorder `list` or set `default: true` on a spec (explicit `default` beats position and last-used).

**Do NOT move title/summary/memory to `gpt-5.4-mini`.** At $0.75/$4.50 it is **3× the price** of
`gpt-5-mini` ($0.25/$2) for work where model quality is nearly irrelevant. Leave `titleModel`,
`summaryModel`, and `memory.agent.model` on `gpt-5-mini`.

**Watch the reporting dashboard** for the first few weeks after enabling, since there is no balance
guardrail.

---

## 8. Verification checklist

Run on **chat-test** first. Nothing here is expected to fail — GPT-5.4 uses the same code paths as the
already-working `gpt-5` — so treat any failure as a signal to stop and investigate.

1. **Model appears and answers.** GPT-5.4 is selectable and completes a plain chat turn.
2. **Cost accounting is correct.** After a turn the recorded model string is `gpt-5.4` and the rate matches
   §2 — **not** the $6 default rate. Check the admin reporting dashboard.
3. **Tool calling works.** An agent with M365 MCP tools attached returns real `tool_calls` and Graph data.
   (Unlike 5.6, if the Responses API misbehaves you can drop `useResponsesApi` and retry — that fallback
   existing is the point.)
4. **Context window reports correctly** in the UI — 1,050,000, not a fallback value.
5. **Streaming works.**
6. **No regression to `gpt-5` / `gpt-5-mini`** — title generation, summaries, and the memory agent still
   work and remain on `gpt-5-mini`.
7. **Default model unchanged** — a new chat still opens on `gpt-5` (if following §7).
8. **Hard-reload before judging.** An open tab does not refetch the startup config; see the `fileConfig`
   browser-cache gotcha before concluding a deploy failed.

---

## 9. Open decisions

- [ ] **Adopt GPT-5.4 at all?** It is 2× input / 1.5× output over today's `gpt-5`. Halving GPT-5.5's
  increase is not the same as holding spend flat. Staying on `gpt-5` remains a legitimate choice.
- [ ] **Opt-in or default?** §7 recommends opt-in. Making it the default is a one-line change later.
- [ ] **Does GPT-5.5 still have a role?** Adding it alongside is another three lines whenever an A/B on
  quality is wanted; nothing here forecloses it.
- [ ] **Does this change the GPT-5.6 plan?** It removes the *cost* motivation for Terra (same price), but
  not the reasons to eventually take v0.8.8. See `docs/gpt-5.6-upgrade-notes.md`.

---

## 10. Environment snapshot ✅ (2026-08-17)

| | |
|---|---|
| Fork base | v0.8.7 |
| Local branch tip | `b187686af` (pablo) |
| Prod HEAD | `200f5be03`, working tree clean, `librechat.yaml` azure block identical to local |
| Azure chat resource | `memodo-openai-sweden` (Sweden Central), group `sweden-central`, `version: 2025-04-01-preview` |
| Models configured today | `gpt-5`, `gpt-5-mini` |
| `gpt-5.4` in prod dist | ✅ present (9 hits data-schemas, 8 hits api) |
| `gpt-5.6` in prod dist | ❌ absent (0 hits) — confirms the 5.6 analysis |
| Balance guardrail | `balance.enabled: false` — no automatic per-user cap |

---

## Sources

- [Azure reasoning models — feature matrix, footnote ^9^, `xhigh` / interleaved thinking](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/reasoning)
- [Azure region availability for models sold by Azure](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure-region-availability)
- [Azure OpenAI v1 API / api-version lifecycle](https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle)

## Related internal docs

- `docs/gpt-5.6-upgrade-notes.md` — the deferred GPT-5.6 Terra dossier; §4 has the full tool-calling
  constraint history, §7 has the GPT-5.5 detail
- `CLAUDE.md` § Production Deploy Discipline — why this change uses the yaml path and the 5.6 backport
  would not
