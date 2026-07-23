# MemodoAI "What's New (July 2026)" — Recording Script

Step-by-step shot list behind `updates-july-2026.md` (this directory). This is a **standalone
update video** — this `updates-2026-07/` folder is **self-contained** (its own shot list, narration,
screenshots, and tooling), separate from the evergreen tutorial. It covers only
what changed in the July 2026 update (v0.8.5 → v0.8.7-rc1 + Microsoft 365). Use it to record the
documentary track and to re-shoot screenshots.

Each step is structured the same way as the evergreen script:

```
### Step N — short title
**Action:** what to click/type.
**Expected UI:** what should be visible afterwards.
**Capture:** screenshot filename and/or video chapter title.
**Notes:** edge cases, gotchas.
```

> Screenshots referenced below live in `updates-2026-07/screenshots/` and were captured live on
> chat-test 2026-07-21. `13-code-artifact` is intentionally absent — code-as-side-panel-artifacts is
> **not available** in our deployment (no model/endpoint carries the Artifacts capability), so it is
> out of scope for this video.

---

## Pre-recording checklist

1. **Browser window size**: 1440×900 (matches the captured screenshots).
2. **Sign-in**: you must be signed in **via Microsoft (Entra SSO)** — required for the Microsoft 365
   chapter. (Microsoft SSO is the only login method, so this is normally already the case.)
3. **Microsoft 365 connection**: the `Microsoft365` MCP server **lazy-connects**. On a fresh session
   it shows a gray dot + a plug icon (disconnected); be ready to click the plug → **Initialize** to
   bring it to **Active** (green dot) before demoing a query. See Chapter 1.
4. **Demo skill**: confirm a skill named `meeting-notes` exists with a **When to use / Procedure /
   Output format** body (used in Chapter 2). If not, create it via Step 2.4.
5. **Demo chained agent**: confirm the `Chain Test Primary` agent exists with `Uppercase Bot` chained
   under it (used in Chapter 3). If not, build a two-agent chain first.
6. **Sidebar / privacy**: real chat titles are visible in the sidebar. For clean menu shots, **collapse
   the sidebar** (top-left toggle) — the composer/menus are the subject in most chapters. (The
   colleague-named test chats were removed 2026-07-21.)
7. **Sample file**: have `MemodoAI-sample-roadmap.xlsx` (or any DOCX/XLSX/PPTX/CSV) ready for the file
   preview in Chapter 5.
8. **Chrome MCP**: connected, tab group created; run `tabs_context_mcp` first. OBS scene set to the
   Chrome window only.
9. **Composer gotcha**: after clicking into the message box, the *first* keystroke sometimes doesn't
   register — click directly in the input and verify text appears before continuing (especially for
   the `$` skill trigger).

---

## Chapter 0 — What changed (cold open; no captures)

Intro prose only (see narration Section 00/01). One line on the two big additions — Microsoft 365
and Skills — and that everything users already know still works. Optionally open on the
`Welcome to MemodoAI` screen.

---

## Chapter 1 — Microsoft 365

### Step 1.1 — Open the MCP Servers menu
**Action:** New chat (`/c/new`), GPT-5. Click **MCP Servers** in the composer button row (next to
Search and File Search).
**Expected UI:** Dropdown listing **Microsoft365** with a small status dot on its icon and a checkbox.
**Capture:** `01-m365-tools-menu.png` — video chapter "Microsoft 365".
**Notes:** If the dot is **green**, it's connected — skip to Step 1.3. If it's **gray** with a plug
icon, do Step 1.2 first.

