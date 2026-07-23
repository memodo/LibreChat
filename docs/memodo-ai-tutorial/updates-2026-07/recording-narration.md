---
purpose: TTS voiceover script for the MemodoAI "What's New (July 2026)" update video
tts-target: ~8-9 min total runtime at 150 wpm
voice-direction: warm, professional, slightly informal — a colleague showing you what changed
pace: 150 wpm; pause for commas, longer pause for em-dashes, full breath at paragraph breaks
recommended-voice: match the evergreen tutorial's voice (ElevenLabs, per tooling/tts/README.md in this folder)
---

# MemodoAI "What's New (July 2026)" — Narration Script

Source for the update video's audio track. Each `## Section` heading renders to its own MP3.
Text in `[brackets]` is an on-screen production cue, not spoken. Lines starting with `>` are
director's notes, not spoken. Timed to align with the documentary track in `recording-script.md`.

This is a **companion** to the evergreen tutorial — it assumes viewers already know the basics and
focuses only on what's new.

---

## Section 00 — Cold open

[on-screen: Welcome to MemodoAI screen]

> ~15 seconds

MemodoAI just got an update. In the next few minutes we'll cover what's new — the headline being
that MemodoAI can now work with your Microsoft 365 — plus reusable Skills, chat Projects, and a
handful of quality-of-life touches. Everything you already know still works exactly the same.

---

## Section 01 — Microsoft 365

[on-screen: composer → MCP Servers dropdown → Microsoft365; connect if needed; run profile query]

> ~120 seconds

The biggest addition: MemodoAI can now read your own Microsoft 365 — your Outlook mail, calendar,
OneDrive and SharePoint files, Excel, OneNote, tasks, and contacts — right inside a chat.

It works through what's called an MCP server — think of it as a connector that lets the assistant
reach an outside system on your behalf. You turn it on in the composer: click **MCP Servers**, and
tick **Microsoft365**.

A quick note on the connection. If you see a green dot next to Microsoft365, it's live. If it's
disconnected — which can happen when your session ages out — click the small plug icon and then
**Initialize**. A couple of seconds later it flips to Active, and you're good.

Now I'll ask something simple: "Using Microsoft 365, what is my display name and job title?" Notice
the line under the response — "Ran get-current-user in Microsoft365." That tells you exactly which
tool it used; you can click it to see more.

Three things to keep in mind. First, it runs as you — it uses your own Microsoft sign-in, so it can
only ever see what you could already see. Second, it's read-only for now: it can read your mail and
files, but it won't send, edit, or delete anything. And third, name a target — "find the ACME
contract in SharePoint" works far better than "find my important documents." Anything it reads back
still passes through the same personal-data checks as the rest of MemodoAI.

---

## Section 02 — Skills

[on-screen: `$` picker; use meeting-notes on a transcript; Skills panel; create form; detail view]

> ~135 seconds

The second big addition is Skills. A skill is a small, reusable playbook — a set of instructions
for how you handle a recurring task — that the assistant pulls in only when it's relevant, instead
of you re-typing the same guidance every time.

The clever part is that MemodoAI always knows a skill's name and one-line description, but only
loads the full instructions when a task actually matches. So the assistant can effectively "know" a
whole library of procedures without carrying all of them in every conversation.

There are two ways to use one. You can just let the assistant pick it — an enabled skill applies
automatically when your request matches its description. Or you can invoke it by name: type a dollar
sign in the message box, and a picker lists your skills. I'll pick "meeting-notes" and paste in a
rough team-sync transcript.

Look at the result — the assistant reshaped my messy notes into clean sections: attendees,
decisions, action items with owners and due dates, and open questions. That structure came from the
skill, not from me asking for it.

You manage skills from the Skills panel in the left rail — that's where you create, edit, and
organize them. To make one, click the plus and choose "Write skill instructions." Give it a name, a
description that's specific about when it should apply, and the instructions themselves in Markdown.
A pattern that works well, borrowed from the skills already in here, is three headings — "When to
use," "Procedure," and "Output format." Save it, and it's in your library.

One more thing worth knowing: skills are versioned and can be shared, so a team can build up a
trusted set of playbooks — fix a procedure once, and everyone using it gets the fix.

---

## Section 03 — Chaining and memory

[on-screen: Agent Builder → Advanced → Chain (Chain Test Primary + Uppercase Bot); then memory chat]

> ~90 seconds

Two more capabilities came with this update. The first is for people who build agents: chaining.

In the Agent Builder, under Advanced, there's a Multi-agent orchestration section with a Chain
option. It lets you run a fixed sequence of agents, one after another — the output of one feeds the
next. Here you can see a chain where a primary agent hands off to an "Uppercase Bot" that transforms
its output. It's worth reaching for when a task has genuinely distinct steps; just remember each
step adds tokens and time, so most everyday tasks don't need it.

The second is memory — and this one's for everyone. MemodoAI can now actively remember things you
tell it. Watch: I'll say, "From now on, remember that I'm on the Frontend team and I prefer concise,
bulleted answers." The assistant confirms what it saved, right there in its reply. Those items now
live in your Memories panel — the brain icon in the left rail — where you can read, edit, or delete
them. It's tied to your account only, and there's a toggle to turn it off whenever you want. There's
nothing to set up; it just works wherever you chat.

---

## Section 04 — Projects

[on-screen: New project → name → Create → project page]

> ~30 seconds

If your chat history is getting long, Projects will help. You can now group related conversations
into project folders, shown at the top of the sidebar. Click "New project," give it a name, and
you've got a home for, say, all your Q3 planning chats. Think of Projects as folders that group
conversations — where Bookmarks, which you already have, are tags you apply across them.

---

## Section 05 — Quality-of-life upgrades

[on-screen: hover context circle; upload an Office file to show the preview card; message timestamp]

> ~60 seconds

A few smaller touches you'll notice as you work.

There's a new context meter — the little circle in the message bar. Hover it and you'll see how full
the model's context window is for the current chat. It's a usage gauge, not a bill — it shows how
much room is left, not a cost. When a long chat starts to fill up, that's a good moment to start a
fresh one.

Office files look better too. When you attach a Word doc, a spreadsheet, a slide deck, or a CSV, it
now shows as a proper preview card rather than a plain download link.

And a couple of little things: new conversations get a title immediately instead of after the first
reply, and hovering any message shows you when it was sent.

---

## Section 07 — Wrap-up

[on-screen: outro card with logo + CTA]

> ~25 seconds

That's what's new. If you want a refresher on the basics — the model picker, file search, building
agents — the main Getting Started guide covers all of that, and none of it changed.

The one thing to try first is Microsoft 365: turn it on from the MCP Servers menu, and ask about
your inbox or your calendar. Just remember it's read-only, and it works best when you tell it exactly
what to look for. If anything's not behaving, reach out to your AI or IT champion. Thanks for
watching.

---

*Roughly 8-9 minutes of audio at 150 words per minute. Adjust phrasing to fit the documentary track
pacing. Note: code-as-artifacts is deliberately not covered — it isn't available in our deployment.*
