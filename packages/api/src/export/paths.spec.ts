import {
  slug,
  safeFilename,
  splitFilename,
  safeRelativePath,
  PathRegistry,
  relativeLink,
} from './paths';

describe('slug', () => {
  it('keeps unicode letters and digits', () => {
    expect(slug('Übersicht Q3 Größe')).toBe('Übersicht-Q3-Größe');
  });

  it('replaces separators, traversal and control characters', () => {
    expect(slug('../../etc/passwd')).toBe('etc-passwd');
    expect(slug('a/b\\c\u0000d')).toBe('a-b-c-d');
    expect(slug('.hidden')).toBe('hidden');
  });

  it('drops emoji and collapses dashes', () => {
    expect(slug('🎉 Party -- Plan 🎉')).toBe('Party-Plan');
  });

  it('caps length at 80 without a trailing dash', () => {
    const result = slug(`${'a'.repeat(79)} ${'b'.repeat(200)}`);
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result.endsWith('-')).toBe(false);
  });

  it('falls back to untitled', () => {
    expect(slug('')).toBe('untitled');
    expect(slug(undefined)).toBe('untitled');
    expect(slug('🎉🎉')).toBe('untitled');
  });
});

describe('safeFilename', () => {
  it('keeps the original name, punctuation and extension case', () => {
    expect(safeFilename('Angebot (final) v2.1_Kunde.pdf')).toBe('Angebot (final) v2.1_Kunde.pdf');
    expect(safeFilename('Q3_Report.XLSX')).toBe('Q3_Report.XLSX');
    expect(safeFilename('Übersicht & Plan.docx')).toBe('Übersicht & Plan.docx');
  });

  it('replaces only characters that are unsafe on disk', () => {
    expect(safeFilename('a/b\\c:d*e?f"g<h>i|j.txt')).toBe('a_b_c_d_e_f_g_h_i_j.txt');
    expect(safeFilename('bad\u0000name\u0007.pdf')).toBe('bad_name_.pdf');
  });

  it('removes leading dots and trailing dots or spaces', () => {
    expect(safeFilename('..env')).toBe('env');
    expect(safeFilename('notes. ')).toBe('notes');
    expect(safeFilename('..')).toBe('untitled');
    expect(safeFilename('')).toBe('untitled');
  });

  it('caps the name at 200 UTF-8 bytes and keeps the extension', () => {
    const result = safeFilename(`${'ä'.repeat(300)}.pdf`);
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(200);
    expect(result.endsWith('.pdf')).toBe(true);
  });
});

describe('splitFilename', () => {
  it('separates stem and extension for collision suffixes', () => {
    expect(splitFilename('Q3_Report.XLSX')).toEqual({ stem: 'Q3_Report', ext: '.XLSX' });
    expect(splitFilename('README')).toEqual({ stem: 'README', ext: '' });
  });
});

describe('safeRelativePath', () => {
  it('removes traversal segments', () => {
    expect(safeRelativePath('../../etc/passwd')).toBe('etc/passwd');
    expect(safeRelativePath('..\\..\\x.sh')).toBe('x.sh');
  });

  it('keeps skill paths verbatim so SKILL.md references still resolve', () => {
    expect(safeRelativePath('scripts/check_offer.py')).toBe('scripts/check_offer.py');
    expect(safeRelativePath('references/api.v2.md')).toBe('references/api.v2.md');
  });

  it('falls back when nothing is left', () => {
    expect(safeRelativePath('../..')).toBe('untitled');
  });
});

describe('PathRegistry', () => {
  it('suffixes collisions case-insensitively', () => {
    const registry = new PathRegistry();
    expect(registry.claim('files', 'Report', '.pdf')).toBe('files/Report.pdf');
    expect(registry.claim('files', 'report', '.pdf')).toBe('files/report-2.pdf');
    expect(registry.claim('files', 'Report', '.pdf')).toBe('files/Report-3.pdf');
    expect(registry.claim('other', 'Report', '.pdf')).toBe('other/Report.pdf');
  });
});

describe('relativeLink', () => {
  it('walks up to the shared root', () => {
    expect(relativeLink('conversations/p/a.md', 'files/a/x.pdf')).toBe('../../files/a/x.pdf');
    expect(relativeLink('conversations/a.md', 'artifacts/a/b.html')).toBe('../artifacts/a/b.html');
  });

  it('encodes spaces and unicode for Markdown links', () => {
    expect(relativeLink('a.md', 'files/Ü x.pdf')).toBe('files/%C3%9C%20x.pdf');
  });
});
