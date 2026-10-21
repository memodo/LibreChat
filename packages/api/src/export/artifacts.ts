import { ContentTypes } from 'librechat-data-provider';
import type { TMessageContentParts } from 'librechat-data-provider';
import type { ExportMessage } from './types';
import { findAllArtifacts } from '~/artifacts/update';

export interface Artifact {
  identifier: string;
  title: string;
  type: string;
  language?: string;
  body: string;
}

/** Text split into plain runs and artifact blocks, in reading order. */
export type Segment = string | Artifact;

/** Where a piece of message text comes from: a content part index, or legacy `text`. */
export type TextSource = number | 'text';

const CODE_EXTENSIONS: Record<string, string> = {
  python: '.py',
  py: '.py',
  typescript: '.ts',
  ts: '.ts',
  javascript: '.js',
  js: '.js',
  json: '.json',
  css: '.css',
  sql: '.sql',
  bash: '.sh',
  sh: '.sh',
  shell: '.sh',
};

const TYPE_EXTENSIONS: Record<string, string> = {
  'application/vnd.react': '.tsx',
  'application/vnd.ant.react': '.tsx',
  'text/html': '.html',
  'application/vnd.code-html': '.html',
  'image/svg+xml': '.svg',
  'application/vnd.mermaid': '.mmd',
  'text/markdown': '.md',
  'text/md': '.md',
};

/** File extension for an artifact (SPEC-020 REQ-009). */
export function artifactExtension({ type, language }: Pick<Artifact, 'type' | 'language'>): string {
  if (type === 'application/vnd.code') {
    return CODE_EXTENSIONS[(language ?? '').toLowerCase()] ?? '.txt';
  }
  return TYPE_EXTENSIONS[type] ?? '.txt';
}

export const partText = (part: TMessageContentParts): string => {
  if (part.type !== ContentTypes.TEXT) {
    return '';
  }
  const { text } = part;
  return typeof text === 'string' ? text : (text?.value ?? '');
};

const ATTRIBUTE = /(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/;

/** Parses one `:::artifact{…} … :::` block (header attributes, inner fence stripped). */
export function parseArtifact(block: string): Artifact {
  const lines = block.split('\n');
  const attributes = new Map<string, string>();
  for (const match of lines[0].matchAll(ATTRIBUTE)) {
    attributes.set(match[1], match[2].replace(/\\"/g, '"'));
  }

  let body = lines.slice(1);
  if (body.length > 0 && body[body.length - 1].trim() === ':::') {
    body = body.slice(0, -1);
  }
  while (body.length > 0 && body[0].trim() === '') {
    body = body.slice(1);
  }
  while (body.length > 0 && body[body.length - 1].trim() === '') {
    body = body.slice(0, -1);
  }

  let language = attributes.get('language');
  const fence = body.length > 0 ? body[0].match(FENCE) : null;
  if (fence) {
    language = fence[2] || language;
    const closing = new RegExp(`^\\s*\\${fence[1][0]}{${fence[1].length},}\\s*$`);
    const last = body.length - 1;
    body = last > 0 && closing.test(body[last]) ? body.slice(1, last) : body.slice(1);
  }

  return {
    identifier: attributes.get('identifier') ?? '',
    title: attributes.get('title') ?? attributes.get('identifier') ?? 'artifact',
    type: attributes.get('type') ?? 'text/plain',
    language: language || undefined,
    body: body.join('\n'),
  };
}

/**
 * Splits every text source of a message into segments. Boundaries come from
 * `findAllArtifacts`; only those whose source matches what is rendered are used, because
 * it falls back to `message.text` when no content part holds an artifact.
 */
export function splitMessage(message: ExportMessage): Map<TextSource, Segment[]> {
  const content = message.content;
  const hasContent = Array.isArray(content) && content.length > 0;
  const texts = new Map<TextSource, string>();
  if (hasContent) {
    content.forEach((part, index) => {
      if (part?.type === ContentTypes.TEXT) {
        texts.set(index, partText(part));
      }
    });
  } else if (message.text) {
    texts.set('text', message.text);
  }

  const boundaries = findAllArtifacts({
    content: hasContent
      ? content.map((part) => ({ type: part?.type, text: part ? partText(part) : '' }))
      : undefined,
    text: message.text,
  }).filter((b) => (hasContent ? b.source === 'content' : b.source === 'text'));

  const result = new Map<TextSource, Segment[]>();
  for (const [source, text] of texts) {
    const own = boundaries
      .filter((b) => (source === 'text' ? true : b.partIndex === source))
      .sort((a, b) => a.start - b.start);
    const segments: Segment[] = [];
    let cursor = 0;
    for (const boundary of own) {
      if (boundary.start > cursor) {
        segments.push(text.slice(cursor, boundary.start));
      }
      segments.push(parseArtifact(text.slice(boundary.start, boundary.end)));
      cursor = boundary.end;
    }
    if (cursor < text.length) {
      segments.push(text.slice(cursor));
    }
    result.set(source, segments);
  }
  return result;
}

/**
 * Picks the artifact version to export per identifier: the last occurrence on the main
 * thread if there is one, otherwise the last occurrence overall (REQ-009).
 */
export function chooseArtifacts(
  messages: ExportMessage[],
  segmentsByMessage: Map<string, Map<TextSource, Segment[]>>,
  mainThread: Set<string>,
): Map<string, Artifact> {
  const chosen = new Map<string, Artifact>();
  const onMain = new Set<string>();
  for (const message of messages) {
    const isMain = mainThread.has(message.messageId);
    for (const segments of segmentsByMessage.get(message.messageId)?.values() ?? []) {
      for (const segment of segments) {
        if (typeof segment === 'string') {
          continue;
        }
        const key = segment.identifier || segment.title;
        if (isMain || !onMain.has(key)) {
          chosen.set(key, segment);
        }
        if (isMain) {
          onMain.add(key);
        }
      }
    }
  }
  return chosen;
}

export const artifactKey = (artifact: Artifact): string => artifact.identifier || artifact.title;