### Step 1.2 — Connect (if disconnected)
**Action:** Click the **plug icon** next to Microsoft365. In the dialog ("Microsoft365 MCP Server —
Disconnected"), click **Initialize**. Wait ~2–3 s.
**Expected UI:** Dialog flips to "**Active**" with a green dot; the Microsoft365 checkbox becomes
ticked.
**Capture:** `03-m365-reconnect.png` (the plug/disconnected state), `03b-m365-initialize.png` (the
Initialize dialog).
**Notes:** This is the same flow users follow if the connection drops mid-session. Close the dialog
(X) when Active.

### Step 1.3 — Enable and ask a (low-sensitivity) question
**Action:** Ensure **Microsoft365** is ticked. Click into the composer, type:
*"Using Microsoft 365, what is my display name and job title?"* Send. Wait ~7 s.
**Expected UI:** A tool indicator **"Ran get-current-user in Microsoft365"** under the assistant
name, then the profile answer (display name + job title).
**Capture:** `02-m365-in-use.png` — video chapter continues "Microsoft 365".
**Notes:** Keep the demo query low-sensitivity (profile only) — a mail/calendar query would put real
inbox content on screen. Narration should stress: **read-only**, runs **as you**, and **name a target**
(sender/folder/keyword) for mail/file questions. `02` shows the operator's own name/title — redact in
post if desired.

---

## Chapter 2 — Skills

### Step 2.1 — Invoke a skill by name (the `$` picker)
**Action:** New chat. Click into the composer, type **`$`**.
**Expected UI:** A **"Select a Skill by name"** popover listing your skills with their descriptions
(e.g. `end-message`, `meeting-notes`).
**Capture:** `04-skills-menu.png` — video chapter "Skills".
**Notes:** If the popover doesn't appear, the first keystroke didn't register — click the input and
retype `$`.

### Step 2.2 — Use a skill on a sample input
**Action:** Select **meeting-notes** from the picker. Type a short **fabricated** transcript, e.g.:
*"Team sync, July 21. Attendees: Alex Chen, Sam Rivera, Jordan Lee. We decided to ship the login
bugfix on Friday. Alex will update the API docs by Thursday. Sam raised a concern about rate limits.
Open question: do we need a data migration before launch?"* Send. Wait ~12 s.
**Expected UI:** A **meeting-notes** chip on the user message; a **"Used 2 tools — skill"** indicator;
structured output — Attendees / Decisions / Action Items (owner + due) / Open Questions / Discussion
Summary.
**Capture:** `07-skills-in-use.png` (top: chip + indicator + first sections), `07b-skills-output.png`
(scrolled: full structured body).
**Notes:** Fabricated names only — no real data. A **Skills** button appears in the composer once a
skill is active (it's conditional; not present in a fresh chat).

### Step 2.3 — Open the Skills panel
**Action:** Click the **Skills icon** in the left rail.
**Expected UI:** A "Skills" panel with **My Skills** (your skills listed), a **+** button, and an
**Admin Settings** entry.
**Capture:** (context shot; the panel is also visible in `05-skills-detail.png`).

### Step 2.4 — Create a skill
**Action:** In the Skills panel, click **+** → **Write skill instructions**. Fill **Name** (e.g.
`warranty-claim`), **Description** (be specific about *when* it applies), and **Instructions**
(Markdown; use the **When to use / Procedure / Output format** pattern). Click **Create**.
**Expected UI:** The "Write skill instructions" dialog with the three fields; new skill appears under
My Skills after Create.
**Capture:** `06-skills-create.png`.
**Notes:** For recording, you can **Cancel** instead of Create to avoid making a real skill (the form
shot is what matters). The alternative "+ → Upload a skill" imports a prepared skill file/bundle.

### Step 2.5 — Show a skill's detail view
**Action:** Click an existing skill (e.g. `meeting-notes`) in the panel.
**Expected UI:** Detail view: name, author + date, **enable toggle**, **share**, **Edit**, delete, and
the Markdown body (When to use / Procedure / Output format). Editing rolls a new **version**; a
**Category** can be assigned.
**Capture:** `05-skills-detail.png`.

---

## Chapter 3 — Chaining & Memory

### Step 3.1 — Agent chaining
**Action:** Open **Agent Builder** (left rail). Select the **Chain Test Primary** agent (or Create New
Agent). Click **Advanced** → scroll to **Multi-agent orchestration** → **Chain**.
**Expected UI:** The **Chain** section ("Run a fixed sequence of agents, one after another"), showing
`Chain Test Primary` with **Uppercase Bot** chained under it (1 / 10), plus an **Add agent** control.
(Also visible: **Handoffs [BETA]** and the **Agent skills** toggle.)
**Capture:** `08-chain-config.png` — video chapter "Chaining & Memory".
**Notes:** Optionally send a message to the chained agent to show the sequence running (Uppercase Bot
transforms the output). Narration: chaining runs agents in sequence; use it for genuinely multi-step
tasks; it costs more tokens/latency.

### Step 3.2 — Memory (the assistant saves what you tell it)
**Action:** New chat, GPT-5. Type: *"From now on, please remember that I'm on the Frontend team and I
prefer concise, bulleted answers."* Send. Wait ~6 s.
**Expected UI:** The assistant confirms in its reply — *"Saved: You are on the Frontend team.",
"Saved: Prefer concise, bulleted answers."* (chat auto-titles "Frontend Team Preferences").
**Capture:** `09-memory-updated.png`.
**Notes:** There is **no separate "memory updated" badge** — the save is narrated in the reply. The
saved items appear in the **Memories panel** (brain icon), where they can be edited/deleted; the
**personalize/memory toggle** controls it. This **writes to the operator's real memory store** — delete
the two test entries afterward. No per-agent memory toggle exists.

---

## Chapter 4 — Projects

### Step 4.1 — Create a project
**Action:** In the sidebar under **Projects**, click **New project**. Name it (e.g. `Q3 Planning`).
Click **Create project**.
**Expected UI:** The project appears under **Projects** in the sidebar and opens its page: title,
"**New chat in [project]**", "Chats 0 / No chats yet".
**Capture:** `10-projects-sidebar.png` — video chapter "Projects".
**Notes:** Narration: Projects = folders that *group* related chats; Bookmarks = *tags* across chats.

---

## Chapter 5 — Quality-of-life upgrades

### Step 5.1 — Context-usage meter
**Action:** In any chat with at least one exchange, **hover the open circle** in the composer (right
side, left of the mic).
**Expected UI:** A popover: **"Context — [used] / [window] ([%])"** (e.g. "Context 1k / 361k (0%)").
**Capture:** `11-context-usage-meter.png` — video chapter "Quality-of-life".
**Notes:** Token counts only — **no monetary cost** shown (by config). The thread need not be long.

### Step 5.2 — Rich Office file preview
**Action:** Toggle **File Search** on. Attach an Office file (`MemodoAI-sample-roadmap.xlsx`) via the
paperclip → Upload Document (operator drives the OS file picker), **or** use the `file_upload` MCP tool
against the hidden file input.
**Expected UI:** The file shows as a **typed preview card** above the composer (icon + "Spreadsheet"),
not a plain download link.
**Capture:** `12-office-preview.png`.
**Notes:** DOCX / XLSX / PPTX / CSV all get a typed preview card.

### Step 5.3 — Message timestamps
**Action:** Open a chat; observe the timestamp next to the assistant name (e.g. "16 minutes ago") or
hover a message.
**Expected UI:** A relative timestamp next to the sender name.
**Capture:** `14-message-timestamp.png`.

### Step 5.4 — Instant titles (no dedicated capture)
**Action:** Start a new chat and send any message.
**Expected UI:** The conversation title appears **immediately** (not after the reply finishes).
**Notes:** Narration cue only — mention it while another action is on screen.

---

## Chapter 7 — Wrap-up (no captures)

Pointer back to the evergreen guide for the basics; remind users M365 is read-only and works best with
a named target; where to get help. See narration Section 07.

---

## Video recording with OBS

OBS captures the Chrome window; the operator starts/stops recording by hand while the browser is
driven through the chapters above. Record each chapter with a little padding before/after for clean
slip-editing. The full pipeline (narration render, transcript, assembly, transcode) is in this
folder's `README.md`; the evergreen `../obs-recording.md` has an optional scripted-OBS proposal.

**Video chapter list** (rough estimates; a fresh standalone cut, ~8–10 min):

```
00:00 — What changed
00:40 — Microsoft 365
02:40 — Skills
05:00 — Chaining & Memory
06:30 — Projects
07:10 — Quality-of-life upgrades
08:40 — Wrap-up
```

Produce EN + DE transcripts and a `chapters.json` for the `/guide` selector (see the plan file §4–5).

---

## Maintenance

When a July-2026 feature changes: update the matching Chapter here, mark affected screenshots stale,
update `updates-july-2026.md`, and re-record only the affected chapter. When code-as-artifacts becomes
available (a model/endpoint with the Artifacts capability), add a chapter + `13-code-artifact.png`.

---

*Grounded in live flows performed on chat-test 2026-07-21. Screenshots `01`–`12`, `14` captured.*
