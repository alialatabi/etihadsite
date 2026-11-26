import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SheetDownloadButton } from '@/app/admin/designs/SheetDownloadButton';
import { errorMessageOf, FALLBACK_SHEET_NAME, filenameFromDisposition } from '@/app/admin/designs/sheet-download';
import { DRAFT_TTL_MS } from '@/components/builder/logic';
import { DESIGN_DELETE_MIN_AGE_MS } from '@/config/defaults';
import { admin } from '@/content/ar';

describe('filenameFromDisposition', () => {
  it('reads the quoted name the sheet route sends', () => {
    expect(filenameFromDisposition('attachment; filename="softy-sheet-circle-30x30mm-x54.pdf"')).toBe('softy-sheet-circle-30x30mm-x54.pdf');
    expect(filenameFromDisposition('attachment; filename=plain.pdf')).toBe('plain.pdf');
  });

  it('falls back when there is no name, and never lets a path or control characters through', () => {
    expect(filenameFromDisposition(null)).toBe(FALLBACK_SHEET_NAME);
    expect(filenameFromDisposition('inline')).toBe(FALLBACK_SHEET_NAME);
    expect(filenameFromDisposition('attachment; filename="../../evil.pdf"')).toBe('evil.pdf');
    expect(filenameFromDisposition('attachment; filename="a\\b.pdf"')).toBe('ab.pdf');
    expect(filenameFromDisposition('attachment; filename=".."')).toBe(FALLBACK_SHEET_NAME);
  });
});

describe('errorMessageOf', () => {
  it('takes the route message only when it is a non-empty string', () => {
    expect(errorMessageOf({ error: 'too_big', message: 'x' })).toBe('x');
    expect(errorMessageOf({ message: '  ' })).toBeNull();
    expect(errorMessageOf({ message: 3 })).toBeNull();
    expect(errorMessageOf(null)).toBeNull();
    expect(errorMessageOf('text')).toBeNull();
  });
});

describe('SheetDownloadButton', () => {
  it('renders an enabled, at-least-44px button with the download label and no error', () => {
    const html = renderToStaticMarkup(createElement(SheetDownloadButton, { href: '/api/admin/designs/upload_a12345/sheet' }));
    expect(html).toContain(admin.designs.card.downloadSheet);
    expect(html).toContain('min-h-11');
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('role="alert"');
  });
});

describe('DESIGN_DELETE_MIN_AGE_MS', () => {
  it('is at least the builder draft lifetime', () => {
    expect(DESIGN_DELETE_MIN_AGE_MS).toBeGreaterThanOrEqual(DRAFT_TTL_MS);
  });
});
