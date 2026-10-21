const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const mongoose = require('mongoose');
const { Readable } = require('stream');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createModels } = require('@librechat/data-schemas');
const { exportUser } = require('~/server/scripts/export');

const files = {
  check: async () => undefined,
  open: async () => Readable.from([Buffer.from('pdf-bytes')]),
};

let mongoServer;
let models;
let outDir;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  models = createModels(mongoose);
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-'));

  const user = await models.User.create({
    email: 'anna.muster@memodo.de',
    name: 'Anna',
    provider: 'local',
  });
  const id = user._id.toString();
  await mongoose.connection.collection('conversations').insertOne({
    conversationId: 'c1',
    user: id,
    title: 'Angebot',
    createdAt: new Date('2026-05-01T08:00:00Z'),
  });
  await mongoose.connection.collection('messages').insertOne({
    messageId: 'm1',
    conversationId: 'c1',
    user: id,
    parentMessageId: null,
    isCreatedByUser: true,
    text: 'Hallo',
    files: [{ file_id: 'f1' }],
    createdAt: new Date('2026-05-01T08:00:00Z'),
  });
  await mongoose.connection.collection('files').insertOne({
    file_id: 'f1',
    user: user._id,
    filename: 'Angebot.pdf',
    filepath: 'uploads/x/f1__Angebot.pdf',
    storageKey: 'uploads/x/f1__Angebot.pdf',
    source: 's3',
    bytes: 9,
    type: 'application/pdf',
  });
});

afterAll(async () => {
  fs.rmSync(outDir, { recursive: true, force: true });
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('export operator script', () => {
  it('writes the same archive as the HTTP export for a user found by email', async () => {
    const result = await exportUser({ email: ' Anna.Muster@memodo.de ', outDir, models, files });

    expect(path.basename(result.path)).toMatch(
      /^memodoai-export-anna\.muster-\d{4}-\d{2}-\d{2}\.zip$/,
    );
    const zip = await JSZip.loadAsync(fs.readFileSync(result.path));
    expect(Object.keys(zip.files).sort()).toEqual([
      'README.md',
      'conversations/2026-05-01-Angebot.md',
      'files/2026-05-01-Angebot/Angebot.pdf',
      'manifest.json',
    ]);
    expect(await zip.file('files/2026-05-01-Angebot/Angebot.pdf').async('string')).toBe(
      'pdf-bytes',
    );
  });

  it('fails clearly for an unknown email', async () => {
    await expect(exportUser({ email: 'nobody@memodo.de', outDir, models, files })).rejects.toThrow(
      'No user with that email',
    );
  });
});
