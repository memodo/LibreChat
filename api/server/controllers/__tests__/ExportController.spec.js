const http = require('http');
const JSZip = require('jszip');
const express = require('express');
const mongoose = require('mongoose');
const compression = require('compression');
const { Readable } = require('stream');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createModels } = require('@librechat/data-schemas');
const { createExportController } = require('~/server/controllers/ExportController');

const USERS = ['u1', 'u2'].map((name) => ({ name, id: new mongoose.Types.ObjectId() }));
const idOf = (name) => USERS.find((u) => u.name === name).id.toString();

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  const db = mongoose.connection;
  for (const { name, id } of USERS) {
    await db.collection('conversations').insertOne({
      conversationId: `c-${name}`,
      user: id.toString(),
      title: `Chat ${name}`,
      createdAt: new Date('2026-05-01T08:00:00Z'),
    });
    await db.collection('messages').insertOne({
      messageId: `m-${name}`,
      conversationId: `c-${name}`,
      user: id.toString(),
      parentMessageId: null,
      isCreatedByUser: true,
      text: `Hallo von ${name}`,
      files: [{ file_id: `f-${name}` }],
      createdAt: new Date('2026-05-01T08:00:00Z'),
    });
    await db.collection('files').insertOne({
      file_id: `f-${name}`,
      user: id,
      filename: `Datei ${name}.pdf`,
      filepath: `uploads/${id}/f-${name}__Datei.pdf`,
      storageKey: `uploads/${id}/f-${name}__Datei.pdf`,
      source: 's3',
      bytes: 10,
      type: 'application/pdf',
    });
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

/**
 * File access whose behaviour the test controls: `instant` serves bytes at once,
 * `gated` sends one chunk and waits for `release()`, `stalled` never opens,
 * `slowCheck` blocks pre-flight until `release()`.
 */
function controllableFiles() {
  const state = { mode: 'instant', opened: [], waiting: [], checks: 0 };
  const release = () => state.waiting.splice(0).forEach((resume) => resume());
  const files = {
    check: () => {
      state.checks += 1;
      if (state.mode !== 'slowCheck') {
        return Promise.resolve();
      }
      return new Promise((resolve) => state.waiting.push(resolve));
    },
    open: () => {
      if (state.mode === 'stalled') {
        return new Promise(() => undefined);
      }
      if (state.mode !== 'gated') {
        return Promise.resolve(Readable.from([Buffer.from('file-bytes')]));
      }
      const stream = new Readable({ read() {} });
      stream.push(Buffer.from('file-bytes'));
      state.waiting.push(() => stream.push(null));
      state.opened.push(stream);
      return Promise.resolve(stream);
    },
  };
  return { state, files, release };
}

async function startApp(options) {
  const app = express();
  app.use(compression());
  app.get(
    '/export',
    (req, res, next) => {
      const name = req.get('x-user');
      req.user = { id: idOf(name), email: `${name}@memodo.de` };
      next();
    },
    createExportController(options),
  );
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

/** Starts a request; `response` resolves on headers, `done` on the full body (or error). */
function get(server, user) {
  let request;
  const response = new Promise((resolve, reject) => {
    request = http.get(
      { port: server.address().port, path: '/export', headers: { 'x-user': user } },
      resolve,
    );
    request.on('error', reject);
  });
  const done = response.then(
    (res) =>
      new Promise((resolve) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ res, body: Buffer.concat(chunks), ended: true }));
        res.on('aborted', () => resolve({ res, body: Buffer.concat(chunks), ended: false }));
        res.on('error', () => resolve({ res, body: Buffer.concat(chunks), ended: false }));
      }),
    () => ({ res: undefined, body: Buffer.alloc(0), ended: false }),
  );
  return { request, response, done };
}

const waitFor = async (condition, timeoutMs = 3_000) => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const closeServer = (server) =>
  new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  });

