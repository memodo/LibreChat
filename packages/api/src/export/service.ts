import JSZip from 'jszip';
import { Transform, pipeline } from 'stream';
import { logger } from '@librechat/data-schemas';
import type { Readable, Writable } from 'stream';
import type { ExportModels, MissingReason, StoredObject } from './types';
import type { FileAccess } from './files';
import type { Layout } from './layout';
import { createLazyStream, ExportFileError } from './files';
import { collectUserData } from './collect';
import { buildLayout } from './layout';
import { formatDate } from './markdown';

const DEFAULT_INACTIVITY_MS = 60_000;

export type ExportOutcome = 'success' | 'aborted' | 'error';

export interface ExportUser {
  id: string;
  email?: string | null;
}

export interface PreparedExport extends Layout {
  filename: string;
}

/** `memodoai-export-<local-part>-<YYYY-MM-DD>.zip` (SPEC-020 REQ-002). */
export function exportFilename(email: string | null | undefined, now: Date): string {
  const local = (email ?? '')
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  return `memodoai-export-${local || 'user'}-${formatDate(now)}.zip`;
}

/** Checks every stored object before anything is sent, one at a time (REQ-011). */
async function preflight(
  files: FileAccess,
  objects: StoredObject[],
): Promise<Map<string, MissingReason>> {
  const missing = new Map<string, MissingReason>();
  for (const object of objects) {
    try {
      await files.check(object);
    } catch (error) {
      missing.set(object.file_id, error instanceof ExportFileError ? error.reason : 'unreadable');
    }
  }
  return missing;
}

/** Collects, pre-flights and lays out one user's archive. Throws on database errors. */
export async function prepareUserExport({
  user,
  models,
  files,
  now = new Date(),
}: {
  user: ExportUser;
  models: ExportModels;
  files: FileAccess;
  now?: Date;
}): Promise<PreparedExport> {
  const data = await collectUserData(models, user.id);
  const missing = await preflight(files, [...data.files, ...data.skillFiles]);
  return { filename: exportFilename(user.email, now), ...buildLayout(data, missing, now) };
}

/**
 * Streams the archive into `output`. Text entries are deflated; stored files are stored
 * as-is and opened lazily, one at a time (REQ-002/REQ-025). If no bytes flow for
 * `inactivityMs`, the pipeline is torn down — the only guard against JSZip stalling when
 * an input fails while paused. All file streams are destroyed when the run ends.
 */
export function writeExportArchive(
  prepared: Pick<PreparedExport, 'entries'>,
  files: FileAccess,
  output: Writable,
  inactivityMs: number = DEFAULT_INACTIVITY_MS,
): Promise<ExportOutcome> {
  const zip = new JSZip();
  const sources: Readable[] = [];
  for (const entry of prepared.entries) {
    if (entry.kind === 'text') {
      zip.file(entry.path, entry.content, { compression: 'DEFLATE' });
      continue;
    }
    const source = createLazyStream(() => files.open(entry.object));
    sources.push(source);
    zip.file(entry.path, source, { compression: 'STORE', binary: true });
  }

  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    const monitor = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        arm();
        callback(null, chunk);
      },
    });
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => monitor.destroy(new Error('[export] archive stalled')),
        inactivityMs,
      );
    };

    arm();
    pipeline(
      zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true }),
      monitor,
      output,
      (error) => {
        clearTimeout(timer);
        for (const source of sources) {
          source.destroy();
        }
        resolve(error ? 'aborted' : 'success');
      },
    );
  });
}

/**
 * Full export run used by the HTTP route and the operator script: prepare, hand the
 * prepared archive to `onReady` (e.g. to set response headers), stream, and log one
 * content-free line (SEC-003).
 */
export async function runUserExport({
  user,
  models,
  files,
  output,
  onReady,
  isAborted = () => false,
  inactivityMs,
}: {
  user: ExportUser;
  models: ExportModels;
  files: FileAccess;
  output: Writable;
  onReady?: (prepared: PreparedExport) => void;
  isAborted?: () => boolean;
  inactivityMs?: number;
}): Promise<ExportOutcome> {
  const started = Date.now();
  const log = (outcome: ExportOutcome, prepared?: PreparedExport) =>
    logger.info('[export] user_export', {
      event: 'user_export',
      userId: user.id,
      outcome,
      durationMs: Date.now() - started,
      counts: prepared?.counts,
      missingFiles: prepared?.missingFiles.length,
    });

  let prepared: PreparedExport;
  try {
    prepared = await prepareUserExport({ user, models, files });
  } catch (error) {
    log('error');
    throw error;
  }

  if (isAborted()) {
    log('aborted', prepared);
    return 'aborted';
  }
  onReady?.(prepared);
  const outcome = await writeExportArchive(prepared, files, output, inactivityMs);
  log(outcome, prepared);
  return outcome;
}
