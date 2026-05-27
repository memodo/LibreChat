---
purpose: TTS voiceover script for the MemodoAI tutorial video
tts-target: ~22 min total runtime at 150 wpm
voice-direction: warm, professional, slightly informal — like a colleague walking a new hire through the product
pace: 150 wpm; pause for commas, longer pause for em-dashes, full breath at paragraph breaks
recommended-voice: OpenAI tts-1-hd / nova
---

# MemodoAI Tutorial — Narration Script

This file is the source for the audio track. Each `## Section N` heading is a unit that the TTS script renders into its own MP3 file. Anything in `[brackets]` is an on-screen production cue, not spoken. Any line starting with `>` is a director's note, also not spoken.

The voiceover is timed to align with the **documentary track** captured per `recording-script.md`. When recording the documentary track, take your time on each step — the audio will be slip-edited to match in post.

---

## Section 00 — Cold open

[on-screen: MemodoAI welcome screen, then logo zoom]

> ~10 seconds

Welcome to MemodoAI. In the next twenty minutes or so, we'll walk through everything you need to be productive on your first day — the basics, the few features that surprise people, and the workflows that actually pay off once you've used it for a week.

---

## Section 01 — Welcome

[on-screen: 01-welcome-screen.png — main UI, sidebar visible]

> ~45 seconds

MemodoAI is Memodo's internal AI workspace. If you've used ChatGPT or Claude before, this will feel familiar. The main difference: it runs on infrastructure we control, so internal data stays inside Memodo's environment.

You can use it for the obvious things — drafting emails, summarizing documents, explaining unfamiliar concepts, polishing rough notes. And for a few less-obvious things: chatting with your own files, building small agents tailored to a recurring task, and rendering interactive artifacts inline in the chat.

Two ground rules before we dive in. MemodoAI is great at being a fast first drafter. It is not a source of truth. Always check facts that matter. And: when you're working with sensitive data, the principle of "use the minimum you need" still applies. We'll come back to this when we talk about PII warnings later.

---

## Section 02 — Interface tour

