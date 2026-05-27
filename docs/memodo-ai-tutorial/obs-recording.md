# Video recording via OBS WebSocket — proposal

A short proposal for recording a video companion to the MemodoAI tutorial, controlled programmatically so the recording stays in sync with the screenshot script and can be re-run cleanly when features change.

## Goal

Produce a `.mkv` or `.mp4` video walkthrough that:

- Captures the Chrome window only (not the whole desktop, no menu bar, no notifications)
- Is driven from the same script that walks through tutorial sections (so the video and the written guide stay in lockstep)
- Writes a `timestamps.log` with named chapter markers ("Section 3 — first conversation", etc.), so editing in post is just cuts at those marks
- Can be re-run end-to-end when MemodoAI updates, without re-thinking how to record

## Approach

OBS Studio 28+ ships with `obs-websocket` v5 built in. It exposes a WebSocket API at `ws://localhost:4455` that lets external scripts:

- Start / stop / pause recording
- Switch scenes
- Read recording status, file paths, timestamps

We control it with a small Node.js (or Python) script. The same script can be invoked by Claude during a capture session — one call per section transition.

## Prerequisites

1. **OBS Studio 28+** installed on the machine that will do the recording.
2. **`obs-websocket` enabled**: OBS → Tools → WebSocket Server Settings → check "Enable WebSocket server" → note port (default 4455) and password.
3. **OBS scene set up** before recording:
   - A "Window Capture" source pointing at the **Google Chrome** window only (not "Display Capture").
   - Output settings: MKV recording (more recoverable on crash), or MP4 if you prefer.
   - Output resolution matched to Chrome (1440×900 for our tutorial); downscale to 1080p in post if needed.
4. **Node.js 20+** and the `obs-websocket-js` package installed in this repo. Drop the package into a small standalone folder so it doesn't pollute the LibreChat monorepo:
   ```bash
   mkdir -p docs/memodo-ai-tutorial/tooling/obs-recorder
   cd docs/memodo-ai-tutorial/tooling/obs-recorder
   npm init -y
   npm install obs-websocket-js
   ```

## The script — `docs/memodo-ai-tutorial/tooling/obs-recorder/record.js`

A minimal CLI that supports four commands: `start`, `mark`, `pause/resume`, `stop`.

```js
#!/usr/bin/env node
// docs/memodo-ai-tutorial/tooling/obs-recorder/record.js
//
// Usage:
//   node record.js start
//   node record.js mark "Section 3 — first conversation"
//   node record.js pause
//   node record.js resume
//   node record.js stop
//
// All commands append to ./timestamps.log next to the script.

import OBSWebSocket from 'obs-websocket-js';
import fs from 'node:fs';
import path from 'node:path';

const WS_URL = process.env.OBS_WS_URL || 'ws://localhost:4455';
const WS_PASSWORD = process.env.OBS_WS_PASSWORD || '';
const LOG_PATH = path.resolve(process.cwd(), 'timestamps.log');

const obs = new OBSWebSocket();
const [cmd, ...rest] = process.argv.slice(2);

function logEntry(event, detail = '') {
  const line = `${new Date().toISOString()}  ${event}${detail ? '  ' + detail : ''}\n`;
  fs.appendFileSync(LOG_PATH, line);
  process.stdout.write(line);
}

async function withConnection(fn) {
  await obs.connect(WS_URL, WS_PASSWORD);
  try { await fn(); } finally { await obs.disconnect(); }
}

const commands = {
  async start() {
    await withConnection(async () => {
      const { outputActive } = await obs.call('GetRecordStatus');
      if (outputActive) return logEntry('start-skipped', 'already recording');
      await obs.call('StartRecord');
      logEntry('start');
    });
  },

  async mark() {
    const label = rest.join(' ').trim() || '(unlabeled)';
    await withConnection(async () => {
      const { outputTimecode } = await obs.call('GetRecordStatus');
      logEntry('mark', `${outputTimecode}  ${label}`);
    });
  },

  async pause() {
    await withConnection(async () => {
      await obs.call('PauseRecord');
      logEntry('pause');
    });
  },

  async resume() {
    await withConnection(async () => {
      await obs.call('ResumeRecord');
      logEntry('resume');
    });
  },

  async stop() {
    await withConnection(async () => {
      const { outputPath } = await obs.call('StopRecord');
      logEntry('stop', outputPath ?? '(unknown path)');
    });
  },
};

const run = commands[cmd];
if (!run) {
  console.error(`Unknown command: ${cmd}. Use start | mark | pause | resume | stop.`);
  process.exit(1);
}

run().catch((err) => {
  logEntry('error', err.message);
  process.exit(2);
});
```

