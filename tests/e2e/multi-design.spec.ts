import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { MULTI_DESIGN_ENABLED } from '../../src/config/defaults';
import {
  TMP,
  builder,
  chooseQuantity,
  chooseShape,
  common,
  expect,
  fakeIpHeaders,
  fillDetails,
  makeFixtures,
  next,
  readyDesign,
  snap,
  test,
} from './helpers';

test.use({ extraHTTPHeaders: fakeIpHeaders() });

// Owner 2026-11-22: the feature is switched off (MULTI_DESIGN_ENABLED = false) and the checkbox is hidden.
test('the «عندي أكثر من تصميم» checkbox is hidden while multi-design orders are switched off', async ({ page }) => {
  test.skip(MULTI_DESIGN_ENABLED, 'multi-design orders are switched on');
  await page.goto('/');
  await chooseShape(page, builder.shape.rect);
  await readyDesign(page);
  await expect(page.locator('#design-file')).toBeAttached();
  await expect(page.locator('#multi-designs')).toHaveCount(0);
  await expect(page.getByText(builder.multi.checkbox)).toHaveCount(0);
});

test.describe('multi-design orders (switched on)', () => {
  test.skip(!MULTI_DESIGN_ENABLED, 'multi-design orders are switched off (MULTI_DESIGN_ENABLED = false)');

  /** A PNG with a transparent background (a «مفرغ» design). */
  async function transparentPng(): Promise<string> {
    fs.mkdirSync(TMP, { recursive: true });
    const file = path.join(TMP, `cutout-${process.pid}-${Date.now()}.png`);
    const dot = await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 20, g: 90, b: 200 } } }).png().toBuffer();
    await sharp({ create: { width: 600, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: dot, left: 150, top: 50 }])
      .png()
      .toFile(file);
    return file;
  }

  test('two designs in one order: sizes, one total count, the preview, a reload, the popup', async ({ page }, info) => {
    const { png } = await makeFixtures();
    const cutout = await transparentPng();

    await page.goto('/');
    await chooseShape(page, builder.shape.rect);
    await readyDesign(page);

    // The box turns the step into design cards; both files are picked at once.
    await page.locator('#multi-designs').check();
    await page.locator('#design-file').setInputFiles([png, cutout]);
    await expect(page.getByRole('heading', { level: 3, name: 'تصميم 1' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'تصميم 2' })).toBeVisible();
    // «مفرغ» only on the transparent one.
    await expect(page.getByText(builder.multi.cutOut, { exact: true })).toHaveCount(1);
    await snap(page, info, 'multi-01-design-cards');
    await next(page).click();

    // One size row per design, each locked to its own artwork (900x900 square, 600x400 = 3:2).
    await page.locator('#size-width').fill('4');
    await page.locator('#size-width-2').fill('6');
    await expect(page.locator('#size-height')).toHaveValue('4');
    await expect(page.locator('#size-height-2')).toHaveValue('4');
    // The preview shows both designs' cells.
    await expect(page.locator('svg:visible use').first()).toBeAttached();
    await expect(page.locator('aside li').nth(0)).toContainText('4 × 4');
    await expect(page.locator('aside li').nth(1)).toContainText('6 × 4');
    await snap(page, info, 'multi-02-size');
    await next(page).click();

    // ONE total count; each design is received sheets x copies-per-sheet times.
    await chooseQuantity(page, 'paper', 400);
    await expect(page.getByText(builder.multi.perDesignLine)).toBeVisible();
    await snap(page, info, 'multi-03-quantity');

    // A reload keeps the step, both designs and both sizes.
    await page.reload();
    await expect(page.getByRole('heading', { level: 2, name: builder.quantity.title })).toBeVisible();
    const back = page.getByRole('button', { name: common.actions.back, exact: true });
    await back.click();
    await expect(page.locator('#size-width')).toHaveValue('4');
    await expect(page.locator('#size-width-2')).toHaveValue('6');
    await back.click();
    await expect(page.getByRole('heading', { level: 3, name: 'تصميم 2' })).toBeVisible();
    await expect(page.getByText(builder.multi.cutOut, { exact: true })).toHaveCount(1);
    await next(page).click();
    await next(page).click();
    await next(page).click();

    await fillDetails(page);
    const posted = page.waitForRequest((r) => r.url().endsWith('/api/orders') && r.method() === 'POST');
    await page.getByRole('button', { name: builder.details.submit, exact: true }).click();
    const body = (await posted).postDataJSON() as { uploadId: string; designs: { uploadId: string; widthUm: number; heightUm: number }[] };
    expect(body.designs).toHaveLength(2);
    expect(body.designs[0].uploadId).toBe(body.uploadId);
    expect(body.designs[0]).toMatchObject({ widthUm: 40_000, heightUm: 40_000 });
    expect(body.designs[1]).toMatchObject({ widthUm: 60_000, heightUm: 40_000 });

    await page.waitForURL('**/order/success', { timeout: 60_000 });
    // Every order gets the popup, once; it has a close button.
    const popup = page.getByRole('dialog');
    await expect(popup).toContainText(builder.success.checkNote);
    await snap(page, info, 'multi-04-success-popup');
    await popup.getByRole('button', { name: builder.success.checkNoteClose, exact: true }).click();
    await expect(popup).toHaveCount(0);
    await snap(page, info, 'multi-05-success');
  });

  test('more than 8 designs: 8 are kept and the customer is told; removing design 1 moves the next up; unticking keeps design 1', async ({ page }) => {
    const { png, jpg } = await makeFixtures();
    const cutout = await transparentPng();
    const cards = page.getByRole('heading', { level: 3 }).filter({ hasText: /^تصميم/ });

    await page.goto('/');
    await chooseShape(page, builder.shape.rect);
    await readyDesign(page);
    await page.locator('#multi-designs').check();

    await page.locator('#design-file').setInputFiles([png, png, png, png, png, png, png, png, jpg]);
    await expect(cards).toHaveCount(8);
    await expect(page.getByRole('status').filter({ hasText: 'الحد الأقصى' })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(builder.multi.add) })).toBeDisabled();

    // Remove designs until two are left, then add the transparent one.
    for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'احذف التصميم رقم 2', exact: true }).click();
    await expect(cards).toHaveCount(2);
    await page.locator('#design-file').setInputFiles([cutout]);
    await expect(cards).toHaveCount(3);
    await expect(page.getByText(builder.multi.cutOut, { exact: true })).toHaveCount(1);

    // Removing design 1 moves the next design up: two designs left.
    await page.getByRole('button', { name: 'احذف التصميم رقم 1', exact: true }).click();
    await expect(cards).toHaveCount(2);

    // Unticking keeps design 1 and asks nothing.
    await page.locator('#multi-designs').uncheck();
    await expect(cards).toHaveCount(0);
    await expect(page.locator('img[src^="blob:"]')).toHaveCount(1);
    await next(page).click();
    await expect(page.locator('#size-width-2')).toHaveCount(0);
  });

  test('a design 1 that fails to read does not lose the other designs from the draft', async ({ page }) => {
    const { png } = await makeFixtures();
    const cutout = await transparentPng();
    const cards = page.getByRole('heading', { level: 3 }).filter({ hasText: /^تصميم/ });

    await page.goto('/');
    await chooseShape(page, builder.shape.rect);
    await readyDesign(page);
    await page.locator('#multi-designs').check();
    await page.locator('#design-file').setInputFiles([png, cutout]);
    await expect(cards).toHaveCount(2);

    // Replace design 1 with a file that cannot be read, then with a good one.
    await page.locator('#design-replace-file').setInputFiles('tests/fixtures/encrypted-marker.pdf');
    await expect(page.getByRole('alert').filter({ hasText: builder.upload.errors.corrupt })).toBeVisible();
    await page.locator('#design-file').setInputFiles([png]);
    await expect(page.getByText(builder.multi.cutOut, { exact: true })).toHaveCount(1);
    await expect(cards).toHaveCount(2);
    await next(page).click();
    await page.locator('#size-width').fill('4');
    await page.locator('#size-width-2').fill('6');
    await expect(page.locator('#size-height-2')).toHaveValue('4');

    // Both designs and both sizes come back after a reload.
    await page.reload();
    await expect(page.locator('#size-width')).toHaveValue('4');
    await expect(page.locator('#size-width-2')).toHaveValue('6');
    await page.getByRole('button', { name: common.actions.back, exact: true }).click();
    await expect(cards).toHaveCount(2);
    await expect(page.getByText(builder.multi.cutOut, { exact: true })).toHaveCount(1);
  });
});
