# MemodoAI Tutorial — Recording Script

This is the step-by-step script behind the tutorial in `README.md` (this directory). Use it to re-record the tutorial (screenshots, video, or both) when:

- MemodoAI features change (new model, new MCP integration, UI redesign)
- A screenshot needs to be re-shot from a cleaner account
- You're producing a video walkthrough and want a shot list

Each step is structured the same way:

```
### Step N — short title
**Action:** what to click/type.
**Expected UI:** what should be visible afterwards.
**Capture:** screenshot filename and/or video chapter title.
**Notes:** edge cases, things to double-check, gotchas.
```

---

## Pre-recording checklist

1. **Browser window size**: 1440×900 (so screencap region `-R-1574,140,1440,900` matches; adjust X if Chrome is on a different monitor).
2. **Account state**: ideally a "demo" user, not an admin account, to avoid admin-only UI elements. Real chat history will be visible in the sidebar — either accept this or use a clean account.
3. **Demo agent**: confirm `Meeting Notes Polisher` exists (used in section 9). If not, recreate it from the instructions block in this script.
4. **Demo file**: the sample document at `docs/memodo-ai-tutorial/sample-q3-roadmap-memo.md` must be readable from a path the Chrome MCP can access (the project tree is fine; `/tmp` may not work due to sandboxing).
5. **MemodoAI state**: confirm
   - GPT-5 is the default model
   - Memory feature is enabled
   - MCP integrations either visible or hidden depending on what's in scope (M365 currently disabled due to v0.8.5 bridge bug)
   - No test agents are visible in the My Agents picker (`user test`, `test`, etc.)
6. **Chrome MCP**: connected and tab group created. Run `tabs_context_mcp` before any other browser action.
7. **OBS** (if recording video): scene set up to capture Chrome window only; obs-websocket plugin enabled (see "Video recording" section at the end).

---

## Section 1 — Welcome (no screenshots; intro prose only)

No captures. Just the title and the "what is MemodoAI / when to use / when not to" prose. Use the same `01-welcome-screen.png` as the closing image of section 1.

---

## Section 2 — Interface tour

### Step 2.1 — Welcome screen, clean state
**Action:** Navigate to `https://chat.memodo-eng.de/c/new`. Click somewhere neutral to dismiss any focus rings/tooltips.
**Expected UI:** "Welcome to MemodoAI" centered, empty composer, left rail visible with all icons, sidebar showing chat history.
**Capture:** `01-welcome-screen.png`
**Notes:** Don't capture if the cursor is hovering on a button (tooltip pops up). Hover at coords ~(1200, 600) to park the cursor in empty space.

---

## Section 3 — Your first conversation

### Step 3.1 — Compose a tutorial prompt
**Action:** Click into the composer. Type: *"What's the difference between OKRs and KPIs? Give me a clear explanation I can share with my team."*
**Expected UI:** Prompt visible in composer; send button is filled/active.
**Capture:** `03-message-composing.png`
**Notes:** Avoid prompts that mention real Memodo projects.

### Step 3.2 — Send and capture top of response
**Action:** Click send. Wait ~20 seconds for the response to complete.
**Expected UI:** Conversation auto-titled (e.g. "OKRs Versus KPIs"); user message at top of chat area; GPT-5 response visible starting with bullet list of "What they are" or similar.
**Capture:** `04-first-conversation.png`
**Notes:** Scroll up to ensure both the user message and start of assistant response are visible.

### Step 3.3 — Capture message action toolbar (bottom of response)
**Action:** Scroll down so the bottom of the assistant message + action icons are visible.
**Expected UI:** Seven icons: speaker (TTS), copy, edit (pencil), fork (branch), thumbs up, thumbs down, regenerate.
**Capture:** `04b-message-actions.png`

---

## Section 4 — Choosing a model

### Step 4.1 — Open model picker, MemodoAI submenu
**Action:** Click the model name button ("GPT-5") in the top bar. Hover over **MemodoAI** submenu.
**Expected UI:** Two top-level items visible (My Agents, MemodoAI); MemodoAI expanded showing GPT-5 with "GPT-5 with document upload support" subtitle and a checkmark.
**Capture:** `02-model-picker.png`

