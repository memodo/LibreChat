import { Readable } from 'stream';
import { mockClient } from 'aws-sdk-client-mock';
import { sdkStreamMixin } from '@smithy/util-stream';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { StoredObject } from './types';
import { createFileAccess, createLazyStream, ExportFileError } from './files';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const s3Mock = mockClient(S3Client);

const stored = (fields: Partial<StoredObject>): StoredObject => ({
  file_id: 'f1',
  filepath: '',
  source: 's3',
  ...fields,
});

beforeAll(() => {
  process.env.AWS_REGION = 'eu-central-1';
  process.env.AWS_BUCKET_NAME = 'test-bucket';
});

beforeEach(() => {
  s3Mock.reset();
});

describe('createFileAccess', () => {
  it('checks the object under its stored key', async () => {
    s3Mock.on(HeadObjectCommand).resolves({});
    await createFileAccess().check(stored({ storageKey: 'uploads/u1/f1__Übersicht.pdf' }));
    expect(s3Mock.commandCalls(HeadObjectCommand)[0].args[0].input).toEqual({
      Bucket: 'test-bucket',
      Key: 'uploads/u1/f1__Übersicht.pdf',
    });
  });

  it('falls back to the key inside a presigned filepath when storageKey is missing', async () => {
    s3Mock.on(HeadObjectCommand).resolves({});
    await createFileAccess().check(
      stored({
        filepath: 'https://files.example.com/uploads/u1/f1__report.pdf?X-Amz-Signature=abc',
      }),
    );
    expect(s3Mock.commandCalls(HeadObjectCommand)[0].args[0].input.Key).toBe(
      'uploads/u1/f1__report.pdf',
    );
  });

  it('reports a missing object as not_found without the key or filename', async () => {
    s3Mock.on(HeadObjectCommand).rejects(Object.assign(new Error('gone'), { name: 'NotFound' }));
    const outcome = await createFileAccess()
      .check(stored({ storageKey: 'uploads/u1/f1__Geheim.pdf' }))
      .then(
        () => null,
        (e: ExportFileError) => e,
      );
    expect(outcome).toBeInstanceOf(ExportFileError);
    expect(outcome).toMatchObject({ reason: 'not_found', fileId: 'f1' });
    expect(outcome?.message).not.toContain('Geheim');
  });

  it('reports other storage failures as unreadable', async () => {
    s3Mock.on(HeadObjectCommand).rejects(new Error('socket hang up'));
    await expect(createFileAccess().check(stored({ storageKey: 'k' }))).rejects.toMatchObject({
      reason: 'unreadable',
    });
  });

  it('rejects non-S3 sources as unsupported', async () => {
    await expect(
      createFileAccess().check(stored({ source: 'local', storageKey: 'k' })),
    ).rejects.toMatchObject({ reason: 'unsupported_source' });
    expect(s3Mock.commandCalls(HeadObjectCommand)).toHaveLength(0);
  });

  it('opens the object body as a stream', async () => {
    s3Mock
      .on(GetObjectCommand)
      .resolves({ Body: sdkStreamMixin(Readable.from([Buffer.from('content')])) });
    const stream = await createFileAccess().open(stored({ storageKey: 'k' }));
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    expect(Buffer.concat(chunks).toString()).toBe('content');
  });
});

describe('createLazyStream', () => {
  it('opens its source only when first read', async () => {
    const open = jest.fn(async () => Readable.from([Buffer.from('a'), Buffer.from('b')]));
    const lazy = createLazyStream(open);
    lazy.pause();
    await new Promise((resolve) => setImmediate(resolve));
    expect(open).not.toHaveBeenCalled();

    const chunks: Buffer[] = [];
    for await (const chunk of lazy) {
      chunks.push(chunk as Buffer);
    }
    expect(open).toHaveBeenCalledTimes(1);
    expect(Buffer.concat(chunks).toString()).toBe('ab');
  });

  it('forwards an open failure as a stream error', async () => {
    const lazy = createLazyStream(async () => {
      throw new ExportFileError('not_found', 'f1');
    });
    await expect(
      (async () => {
        for await (const chunk of lazy) {
          void chunk;
        }
      })(),
    ).rejects.toMatchObject({ reason: 'not_found' });
  });

  it('destroys the source when destroyed', async () => {
    const source = new Readable({ read() {} });
    const lazy = createLazyStream(async () => source);
    lazy.resume();
    await new Promise((resolve) => setImmediate(resolve));
    lazy.destroy();
    expect(source.destroyed).toBe(true);
  });
});
