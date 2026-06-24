# MemodoAI Upgrade — v0.8.5 → v0.8.7-rc1: What to Expect

This document summarizes the user-facing and operator-facing changes introduced by upgrading
MemodoAI from the version currently running in production to the version on the
`feature-upgrade-15-06-26` branch. It exists so we know what to communicate to users and what
decisions to make before the production cutover.

- **Production currently runs:** `v0.8.5` (the `pablo` branch lineage).
- **Upgrade target:** `v0.8.7-rc1` (branch `package.json` == `v0.8.7-rc1`).
- **Scope of the jump:** two upstream releases — `v0.8.6` **and** the `v0.8.7` release
  candidate — totalling **~470 upstream commits**.
- **Stability caveat:** the target is a **release candidate** (`-rc1`), not a finalized
  release. Treat that as a separate consideration from the feature list below.

Every "will appear / won't appear" call below was cross-checked against the actual
`librechat.yaml` interface config and the schema defaults in
`packages/data-provider/src/config.ts`, so it reflects what users will really see given our
configuration — not just what upstream theoretically ships.

---

## What Users WILL See (default-on with our config)

These need no config change; they are on by default and our `librechat.yaml` does not disable
them. These are the changes worth communicating to users.

### Projects

**Status:** On (default). *(PRs #13467, #13531)*

Conversations can be grouped into projects/folders from the sidebar. The empty "Projects"
section collapses by default so it stays out of the way until used. *(This is the change first
noticed in the upgraded UI.)*

### Real-time context-window & token-usage indicator

**Status:** On (`interface.contextUsage` defaults to `true`; not overridden). *(PRs #13670, #13739)*

A gauge shows how "full" the model's context window is, with a hover snapshot and a
click-through breakdown of token usage per message/branch.

**Important nuance — monetary cost is a separate toggle and is OFF:**
`interface.contextCost` defaults to **`false`**. Despite the upstream PR being titled
"Cost-On-By-Default," in the released config users will see **token counts but not monetary
cost**. They will *not* see per-message pricing unless we deliberately enable it (see
"Decisions For Us" below).

### Message timestamps on hover

**Status:** On (default). *(PR #13709)*

Hovering a message reveals when it was sent.

### Message navigation strip + redesigned scroll-to-bottom

**Status:** On (default). *(PRs #12657, #13497)*

A strip/markers to jump between messages in a long conversation, with drag-to-scrub.

### Immediate conversation-title generation

**Status:** On (default). *(PR #13395)*

Chat titles appear right away instead of after a delay.

### Rich inline previews for Office files

**Status:** On (default). *(PR #12934)*

DOCX, CSV, XLSX, and PPTX render as rich previews rather than plain download links.

### Code & source-code artifacts in the side panel

**Status:** On (default). *(PRs #12854, #12832, #12829)*

Code-execution output and source-code blocks render as side-panel artifacts and inline,
rather than as plain text.

### Skills (brand-new system)

**Status:** On by default in config (no `skills:` key in `librechat.yaml`, so it inherits
`use: true, create: true`). Surfaces meaningfully only in agent contexts.
*(PRs #12580, #12649, #12690, #13293, and ~15 more)*

A new capability: users get a `$` command popover to manually invoke "skills" (reusable
prompt/tool bundles), plus a Skills management UI for creating and sharing them. This is the
**second-biggest visible change after Projects**, and a concept users will not recognize — so
it is either worth explaining in the rollout or worth disabling until we are ready (see
"Decisions For Us").

### Model-spec conversation starters & landing/selector branding

**Status:** Conditional — we use `modelSpecs`, so this applies if individual specs define
descriptions or starter prompts. *(PRs #13710, #13662)*

Model-spec descriptions/starters now render as suggested-prompt cards on the landing screen
and as branding in the model selector. Whether anything shows depends on what each spec
defines.

---

## New, but Builder/Admin-facing (only power users notice)

- **Agent Builder upgrades:** configure subagents, per-agent skill selection, and agent
  file-authoring tools. *(PRs #12725, #12689, #13435)*
- **Granular access control on shared links** via a proper ACL system — finer-grained sharing
  permissions. *(PR #13051)*
- **Masked credential fields** (`SecretInput`) in agent/action config, so secrets are not
  shown in plaintext. *(PR #12955)*

---

## Decisions For Us (present but gated, or a deliberate choice)

- **Cost visibility:** if we want employees to see the monetary cost of their usage (we
  already run `transactions` + `balance` tracking), set `interface.contextCost: true` and add
  `interface.currency` (e.g. EUR with a rate). Currently off — this is an opt-in decision, not
  something that changed under us.
- **Skills exposure:** decide whether to leave Skills on (a new, unexplained surface for
  users) or set `interface.skills.use: false` to hide it until we roll it out with guidance.
- **PII filter overlap:** v0.8.7-rc1 introduced upstream's own "Configurable Message PII
  Filter" (`createMessageFilterPii`), conceptually parallel to our SPEC-009 redakt-based PII
  work. There are now two PII code paths in the tree; confirm they do not double-process or
  conflict before production.
- **New models** (Claude Opus 4.8, Fable 5, GPT-5.5 / frontier OpenAI, Gemini 3.5 Flash) only
  appear **if the corresponding endpoints are configured**. With our Azure OpenAI + custom
  setup they will not appear automatically — model availability is unchanged unless we add
  them.

---

## What Will NOT Appear (our config suppresses it)

So we are not surprised these are missing:

- **Agent Marketplace in the model selector** — we set `interface.marketplace.use: false`, so
  the new marketplace surface stays hidden. *(PR #13553)*
- **Multi-conversation view** — `multiConvo: false` in our config, unchanged.
- **Remote agents** — off in our config.
- **Monetary cost display** — off (`contextCost` default `false`), as noted above.

---

## Operator / Deploy Notes

These do not affect end users directly but matter for the cutover (see also the
`project_v086_upgrade` memory and CLAUDE.md "Production Deploy Discipline").

- **Release candidate:** target is `v0.8.7-rc1`, not a final release.
- **Toolchain change:** the upgrade re-adopts the tsdown/rolldown build and **requires Node
  22.18+**; the API now bundles to `index.cjs` (not `index.js`), so the deploy base image must
  expect `index.cjs`.
- **Do not regenerate `package-lock.json`** — `react-window` must stay pinned at `1.8.11` for
  `react-vtree`.
- **PII overlap** (repeated from above) — reconcile upstream's `createMessageFilterPii` with
  our SPEC-009 redakt path before prod.

---

## Suggested User Announcement

> We've updated MemodoAI to a newer version. A few things you'll notice:
> - **Projects:** you can now group related chats into projects from the sidebar.
> - **Context/usage meter:** each chat shows how much of the model's "memory" (context
>   window) you've used, with a breakdown on hover.
> - **Message timestamps & navigation:** hover any message to see when it was sent, and use
>   the new side strip to jump around long conversations.
> - **Better file & code previews:** Word/Excel/PowerPoint/CSV files and code now preview
>   richly inside the chat.
> - **Skills (new):** type `$` in the message box to access reusable "skills." *(Include this
>   line only if Skills stays enabled.)*
> - Chat titles now appear instantly.
