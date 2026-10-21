const MAX_SEGMENT_LENGTH = 80;
const FALLBACK_SEGMENT = 'untitled';

/** Reduces user-supplied text to one safe archive path segment (Unicode letters/digits kept). */
export function slug(value: string | null | undefined): string {
  const cleaned = (value ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SEGMENT_LENGTH)
    .replace(/-+$/, '');
  return cleaned.length > 0 ? cleaned : FALLBACK_SEGMENT;
}

const MAX_FILENAME_BYTES = 200;
const MAX_EXTENSION_BYTES = 32;
const UNSAFE_FILENAME_CHARS = new Set(['/', '\\', ':', '*', '?', '"', '<', '>', '|']);

/** Replaces characters that are unsafe in filenames on common filesystems (incl. control chars). */
const replaceUnsafe = (value: string): string =>
  Array.from(value, (char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 || UNSAFE_FILENAME_CHARS.has(char) ? '_' : char;
  }).join('');

/** Trims a string from the end until it fits in `maxBytes` of UTF-8 without splitting a character. */
const fitBytes = (value: string, maxBytes: number): string => {
  const chars = Array.from(value);
  while (chars.length > 0 && Buffer.byteLength(chars.join(''), 'utf8') > maxBytes) {
    chars.pop();
  }
  return chars.join('');
};

/**
 * Keeps an original filename as close to the user's as possible: only characters that are
 * unsafe on common filesystems become `_`, leading dots and trailing dots/spaces go, and the
 * name is capped at 200 UTF-8 bytes with its extension (case kept) preserved.
 */
export function safeFilename(filename: string | null | undefined): string {
  const cleaned = replaceUnsafe((filename ?? '').normalize('NFC'))
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');
  if (!cleaned) {
    return FALLBACK_SEGMENT;
  }
  const dot = cleaned.lastIndexOf('.');
  const hasExt = dot > 0 && Buffer.byteLength(cleaned.slice(dot), 'utf8') <= MAX_EXTENSION_BYTES;
  const ext = hasExt ? cleaned.slice(dot) : '';
  const stem = hasExt ? cleaned.slice(0, dot) : cleaned;
  const room = Math.max(MAX_FILENAME_BYTES - Buffer.byteLength(ext, 'utf8'), 1);
  return `${fitBytes(stem, room).replace(/[.\s]+$/, '') || FALLBACK_SEGMENT}${ext}`;
}

/** Splits a safe filename into stem and extension, for collision suffixes (`name-2.ext`). */
export function splitFilename(filename: string | null | undefined): { stem: string; ext: string } {
  const name = safeFilename(filename);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: '' };
}

/** A skill file's relative path with traversal and empty segments removed, otherwise verbatim. */
export function safeRelativePath(relativePath: string): string {
  const segments = relativePath
    .split(/[/\\]+/)
    .filter((s) => s && s !== '.' && s !== '..')
    .map(safeFilename);
  return segments.length > 0 ? segments.join('/') : FALLBACK_SEGMENT;
}

/**
 * Hands out archive paths that are unique per folder. Comparison is case-insensitive so
 * an archive unpacked on macOS or Windows never has two entries overwrite each other.
 */
export class PathRegistry {
  private readonly taken: Set<string> = new Set<string>();

  claim(dir: string, stem: string, ext = ''): string {
    const prefix = dir ? `${dir}/` : '';
    let candidate = `${prefix}${stem}${ext}`;
    for (let n = 2; this.taken.has(candidate.toLowerCase()); n++) {
      candidate = `${prefix}${stem}-${n}${ext}`;
    }
    this.taken.add(candidate.toLowerCase());
    return candidate;
  }
}

/** Relative link from one archive file to another, for Markdown links. */
export function relativeLink(from: string, to: string): string {
  const fromDirs = from.split('/').slice(0, -1);
  const toParts = to.split('/');
  let shared = 0;
  while (
    shared < fromDirs.length &&
    shared < toParts.length - 1 &&
    fromDirs[shared] === toParts[shared]
  ) {
    shared++;
  }
  const ups = fromDirs.length - shared;
  const path = [...Array<string>(ups).fill('..'), ...toParts.slice(shared)].join('/');
  return encodeURI(path);
}
