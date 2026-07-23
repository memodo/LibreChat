# MemodoAI "July 2026 Updates" — Guide + Video Plan (v0.8.7-rc1 + Microsoft 365)

**Goal:** produce a **standalone, labeled "July 2026 Updates" deliverable** — its own written guide
and its own video — covering the features introduced by the **v0.8.5 → v0.8.7-rc1 upgrade** and the
**Microsoft 365 MCP integration**. This is a companion to the evergreen "Getting Started with
MemodoAI" tutorial, not a rewrite of it.

## Scoping decisions (current)

- **Standalone deliverable** (revised 2026-07-20). A *new* guide + *new* video labeled for the
  July 2026 updates. **Supersedes** the earlier "incremental splice into the existing 15-chapter
  video" approach — the new video is recorded fresh for the new features; the existing cut is left
  untouched.
- **Audience:** existing users who already know the basics (the evergreen guide covers those). This
  guide assumes familiarity and focuses on what changed.
- **Depth:** end-user for the UI changes; **in-depth for Skills** (usage + a create-a-skill
  walkthrough) and **proper coverage of the `chain` and `memory` agent capabilities** (explanation
  + a simple example each — not a full multi-agent orchestration lab unless we decide to go further).
- **Evergreen "Getting Started" guide:** gets only small **accuracy corrections** (see §7), done
  separately and not gated on this work.

## Decisions (confirmed 2026-07-20)

1. **Title/label:** **"What's New (July 2026)"**.
2. **`/guide` hosting:** **Option A** — a selector on the existing page ("Getting Started" |
   "What's New (July 2026)") swapping video/chapters/transcript/HTML link.
3. **M365 enable path:** **CONFIRMED** — the composer's **"MCP Servers"** dropdown → tick
   **Microsoft365** (a normal chat, no agent). Verified from a live chat-test screenshot.
4. **chain/memory depth:** explanation + one simple example each (the recommended default; can be
   deepened later if wanted).

## Live verification (chat-test, 2026-07-20)

The written-guide UI claims were verified against the live instance:

- **M365 enable:** composer → **MCP Servers** dropdown → tick **Microsoft365**. Confirmed.
- **Composer buttons:** Search / File Search / **MCP Servers** (no Skills button in the base GPT-5
  composer in this session — Skills is reached via the left rail + `$`; a composer Skills button
  appeared in Pablo's earlier screenshot, so it's conditional — not relied on in the guide).
- **Skills location:** a **left-rail Skills panel** ("My Skills" list + **Admin Settings**), not a
  composer button.
