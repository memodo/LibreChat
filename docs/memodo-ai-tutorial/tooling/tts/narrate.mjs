#!/usr/bin/env node
/**
 * narrate.mjs — render docs/memodo-ai-tutorial/recording-narration.md
 *               to per-section MP3 files via the ElevenLabs API.
 *
 * No npm dependencies — uses built-in fetch (requires Node 20+).
 *
 * Setup:
 *   export ELEVENLABS_API_KEY=sk_...
 *
 * Usage:
 *   node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs                         # render all sections
 *   node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs --dry-run               # show what would render, no API calls
 *   node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs --list-voices           # browse your ElevenLabs voice library
 *   node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs --sections 01,02,03     # render only these section IDs
 *   node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs --voice <id>            # override the voice
 *   node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs --model eleven_v3       # override the model
 *   node docs/memodo-ai-tutorial/tooling/tts/narrate.mjs --force                 # re-render even if file exists
 *
 * Output: docs/memodo-ai-tutorial/audio/section-<id>.mp3
 *
 * Existing files are skipped unless --force is set, so partial runs are resumable.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULTS = {
  voice: '21m00Tcm4TlvDq8ikWAM', // Rachel — calm narration-friendly American English female
  model: 'eleven_multilingual_v2',
  stability: 0.5,
  similarityBoost: 0.75,
  speakerBoost: true,
};

const API = 'https://api.elevenlabs.io/v1';
// Resolve paths relative to this script so it runs from any working directory.
// This file lives at docs/memodo-ai-tutorial/tooling/tts/ — the tutorial dir is two levels up.
const TUTORIAL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = path.join(TUTORIAL_DIR, 'recording-narration.md');
const OUTDIR = path.join(TUTORIAL_DIR, 'audio');

const args = parseArgs(process.argv.slice(2));

if (args['list-voices']) {
  await listVoices();
  process.exit(0);
}

const VOICE = args.voice || DEFAULTS.voice;
const MODEL = args.model || DEFAULTS.model;
const SECTIONS_FILTER = args.sections?.split(',').map((s) => s.trim());

const allSections = parseSections(fs.readFileSync(SOURCE, 'utf8'));
const sections = SECTIONS_FILTER
  ? allSections.filter((s) => SECTIONS_FILTER.includes(s.id))
  : allSections;

const totalChars = sections.reduce((sum, s) => sum + s.spoken.length, 0);

console.log(`Source:   ${SOURCE}`);
console.log(`Output:   ${OUTDIR}`);
console.log(`Voice:    ${VOICE}`);
console.log(`Model:    ${MODEL}`);
console.log(`Sections: ${sections.length} of ${allSections.length} (${totalChars} characters total)`);
console.log('');

if (args['dry-run']) {
  for (const s of sections) {
    console.log(`  [${s.id}] ${String(s.spoken.length).padStart(5)} chars  ${s.header}`);
  }
  console.log('\n(dry run — no API calls made)');
  process.exit(0);
}

requireKey();
fs.mkdirSync(OUTDIR, { recursive: true });

let renderedChars = 0;
let skippedSections = 0;

for (const { id, header, spoken } of sections) {
  const file = path.join(OUTDIR, `section-${id}.mp3`);

  if (fs.existsSync(file) && !args.force) {
    console.log(`[${id}] skip (exists)  ${header}`);
    skippedSections++;
    continue;
  }

  console.log(`[${id}] render ${String(spoken.length).padStart(5)} chars  ${header}`);

  const res = await fetch(`${API}/text-to-speech/${VOICE}`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: spoken,
      model_id: MODEL,
      voice_settings: {
        stability: Number(args.stability ?? DEFAULTS.stability),
        similarity_boost: Number(args.similarity ?? DEFAULTS.similarityBoost),
        use_speaker_boost: DEFAULTS.speakerBoost,
      },
    }),
  });

  if (!res.ok) {
    console.error(`  HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
  console.log(`  -> ${file} (${(buf.length / 1024).toFixed(1)} KB)`);
  renderedChars += spoken.length;
}

console.log('');
console.log(
  `Done. Rendered ${sections.length - skippedSections} sections (${renderedChars} chars). Skipped ${skippedSections} existing.`,
);

// ----- helpers -----

function parseSections(md) {
  return md
    .split(/^## Section /m)
    .slice(1)
    .map((block) => {
      const [header, ...rest] = block.split('\n');
      const id = header.match(/^(\d+\w*)/)?.[1] ?? 'unknown';
      const spoken = rest
        .join('\n')
        .replace(/\[.*?\]/g, '') // strip [on-screen cues]
        .replace(/^\s*>.*$/gm, '') // strip > director notes
        .replace(/\n{3,}/g, '\n\n') // collapse extra blanks
        .trim();
      return { id, header: header.trim(), spoken };
    })
    .filter((s) => s.spoken);
}

async function listVoices() {
  requireKey();
  const res = await fetch(`${API}/voices`, {
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
  });
  if (!res.ok) {
    console.error(`Failed to list voices: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const { voices } = await res.json();
  console.log(`Found ${voices.length} voices.\n`);
  for (const v of voices) {
    const l = v.labels ?? {};
    console.log(
      `${v.voice_id}  ${(v.name ?? '').padEnd(22)}  ` +
        `${(l.gender ?? '').padEnd(8)}  ${(l.accent ?? '').padEnd(14)}  ` +
        `${l.description ?? l.descriptive ?? l.use_case ?? ''}`,
    );
  }
}

function requireKey() {
  if (!process.env.ELEVENLABS_API_KEY) {
    console.error('Set ELEVENLABS_API_KEY in your environment:');
    console.error('  export ELEVENLABS_API_KEY=sk_...');
    process.exit(1);
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}
