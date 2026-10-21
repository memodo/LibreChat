import yaml from 'js-yaml';
import { ContentTypes } from 'librechat-data-provider';
import type { TMessageContentParts } from 'librechat-data-provider';
import type {
  ExportAgent,
  ExportSkill,
  ExportMemory,
  ExportPrompt,
  ExportPreset,
  ExportMessage,
  ExportPromptGroup,
  ExportConversation,
} from './types';
import type { Segment, TextSource } from './artifacts';
import type { ThreadVersion } from './thread';
import { artifactKey, partText } from './artifacts';
import { relativeLink } from './paths';

const TIME_ZONE = 'Europe/Berlin';
const TOOL_ARGS_LIMIT = 200;
const ERROR_TEXT_LIMIT = 300;
const USER_LABEL = 'Du / You';
const ASSISTANT_FALLBACK = 'Assistent / Assistant';

const dateParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** `YYYY-MM-DD` (or `YYYY-MM-DD HH:mm`) in Europe/Berlin. */
export function formatDate(value: Date | string | undefined, withTime = false): string {
  if (!value) {
    return '';
  }
  const parts = new Map(dateParts.formatToParts(new Date(value)).map((p) => [p.type, p.value]));
  const day = `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`;
  return withTime ? `${day} ${parts.get('hour')}:${parts.get('minute')}` : day;
}

/**
 * A Date whose UTC fields read as Europe/Berlin wall-clock time. JSZip writes entry times
 * from UTC fields and unzip tools read them as local time, so this shows the real export time.
 */
export function berlinWallClock(value: Date): Date {
  const parts = new Map(dateParts.formatToParts(value).map((p) => [p.type, Number(p.value)]));
  const part = (type: Intl.DateTimeFormatPartTypes): number => parts.get(type) ?? 0;
  return new Date(
    Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
      part('second'),
    ),
  );
}

const frontMatter = (fields: Record<string, string | string[] | undefined>): string => {
  const defined = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined && v !== '' && v.length !== 0),
  );
  return `---\n${yaml.dump(defined, { lineWidth: -1 })}---`;
};

const truncate = (value: string, limit: number): string =>
  value.length > limit ? `${value.slice(0, limit)}…` : value;

const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();

const quote = (value: string): string =>
  value
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');

type ToolCall = Extract<TMessageContentParts, { type: ContentTypes.TOOL_CALL }>['tool_call'];

const compactArgs = (args: string | object | undefined): string => {
  if (args === undefined) {
    return '';
  }
  if (typeof args !== 'string') {
    return JSON.stringify(args);
  }
  try {
    return JSON.stringify(JSON.parse(args));
  } catch {
    return oneLine(args);
  }
};

/** Tool name and compact arguments, whatever the tool-call shape (outputs are never read). */
function describeToolCall(call: ToolCall | undefined): { name: string; args: string } {
  if (!call) {
    return { name: 'tool', args: '' };
  }
  if ('function' in call && call.function) {
    return { name: call.function.name, args: compactArgs(call.function.arguments) };
  }
  if ('name' in call && typeof call.name === 'string') {
    return { name: call.name, args: compactArgs(call.args) };
  }
  if ('code_interpreter' in call) {
    return { name: 'code_interpreter', args: oneLine(call.code_interpreter?.input ?? '') };
  }
  return { name: 'type' in call && call.type ? call.type : 'tool', args: '' };
}

export interface ConversationLinks {
  /** Archive path of the conversation file itself (links are relative to it). */
  path: string;
  artifacts: Map<string, string>;
  /** Owned files: file_id → archive path, or null when pre-flight found it missing. */
  files: Map<string, { name: string; path: string | null }>;
}

const renderSegments = (segments: Segment[], links: ConversationLinks): string =>
  segments
    .map((segment) => {
      if (typeof segment === 'string') {
        return segment;
      }
      const target = links.artifacts.get(artifactKey(segment));
      const label = `Artefakt / Artifact: ${segment.title}`;
      return target ? `[${label}](${relativeLink(links.path, target)})` : `> ${label}`;
    })
    .join('');

