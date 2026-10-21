import yaml from 'js-yaml';
import { ContentTypes } from 'librechat-data-provider';
import type { ExportMessage, ExportSkill } from './types';
import { formatDate, renderConversation, renderSkill, renderMemories } from './markdown';
import { buildThread } from './thread';
import { splitMessage } from './artifacts';
import { Types } from 'mongoose';

const render = (messages: ExportMessage[], title = 'Chat') =>
  renderConversation({
    conversation: { conversationId: 'c1', title, createdAt: new Date('2026-05-01T08:00:00Z') },
    versions: buildThread(messages),
    segmentsByMessage: new Map(messages.map((m) => [m.messageId, splitMessage(m)])),
    links: { path: 'conversations/c.md', artifacts: new Map(), files: new Map() },
  });

const message = (fields: Partial<ExportMessage>): ExportMessage => ({
  messageId: 'm1',
  conversationId: 'c1',
  parentMessageId: null,
  isCreatedByUser: false,
  sender: 'GPT-5',
  ...fields,
});

describe('formatDate', () => {
  it('uses Europe/Berlin, so a late UTC evening is already the next day', () => {
    expect(formatDate(new Date('2026-07-31T22:30:00Z'), true)).toBe('2026-08-01 00:30');
    expect(formatDate(new Date('2026-01-31T23:30:00Z'))).toBe('2026-02-01');
  });

  it('returns an empty string without a date', () => {
    expect(formatDate(undefined)).toBe('');
  });
});

describe('renderConversation', () => {
  it('writes front matter that survives YAML special characters', () => {
    const title = 'Plan: "Q3" #wichtig\nzweite Zeile';
    const markdown = render([message({ text: 'Hallo' })], title);
    const front = markdown.split('---\n')[1];
    expect(yaml.load(front)).toMatchObject({ title });
  });

  it('collapses an error message to one truncated line', () => {
    const markdown = render([message({ error: true, text: `${'x'.repeat(400)}\nmore` })]);
    const line = markdown.split('\n').find((l) => l.startsWith('> Fehler / Error:')) ?? '';
    expect(line.length).toBeLessThan(330);
    expect(line.endsWith('…')).toBe(true);
  });

  it('renders unknown part types as a placeholder, never as JSON', () => {
    const markdown = render([
      message({
        content: [
          { type: ContentTypes.IMAGE_URL, image_url: { url: 'https://example.com/i.png' } },
          { type: ContentTypes.TEXT, text: 'Bildbeschreibung' },
        ],
      }),
    ]);
    expect(markdown).toContain('> image_url');
    expect(markdown).not.toContain('example.com');
    expect(markdown).toContain('Bildbeschreibung');
  });

  it('summarizes function-style tool calls with truncated arguments', () => {
    const markdown = render([
      message({
        content: [
          {
            type: ContentTypes.TOOL_CALL,
            tool_call: {
              id: 't',
              type: 'function',
              function: {
                name: 'search',
                arguments: JSON.stringify({ q: 'y'.repeat(300) }),
                output: 'secret',
              },
            },
          },
        ],
      }),
    ]);
    const line = markdown.split('\n').find((l) => l.includes('`search`')) ?? '';
    expect(line.endsWith('…')).toBe(true);
    expect(markdown).not.toContain('secret');
  });
});

describe('renderSkill', () => {
  const skill = (body: string): ExportSkill => ({
    _id: new Types.ObjectId(),
    name: 'my-skill',
    description: 'Does: things',
    body,
    frontmatter: { license: 'MIT' },
  });

  it('generates front matter when the body has none', () => {
    const output = renderSkill(skill('# Steps'));
    const front = yaml.load(output.split('---\n')[1]);
    expect(front).toEqual({ license: 'MIT', name: 'my-skill', description: 'Does: things' });
    expect(output.endsWith('# Steps\n')).toBe(true);
  });

  it('keeps an imported body with its own front matter verbatim', () => {
    const body = '---\nname: my-skill\ndescription: x\n---\n# Steps';
    expect(renderSkill(skill(body))).toBe(`${body}\n`);
  });
});

describe('renderMemories', () => {
  it('puts one memory per line', () => {
    expect(renderMemories([{ value: 'Mag\nkurze Antworten' }, { value: 'Vertrieb' }])).toBe(
      '- Mag kurze Antworten\n- Vertrieb\n',
    );
  });
});