- **Create a skill:** **+ → "Write skill instructions"** (fields: **Name**, **Description** — "be
  specific about when this skill should apply" — **Instructions** in Markdown) or **"Upload a
  skill"**. **No three-mode invocation selector** existed; relevance is model-decided from the
  Description + a "When to use" body heading. Skills have a **Category**, **versioning** (v1 +
  author), an enable toggle, and sharing.
- **Invoke a skill in chat:** type **`$`** → "Select a Skill by name" picker. Confirmed.
- **Chain:** Agent Builder → **Advanced → Multi-agent orchestration → Chain** ("run a fixed sequence
  of agents", up to 10). Also **Handoffs [BETA]** (out of scope) and an **Agent skills** toggle.
- **Memory capability:** confirmed a REAL capability in *our* build — `AgentCapabilities.memory` in
  `packages/data-provider/src/config.ts` (+ in `defaultAgentCapabilities`), implemented in
  `packages/api/src/agents/memory.ts` (`buildInlineMemoryTool`, gated by capability + memory config +
  user opt-in + MEMORIES permission). The public docs listing 13 capabilities just lag our v0.8.7-rc1.
  It is **NOT a per-agent Agent Builder toggle** (confirmed by code + UI) — it surfaces as the
  **"memory updated"** indicator on messages + entries in the **Memories panel**. Guide §4 reframed
  accordingly; screenshot `09-memory-updated.png`. (My earlier "no such capability / drop it" was
  wrong — corrected after reading LibreChat docs + our source.)

---

## 1. Feature inventory — what's new (verified against live `librechat.yaml`)

### 1a. Microsoft 365 (headline new capability)

MemodoAI connects to Microsoft 365 through a **Model Context Protocol (MCP) server** — the
`Microsoft365` server (an `mcp-m365` sidecar that bridges to Microsoft Graph), defined under
`mcpServers:` in `librechat.yaml`. It is **not** an agent feature; it's a standalone MCP tool group
with its own On-Behalf-Of (OBO) token exchange. Once its tools are enabled in a chat, the assistant
can read the signed-in user's M365 data on their behalf. **Read-only** (Phase 1). Every call runs
as the signed-in user via the OBO exchange and inherits their existing permissions — the assistant
cannot reach data the user couldn't already see.

| Surface | What the assistant can do (read-only) |
|---|---|
| Outlook mail | List/read/search messages by sender, subject, date, keyword |
| Calendar | List/read events, attendees, locations; query by date range |
| OneDrive / SharePoint | Browse files, read metadata, pull file contents to reason over |
| Excel | Read worksheet ranges, named tables, chart definitions |
| OneNote | List notebooks/sections/pages; read page contents |
| To Do / Planner | List task lists, plans, buckets, tasks with status/due dates |
| Contacts | List/read contacts (name, email, phone) |
| Graph search | Cross-service keyword search over the user's mail/files/sites |
| Profile | Display name, UPN, job title |

**Constraints users must understand:** it's **read-only** (no sending mail, no editing files); it
runs **as the signed-in user** (inherits their permissions); tool output **still passes through the
PII detector**. *No sign-in caveat needed* — Microsoft SSO is the only login method, so every user
is already signed in with Microsoft and M365 works on their behalf automatically.

**Verification note:** `docs/m365-mcp-features.md` header still says "runtime verification
pending," but the chat-test env work verified OBO→Graph end-to-end. **Reconcile that stale header
before publishing** and confirm live behavior on chat-test during capture.

### 1b. v0.8.7 visible UI changes (default-on with our config)

| Feature | What the user sees |
|---|---|
| **Projects** | Group conversations into folders at the top of the sidebar |
| **Context-usage meter** | Gauge showing how full the context window is; hover for a breakdown. **Token counts only — monetary cost is OFF** (`interface.contextCost: false`) |
| **Instant conversation titles** | Titles appear immediately, not after the first reply |
| **Message timestamps on hover** | Hover a message → when it was sent |
| **Message-navigation strip** | Jump/scrub between messages in long chats |
| **Rich Office previews** | DOCX/CSV/XLSX/PPTX render as inline previews, not download links |
| **Code / source artifacts** | Code output + source blocks render as side-panel artifacts |

### 1c. Newly enabled agent capabilities (`b61a9c08e`)

`agents.capabilities` gained `memory`, `chain`, `skills` (now:
`file_search, web_search, actions, artifacts, tools, memory, chain, skills`).

- **Skills** — a `$` command popover for reusable prompt/knowledge modules, plus a management UI to
  create/share them. **In-depth in this guide** (usage + create-a-skill walkthrough).
- **chain** — sequential multi-agent chaining within one run. **Covered** (explanation + example).
- **memory (capability)** — lets a *specific agent* read/write memories as a tool, distinct from
  the global Memories panel. **Covered** (explanation + when to use).

### 1d. Explicitly NOT covered (avoid scope creep)

Agent Marketplace (`marketplace.use: false`), multi-conversation (`multiConvo: false`), remote
agents (off), monetary cost display (off), Code Interpreter / `execute_code` (needs sandbox infra,
not enabled), subagents (not enabled). None are visible to our users.

---

## 2. New written guide — outline

Lives in `docs/memodo-ai-tutorial/updates-2026-07/` — its own guide (`updates-july-2026.md`),
`screenshots/`, `recording-script.md`, `recording-narration.md`, `audio/` `video/` `transcript/`
output dirs, this plan, and a `README.md`. The TTS/transcription **tooling is shared at the tutorial
root** (`docs/memodo-ai-tutorial/tooling/`) and invoked with this folder's name — e.g.
`node tooling/tts/narrate.mjs updates-2026-07`, `bash tooling/transcribe.sh updates-2026-07`
(structure reorg 2026-07-22: original guide → `getting-started/`; shared tooling parameterized by
recording folder; verified via `narrate.mjs --dry-run`). `.gitignore` ignores this folder's
`audio/`/`video/`/media.

| # | Section | Depth | Content |
|---|---|---|---|
| 1 | **What changed & who this is for** | Light | One paragraph: MemodoAI was upgraded (v0.8.5→v0.8.7) and gained Microsoft 365. Assumes you know the basics; link to the evergreen Getting Started guide. |
| 2 | **Microsoft 365** | Deep | What an MCP server is (one line); read-only + runs-as-you (no sign-in caveat — Microsoft SSO is the only login); **how to turn it on** — composer → **MCP Servers** dropdown → tick **Microsoft365** (a normal chat, no agent); the M365 surfaces (mail/calendar/files/etc.); 3–4 example prompts; how results show ("Used N tools — Microsoft365"); **reconnect behavior** (connection can drop on session expiry → click the reconnect icon next to Microsoft365); privacy note (PII detection still applies; new data categories). |
| 3 | **Skills — reusable playbooks** | Deep + walkthrough | What a skill is and the progressive-disclosure model (name/description advertised cheaply → body on demand → `references/*` if needed); how to **invoke** one — the **Skills** pinned button in the composer *and* the `$` menu; **walkthrough: create a skill** in the management UI (name, description, `SKILL.md` body, references, invocation control — manual `$` / always-apply / model-decided); Skills vs. Prompts (§11 evergreen) vs. Agents (§9 evergreen); versioning + the `SKILLS` permission. |
| 4 | **Agent power-ups: chaining & memory** | Builder-focused | **Agent chaining (`chain`)** — sequential multi-agent chaining in one run; what it does, a simple example, the cost/latency caveat. **Memory as a capability (`memory`)** — giving a specific agent read/write memory tools, distinct from the global Memories panel; when you'd want agent-scoped memory. Both framed for people building agents in Agent Builder. |
| 5 | **Projects** | Light | Group related chats into folders from the sidebar; when to use vs. Bookmarks. |
| 6 | **Quality-of-life upgrades** | Light | Context-usage meter (token counts, cost off), instant titles, timestamps on hover, message-navigation strip, rich Office previews, code/source artifacts. |
| 7 | **Where to learn more** | Light | Pointers back to the evergreen guide, the Concierge agent, and the AI/IT champion. |

---

## 3. Screenshots — capture list

All on **chat-test.memodo.de** (v0.8.7 + M365 live), 1440×900. Store under
`updates-2026-07/screenshots/`. **M365 + agent-scoped shots need an Entra-signed-in session.**

| Name | Shows |
|---|---|
| `01-m365-tools-menu.png` | The composer **MCP Servers** dropdown open, ticking **Microsoft365** (the enable path) |
| `02-m365-in-use.png` | Assistant answering an M365 prompt with the "Used N tools — Microsoft365" expander |
| `03-m365-reconnect.png` | The reconnect icon next to **Microsoft365** (only visible when disconnected — can't force on demand; use Pablo's provided screenshot as the source). Connected state shows a **green dot** instead. |
| `04-skills-menu.png` | The `$` "Select a Skill by name" picker in the composer *(verified)* |
| `05-skills-detail.png` | A skill's detail view — enable toggle, share, Edit, version *(verified)* |
| `06-skills-create.png` | The "Write skill instructions" form — Name / Description / Instructions (Markdown) *(verified)* |
| `07-skills-in-use.png` | A skill primed into a response |
| `08-chain-config.png` | Agent Builder → Advanced → Multi-agent orchestration → **Chain** *(verified, captured)* |
| `09-memory-updated.png` | The "memory updated" indicator on a message when the assistant saves a memory (memory is a platform capability, **no per-agent toggle**) |
| `10-projects-sidebar.png` | Projects folder(s) in the sidebar |
| `11-context-usage-meter.png` | Context gauge + hover breakdown |
| `12-office-preview.png` | Inline XLSX/DOCX preview |
| `13-code-artifact.png` | Code/source rendered as a side-panel artifact |
| `14-message-timestamp.png` | Timestamp-on-hover (+ nav strip if it combines) |

**Capture status (2026-07-21):** ✅ Captured (14): `01`, `02`, `03`, `03b` (Initialize dialog — extra),
`04`, `05`, `06`, `07`, `07b` (full skill output — extra), `08`, `09`, `10`, `11`, `12`, `14`.
`12-office-preview` was uploaded via the **`file_upload` browser tool** (staged the .xlsx in the
session scratchpad → set the hidden file input by ref; no native dialog needed). `02` contains
Pablo's own name/title (low-sensitivity, agreed) — redact at polish if desired.

**❌ DROPPED — `13-code-artifact` / code-as-artifacts (2026-07-21, per Pablo):** there is **no LLM
model or AI endpoint configured with the Artifacts capability** in our deployment, so
code-as-side-panel-artifacts is **not an available feature** for our users. The §6 "Code as artifacts"
bullet was **removed** from the guide. This limitation is **specific to the Artifacts capability** —
it does NOT extend to agents in general.

**CHAIN (§4) — CONFIRMED AVAILABLE (an earlier "same root cause" worry was WRONG and is retracted).**
Pablo confirmed chaining works: the **"Chain Test Primary"** agent has **"Uppercase Bot"** chained
(1/10) and runs. Agents ARE functional in the deployment — the artifacts limitation above is specific
to Artifacts, not to agents. **Keep §4 chaining + screenshot `08` as-is.**

**Re-verify for the evergreen guide's corrections (§7):** welcome screen (suggested-prompt cards?),
left-rail icons, composer footer version. **Also confirmed during capture:** the composer's **Skills**
button is *conditional* (appears once a skill is used/active — absent in a fresh base chat), so both
the `$` picker and the left-rail Skills panel are the reliable entry points.

---

## 4. Video — standalone "July 2026 Updates" cut

A **fresh, self-contained video** (est. ~8–12 min), NOT a splice into the existing 17:53 tour.
Chapters mirror the guide sections. Own narration, own transcript (EN/DE), own `chapters.json`.
Same production pipeline as the original.

Chapters: (1) What changed, (2) Microsoft 365, (3) Skills (incl. create-a-skill), (4) Agent
power-ups: chaining & memory, (5) Projects, (6) Quality-of-life upgrades, (7) Wrap-up.

**Production steps:**

- [x] Write `updates-2026-07/recording-script.md` (shot list per chapter). **DONE 2026-07-21** —
      grounded in the live capture flows; 7 chapters; screenshots wired in; gotchas noted.
- [x] Write `updates-2026-07/recording-narration.md` (one block per chapter + cold open/outro).
      **DONE 2026-07-21** — ~8–9 min at 150 wpm; matches the corrected facts; code-artifacts excluded.
- [ ] Record segments in OBS (operator-controlled record; Claude drives the browser — the
      established split; `screencapture -v` is unreliable here).
- [ ] Render narration via `tooling/tts/narrate.mjs updates-2026-07` (ElevenLabs; needs `ELEVENLABS_API_KEY`).
- [ ] Assemble the cut (intro/outro title cards + documentary track + narration).
- [ ] Generate `updates-2026-07/transcript/` (whisper.cpp) → EN + DE `.vtt`/`.txt`, `chapters.json`
      (EN + DE titles, `duration`).
- [ ] Transcode to web MP4 (H.264/AAC, faststart) per the README `ffmpeg` command.

Because it's standalone, there is **no timestamp reflow, no re-transcode of the old video, and no
transcript re-alignment** of the existing tour — a concrete benefit of the standalone approach.

---

## 5. In-app `/guide` page — hosting a second guide

The `/guide` page currently serves ONE video + chapters + transcript + one HTML guide from the
bind-mounted `./guide-media/`. A second, labeled deliverable needs a hosting decision (**§8.2**):

- **Option A — Selector on the existing page (recommended).** Tabs/toggle at the top:
  "Getting Started" | "What's New — July 2026". Swaps video, chapters, transcript, and the HTML
  link. One route (`Guide.tsx`), one discoverable entry point, clearly labeled. Moderate frontend
  change + new `guide-media` files (namespaced, e.g. `guide-media/updates-2026-07/`).
- **Option B — Second route.** e.g. `/guide/updates-july-2026`, reusing the Guide component;
  cleanest separation but needs routing work + a link from the main page.
- **Option C — Second section on the same page.** Append a "July 2026 Updates" block below the main
  tour; simplest frontend, but a long page and weaker labeling.

Media (per host, not in git): the new `MemodoAI-updates-july-2026.mp4`, transcript `.vtt`/`.txt`,
`chapters.json`, and the new HTML guide export. Frontend selector/route work → `npm run build` +
`./prod-sync.sh`; media → copy to the host's `./guide-media/`.

---

## 6. Sequencing & dependencies

1. **Asset creation happens on chat-test now** — it already runs v0.8.7 + M365, so screenshots and
   OBS recording are unblocked today.
2. **M365 + agent-scoped shots need an Entra session** on chat-test.
3. **Publishing to prod `/guide` is coupled to the prod cutover** (pending pablo → prod deploy of
   v0.8.7 + M365). Until prod runs the new version, prod users lack these features — publish to
   **chat-test** `/guide` now; hold **prod** publish for the cutover.
4. **Reconcile the stale M365 doc header** before the guide asserts M365 is live.
5. **Verify the M365 enable path** (§8.3) and the drift-correction UI details on chat-test.

---

## 7. Evergreen "Getting Started" guide — small corrections (decoupled)

Not part of the new deliverable; just keep the old guide from stating things that are now false:

- §2 footer note "LibreChat **v0.8.5**" → **v0.8.7-rc1**.
- §3 auto-title text ("right after the model finishes its first reply") → titles are **instant**.
- §2 left-rail / sidebar description → re-verify against v0.8.7 (Projects entry, icon changes).
- §2 composer buttons → the bar now shows **Search / File Search / Skills / MCP Servers** as pinned
  buttons (the current guide lists only paperclip/sliders/search/file-search).
- §1 welcome screenshot → re-capture if suggested-prompt cards now appear.

These can ship independently of the July 2026 deliverable.

---

## 8. Decisions

All resolved — see the **Decisions (confirmed 2026-07-20)** block at the top. Summary: title
"What's New (July 2026)"; `/guide` = selector (Option A); M365 enabled via composer → MCP Servers →
Microsoft365; chain/memory = explanation + one example each.
