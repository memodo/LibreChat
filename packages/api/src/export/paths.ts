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

/** Splits a filename into a slugged stem and a sanitized lowercase extension. */
export function splitFilename(filename: string | null | undefined): { stem: string; ext: string } {
  const name = filename ?? '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) {
    return { stem: slug(name), ext: '' };
  }
  const ext = name
    .slice(dot + 1)
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .slice(0, 16)
    .toLowerCase();
  return { stem: slug(name.slice(0, dot)), ext: ext ? `.${ext}` : '' };
}

/** Sanitizes a skill file's relative path: no traversal, every segment slugged. */
export function safeRelativePath(relativePath: string): string {
  const segments = relativePath.split(/[/\\]+/).filter((s) => s && s !== '.' && s !== '..');
  if (segments.length === 0) {
    return FALLBACK_SEGMENT;
  }
  const last = splitFilename(segments[segments.length - 1]);
  const dirs = segments.slice(0, -1).map(slug);
  return [...dirs, `${last.stem}${last.ext}`].join('/');
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
