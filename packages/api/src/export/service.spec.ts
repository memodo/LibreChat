import JSZip from 'jszip';
import yaml from 'js-yaml';
import mongoose, { Types } from 'mongoose';
import { Readable, Writable, PassThrough } from 'stream';
import { createModels, logger } from '@librechat/data-schemas';
import { ContentTypes } from 'librechat-data-provider';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { FileAccess } from './files';
import type { ExportModels } from './types';
import { prepareUserExport, writeExportArchive, runUserExport } from './service';
import { ExportFileError } from './files';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const NO_PARENT = '00000000-0000-0000-0000-000000000000';

let mongoServer: MongoMemoryServer;
let models: ExportModels;

const userA = new Types.ObjectId();
const userB = new Types.ObjectId();
const skillA = new Types.ObjectId();
const groupA = new Types.ObjectId();
const productionA = new Types.ObjectId();
const projectA = new Types.ObjectId();

/** Bytes per file_id; a missing key makes `check`/`open` fail like a missing S3 object. */
const blobs = new Map<string, Buffer>();

const fileAccess: FileAccess = {
  async check(file) {
    if (!blobs.has(file.file_id)) {
      throw new ExportFileError('not_found', file.file_id);
    }
  },
  async open(file) {
    const blob = blobs.get(file.file_id);
    if (!blob) {
      throw new ExportFileError('not_found', file.file_id);
    }
    return Readable.from([blob]);
  },
};

const at = (minute: number) => new Date(Date.UTC(2026, 4, 1, 8, minute));
const artifact = (identifier: string, body: string) =>
  `:::artifact{identifier="${identifier}" type="text/html" title="Seite ${identifier}"}\n\`\`\`html\n${body}\n\`\`\`\n:::`;

/** Collects everything written to it into one buffer. */
function sink(): { stream: Writable; buffer: () => Buffer } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });
  return { stream, buffer: () => Buffer.concat(chunks) };
}

async function exportZip(userId: Types.ObjectId, email = 'Anna.Muster@memodo.de') {
  const prepared = await prepareUserExport({
    user: { id: userId.toString(), email },
    models,
    files: fileAccess,
    now: at(0),
  });
  const out = sink();
  const outcome = await writeExportArchive(prepared, fileAccess, out.stream);
  const zip = await JSZip.loadAsync(out.buffer());
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  const read = (name: string) => zip.file(name)?.async('string') ?? Promise.resolve('');
  return { prepared, outcome, zip, names, read };
}

