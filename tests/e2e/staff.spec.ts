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

test('staff page: two designs in, one 2-page PDF with the cutter dots out', async ({ page }) => {
  const res = await page.goto(`/staff/${STAFF_KEY}`);
  expect(res?.status()).toBe(200);

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