### Step 4.2 — My Agents submenu
**Action:** Hover over **My Agents** in the same picker.
**Expected UI:** Submenu shows `Memodo Engineering Concierge` (and `Meeting Notes Polisher` if recreated).
**Capture:** `02b-model-picker-my-agents.png`
**Notes:** Confirm no test agents are listed. Confirm TA Research Agent does not appear under MemodoAI.

### Step 4.3 — Close picker
**Action:** Press Escape. Click in empty chat area to defocus the model button (kills the "Select a model" tooltip).

---

## Section 5 — Presets

### Step 5.1 — Open Presets dropdown
**Action:** Click the **Presets** button (next to the model picker in the top bar).
**Expected UI:** Dropdown shows "No default preset active." and "No presets yet, use the settings button to create one."
**Capture:** `22-presets-empty.png`
**Notes:** Keep this empty in the demo account — the section is about discouraging tweaks. Press Escape to close.

---

## Section 6 — Temporary Chat

### Step 6.1 — Enable Temporary Chat
**Action:** Click the **Temporary Chat** icon in the top-right corner of the chat area (a dotted-line/broken-record style icon).
**Expected UI:** Composer gains a purple ring; tooltip "Temporary Chat" visible if cursor is still hovering.
**Capture:** `21-temporary-chat.png`

### Step 6.2 — Disable Temporary Chat
**Action:** Click the icon again to toggle off.
**Expected UI:** Purple ring disappears.

---

## Section 7 — Web Search

### Step 7.1 — Enable Search and ask a current-event question
**Action:**
1. Toggle the **Search** button (globe icon) in the composer.
2. Click into the message input.
3. Type: *"What's the weather forecast in Munich for tomorrow?"*
4. Click send. Wait 30–60 seconds — the model may run multiple web searches.

**Expected UI:** Response shows "Used N tools — Web Search" with multiple "Searched the web" entries listed, then the assistant's answer (which may include a follow-up question or partial result depending on search quality).
**Capture:** `23-web-search.png`
**Notes:** If the answer comes back empty / unhelpful, that's OK for the tutorial — it teaches users to refine queries. Alternative prompts that tend to give cleaner results: *"What's today's EUR-USD exchange rate?"* or *"Who won the most recent UEFA Champions League final?"*

### Step 7.2 — Disable Search
**Action:** Toggle the Search button off.

---

## Section 8 — File Search

### Step 8.1 — Show paperclip → Upload Image (no File Search yet)
**Action:** Click the paperclip in the composer (Attach File Options).
**Expected UI:** Single option: "Upload Image".
**Capture:** `05-attach-image-menu.png`
**Notes:** Press Escape to close.

### Step 8.2 — Enable File Search, show Upload Document
**Action:**
1. Toggle the **File Search** button in the composer (it should turn green).
2. Click the paperclip again.

**Expected UI:** Two options now: "Upload Image" and "Upload Document".
**Capture:** `06-attach-document-menu.png`

### Step 8.3 — Attach the sample document
**Action:**
1. Click **Upload Document**. A macOS file picker opens.
2. Press **Cmd+Shift+G**, paste: `/Users/pablooliva/Dev/AI dev/LibreChat/docs/memodo-ai-tutorial/sample-q3-roadmap-memo.md`
3. Press Enter, then Open.

**Expected UI:** File pill appears above the composer: "sample-q3-roadmap-m… Document".
**Capture:** `07-file-attached.png`
**Notes:** Direct file upload via the MCP `file_upload` tool fails ("Not allowed") — you must drive the macOS file picker manually OR via AppleScript.

### Step 8.4 — Ask a question about the file
**Action:**
1. Click in the composer.
2. Type: *"What are the three Q3 priorities and who owns each one? Cite the document."*
3. Click send. Wait ~20 seconds.

