import fs from 'node:fs';
import path from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream, type PDFPage } from 'pdf-lib';
import { test, expect } from '@playwright/test';
import { staff } from '../../src/content/ar';

// Must match webServer.env.STAFF_PAGE_KEY in playwright.config.ts.
const STAFF_KEY = 'e2e-staff-key-e2e-staff-key-1234';
const FIXTURES = path.join(__dirname, '..', 'fixtures');

function contentOf(page: PDFPage): string {
  const ctx = page.doc.context;
  const contents = page.node.Contents();
  if (!contents) return '';
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => ctx.lookup(r)) : [contents];
  return streams
    .map((s) => {
      if (!(s instanceof PDFRawStream)) throw new Error('unexpected stream type');
      return Buffer.from(decodePDFRawStream(s).decode()).toString('latin1');
    })
    .join('\n');
}

test('staff page: a wrong key is a plain 404', async ({ page }) => {
  const res = await page.goto('/staff/wrong-key');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('button', { name: staff.download })).toHaveCount(0);
});

/**
 * `next dev` echoes every 404's own URL in the flight data's canonical-URL field
 * (`\"c\":[\"\",\"nonexistent-page\"]`); a production build serves one static page with no
 * URL in it. Remove that echo (and the per-render id) before comparing.
 */
const withoutUrlEcho = (html: string) =>
  html.replace(/\\"c\\":\[[^\]]*\]/g, '"c":[URL]').replace(/self\.__next_r="[^"]*"/g, 'self.__next_r=""');
/** `<!DOCTYPE html><html ...>` up to the end of the html start tag. */
const shellOf = (html: string) => html.slice(0, html.indexOf('>', html.indexOf('<html')) + 1);

test('staff page: a wrong key is answered exactly like an unknown URL', async ({ request }) => {
  const WRONG = 'wrong-key-xyz-wrong-key-xyz-123';
  const unknown = await request.get('/nonexistent-page');
  expect(unknown.status()).toBe(404);
  const unknownHtml = await unknown.text();
  expect(unknownHtml).toContain('<html lang="ar"');
  expect(withoutUrlEcho(unknownHtml)).not.toContain('nonexistent-page');

  for (const url of [`/staff/${WRONG}`, '/staff', `/staff/${STAFF_KEY}/extra`, `/staff/${STAFF_KEY.toUpperCase()}`]) {
    const res = await request.get(url);
    expect(res.status(), url).toBe(404);
    expect(res.headers()['referrer-policy'], url).toBeUndefined();
    const html = await res.text();
    // The same <html lang="ar" dir="rtl" ...> shell as the unknown URL, not the bare error shell.
    expect(shellOf(html), url).toBe(shellOf(unknownHtml));
    expect(html, url).not.toContain('__next_error__');
    const body = withoutUrlEcho(html);
    expect(body, url).not.toContain(WRONG);
    expect(body, url).not.toContain(STAFF_KEY);
    expect(body.toLowerCase(), url).not.toContain('staff'); // no route data naming the staff route
    expect(body, url).toBe(withoutUrlEcho(unknownHtml));
  }
});

test('staff page: two designs in, one 2-page PDF with the cutter dots out', async ({ page }) => {
  const res = await page.goto(`/staff/${STAFF_KEY}`);
  expect(res?.status()).toBe(200);
  expect(res?.headers()['referrer-policy']).toBe('no-referrer');
  expect(res?.headers()['x-robots-tag']).toBe('noindex, nofollow');

  await page.locator('#staff-files').setInputFiles([
    path.join(FIXTURES, 'padded-400x400.png'),
    path.join(FIXTURES, 'opaque-300x300.jpg'),
  ]);
  const cards = page.locator('li[data-card]');
  await expect(cards).toHaveCount(2);

  // Both cards default to a circle: one diameter field each.
  await cards.nth(0).locator('input[id^="staff-w-"]').fill('5');
  await cards.nth(1).locator('input[id^="staff-w-"]').fill('4');

  const button = page.getByRole('button', { name: staff.download });
  await expect(button).toBeEnabled();

  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  expect(download.suggestedFilename()).toMatch(/^softy-sheets-\d{8}-\d{4}\.pdf$/);
  const file = await download.path();
  expect(file).toBeTruthy();
  const bytes = fs.readFileSync(file!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');

  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(doc.getPageCount()).toBe(2);

  // One OCG, named sk_marks; each page has one dots block whose property points at it.
  const ocgs = doc.catalog.lookup(PDFName.of('OCProperties'), PDFDict).lookup(PDFName.of('OCGs'), PDFArray);
  expect(ocgs.size()).toBe(1);
  const ocg = doc.context.lookup(ocgs.get(0), PDFDict);
  expect(ocg.get(PDFName.of('Name'))?.toString()).toBe('(sk_marks)');

  doc.getPages().forEach((p) => {
    const bdc = [...contentOf(p).matchAll(/\/OC \/(\S+) BDC[\s\S]*?0 0 0 1 k[\s\S]*?f\*\s+EMC/g)];
    expect(bdc).toHaveLength(1);
    const props = (p.node.Resources() as PDFDict).lookup(PDFName.of('Properties'), PDFDict);
    expect(props.get(PDFName.of(bdc[0][1]))?.toString()).toBe(ocgs.get(0).toString());
  });
});
