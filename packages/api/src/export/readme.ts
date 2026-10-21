import type { ExportCounts } from './types';

interface ReadmeText {
  title: string;
  intro: string;
  contents: string;
  /** Count key, singular noun, plural noun, location in the archive. */
  items: Array<[keyof ExportCounts, string, string, string]>;
  otherFiles: string;
  missing: string;
  toClaude: string;
  memories: string;
  agents: string;
  skills: string;
  conversations: string;
  omitted: string;
}

const de: ReadmeText = {
  title: 'Deutsch',
  intro:
    'Dieses Archiv enthält deine Daten aus MemodoAI. Alle Dateien lassen sich ohne MemodoAI öffnen: Unterhaltungen sind Markdown-Dateien (`.md`), hochgeladene Dateien liegen im Original vor.',
  contents: 'Inhalt',
  items: [
    ['conversations', 'Unterhaltung', 'Unterhaltungen', 'in `conversations/`'],
    ['artifacts', 'Artefakt', 'Artefakte', 'in `artifacts/`'],
    ['files', 'Datei', 'Dateien', 'in `files/` und `agents/`'],
    ['memories', 'Erinnerung', 'Erinnerungen', 'in `memories.txt`'],
    ['agents', 'Agent', 'Agenten', 'in `agents/`'],
    ['skills', 'Skill', 'Skills', 'in `skills/`'],
    ['promptGroups', 'Prompt', 'Prompts', 'in `prompts.md`'],
    ['presets', 'Preset', 'Presets', 'in `presets.md`'],
  ],
  otherFiles: '`files/other/` enthält Dateien, die keiner Unterhaltung zugeordnet sind.',
  missing:
    'Einige Dateien konnten nicht gelesen werden; sie sind in `manifest.json` unter `missingFiles` aufgeführt.',
  toClaude: 'Umzug nach Claude',
  memories:
    '**Erinnerungen:** Öffne in Claude die Einstellungen (*Settings → Memory*), wähle „Start import“, füge den Inhalt von `memories.txt` ein und bestätige.',
  agents:
    '**Agenten:** Lege in Claude ein *Projekt* an, kopiere den Abschnitt „Anweisungen“ aus `agents/<Name>/instructions.md` in die Projekt-Anweisungen und lade die Dateien aus `agents/<Name>/files/` als Projektwissen hoch.',
  skills:
    '**Skills:** Lade einen Ordner aus `skills/` (mit seiner `SKILL.md`) in Claude als Skill hoch.',
  conversations:
    '**Unterhaltungen:** Claude kann keine Chatverläufe importieren. Lade wichtige Unterhaltungen aus `conversations/` als Wissensdateien in ein Claude-Projekt hoch, damit Claude sie nutzen kann.',
  omitted:
    'Bewusst nicht enthalten: interne Denkschritte der Modelle und die Rohausgaben von Werkzeugen (nur ihr Aufruf ist vermerkt).',
};

const en: ReadmeText = {
  title: 'English',
  intro:
    'This archive contains your data from MemodoAI. Everything opens without MemodoAI: conversations are Markdown files (`.md`), uploaded files are in their original format.',
  contents: 'Contents',
  items: [
    ['conversations', 'conversation', 'conversations', 'in `conversations/`'],
    ['artifacts', 'artifact', 'artifacts', 'in `artifacts/`'],
    ['files', 'file', 'files', 'in `files/` and `agents/`'],
    ['memories', 'memory', 'memories', 'in `memories.txt`'],
    ['agents', 'agent', 'agents', 'in `agents/`'],
    ['skills', 'skill', 'skills', 'in `skills/`'],
    ['promptGroups', 'prompt', 'prompts', 'in `prompts.md`'],
    ['presets', 'preset', 'presets', 'in `presets.md`'],
  ],
  otherFiles: '`files/other/` holds files that are not attached to any conversation.',
  missing: 'Some files could not be read; they are listed in `manifest.json` under `missingFiles`.',
  toClaude: 'Moving to Claude',
  memories:
    '**Memories:** In Claude open *Settings → Memory → Start import*, paste the contents of `memories.txt` and confirm.',
  agents:
    '**Agents:** Create a Claude *Project*, copy the "Instructions" section of `agents/<name>/instructions.md` into the project instructions, and upload the files from `agents/<name>/files/` as project knowledge.',
  skills: '**Skills:** Upload a folder from `skills/` (with its `SKILL.md`) to Claude as a skill.',
  conversations:
    '**Conversations:** Claude cannot import chat history. Upload important conversations from `conversations/` to a Claude project as knowledge files so Claude can use them.',
  omitted:
    'Intentionally not included: the models’ internal reasoning and raw tool outputs (only the tool call itself is noted).',
};

function section(text: ReadmeText, counts: ExportCounts, hasOtherFiles: boolean): string {
  const items = text.items
    .filter(([key]) => counts[key] > 0)
    .map(
      ([key, one, many, where]) => `- ${counts[key]} ${counts[key] === 1 ? one : many} ${where}`,
    );
  const steps = [
    counts.memories > 0 ? text.memories : '',
    counts.agents > 0 ? text.agents : '',
    counts.skills > 0 ? text.skills : '',
    counts.conversations > 0 ? text.conversations : '',
  ].filter(Boolean);

  const parts = [`## ${text.title}`, text.intro];
  if (items.length > 0) {
    parts.push(`### ${text.contents}`, items.join('\n'));
  }
  if (hasOtherFiles) {
    parts.push(text.otherFiles);
  }
  if (counts.missingFiles > 0) {
    parts.push(text.missing);
  }
  if (steps.length > 0) {
    parts.push(`### ${text.toClaude}`, steps.map((s, i) => `${i + 1}. ${s}`).join('\n'));
  }
  parts.push(text.omitted);
  return parts.join('\n\n');
}

/** Bilingual README, German first (SPEC-020 REQ-017). Sections for empty types are omitted. */
export function renderReadme(
  counts: ExportCounts,
  hasOtherFiles: boolean,
  exportedAt: string,
): string {
  return `# MemodoAI Export (${exportedAt})\n\n${section(de, counts, hasOtherFiles)}\n\n---\n\n${section(en, counts, hasOtherFiles)}\n`;
}
