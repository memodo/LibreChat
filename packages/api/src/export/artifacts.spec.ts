import { ContentTypes } from 'librechat-data-provider';
import { parseArtifact, splitMessage, chooseArtifacts, artifactExtension } from './artifacts';
import type { Artifact, Segment, TextSource } from './artifacts';
import type { ExportMessage } from './types';

const block = (identifier: string, body: string, extra = '') =>
  `:::artifact{identifier="${identifier}" type="text/html" title="Page ${identifier}"${extra}}\n\`\`\`html\n${body}\n\`\`\`\n:::`;

const message = (messageId: string, fields: Partial<ExportMessage>): ExportMessage => ({
  messageId,
  conversationId: 'c1',
  isCreatedByUser: false,
  ...fields,
});

const artifactsOf = (segments: Segment[] | undefined): Artifact[] =>
  (segments ?? []).filter((s): s is Artifact => typeof s !== 'string');

describe('parseArtifact', () => {
  it('reads header attributes and strips the inner fence', () => {
    const artifact = parseArtifact(block('demo', '<h1>Hi</h1>'));
    expect(artifact).toEqual({
      identifier: 'demo',
      title: 'Page demo',
      type: 'text/html',
      language: 'html',
      body: '<h1>Hi</h1>',
    });
  });

  it('takes the code language from the fence info string', () => {
    const artifact = parseArtifact(
      ':::artifact{identifier="s" type="application/vnd.code" title="Script"}\n```python\nprint(1)\n```\n:::',
    );
    expect(artifact.language).toBe('python');
    expect(artifactExtension(artifact)).toBe('.py');
  });

  it('handles missing attributes, escaped quotes and an unclosed block', () => {
    const artifact = parseArtifact(':::artifact{title="Say \\"hi\\""}\nplain body\nmore');
    expect(artifact).toMatchObject({
      identifier: '',
      title: 'Say "hi"',
      type: 'text/plain',
      body: 'plain body\nmore',
    });
  });
});

describe('artifactExtension', () => {
  it.each([
    ['application/vnd.react', undefined, '.tsx'],
    ['application/vnd.ant.react', undefined, '.tsx'],
    ['text/html', undefined, '.html'],
    ['application/vnd.code-html', undefined, '.html'],
    ['image/svg+xml', undefined, '.svg'],
    ['application/vnd.mermaid', undefined, '.mmd'],
    ['text/markdown', undefined, '.md'],
    ['application/vnd.code', 'ts', '.ts'],
    ['application/vnd.code', 'cobol', '.txt'],
    ['text/plain', undefined, '.txt'],
    ['application/unknown', undefined, '.txt'],
  ])('%s (%s) → %s', (type, language, ext) => {
    expect(artifactExtension({ type, language })).toBe(ext);
  });
});

describe('splitMessage', () => {
  it('splits content parts and keeps surrounding text', () => {
    const segments = splitMessage(
      message('m1', {
        text: '',
        content: [
          {
            type: ContentTypes.TEXT,
            text: `Intro\n${block('a', 'A')}\nMiddle\n${block('b', 'B')}\nEnd`,
          },
          { type: ContentTypes.TEXT, text: { value: 'second part' } },
        ],
      }),
    );
    const first = segments.get(0) ?? [];
    expect(artifactsOf(first).map((a) => a.identifier)).toEqual(['a', 'b']);
    expect(first[0]).toBe('Intro\n');
    expect(first[first.length - 1]).toBe('\nEnd');
    expect(segments.get(1)).toEqual(['second part']);
  });

  it('uses legacy text when there is no content', () => {
    const segments = splitMessage(message('m1', { text: `Before\n${block('x', 'X')}` }));
    expect(artifactsOf(segments.get('text')).map((a) => a.body)).toEqual(['X']);
  });

  it('ignores text-sourced boundaries when content parts are rendered', () => {
    const segments = splitMessage(
      message('m1', {
        text: `stale copy ${block('old', 'OLD')}`,
        content: [{ type: ContentTypes.TEXT, text: 'no artifacts here' }],
      }),
    );
    expect(segments.get(0)).toEqual(['no artifacts here']);
    expect(segments.has('text')).toBe(false);
  });
});

describe('chooseArtifacts', () => {
  const split = (messages: ExportMessage[]) =>
    new Map<string, Map<TextSource, Segment[]>>(
      messages.map((m) => [m.messageId, splitMessage(m)]),
    );

  it('prefers the last version on the main thread over a later abandoned branch', () => {
    const messages = [
      message('main-1', { text: block('page', 'v1') }),
      message('main-2', { text: block('page', 'v2') }),
      message('branch', { text: block('page', 'v3-abandoned') }),
    ];
    const chosen = chooseArtifacts(messages, split(messages), new Set(['main-1', 'main-2']));
    expect(chosen.get('page')?.body).toBe('v2');
  });

  it('falls back to the last occurrence when the artifact never reached the main thread', () => {
    const messages = [
      message('b1', { text: block('draft', 'one') }),
      message('b2', { text: block('draft', 'two') }),
    ];
    const chosen = chooseArtifacts(messages, split(messages), new Set());
    expect(chosen.get('draft')?.body).toBe('two');
  });
});