[on-screen: hover over each left-rail icon as it's mentioned]

> ~60 seconds

The interface has three regions, left to right.

On the far left is a column of icons — your control panel. From top to bottom: open or close the sidebar, start a new chat, your chat history, the agent builder, prompts, memories, bookmarks, attach files, parameters, and at the very bottom your account avatar. Hover over any of them to see its name.

To the right of those icons is the conversation sidebar, where your past chats are grouped by recency — today, the last seven days, the last thirty days.

And the big middle column is where you actually work. The top bar shows the active model or agent. The composer at the bottom is where you type. The composer has four buttons that shift its behavior — a paperclip for attaching files, a sliders icon for tweaking parameters, a search button for the web, and a file search button for chatting with documents. We'll touch each of these in turn.

---

## Section 03 — Your first conversation

[on-screen: type OKR prompt, send, capture response]

> ~90 seconds

Let's send our first message. The default model is GPT-5, and unless you have a reason to change it, that's the right choice for almost everything.

I'll type a question — something you might actually ask on a workday. "What's the difference between OKRs and KPIs? Give me a clear explanation I can share with my team."

I'll send that. Notice the conversation auto-titles itself once the model finishes — it picks something descriptive based on the content. You can always rename it manually by hovering over the title in the sidebar.

Now under each assistant response, you'll see a row of icons. From left to right: read aloud, copy, edit, fork — which means continue from this point in a new branch of the conversation — thumbs up, thumbs down, and regenerate.

One quick tip while we're here. If you don't like a response, it's almost always better to edit your original message and re-send than to argue with the model in a follow-up. Click the pencil icon on your own message, refine the question, and you'll get a cleaner answer in fewer turns. Same conversation, less noise.

---

## Section 04 — Choosing a model

[on-screen: open model picker, hover MemodoAI submenu, then My Agents submenu]

> ~45 seconds

Click the model name in the top bar to open the picker. You'll see two groups.

The first is MemodoAI — that's the base models available in your instance. Right now that's GPT-5, with document upload support.

The second is My Agents — these are pre-configured assistants that you or a colleague have built. Picking one of these from the model picker is the fastest way to start a chat with that agent.

The rule of thumb for which to pick: leave it on GPT-5 unless you're doing something an agent was specifically built for — like asking the Memodo Engineering Concierge a handbook question, or running rough meeting notes through the Meeting Notes Polisher.

---

## Section 05 — Presets vs agents

[on-screen: click Presets dropdown, show empty state]

> ~60 seconds

There are two things in MemodoAI that look similar but solve different problems. Presets and agents.

Presets are saved bundles of model parameters — things like temperature, max tokens, frequency penalty. They live behind the Presets button next to the model picker. The defaults that MemodoAI ships with have been chosen for sensible behavior. Unless you have a specific reason to tweak them, leave them alone. Changing temperature without a clear hypothesis usually makes the model worse, not better.

Agents, on the other hand, are full personas. They have a name, an icon, a system prompt that defines how they behave, and optional tools. Use an agent when the same role keeps coming up. We'll build one in a few minutes.

The short version: presets are an advanced power-user feature. Ignore them if you're new. Agents are what you'll actually use day to day.

---

## Section 06 — Temporary Chat

[on-screen: click Temporary Chat icon top-right, show purple ring]

> ~30 seconds

That dotted icon in the top-right corner toggles Temporary Chat mode. When it's on, the composer gets a purple ring — and the conversation is not saved to your history. Use this for one-off questions you don't want sitting in your sidebar. Quick definitions, throwaway brainstorms, sensitive drafts. Closing the tab also ends it. Anything you send in Temporary Chat is gone the moment the chat closes.

---

## Section 07 — Web Search

[on-screen: toggle Search, type weather query, send, capture multiple search calls]

> ~60 seconds

The model is trained on data that's months old by the time you're using it. To pull in fresh information, toggle the Search button on — it's the globe icon in the composer.

I'll ask a question that needs current data. The model decomposes the question into multiple web searches automatically. You'll see a "Used N tools" indicator at the top of the response — click it to see exactly what the model searched for and what it found.

Search is great for anything time-sensitive — pricing, news, current versions, recent events. It struggles with very specific local data, niche corporate information, and anything behind a paywall. If a search comes back unclear, the model will usually offer to refine. Guide it: name a source, narrow the scope, or specify what kind of answer you want.

---

## Section 08 — File Search

[on-screen: toggle File Search, paperclip menu, upload sample memo, ask question, expand sources]

> ~120 seconds

This is one of the most useful features in MemodoAI. You attach a document, ask questions about it, and the model answers with citations back to the source.

Step one: turn on File Search. Click the toggle in the composer. Without this, the paperclip only lets you upload images.

Step two: attach the document. Click the paperclip — now you have two options. Pick Upload Document. MemodoAI supports the formats you'd expect from a modern office workflow: PDFs, Word documents, Markdown, plain text, CSVs, spreadsheets, slide decks, and most common source code formats. There's a size limit around twenty-five megabytes per file. If a file gets rejected, split it first.

Step three: ask. I'm going to ask: "What are the three Q3 priorities and who owns each one? Cite the document."

Notice the response. Each claim is tied back to the source — that's the citation behavior. And the "Searched your files" expander shows the actual chunks of the document the model read. You can verify any claim by clicking through.

Two things to know. One — you can attach multiple documents to one chat. The model will search across all of them. Two — for long documents, ask focused questions. "Who owns Priority 2" is much better than "Tell me about this doc." The narrower your question, the better the citation behavior.

---

## Section 09 — Agents

[on-screen: open Concierge agent landing, send opener, then Agent Builder, Create New Agent, fill form, save, use new agent]

> ~180 seconds

Agents are pre-configured assistants someone built for a specific job. They have a name, an icon, a system prompt, and optionally some tools wired up like file search or web search.

Let's start by using a shared agent. From the model picker, I'll pick Memodo Engineering Concierge. The chat area changes to show the agent's landing page — its name, its icon, and a short description of what it's for.

When I send a message, the agent uses its tools to find an answer. Notice the "Used N tools" line at the top of the response — same idea as web search, just with the agent's own tools. Agents that have been built by other people, like this one, are read-only. You can use them but not edit their instructions.

Now let's build our own. I'll open the Agent Builder — that's the robot icon in the left rail. If I had a read-only agent selected, I'd see a "You don't have access to edit this agent" message. That's fine — I'll click Create New Agent at the top.

The blank form has fields for the name, a short description, the category, the instructions — which is the system prompt — the model, and the capabilities. The instructions are the heart of an agent. Be specific: what input it expects, what output it should produce, what tone to use, and what it must not do.

For our example, I'll create a Meeting Notes Polisher. It takes rough bullet-point notes and produces clean structured minutes. The system prompt tells it exactly what sections to include — attendees, key decisions, action items, discussion summary, open questions. It tells it to mark missing fields as TBD. And critically, it forbids inventing facts that aren't in the source.

I'll pick GPT-5 as the model — Azure OpenAI as the provider. Click Create.

Now I can use it. I'll start a new chat with the Meeting Notes Polisher and paste in some rough notes. The agent follows its instructions exactly — structured sections, owners and deadlines extracted, TBD where the source didn't specify, no invented facts.

Three rules for writing good agent instructions, by the way. One — describe input and output explicitly. The model follows shape more reliably than vibes. Two — forbid the failure modes. "Never invent facts not in the source" is more important than describing what right looks like. Three — set the tone in one sentence. The model will hold the tone if you tell it once.

---

## Section 09b — Artifacts

[on-screen: Agent Builder Capabilities, Enable Artifacts toggle, then prompt with visual ask, side-panel render]

> ~75 seconds

There's one more agent capability worth showing — Artifacts. When you ask MemodoAI for something visual — a chart, a small UI mockup, a styled table, an interactive widget — the result can be rendered as an artifact: a self-contained interactive panel that appears next to the chat instead of as a plain code block.

To use it, the agent needs Artifacts enabled. In the Agent Builder, scroll the Capabilities section. You'll see two toggles — Enable Artifacts, and Include shadcn UI components instructions. The second toggle tells the agent about a popular component library so its artifacts look cleaner.

Once enabled, ask for something visual. I'm going to ask the Meeting Notes Polisher to render the action items as an interactive HTML checklist with checkboxes, owner labels, and a progress counter at the top.

There it is — a side-panel artifact, fully interactive. I can check items off, the progress counter updates, and I can switch between the rendered preview and the underlying code with the toggle at the top.

Artifacts are best for one-off prototypes and visual answers. The state inside an artifact isn't saved — if you check items off, that's just for the current view. To capture a moment, take a screenshot.

---

## Section 10 — Memories

[on-screen: open Memories panel, show entries, edit team_sync_monday]

> ~60 seconds

MemodoAI remembers context across chats so you don't have to keep re-introducing yourself. Things like your name, your role, ongoing projects you mentioned, recurring people you work with — these get quietly saved.

Click the brain icon in the left rail to see what's saved. Each memory has a key, a short identifier; a value, the actual content; a token count; and a date. You can edit any of them by clicking the pencil icon, or delete with the trash icon.

The Use Memory toggle at the top of the panel controls whether the model has access to memories during your chats. Turn it off if you want the model to behave like it's never met you — useful for testing prompts.

Two things to know. Memories are tied to your account only — nobody else can see them. And anything you don't want stored, you can delete in one click. The trash icon is fast.

---

## Section 11 — Prompts

[on-screen: open Prompts panel, then Create Prompt page]

> ~45 seconds

The Prompts panel — that's the pencil icon in the left rail — is a personal library of reusable prompts. Things you find yourself typing repeatedly. "Translate this to German, formal tone." "Summarize this email in three bullets." "Convert this rough text into a Slack-ready announcement."

Click the plus to create one. You give it a name, optionally a category, the prompt text itself, and optionally a slash command that triggers it. With "Send prompts on select" checked at the top of the panel, clicking a saved prompt sends it immediately.

The rule of thumb: a prompt is a one-shot instruction. An agent is an ongoing persona. If you find yourself selecting the same prompt every day, that's a sign it should be promoted to an agent instead.

---

## Section 12 — Bookmarks

[on-screen: open conversation, click bookmark icon, New Bookmark dialog]

> ~30 seconds

Bookmarks are tags you can apply to conversations to find them later — useful once you have a long chat history. Open any conversation, click the bookmark icon in the top bar, then New Bookmark. Give it a title — typically a category like "Project X" or "Reference" — and optionally a description. The "Add to current conversation" checkbox tags this chat with the bookmark on the spot.

---

## Section 13 — PII warnings

[on-screen: type prompt with fake PII, send, capture warning banner]

> ~90 seconds

One more thing worth understanding before you start using MemodoAI for real work. The PII warning.

MemodoAI scans your messages for things that look like personal or sensitive data. Credit card numbers, social security numbers, email addresses, phone numbers, addresses, financial identifiers. If the detector finds something, you'll see an orange banner at the top of the screen calling it out.

I'll demonstrate with a clearly fake test prompt. Notice when I send this — there's the banner. "Your message appears to contain personal information." It identifies the categories that were flagged.

A few important things to know. One — this is a heads-up, not a hard stop. The message still goes to the model. So if you notice mid-send that you shouldn't have included something, use the Stop generating button in the composer to halt the response, then delete the conversation if needed.

Two — the detector isn't perfect. It can flag things that aren't really PII, and it can miss things that are. Treat it as a safety net, not a checkpoint. You're still responsible for what you send.

Three — under the hood, this is powered by Memodo's PII detection service, redakt. Compliance can adjust its sensitivity. If you're not sure how strict it is in your context, ask your IT champion.

The simple version: when the banner appears, stop and read it. Most of the time you'll want to edit the message and re-send with placeholders instead of real data.

---

## Section 14 — Common workflows

[on-screen: brief reuse of earlier captures — File Search, Meeting Notes Polisher, Search]

> ~90 seconds

Let's pull this together with a few concrete workflows you can copy directly.

Workflow one. You want to summarize a long document. Turn on File Search, attach the file, then ask for a one-paragraph executive summary followed by a bullet list of the top risks or decisions, with citations. If a bullet looks fuzzy, expand the "Searched your files" panel to verify the source. Then ask follow-up questions tied to specific sections.

Workflow two. You want to clean up rough meeting notes. From the model picker, pick the Meeting Notes Polisher. Paste your notes — bullet points, fragments, whatever you have. Review the output. Anything marked TBD is something the agent couldn't find — fill it in by replying with the missing info or editing your original message.

Workflow three. You need an answer that depends on current data. Turn on Search. Ask the question naturally. Check the "Used N tools" panel to see where the model pulled from. If a number seems off, ask the model to explain where it got it from.

Workflow four — and this is the most useful one over time. If you find yourself typing variants of the same prompt every few days, it's time for an agent. Open the Agent Builder, write five or ten lines of instructions describing input shape, output shape, the tone, and the one or two things the agent must not do. Pick GPT-5. Save, test, refine, save again. Three iterations is normal.

---

## Section 15 — Tips, limits, and getting help

[on-screen: account menu open showing My Files, Help & FAQ, Settings]

> ~60 seconds

A few quick principles before we wrap up.

Be specific. "Make this professional" is vague. "Rewrite this email so it sounds direct but warm, three short paragraphs, no greeting" is actionable. The model follows shape better than vibes.

Edit before you re-ask. Re-sending a slightly clearer prompt almost always beats trying to steer the model through a long follow-up.

The model can be wrong. Always check facts that matter. The model is a very fast drafter, not an oracle.

Sensitive data: stick to the minimum you need. If a task doesn't need a real name or a real number, redact first. The PII warning is a safety net, not a replacement for thinking.

And finally, where to get help. Click your avatar at the bottom-left of the screen. The account menu has My Files for everything you've uploaded, Help and FAQ for the upstream documentation, and Settings for UI preferences like language and theme.

For Memodo-specific questions — a custom agent isn't behaving, you want to share an agent with the team, you've found a bug — reach out to your AI or IT champion. Or ask the Memodo Engineering Concierge agent directly.

---

## Section 99 — Outro

[on-screen: outro card with logo + CTA]

> ~15 seconds

That's the tour. Open MemodoAI, try a few things, and don't be shy about building your own agents — that's where the real time savings live. Thanks for watching.

---

*This script should produce roughly 22 minutes of audio at 150 words per minute. Adjust phrasing to fit the documentary track pacing as needed.*