**Expected UI:** Conversation titled "Q3 Priorities and Owners"; response shows "Searched your files" expander followed by a bullet list of priorities with citations "(Q3 Product Roadmap Memo, July 2026)".
**Capture:** `08-file-search-response.png`

### Step 8.5 — Expand the source chunk
**Action:** Click the chevron next to "Searched your files".
**Expected UI:** Panel expands showing source filename, relevance score (e.g. "55%"), and the actual retrieved text from the document.
**Capture:** `09-file-search-source.png`

---

## Section 9 — Agents (use + build)

### Step 9.1 — Open a new chat with the Concierge
**Action:**
1. Navigate to `/c/new`.
2. Click the model picker → My Agents → **Memodo Engineering Concierge**.

**Expected UI:** Chat area shows agent landing — feather/quill icon, name, description: "Internal helper for Memodo engineers — answers handbook questions, runs quick API lookups, and drafts diagrams."
**Capture:** `10-agent-landing.png`

### Step 9.2 — Ask the Concierge an opener
**Action:** Type: *"Hi! What can you help me with? I'm new to MemodoAI."* Send. Wait ~30 seconds (the agent uses its tools).

**Expected UI:** Conversation auto-titled "MemodoAI Engineering Concierge". Top of response shows "Used 2 tools — File Search", then "Welcome, [name]! I'm your Memodo Engineering Concierge…" followed by a structured "What I can help you with" bullet list referencing internal sections (6.1, 6.2, etc.).
**Capture:** `11-agent-in-use.png` (top of response)

### Step 9.3 — Scroll to bottom of Concierge response
**Action:** Scroll down to capture the bottom half ("Quick start (today)" and "If you tell me:" sections).
**Capture:** `11-agent-response-bottom.png`
**Notes:** This image contains real internal handbook references (Tier 1, AI Register, Approved Tool Register, Shadow AI Policy, etc.). Confirm these are OK to publish or redact before final.

### Step 9.4 — Open Agent Builder with a read-only agent selected
**Action:** Click the **Agent Builder** icon (robot/grid) in the left rail while the Concierge is still the active agent.
**Expected UI:** Agent Builder panel opens with "Memodo Engineering Concierge" in the dropdown, and the message "Agent Not Available — You don't have access to edit this agent."
**Capture:** `12-agent-builder-readonly.png`
**Notes:** This is a teachable moment for users — shared agents are read-only.

### Step 9.5 — Click Create New Agent
**Action:** Click **Create New Agent** at the top of the Agent Builder panel.
**Expected UI:** Blank form: Name (required, empty), Description (optional), Category (General), Instructions (empty textarea with placeholder), Model (Select a model, empty/required), Capabilities section visible (Web Search, Artifacts toggles).
**Capture:** `13-agent-builder-blank.png`

### Step 9.6 — Fill in the form
**Action:**
1. Name: `Meeting Notes Polisher`
2. Description: `Turns rough bullet-point meeting notes into clean, structured minutes.`
3. Instructions: paste the multi-meeting-type prompt from `README.md` section 9 (the one with three branches A/B/C). For the simpler one-format version, use the original prompt instead.
4. Click "Select a model" → Provider: Azure OpenAI → Model: gpt-5 → Back arrow.

**Expected UI:** Form has all fields filled; model section shows `gpt-5` selected.
**Capture:** `14-agent-builder-filled.png`

### Step 9.7 — Click Create
**Action:** Scroll to bottom of form, click **Create**.
**Expected UI:** Green toast at top of chat area: "Successfully created Meeting Notes Polisher." Form refreshes with the new agent name in the dropdown and an `agent_*` ID under the name.
**Capture:** `15-agent-created.png`