function renderPart(
  part: TMessageContentParts | null | undefined,
  index: number,
  segments: Map<TextSource, Segment[]>,
  links: ConversationLinks,
): string {
  if (!part) {
    return '';
  }
  switch (part.type) {
    case ContentTypes.TEXT:
      return renderSegments(segments.get(index) ?? [partText(part)], links).trim();
    case ContentTypes.THINK:
      return '';
    case ContentTypes.TOOL_CALL: {
      const { name, args } = describeToolCall(part.tool_call);
      const shown = args ? ` ${truncate(args, TOOL_ARGS_LIMIT)}` : '';
      return `> Werkzeug / Tool: \`${name}\`${shown}`;
    }
    case ContentTypes.ERROR: {
      const text = typeof part.text === 'string' ? part.text : (part.text?.value ?? '');
      return `> Fehler / Error: ${oneLine(part.error ?? text)}`;
    }
    default:
      return `> ${part.type}`;
  }
}

function renderFileRefs(message: ExportMessage, links: ConversationLinks): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const ref of [...(message.files ?? []), ...(message.attachments ?? [])]) {
    const id = ref?.file_id;
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const file = links.files.get(id);
    if (!file) {
      continue;
    }
    lines.push(
      file.path
        ? `Datei / File: [${file.name}](${relativeLink(links.path, file.path)})`
        : `> Datei nicht verfügbar / File unavailable: ${file.name}`,
    );
  }
  return lines;
}

function renderTurn(
  message: ExportMessage,
  turn: number,
  level: string,
  segments: Map<TextSource, Segment[]>,
  links: ConversationLinks,
): string {
  const speaker = message.isCreatedByUser ? USER_LABEL : (message.sender ?? ASSISTANT_FALLBACK);
  const blocks: string[] = [`${level} ${turn} · ${speaker}`];
  const when = formatDate(message.createdAt, true);
  if (when) {
    blocks.push(`_${when}_`);
  }

  if (message.isCreatedByUser) {
    blocks.push(...(message.quotes ?? []).map(quote));
  }

  if (message.error) {
    blocks.push(`> Fehler / Error: ${truncate(oneLine(message.text ?? ''), ERROR_TEXT_LIMIT)}`);
    return blocks.join('\n\n');
  }

  if (Array.isArray(message.content) && message.content.length > 0) {
    message.content.forEach((part, index) => {
      const rendered = renderPart(part, index, segments, links);
      if (rendered) {
        blocks.push(rendered);
      }
    });
  } else {
    const rendered = renderSegments(segments.get('text') ?? [message.text ?? ''], links).trim();
    if (rendered) {
      blocks.push(rendered);
    }
  }

  blocks.push(...renderFileRefs(message, links));
  return blocks.join('\n\n');
}

export interface ConversationDocument {
  conversation: ExportConversation;
  versions: ThreadVersion[];
  projectName?: string;
  /** Name of the user's own agent this conversation used, when known. */
  agentName?: string;
  segmentsByMessage: Map<string, Map<TextSource, Segment[]>>;
  links: ConversationLinks;
}

/** One conversation as Markdown: front matter, main thread, then other versions (REQ-006–008). */
export function renderConversation({
  conversation,
  versions,
  projectName,
  agentName,
  segmentsByMessage,
  links,
}: ConversationDocument): string {
  const [main, ...others] = versions;
  const title = conversation.title || 'Unbenannt / Untitled';
  const assistant = agentName ?? main?.turns.find((m) => !m.isCreatedByUser)?.sender;
  const model = conversation.model?.startsWith('agent_') ? undefined : conversation.model;

  const renderVersion = (version: ThreadVersion, level: string): string =>
    version.turns
      .map((message, i) =>
        renderTurn(
          message,
          version.firstTurn + i,
          level,
          segmentsByMessage.get(message.messageId) ?? new Map(),
          links,
        ),
      )
      .join('\n\n');

  const sections = [
    frontMatter({
      title,
      created: formatDate(conversation.createdAt, true),
      updated: formatDate(conversation.updatedAt, true),
      model,
      assistant,
      project: projectName,
      tags: conversation.tags,
    }),
    `# ${title}`,
  ];
  if (main) {
    sections.push(renderVersion(main, '###'));
  }
  if (others.length > 0) {
    sections.push('## Weitere Versionen / Other versions');
    for (const version of others) {
      const from = version.from ?? { version: 1, turn: 0 };
      sections.push(
        `### Version ${version.version}`,
        `↳ Abzweigung nach Beitrag ${from.turn} von Version ${from.version} / Branches after turn ${from.turn} of version ${from.version}`,
        renderVersion(version, '####'),
      );
    }
  }
  return `${sections.join('\n\n')}\n`;
}