async function seed() {
  const a = userA.toString();
  const b = userB.toString();
  const db = mongoose.connection;

  await db.collection('conversations').insertMany([
    {
      conversationId: 'conv-a1',
      user: a,
      title: 'Angebot: Q3 "Solar"',
      tags: ['vertrieb'],
      model: 'gpt-5',
      agent_id: 'agent_a',
      chatProjectId: projectA.toString(),
      createdAt: at(1),
      updatedAt: at(9),
    },
    { conversationId: 'conv-a2', user: a, title: 'New Chat', createdAt: at(2), updatedAt: at(2) },
    {
      conversationId: 'conv-a3',
      user: a,
      title: 'New Chat',
      isArchived: true,
      createdAt: at(3),
      updatedAt: at(3),
    },
    {
      conversationId: 'conv-a-temp',
      user: a,
      title: 'Temporary',
      isTemporary: true,
      createdAt: at(4),
    },
    { conversationId: 'conv-b1', user: b, title: 'B secret conversation', createdAt: at(1) },
  ]);

  await db.collection('messages').insertMany([
    {
      messageId: 'a1-u1',
      conversationId: 'conv-a1',
      user: a,
      parentMessageId: NO_PARENT,
      isCreatedByUser: true,
      sender: 'User',
      text: 'Bitte ein Angebot',
      quotes: ['zitierter Text'],
      files: [{ file_id: 'file-a-shared' }, { file_id: 'file-b-secret' }],
      createdAt: at(1),
    },
    {
      messageId: 'a1-old',
      conversationId: 'conv-a1',
      user: a,
      parentMessageId: 'a1-u1',
      isCreatedByUser: false,
      sender: 'Concierge',
      text: '',
      content: [{ type: ContentTypes.TEXT, text: `Alt ${artifact('angebot', 'v-old')}` }],
      createdAt: at(2),
    },
    {
      messageId: 'a1-new',
      conversationId: 'conv-a1',
      user: a,
      parentMessageId: 'a1-u1',
      isCreatedByUser: false,
      sender: 'Concierge',
      text: '',
      content: [
        { type: ContentTypes.THINK, think: 'private reasoning' },
        {
          type: ContentTypes.TOOL_CALL,
          tool_call: {
            id: 't1',
            name: 'web_search',
            args: '{"query": "solar prices"}',
            output: 'TOOL OUTPUT SHOULD NOT APPEAR',
            type: 'tool_call',
          },
        },
        { type: ContentTypes.TEXT, text: `Hier ist es:\n${artifact('angebot', 'v-new')}` },
      ],
      createdAt: at(3),
    },
    {
      messageId: 'a1-err',
      conversationId: 'conv-a1',
      user: a,
      parentMessageId: 'a1-new',
      isCreatedByUser: false,
      sender: 'Concierge',
      error: true,
      text: '{"code":"rate_limit","message":"Too many"}',
      createdAt: at(4),
    },
    {
      messageId: 'a2-u1',
      conversationId: 'conv-a2',
      user: a,
      parentMessageId: NO_PARENT,
      isCreatedByUser: true,
      text: 'Zweiter Chat',
      files: [{ file_id: 'file-a-shared' }, { file_id: 'file-a-missing' }],
      createdAt: at(5),
    },
    {
      messageId: 'a3-u1',
      conversationId: 'conv-a3',
      user: a,
      parentMessageId: NO_PARENT,
      isCreatedByUser: true,
      text: 'Dritter Chat',
      createdAt: at(6),
    },
    {
      messageId: 'temp-u1',
      conversationId: 'conv-a-temp',
      user: a,
      parentMessageId: NO_PARENT,
      isCreatedByUser: true,
      text: 'TEMPORARY TEXT',
      createdAt: at(7),
    },
    {
      messageId: 'b1-u1',
      conversationId: 'conv-b1',
      user: b,
      parentMessageId: NO_PARENT,
      isCreatedByUser: true,
      text: 'B SECRET MESSAGE',
      createdAt: at(1),
    },
  ]);

  const file = (fileId: string, user: Types.ObjectId, filename: string, extra = {}) => ({
    file_id: fileId,
    user,
    filename,
    filepath: `https://minio/librechat/uploads/${user}/${fileId}__${filename}`,
    storageKey: `uploads/${user}/${fileId}__${filename}`,
    source: 's3',
    bytes: 3,
    type: 'application/pdf',
    object: 'file',
    usage: 0,
    context: 'message_attachment',
    createdAt: at(0),
    ...extra,
  });
  await db
    .collection('files')
    .insertMany([
      file('file-a-shared', userA, 'Übersicht Q3.pdf'),
      file('file-a-agent', userA, 'Preisliste.xlsx', { context: 'agents' }),
      file('file-a-unref', userA, 'Notizen.txt'),
      file('file-a-missing', userA, 'Verloren.pdf'),
      file('file-a-avatar', userA, 'avatar.png', { context: 'avatar' }),
      file('file-b-secret', userB, 'B-secret.pdf'),
      file('file-b-knowledge', userB, 'B-knowledge.pdf', { context: 'agents' }),
    ]);
  for (const id of [
    'file-a-shared',
    'file-a-agent',
    'file-a-unref',
    'file-a-avatar',
    'file-b-secret',
    'file-b-knowledge',
  ]) {
    blobs.set(id, Buffer.from(`bytes-of-${id}`));
  }

  await db.collection('memoryentries').insertMany([
    { userId: userA, key: 'team', value: 'Arbeitet im Vertrieb', updated_at: at(2) },
    { userId: userA, key: 'style', value: 'Mag kurze Antworten', updated_at: at(1) },
    { userId: userB, key: 'secret', value: 'B SECRET MEMORY', updated_at: at(1) },
  ]);

  await db.collection('agents').insertMany([
    {
      id: 'agent_a2',
      name: 'Service-Helfer',
      instructions: 'Hilf dem Service.',
      model: 'gpt-5',
      provider: 'azureOpenAI',
      author: userA,
      tool_resources: { file_search: { file_ids: ['file-a-agent'] } },
    },
    {
      id: 'agent_a',
      name: 'Angebots-Helfer',
      description: 'Hilft bei Angeboten',
      instructions: 'Antworte förmlich.',
      model: 'gpt-5',
      provider: 'azureOpenAI',
      author: userA,
      conversation_starters: ['Neues Angebot'],
      tool_resources: { file_search: { file_ids: ['file-a-agent', 'file-b-knowledge'] } },
    },
    {
      id: 'agent_b',
      name: 'B Agent',
      instructions: 'B SECRET INSTRUCTIONS',
      model: 'gpt-5',
      provider: 'azureOpenAI',
      author: userB,
    },
  ]);

  await db.collection('skills').insertMany([
    {
      _id: skillA,
      name: 'angebot-pruefen',
      description: 'Prüft Angebote',
      body: '---\nname: angebot-pruefen\ndescription: Prüft Angebote\n---\n\n# Schritte',
      frontmatter: {},
      author: userA,
    },
    { name: 'b-skill', description: 'B', body: 'B SECRET SKILL', frontmatter: {}, author: userB },
  ]);
  await db.collection('skillfiles').insertMany([
    {
      skillId: skillA,
      relativePath: '../scripts/check.py',
      file_id: 'skillfile-a',
      filename: 'check.py',
      filepath: 'skills/check.py',
      storageKey: 'skills/check.py',
      source: 's3',
      author: userB,
    },
  ]);
  blobs.set('skillfile-a', Buffer.from('print("ok")'));

  await db.collection('promptgroups').insertMany([
    {
      _id: groupA,
      name: 'Angebotsvorlage',
      command: 'angebot',
      category: 'sales',
      oneliner: 'Vorlage',
      productionId: productionA,
      author: userA,
    },
    { name: 'B Prompts', productionId: new Types.ObjectId(), author: userB },
  ]);
  await db.collection('prompts').insertMany([
    { groupId: groupA, prompt: 'Alte Version', author: userA, createdAt: at(1) },
    {
      _id: productionA,
      groupId: groupA,
      prompt: 'Aktuelle Version von Kollegin',
      author: userB,
      createdAt: at(2),
    },
  ]);

  await db
    .collection('chatprojects')
    .insertMany([{ _id: projectA, name: 'Vertrieb 2026', user: a }]);
  await db.collection('presets').insertMany([
    {
      user: a,
      title: 'Formell',
      endpoint: 'azureOpenAI',
      model: 'gpt-5',
      promptPrefix: 'Sei formell.',
    },
    { user: b, title: 'B SECRET PRESET' },
  ]);
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  models = createModels(mongoose);
  await seed();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('user data export (integration)', () => {
  it('exports everything user A owns, each file once, at the specified locations', async () => {
    const { prepared, outcome, names, read } = await exportZip(userA);

    expect(outcome).toBe('success');
    expect(prepared.filename).toBe('memodoai-export-anna.muster-2026-05-01.zip');
    expect(prepared.counts).toEqual({
      conversations: 3,
      messages: 6,
      artifacts: 1,
      files: 3,
      missingFiles: 1,
      memories: 2,
      agents: 2,
      skills: 1,
      promptGroups: 1,
      presets: 1,
    });
    expect(names.sort()).toEqual(
      [
        'README.md',
        'manifest.json',
        'agents/Angebots-Helfer/files/Preisliste.xlsx',
        'agents/Angebots-Helfer/instructions.md',
        'agents/Service-Helfer/files/Preisliste.xlsx',
        'agents/Service-Helfer/instructions.md',
        'artifacts/2026-05-01-Angebot-Q3-Solar/Seite-angebot.html',
        'conversations/Vertrieb-2026/2026-05-01-Angebot-Q3-Solar.md',
        'conversations/2026-05-01-New-Chat.md',
        'conversations/archived/2026-05-01-New-Chat-2.md',
        'files/2026-05-01-Angebot-Q3-Solar/Übersicht Q3.pdf',
        'files/other/Notizen.txt',
        'memories.txt',
        'presets.md',
        'prompts.md',
        'skills/angebot-pruefen/SKILL.md',
        'skills/angebot-pruefen/scripts/check.py',
      ].sort(),
    );
    expect(await read('files/2026-05-01-Angebot-Q3-Solar/Übersicht Q3.pdf')).toBe(
      'bytes-of-file-a-shared',
    );
    expect(await read('skills/angebot-pruefen/scripts/check.py')).toBe('print("ok")');
  });

  it('contains nothing that belongs to user B', async () => {
    const { names, zip } = await exportZip(userA);
    const contents = await Promise.all(names.map((name) => zip.file(name)?.async('string')));
    const everything = `${names.join('\n')}\n${contents.join('\n')}`;
    for (const secret of [
      'B SECRET',
      'B-secret',
      'B-knowledge',
      'bytes-of-file-b',
      'B Agent',
      'B Prompts',
      'b-skill',
      'TEMPORARY TEXT',
      'avatar',
    ]) {
      expect(everything).not.toContain(secret);
    }
  });

  it('renders the conversation per REQ-006/REQ-007', async () => {
    const { read } = await exportZip(userA);
    const markdown = await read('conversations/Vertrieb-2026/2026-05-01-Angebot-Q3-Solar.md');
    const [, front] = markdown.split('---\n');

    expect(yaml.load(front)).toMatchObject({
      title: 'Angebot: Q3 "Solar"',
      model: 'gpt-5',
      assistant: 'Angebots-Helfer',
      project: 'Vertrieb 2026',
      tags: ['vertrieb'],
    });
    expect(markdown).toContain('### 1 · Du / You');
    expect(markdown).toContain('> zitierter Text');
    expect(markdown).toContain('### 2 · Concierge');
    expect(markdown).toContain('> Werkzeug / Tool: `web_search` {"query":"solar prices"}');
    expect(markdown).toContain(
      '[Artefakt / Artifact: Seite angebot](../../artifacts/2026-05-01-Angebot-Q3-Solar/Seite-angebot.html)',
    );
    expect(markdown).toContain('> Fehler / Error: {"code":"rate_limit","message":"Too many"}');
    expect(markdown).toContain(
      'Datei / File: [Übersicht Q3.pdf](../../files/2026-05-01-Angebot-Q3-Solar/%C3%9Cbersicht%20Q3.pdf)',
    );
    expect(markdown).toContain('## Weitere Versionen / Other versions');
    expect(markdown).toContain('Branches after turn 1 of version 1');
    expect(markdown).not.toContain('private reasoning');
    expect(markdown).not.toContain('TOOL OUTPUT SHOULD NOT APPEAR');
    expect(markdown).not.toContain(':::artifact');
  });

  it('exports the main-thread artifact version, linked from every occurrence', async () => {
    const { read } = await exportZip(userA);
    expect(await read('artifacts/2026-05-01-Angebot-Q3-Solar/Seite-angebot.html')).toBe('v-new\n');
  });

  it('lists a file missing at pre-flight and still delivers the archive', async () => {
    const { prepared, read } = await exportZip(userA);
    expect(prepared.missingFiles).toEqual([
      {
        filename: 'Verloren.pdf',
        location: 'files/2026-05-01-New-Chat/Verloren.pdf',
        reason: 'not_found',
      },
    ]);
    const manifest = JSON.parse(await read('manifest.json'));
    expect(manifest.missingFiles).toHaveLength(1);
    expect(await read('conversations/2026-05-01-New-Chat.md')).toContain(
      '> Datei nicht verfügbar / File unavailable: Verloren.pdf',
    );
  });

  it('writes memories, agent, skill, prompts and presets in their Claude-ready shapes', async () => {
    const { read } = await exportZip(userA);
    expect(await read('memories.txt')).toBe('- Mag kurze Antworten\n- Arbeitet im Vertrieb\n');

    const agent = await read('agents/Angebots-Helfer/instructions.md');
    expect(agent).toContain('Antworte förmlich.');
    expect(agent).toContain('- Neues Angebot');
    expect(agent).toContain('[Preisliste.xlsx](files/Preisliste.xlsx)');

    const service = await read('agents/Service-Helfer/instructions.md');
    expect(service).toContain('[Preisliste.xlsx](files/Preisliste.xlsx)');
    expect(await read('agents/Service-Helfer/files/Preisliste.xlsx')).toBe('bytes-of-file-a-agent');

    const skill = await read('skills/angebot-pruefen/SKILL.md');
    expect(skill.match(/^---$/gm)).toHaveLength(2);

    const prompts = await read('prompts.md');
    expect(prompts).toContain('Aktuelle Version von Kollegin');
    expect(prompts).not.toContain('Alte Version');

    const readme = await read('README.md');
    expect(readme.indexOf('## Deutsch')).toBeLessThan(readme.indexOf('## English'));
    expect(readme).toContain('3 Unterhaltungen');
  });

  it('never writes an entry outside the archive root', async () => {
    const { names } = await exportZip(userA);
    for (const name of names) {
      expect(name.startsWith('/')).toBe(false);
      expect(name.split('/')).not.toContain('..');
    }
  });

  it('logs one content-free line per run', async () => {
    const info = jest.mocked(logger.info);
    info.mockClear();
    await runUserExport({
      user: { id: userA.toString() },
      models,
      files: fileAccess,
      output: sink().stream,
    });
    expect(info).toHaveBeenCalledTimes(1);
    const calls: unknown[][] = info.mock.calls;
    const fields = calls[0][1];
    expect(fields).toEqual({
      event: 'user_export',
      userId: userA.toString(),
      outcome: 'success',
      durationMs: expect.any(Number),
      counts: expect.any(Object),
      missingFiles: 1,
    });
    expect(JSON.stringify(fields)).not.toMatch(/Angebot|Übersicht|Vertrieb|Verloren/);
  });

  it('logs the error identity without its message when preparation fails', async () => {
    const error = jest.mocked(logger.error);
    error.mockClear();
    const find = jest.spyOn(models.Conversation, 'find').mockImplementationOnce(() => {
      throw Object.assign(new RangeError('Vertrieb title leaked'), { code: 50 });
    });
    await expect(
      runUserExport({
        user: { id: userA.toString() },
        models,
        files: fileAccess,
        output: sink().stream,
      }),
    ).rejects.toThrow(RangeError);
    const calls: unknown[][] = error.mock.calls;
    expect(calls[0][1]).toMatchObject({ outcome: 'error', errorName: 'RangeError', errorCode: 50 });
    expect(JSON.stringify(calls[0][1])).not.toContain('Vertrieb');
    find.mockRestore();
  });

  it('produces README and manifest only for a user without data', async () => {
    const { names, prepared } = await exportZip(new Types.ObjectId(), '');
    expect(names.sort()).toEqual(['README.md', 'manifest.json']);
    expect(prepared.filename).toBe('memodoai-export-user-2026-05-01.zip');
  });
});

describe('streaming robustness', () => {
  const entries = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      kind: 'object' as const,
      path: `files/f${i}.bin`,
      object: { file_id: `f${i}`, filepath: '', source: 's3' },
    }));

  it('aborts and destroys sources when a file fails mid-stream', async () => {
    const opened: Readable[] = [];
    const failing: FileAccess = {
      check: async () => undefined,
      async open() {
        let pushed = false;
        const stream = new Readable({
          read() {
            if (pushed) {
              this.destroy(new Error('read failed'));
              return;
            }
            pushed = true;
            this.push(Buffer.alloc(1024));
          },
        });
        opened.push(stream);
        return stream;
      },
    };
    const outcome = await writeExportArchive(
      { entries: entries(2) },
      failing,
      sink().stream,
      2_000,
    );
    expect(outcome).toBe('aborted');
    expect(opened.every((s) => s.destroyed)).toBe(true);
  });

  it('never hangs when a paused input errors under backpressure', async () => {
    const failing: FileAccess = {
      check: async () => undefined,
      async open() {
        let sent = 0;
        return new Readable({
          read() {
            sent += 1;
            if (sent > 20) {
              this.destroy(new Error('late failure'));
              return;
            }
            this.push(Buffer.alloc(64 * 1024));
          },
        });
      },
    };
    const slow = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, callback) {
        setTimeout(callback, 20);
      },
    });
    const started = Date.now();
    const outcome = await writeExportArchive({ entries: entries(1) }, failing, slow, 300);
    expect(outcome).toBe('aborted');
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('opens one file at a time', async () => {
    let open = 0;
    let maxOpen = 0;
    const counting: FileAccess = {
      check: async () => undefined,
      async open() {
        open += 1;
        maxOpen = Math.max(maxOpen, open);
        const stream = Readable.from([Buffer.from('x')]);
        stream.once('end', () => {
          open -= 1;
        });
        return stream;
      },
    };
    const outcome = await writeExportArchive({ entries: entries(5) }, counting, sink().stream);
    expect(outcome).toBe('success');
    expect(maxOpen).toBe(1);
  });

  it('destroys the open source when the client disconnects', async () => {
    let source: Readable | undefined;
    const endless: FileAccess = {
      check: async () => undefined,
      async open() {
        source = new Readable({
          read() {
            setTimeout(() => this.push(Buffer.alloc(16 * 1024)), 5);
          },
        });
        return source;
      },
    };
    const output = new PassThrough();
    output.once('data', () => output.destroy());
    output.resume();
    const outcome = await writeExportArchive({ entries: entries(1) }, endless, output, 2_000);
    expect(outcome).toBe('aborted');
    expect(source?.destroyed).toBe(true);
  });

  it('skips streaming and reports aborted when the client left during preparation', async () => {
    const out = sink();
    const onReady = jest.fn();
    const outcome = await runUserExport({
      user: { id: userA.toString() },
      models,
      files: fileAccess,
      output: out.stream,
      onReady,
      isAborted: () => true,
    });
    expect(outcome).toBe('aborted');
    expect(onReady).not.toHaveBeenCalled();
    expect(out.buffer()).toHaveLength(0);
  });
});