### Step 9.8 — Use the new agent
**Action:**
1. Click **Select** next to the Create button.
2. Click "New chat" in the left rail.
3. Re-pick "Meeting Notes Polisher" from the model picker (selecting it via Agent Builder doesn't always persist across navigations).
4. Type the sample notes (single line, no newlines — newlines submit prematurely):
   `team sync mon - alex, priya, tom; launch slipping again, copy reviews from legal still pending; priya to chase legal by wed; analytics dashboard finally green, ship by fri; bug in checkout, tom investigating, no eta yet; next sprint planning thu 10am; open: do we delay launch or split into 2 phases?`
5. Send. Wait ~30 seconds.

**Expected UI:** Conversation titled "Monday Team Sync Notes". Response has Attendees / Key Decisions / Action Items (with Owner + Deadline) / Discussion Summary / Open Questions. "Updated saved memory" indicator visible above the response.
**Capture:** `16-new-agent-response.png` (top)
**Notes:** If using the multi-format version of the instructions, mention in the prompt: "treat this as a team meeting (not steering or exec)" to get reliable format selection.

### Step 9.9 — Scroll to bottom of new agent response
**Action:** Scroll down.
**Capture:** `16-new-agent-response-bottom.png`

---

## Section 9b — Artifacts

### Step 9b.1 — Show Artifacts toggles in Agent Builder
**Action:**
1. Open Agent Builder → either the Meeting Notes Polisher (now editable since you own it) or a fresh agent.
2. Scroll the form down to the **Capabilities** section, specifically the **Enable Artifacts** and **Include shadcn/ui components instructions** toggles.

**Expected UI:** The two toggles visible — `Enable Artifacts` and `Include shadcn/ui components instructions`. Default is off.
**Capture:** `26-artifacts-toggle.png`

### Step 9b.2 — Render an Artifact in a chat
**Action:**
1. Use an Artifacts-enabled agent OR enable Artifacts on a temporary one.
2. Ask: *"Make me a small interactive checklist of the action items from these meeting notes, with checkboxes and a progress counter. Use shadcn/ui."* (paste a few sample action items)
3. Wait for response.

**Expected UI:** A side-panel Artifact appears on the right with the rendered checklist (title, subtitle, progress counter, three checkable items with Owner / Due badges, Reset progress button). Code / Preview toggle in the top-left of the panel. Chat on the left shows the polished prose summary plus a small "Click to close" Artifact card.
**Capture:** `27-artifact-rendered.png`
**Notes:** Verified working on Meeting Notes Polisher with both Artifacts toggles enabled. The model auto-uses shadcn/ui styling when that toggle is on.

---

## Section 10 — Memories

### Step 10.1 — Open Memories panel
**Action:** Click the **Memories** icon (brain) in the left rail.
**Expected UI:** Panel opens showing "Filter memories…", a "+" add button, the "Use memory" toggle (checked), and a list of saved memories with key/value/timestamp.
**Capture:** `17-memories-panel.png`
**Notes:** The demo account will have at least three memories after recording section 9 (location, name, team_sync_monday). Re-shoot if confidential data appears.

### Step 10.2 — Open Edit Memory dialog
**Action:** Click the pencil icon next to the `team_sync_monday` memory.
**Expected UI:** Modal dialog "Edit Memory" with Key field (`team_sync_monday`), Value textarea, Cancel + Save buttons. Token count and creation date shown at top.
**Capture:** `18-memory-edit.png`
**Notes:** Press Cancel to close without changes.

---

## Section 11 — Prompts

### Step 11.1 — Open Prompts panel
**Action:** Click the **Prompts** icon (pencil) in the left rail.
**Expected UI:** Panel shows "Filter prompts by name", "+" button, "Send prompts on select" checkbox (default checked), and the list of existing prompts (e.g. `Pirrrate — Talk like a pirate.`).
**Capture:** `19-prompts-panel.png`

### Step 11.2 — Open Create Prompt page
**Action:** Click the "+" button.
**Expected UI:** Full-page form at `/prompts/new` with Prompt Name (required), Category dropdown, Text input with "Special variables" button, optional description and command fields.
**Capture:** `20-create-prompt.png`
**Notes:** Press back / browser back to return without creating.

---

## Section 12 — Bookmarks

### Step 12.1 — Open the Bookmark menu on an existing conversation
**Action:**
1. Navigate into any non-temporary conversation (e.g. the OKRs one from section 3).
2. Click the **Add Bookmarks** icon in the top bar of the chat area.

**Expected UI:** Small dropdown with "New Bookmark" menuitem.
**Capture:** *(optional — could be a sub-step of 24-new-bookmark)*

### Step 12.2 — Open New Bookmark dialog
**Action:** Click "New Bookmark".
**Expected UI:** Modal dialog "New Bookmark" with Title (required), Description (optional textarea), "Add to current conversation" checkbox (default checked), Cancel + Save buttons.
**Capture:** `24-new-bookmark.png`
**Notes:** Press Cancel to close without creating.

---

## Section 13 — PII warnings

### Step 13.1 — Trigger a PII warning
**Action:**
1. In a new chat (GPT-5, no agent), type a prompt with obvious fake PII. Examples:
   - *"My credit card is 4111-1111-1111-1111 and I need help drafting a refund request email."*
   - *"Help me email John Smith at john@example.com — his SSN 123-45-6789 was on the form."*
2. Click send.

**Expected UI:** Orange banner appears at the top of the screen *after the message is sent*, identifying flagged PII categories (e.g. "credit card numbers, email addresses, phone numbers"). The model still processes the message — the warning is informational, not blocking.
**Capture:** `28-pii-warning.png`
**Notes:** Verified working. Trigger reliably with: *"Help me draft a refund email. My credit card 4111-1111-1111-1111 was charged twice. Reply to john.doe@example.com or call me at 555-123-4567."* Use only clearly fake/canonical test values (4111 cards, 555 phone numbers) — never real data, even your own. If IT/Compliance changes the redakt config to *detect* mode in the future, this warning will stop appearing; re-confirm before each tutorial refresh.

---

## Section 14 — Common workflows

No new screenshots — section reuses earlier captures and describes recipes in prose.

---

## Section 15 — Tips + Account menu

### Step 15.1 — Open Account menu
**Action:** Click your avatar at the bottom-left of the screen.
**Expected UI:** Small popup menu showing your email, then: My Files, Help & FAQ, Settings, Log out.
**Capture:** `25-account-menu.png`
**Notes:** The email shown should be a service / generic account if possible. Real personal emails are fine to redact in post.

---

## Video recording with OBS

If producing a video walkthrough alongside screenshots, use OBS controlled via `obs-websocket` (built-in since OBS 28). A small Node script can:

- Start recording at the beginning of the session
- Write chapter markers ("section 3 — first conversation") to a `timestamps.log`
- Pause/resume between sections
- Stop recording at the end

See `docs/memodo-ai-tutorial/obs-recording.md` for the script proposal and setup.

**Video chapter list** (corresponds to the section structure above):

```
00:00 — Welcome
00:30 — Interface tour
01:00 — Your first conversation
02:30 — Choosing a model
03:00 — Presets (skip — show only)
03:30 — Temporary Chat
04:00 — Web Search
05:00 — File Search (chat with documents)
07:00 — Agents (using a shared agent)
08:30 — Agents (building your own)
11:00 — Artifacts
12:00 — Memories
12:30 — Prompts
13:30 — Bookmarks
14:00 — PII warnings
15:00 — Common workflows
17:00 — Tips, limits, and getting help
```

Timestamps above are rough estimates; the script in `obs-recording.md` writes real timestamps to disk as you record.

---

## Maintenance

When a section of MemodoAI changes:

1. **Update the relevant Section in this script** — change actions, expected UI, capture filenames.
2. **Mark the affected screenshots as stale** in the screenshots directory (rename with `.old.png` suffix until re-shot).
3. **Update the relevant Section in `README.md`** — change prose, references.
4. **Re-record** by walking through the affected sections of this script. Existing untouched sections stay valid.

When a *new feature* lands:

1. Add a new Section to this script in the appropriate place.
2. Add the corresponding Section to `README.md`.
3. Reserve new screenshot filenames (next available number).
4. Capture and verify.

---

*Maintained by: the same person who wrote the tutorial. Last verified against MemodoAI: 2026-05-19.*