describe('GET /api/user/export (real HTTP)', () => {
  it('streams a valid zip with download headers through compression()', async () => {
    const { files } = controllableFiles();
    const server = await startApp({ fileAccess: () => files });
    try {
      const { res, body } = await get(server, 'u1').done;
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/zip');
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="memodoai-export-u1-\d{4}-\d{2}-\d{2}\.zip"$/,
      );
      expect(res.headers['content-encoding']).toBeUndefined();

      const zip = await JSZip.loadAsync(body);
      expect(zip.file('files/2026-05-01-Chat-u1/Datei u1.pdf')).not.toBeNull();
      expect(await zip.file('conversations/2026-05-01-Chat-u1.md').async('string')).toContain(
        'Hallo von u1',
      );
      expect(Object.keys(zip.files).join()).not.toContain('u2');
    } finally {
      await closeServer(server);
    }
  });

  it('allows one export per user while one is streaming', async () => {
    const { state, files, release } = controllableFiles();
    state.mode = 'gated';
    const server = await startApp({ fileAccess: () => files });
    try {
      const first = get(server, 'u1');
      await first.response;
      await waitFor(() => state.opened.length === 1);

      const second = await get(server, 'u1').done;
      expect(second.res.statusCode).toBe(429);
      expect(JSON.parse(second.body.toString())).toEqual({ error: 'export_in_progress' });

      release();
      const { res, ended } = await first.done;
      expect(res.statusCode).toBe(200);
      expect(ended).toBe(true);
    } finally {
      await closeServer(server);
    }
  });

  it('caps concurrent exports server-wide', async () => {
    const { state, files, release } = controllableFiles();
    state.mode = 'gated';
    const server = await startApp({ fileAccess: () => files, maxConcurrent: 1 });
    try {
      const first = get(server, 'u1');
      await first.response;
      await waitFor(() => state.opened.length === 1);

      const other = await get(server, 'u2').done;
      expect(other.res.statusCode).toBe(429);
      expect(JSON.parse(other.body.toString())).toEqual({ error: 'export_busy' });

      release();
      await first.done;
    } finally {
      await closeServer(server);
    }
  });

  it('destroys the open file and frees the slot when the client aborts mid-stream', async () => {
    const { state, files } = controllableFiles();
    state.mode = 'gated';
    const server = await startApp({ fileAccess: () => files });
    try {
      const first = get(server, 'u1');
      await first.response;
      await waitFor(() => state.opened.length === 1);
      first.request.destroy();

      await waitFor(() => state.opened[0].destroyed);
      state.mode = 'instant';
      const again = await get(server, 'u1').done;
      expect(again.res.statusCode).toBe(200);
    } finally {
      await closeServer(server);
    }
  });

  it('holds the slot during preparation even if the client leaves, so retries cannot stack', async () => {
    const { state, files, release } = controllableFiles();
    state.mode = 'slowCheck';
    const server = await startApp({ fileAccess: () => files });
    try {
      const first = get(server, 'u1');
      await waitFor(() => state.checks === 1);
      first.request.destroy();
      await first.done;

      const retry = await get(server, 'u1').done;
      expect(retry.res.statusCode).toBe(429);

      state.mode = 'instant';
      release();
      await waitFor(() => state.waiting.length === 0);
      let status;
      for (let attempt = 0; attempt < 20 && status !== 200; attempt++) {
        status = (await get(server, 'u1').done).res.statusCode;
        if (status !== 200) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
      expect(status).toBe(200);
    } finally {
      await closeServer(server);
    }
  });

  it('aborts a stalled stream via the watchdog and frees the slot', async () => {
    const { state, files } = controllableFiles();
    state.mode = 'stalled';
    const server = await startApp({ fileAccess: () => files, inactivityMs: 150 });
    try {
      const stalled = await get(server, 'u1').done;
      expect(stalled.ended).toBe(false);

      state.mode = 'instant';
      const again = await get(server, 'u1').done;
      expect(again.res.statusCode).toBe(200);
    } finally {
      await closeServer(server);
    }
  });

  it('answers 500 JSON without zip headers when preparation fails', async () => {
    const { files } = controllableFiles();
    const find = jest.spyOn(mongoose.models.Conversation, 'find').mockImplementationOnce(() => {
      throw new Error('mongo down');
    });
    const server = await startApp({ fileAccess: () => files });
    try {
      const { res, body } = await get(server, 'u1').done;
      expect(res.statusCode).toBe(500);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.headers['content-disposition']).toBeUndefined();
      expect(JSON.parse(body.toString())).toEqual({ error: 'export_failed' });
    } finally {
      find.mockRestore();
      await closeServer(server);
    }
  });
});