/** One memory per line, oldest first — the format Claude's memory import accepts (REQ-012). */
export const renderMemories = (memories: ExportMemory[]): string =>
  `${memories.map((m) => `- ${oneLine(m.value)}`).join('\n')}\n`;

export function renderAgent(
  agent: ExportAgent,
  instructionsPath: string,
  files: Array<{ name: string; path: string }>,
): string {
  const lines = [`# ${agent.name || agent.id}`];
  if (agent.description) {
    lines.push(agent.description);
  }
  lines.push(`**Modell / Model:** ${agent.model}`);
  lines.push('## Anweisungen / Instructions', agent.instructions?.trim() || '_(keine / none)_');
  const starters = agent.conversation_starters ?? [];
  if (starters.length > 0) {
    lines.push(
      '## Gesprächsstarter / Conversation starters',
      starters.map((s) => `- ${s}`).join('\n'),
    );
  }
  if (files.length > 0) {
    lines.push(
      '## Wissensdateien / Knowledge files',
      files.map((f) => `- [${f.name}](${relativeLink(instructionsPath, f.path)})`).join('\n'),
    );
  }
  return `${lines.join('\n\n')}\n`;
}

const FRONT_MATTER_START = /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/;

/** SKILL.md: imported skills already carry front matter in `body` and are kept verbatim (REQ-014). */
export function renderSkill(skill: ExportSkill): string {
  if (FRONT_MATTER_START.test(skill.body)) {
    return skill.body.endsWith('\n') ? skill.body : `${skill.body}\n`;
  }
  const fields = { ...(skill.frontmatter ?? {}), name: skill.name, description: skill.description };
  return `---\n${yaml.dump(fields, { lineWidth: -1 })}---\n\n${skill.body.trim()}\n`;
}

export function renderPrompts(groups: ExportPromptGroup[], prompts: ExportPrompt[]): string {
  const sections = ['# Prompts'];
  for (const group of groups) {
    const own = prompts.filter((p) => String(p.groupId) === String(group._id));
    const production =
      own.find((p) => String(p._id) === String(group.productionId)) ?? own[own.length - 1];
    const meta = [
      group.command ? `**Befehl / Command:** /${group.command}` : '',
      group.category ? `**Kategorie / Category:** ${group.category}` : '',
      group.oneliner ? `_${group.oneliner}_` : '',
    ].filter(Boolean);
    sections.push(
      `## ${group.name}`,
      ...meta,
      production ? production.prompt.trim() : '_(leer / empty)_',
    );
  }
  return `${sections.join('\n\n')}\n`;
}

export function renderPresets(presets: ExportPreset[]): string {
  const sections = ['# Presets'];
  for (const preset of presets) {
    sections.push(`## ${preset.title || 'Preset'}`);
    const model = [preset.endpoint, preset.model].filter(Boolean).join(' / ');
    if (model) {
      sections.push(`**Modell / Model:** ${model}`);
    }
    if (preset.promptPrefix) {
      sections.push(preset.promptPrefix.trim());
    }
    if (preset.instructions) {
      sections.push(preset.instructions.trim());
    }
  }
  return `${sections.join('\n\n')}\n`;
}
