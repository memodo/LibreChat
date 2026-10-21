import { Readable } from 'stream';
import { FileSources } from 'librechat-data-provider';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import type { MissingReason, StoredObject } from './types';
import { resolveStoredS3Key } from '~/storage/s3/crud';
import { initializeS3 } from '~/cdn/s3';

/** Content-free error: carries only a reason and the file id, never keys or filenames. */
export class ExportFileError extends Error {
  readonly reason: MissingReason;
  readonly fileId: string;

  constructor(reason: MissingReason, fileId: string) {
    super(`[export] file ${fileId} ${reason}`);
    this.name = 'ExportFileError';
    this.reason = reason;
    this.fileId = fileId;
  }
}

export interface FileAccess {
  /** Resolves when the object exists; rejects with an `ExportFileError` otherwise. */
  check(file: StoredObject): Promise<void>;
  open(file: StoredObject): Promise<Readable>;
}

type S3Target = { s3: S3Client; Bucket: string; Key: string };

/** Upper bound for MinIO to answer a HEAD or start a GET; a stalled store fails fast instead of hanging the export. */
const STORAGE_RESPONSE_TIMEOUT_MS = 15_000;

const isNotFound = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'NotFound' || error.name === 'NoSuchKey');

function resolveTarget(file: StoredObject): S3Target {
  if (file.source !== FileSources.s3) {
    throw new ExportFileError('unsupported_source', file.file_id);
  }
  const s3 = initializeS3();
  const Bucket = process.env.AWS_BUCKET_NAME;
  if (!s3 || !Bucket) {
    throw new ExportFileError('unreadable', file.file_id);
  }
  let Key = '';
  try {
    Key = resolveStoredS3Key(file);
  } catch {
    throw new ExportFileError('unreadable', file.file_id);
  }
  if (!Key) {
    throw new ExportFileError('unreadable', file.file_id);
  }
  return { s3, Bucket, Key };
}

/** S3-backed file access shared by the HTTP export and the operator script (SPEC-020 REQ-026). */
export function createFileAccess(): FileAccess {
  return {
    async check(file) {
      const { s3, Bucket, Key } = resolveTarget(file);
      try {
        await s3.send(new HeadObjectCommand({ Bucket, Key }), {
          abortSignal: AbortSignal.timeout(STORAGE_RESPONSE_TIMEOUT_MS),
        });
      } catch (error) {
        throw new ExportFileError(isNotFound(error) ? 'not_found' : 'unreadable', file.file_id);
      }
    },
    async open(file) {
      const { s3, Bucket, Key } = resolveTarget(file);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), STORAGE_RESPONSE_TIMEOUT_MS);
      try {
        const { Body } = await s3.send(new GetObjectCommand({ Bucket, Key }), {
          abortSignal: controller.signal,
        });
        if (!(Body instanceof Readable)) {
          throw new ExportFileError('unreadable', file.file_id);
        }
        return Body;
      } catch (error) {
        if (error instanceof ExportFileError) {
          throw error;
        }
        throw new ExportFileError(isNotFound(error) ? 'not_found' : 'unreadable', file.file_id);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * A Readable that opens its source on the first read and relays it with backpressure.
 * JSZip pauses every input when it is added and resumes one entry at a time, so wrapping
 * each file this way keeps at most one storage object open per export.
 */
export function createLazyStream(open: () => Promise<Readable>): Readable {
  let source: Readable | undefined;
  let opening = false;

  const lazy = new Readable({
    read() {
      if (source) {
        source.resume();
        return;
      }
      if (opening) {
        return;
      }
      opening = true;
      open().then(
        (stream) => {
          if (lazy.destroyed) {
            stream.destroy();
            return;
          }
          source = stream;
          stream.on('data', (chunk: Buffer) => {
            if (!lazy.push(chunk)) {
              stream.pause();
            }
          });
          stream.once('end', () => lazy.push(null));
          stream.once('error', (error: Error) => lazy.destroy(error));
        },
        (error: Error) => lazy.destroy(error),
      );
    },
    destroy(error, callback) {
      source?.destroy();
      callback(error);
    },
  });

  return lazy;
}