Set the WebSocket password as an env var so it doesn't end up in source:

```bash
export OBS_WS_PASSWORD='your-obs-websocket-password'
```

## How I'd drive it during a capture session

The same flow that produced the screenshots becomes a recording flow. Each call into the Chrome MCP is bracketed by a `record.js mark` for the corresponding section. In practice, my driver would do something like:

```bash
# 1. Start recording
node docs/memodo-ai-tutorial/tooling/obs-recorder/record.js start

# 2. Mark section transitions as I walk through the script
node docs/memodo-ai-tutorial/tooling/obs-recorder/record.js mark "Section 2 — Interface tour"
# ... drive Chrome MCP to navigate, capture, click ...

node docs/memodo-ai-tutorial/tooling/obs-recorder/record.js mark "Section 3 — Your first conversation"
# ... type prompt, send, wait for response ...

node docs/memodo-ai-tutorial/tooling/obs-recorder/record.js mark "Section 8 — File Search"
# ... upload sample doc, ask question ...

# 3. Stop at the end
node docs/memodo-ai-tutorial/tooling/obs-recorder/record.js stop
```

The output: one continuous `.mkv` file and a `timestamps.log` like:

```
2026-05-19T16:00:00.000Z  start
2026-05-19T16:00:12.341Z  mark  00:00:12  Section 2 — Interface tour
2026-05-19T16:00:48.812Z  mark  00:00:48  Section 3 — Your first conversation
2026-05-19T16:03:14.605Z  mark  00:03:14  Section 4 — Choosing a model
...
2026-05-19T16:18:02.770Z  stop  /Users/pablooliva/Movies/2026-05-19_18-00-00.mkv
```

That log is then your editing source: the timecode column lines up exactly with the video, so you can build a YouTube-style chapter list or cut the file into per-section clips with one command:

```bash
ffmpeg -i recording.mkv -ss 00:00:12 -to 00:03:14 \
  -c copy section-02-interface-tour.mkv
```

## What I can and can't do autonomously

**I can:** call `record.js` over Bash, time my actions inside the Chrome MCP session, write the timestamps.log alongside the screenshot capture.

**I can't (yet):** install OBS, set up the scene, or change OBS settings. Those are one-time manual steps you do up front. Once the scene and websocket are configured, the script handles the rest.

**Pause/resume between sections** is supported — useful if you want to skip "waiting for the model to respond" boredom in the final cut.

## Trade-offs

- **Pro**: video and written guide stay in lockstep automatically. Re-running the script after a feature change produces both new screenshots *and* a fresh recording in the same pass.
- **Pro**: timestamps are deterministic — no manual marking, no human error in chapter creation.
- **Con**: OBS has to be running before the script starts. If it crashes mid-recording, you've lost the recording (MKV partial-recovery is OK; MP4 isn't).
- **Con**: my Chrome MCP actions are fast — sometimes too fast for a comfortable video. We'd need to insert deliberate pauses (extra `wait` calls) between actions during a recording run to make it human-watchable. Suggest a separate "video mode" flag in the driver script that doubles all `wait` durations.

## Variant: simpler approach without OBS

If you want to skip OBS entirely, macOS ships `screencapture -V <seconds> file.mov` for time-limited video, and `screencapture -v file.mov` for interactive video. The control isn't as fine-grained (no chapter markers, no pause), but it works for a one-shot recording you'll edit by hand. For a one-time "record once and edit" approach, this is enough. For a re-runnable, scriptable workflow that tracks tutorial updates over time, OBS is the better investment.

## Recommendation

If video is a one-time thing for this initial launch: **use macOS `screencapture -v` and edit manually**. Lower setup cost; only the written guide stays canonical.

If video is going to be a recurring deliverable as MemodoAI evolves: **invest in the OBS + script approach**. The first recording costs more time (OBS setup, script wiring), every subsequent re-recording is much cheaper.

Either way, the `recording-script.md` document is the source of truth — the OBS script is just one optional way to consume it.
