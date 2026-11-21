import fs from 'node:fs';
import path from 'node:path';
import {
  ORDERS_DIR,
  builder,
  common,
  chooseQuantity,
  chooseShape,
  expect,
  fakeIpHeaders,
  fillDetails,
  makeFixtures,
  next,
  perSheetBadge,
  readyDesign,
  setSize,
  snap,
  test,
  upload,
} from './helpers';
import { MOCK_BRIEF } from './openai-mock';

test.use({ extraHTTPHeaders: fakeIpHeaders() });

/**
 * The AI designer end to end, against the OpenAI mock started by global-setup.ts:
 * idea → text review → generate → accept → arrangement → quantity → details → submit.
 */
test('AI design: idea → review → generate → accept → order', async ({ page }, info) => {
  // The accepted design is already on the server: submitting must not upload it again.
  const uploads: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/api\/upload/.test(r.url())) uploads.push(r.url());
  });

  await page.goto('/');
  await chooseShape(page, builder.shape.circle);
  await setSize(page, '3');
  await page.locator('#ai-idea').fill('ستيكر مكتوب عليه مقهي الورد وبيه كوب قهوة');
  await page.getByRole('button', { name: builder.ai.generate, exact: true }).click();

  // The review box: the exact line to print, with the spelling fix shown.
  await expect(page.locator('#ai-line-0')).toHaveValue(MOCK_BRIEF.printed_text[0]);
  await expect(page.getByText(builder.ai.fixesTitle)).toBeVisible();
  await snap(page, info, 'ai-01-review');
  await page.getByRole('button', { name: builder.ai.confirm, exact: true }).click();

  // The result, then accept.
  const accept = page.getByRole('button', { name: builder.ai.accept, exact: true });
  await expect(accept).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(builder.ai.printedText)).toBeVisible();
  await snap(page, info, 'ai-02-result');
  await accept.click();

  // The arrangement step with the typed size kept.
  await expect(page.getByRole('heading', { level: 2, name: builder.size.title })).toBeVisible();
  await expect(page.locator('#size-width')).toHaveValue('3');
  await expect(perSheetBadge(page, 54)).toBeVisible();
  await snap(page, info, 'ai-03-arrangement');
  await next(page).click();

  await chooseQuantity(page, 'plastic', 1050);
  await expect(page.locator('#qty-result')).toContainText('1,080');
  await next(page).click();

  await fillDetails(page);
  await page.getByRole('button', { name: builder.details.submit, exact: true }).click();
  await page.waitForURL('**/order/success', { timeout: 60_000 });
  await snap(page, info, 'ai-04-success');

  expect(uploads, 'the generated design is not uploaded again').toEqual([]);
  const displayNo = (await page.getByText(/EP-\d{6}-[A-Z0-9]{4}/).first().textContent())!.match(/EP-\d{6}-[A-Z0-9]{4}/)![0];
  const hit = fs
    .readdirSync(ORDERS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(ORDERS_DIR, f), 'utf8')))
    .find((j) => j.displayNo === displayNo);
  expect(hit, `order json for ${displayNo}`).toBeTruthy();
  // The order was made from the generated file itself (an opaque PNG is stored by the order pipeline as JPEG).
  expect(hit.design.originalName).toBe('ai-design.png');
  expect(hit.layout.countPerSheet).toBe(54);
});

test('a shrunk AI design shows the text-size warning', async ({ page }) => {
  await page.goto('/');
  await chooseShape(page, builder.shape.circle);
  await setSize(page, '4');
  await page.locator('#ai-idea').fill('مقهي الورد');
  await page.getByRole('button', { name: builder.ai.generate, exact: true }).click();
  await page.getByRole('button', { name: builder.ai.confirm, exact: true }).click();
  await page.getByRole('button', { name: builder.ai.accept, exact: true }).click({ timeout: 60_000 });

  await expect(page.getByRole('heading', { level: 2, name: builder.size.title })).toBeVisible();
  await expect(page.getByText(builder.ai.shrinkWarning)).toHaveCount(0);
  await setSize(page, '3');
  await expect(page.getByText(builder.ai.shrinkWarning)).toBeVisible();
});

test('with a reference image, the accepted design survives a reload and is still not uploaded again', async ({ page }) => {
  const { png } = await makeFixtures();
  const uploads: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/api\/upload/.test(r.url())) uploads.push(r.url());
  });

  await page.goto('/');
  await chooseShape(page, builder.shape.circle);
  await setSize(page, '3');
  await page.locator('#ai-idea').fill('مقهي الورد');
  await page.locator('#ai-refs').setInputFiles(png);
  await expect(page.getByRole('button', { name: builder.ai.removeRef })).toBeVisible();
  await page.getByRole('button', { name: builder.ai.generate, exact: true }).click();
  await page.getByRole('button', { name: builder.ai.confirm, exact: true }).click();
  await page.getByRole('button', { name: builder.ai.accept, exact: true }).click({ timeout: 60_000 });
  // The reference image went up once (it goes to /images/edits); nothing else.
  expect(uploads.length).toBeGreaterThan(0);
  uploads.length = 0;

  await expect(page.getByRole('heading', { level: 2, name: builder.size.title })).toBeVisible();
  await expect(perSheetBadge(page, 54)).toBeVisible();
  await next(page).click();
  await chooseQuantity(page, 'plastic', 1050);
  await expect(page.locator('#qty-result')).toContainText('1,080');

  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: builder.quantity.title })).toBeVisible();
  await expect(page.locator('#stickers-input')).toHaveValue('1050');
  await next(page).click();
  await fillDetails(page);
  await page.getByRole('button', { name: builder.details.submit, exact: true }).click();
  await page.waitForURL('**/order/success', { timeout: 60_000 });
  expect(uploads, 'the restored AI design is not uploaded again').toEqual([]);
});

test('too much text: a warning, and the confirm button stays enabled', async ({ page }) => {
  await page.goto('/');
  await chooseShape(page, builder.shape.circle);
  await setSize(page, '1');
  await page.locator('#ai-idea').fill('مقهي الورد');
  await page.getByRole('button', { name: builder.ai.generate, exact: true }).click();
  await expect(page.locator('#ai-line-0')).toHaveValue(MOCK_BRIEF.printed_text[0]);
  // Both wordings (with or without a recommended size) start with this sentence.
  const warning = page.getByRole('status').filter({ hasText: builder.ai.tooMuchTextReduce.split('،')[0] });
  await expect(warning).toBeVisible();
  await expect(page.getByRole('button', { name: builder.ai.confirm, exact: true })).toBeEnabled();

  // The customer goes on anyway: the design step shows the same warning beside the result.
  await page.getByRole('button', { name: builder.ai.confirm, exact: true }).click();
  const accept = page.getByRole('button', { name: builder.ai.accept, exact: true });
  await expect(accept).toBeVisible({ timeout: 60_000 });
  await expect(warning).toBeVisible();

  // Accepted anyway: the arrangement step warns too, also after a reload (the printed lines are kept in the draft).
  await expect(accept).toBeEnabled();
  await accept.click();
  await expect(page.getByRole('heading', { level: 2, name: builder.size.title })).toBeVisible();
  await expect(warning).toBeVisible();
  await expect(page.getByText(builder.ai.shrinkWarning)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: builder.size.title })).toBeVisible();
  await expect(warning).toBeVisible();
});

test('AI unavailable: a notice, and «عندي تصميم جاهز» still leads to the upload', async ({ page }) => {
  await page.route('**/api/design/brief', (route) => route.fulfill({ status: 503, json: { ok: false, error: 'unavailable' } }));
  const { png } = await makeFixtures();
  await page.goto('/');
  await chooseShape(page, builder.shape.circle);
  await setSize(page, '3');
  await page.locator('#ai-idea').fill('مقهي الورد');
  await page.getByRole('button', { name: builder.ai.generate, exact: true }).click();
  await expect(page.getByText(builder.ai.unavailable)).toBeVisible();
  await expect(page.locator('#ai-idea')).toHaveCount(0);

  await readyDesign(page);
  await upload(page, png);
  await expect(page.locator('img[src^="blob:"]').first()).toBeVisible();
  await next(page).click();
  await expect(perSheetBadge(page, 54)).toBeVisible();
});

test('an upload customer who only tries the idea box keeps the upload step', async ({ page }) => {
  await page.route('**/api/design/brief', (route) => route.fulfill({ status: 500, json: { ok: false, error: 'failed' } }));
  const { png } = await makeFixtures();
  await page.goto('/');
  await chooseShape(page, builder.shape.circle);
  // The AI page does not give the upload-only PNG advice for custom shapes.
  await expect(page.getByText(builder.shape.customHintAi)).toBeVisible();
  await readyDesign(page);
  await upload(page, png);
  await expect(page.locator('img[src^="blob:"]').first()).toBeVisible();

  await page.getByRole('button', { name: common.actions.back, exact: true }).click();
  await expect(page.getByText(builder.shape.customHint)).toBeVisible();
  await setSize(page, '3');
  await page.locator('#ai-idea').fill('مقهي الورد');
  await page.getByRole('button', { name: builder.ai.generate, exact: true }).click();
  await expect(page.getByText(builder.ai.errors.failed)).toBeVisible();

  // Still an upload: Next is there and the design step is the upload, with the file.
  await next(page).click();
  await expect(page.getByRole('heading', { level: 2, name: builder.upload.title })).toBeVisible();
  await expect(page.getByRole('button', { name: builder.upload.replace })).toBeVisible();
});

test('after accepting an AI design, an own upload replaces it and is uploaded at submit', async ({ page }) => {
  const { png } = await makeFixtures();
  const uploads: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/api\/upload/.test(r.url())) uploads.push(r.url());
  });
  await page.goto('/');
  await chooseShape(page, builder.shape.circle);
  await setSize(page, '3');
  await page.locator('#ai-idea').fill('مقهي الورد');
  await page.getByRole('button', { name: builder.ai.generate, exact: true }).click();
  await page.getByRole('button', { name: builder.ai.confirm, exact: true }).click();
  await page.getByRole('button', { name: builder.ai.accept, exact: true }).click({ timeout: 60_000 });
  await expect(page.getByRole('heading', { level: 2, name: builder.size.title })).toBeVisible();

  // Back to page 1, «عندي تصميم جاهز», own file.
  const back = page.getByRole('button', { name: common.actions.back, exact: true });
  await back.click();
  await back.click();
  await readyDesign(page);
  await upload(page, png);
  await expect(page.getByText(/design-.*\.png/)).toBeVisible();
  await next(page).click();
  await expect(perSheetBadge(page, 54)).toBeVisible();
  await next(page).click();
  await chooseQuantity(page, 'plastic', 1050);
  await next(page).click();
  await fillDetails(page);
  await page.getByRole('button', { name: builder.details.submit, exact: true }).click();
  await page.waitForURL('**/order/success', { timeout: 60_000 });
  expect(uploads.length, 'the own file is uploaded').toBeGreaterThan(0);
});

// Own IP per describe: each block makes one more counted generation (5 per IP per day).
test.describe('a failed retry keeps the paid result', () => {
  test.use({ extraHTTPHeaders: fakeIpHeaders() });

  test('generate → the retry fails → the first design is still accepted and ordered', async ({ page }) => {
    const uploads: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/api\/upload/.test(r.url())) uploads.push(r.url());
    });

    await page.goto('/');
    await chooseShape(page, builder.shape.circle);
    await setSize(page, '3');
    await page.locator('#ai-idea').fill('مقهي الورد');
    await page.getByRole('button', { name: builder.ai.generate, exact: true }).click();
    await page.getByRole('button', { name: builder.ai.confirm, exact: true }).click();
    const accept = page.getByRole('button', { name: builder.ai.accept, exact: true });
    await expect(accept).toBeVisible({ timeout: 60_000 });

    // The next try fails on the server (not counted): the paid design stays, with the error above it.
    await page.route('**/api/design/generate', (route) => route.fulfill({ status: 500, json: { ok: false, error: 'failed' } }));
    await page.getByRole('button', { name: builder.ai.retry, exact: true }).click();
    await expect(page.getByText(builder.ai.errors.failed)).toBeVisible();
    await expect(accept).toBeEnabled();
    await expect(page.getByText(builder.ai.printedText)).toBeVisible();
    // No generic Next while the result waits for «أكمل بهذا».
    await expect(page.getByRole('button', { name: common.actions.next, exact: true })).toHaveCount(0);

    // «عدّل الفكرة» and back: the design is still reachable, without the old message.
    await page.getByRole('button', { name: builder.ai.editIdea, exact: true }).click();
    await page.getByRole('button', { name: builder.ai.viewResult, exact: true }).click();
    await expect(accept).toBeEnabled();
    await expect(page.getByText(builder.ai.errors.failed)).toHaveCount(0);
    await accept.click();

    const sizeHeading = page.getByRole('heading', { level: 2, name: builder.size.title });
    await expect(sizeHeading).toBeVisible();
    // Page 1 does not bring the failed retry's message back for the design that was accepted.
    const back = page.getByRole('button', { name: common.actions.back, exact: true });
    await back.click();
    await expect(page.getByRole('heading', { level: 2, name: builder.steps.design })).toBeVisible();
    await back.click();
    await expect(page.locator('#ai-idea')).toBeVisible();
    await expect(page.getByText(builder.ai.errors.failed)).toHaveCount(0);
    await next(page).click();
    await expect(page.getByRole('heading', { level: 2, name: builder.steps.design })).toBeVisible();
    await next(page).click();

    await expect(sizeHeading).toBeVisible();
    await expect(perSheetBadge(page, 54)).toBeVisible();
    await next(page).click();
    await chooseQuantity(page, 'plastic', 1050);
    await next(page).click();
    await fillDetails(page);
    await page.getByRole('button', { name: builder.details.submit, exact: true }).click();
    await page.waitForURL('**/order/success', { timeout: 60_000 });
    expect(uploads, 'the kept design is not uploaded again').toEqual([]);
  });
});

test.describe('page 1 rectangle after an accept', () => {
  test.use({ extraHTTPHeaders: fakeIpHeaders() });

  test('its sides are typed freely, and moving on without a new design locks the ratio again', async ({ page }) => {
    await page.goto('/');
    await chooseShape(page, builder.shape.rect);
    await setSize(page, '5');
    await page.locator('#size-height').fill('5');
    await page.locator('#ai-idea').fill('مقهي الورد');
    await page.getByRole('button', { name: builder.ai.generate, exact: true }).click();
    await page.getByRole('button', { name: builder.ai.confirm, exact: true }).click();
    await page.getByRole('button', { name: builder.ai.accept, exact: true }).click({ timeout: 60_000 });
    await expect(page.getByRole('heading', { level: 2, name: builder.size.title })).toBeVisible();
    await expect(page.locator('#size-height')).toHaveValue('5');

    // Back to page 1: a new idea may need another ratio, so the height is free (the width stays).
    const back = page.getByRole('button', { name: common.actions.back, exact: true });
    await back.click();
    await back.click();
    await page.locator('#size-height').fill('3');
    await expect(page.locator('#size-width')).toHaveValue('5');

    // No new design: moving on brings the square design's ratio back.
    await next(page).click();
    await expect(page.getByRole('heading', { level: 2, name: builder.steps.design })).toBeVisible();
    // The layout follows the size after a short debounce; Next waits for it (a click inside it does nothing).
    const sizeHeading = page.getByRole('heading', { level: 2, name: builder.size.title });
    await expect(async () => {
      await next(page).click();
      await expect(sizeHeading).toBeVisible({ timeout: 2_000 });
    }).toPass();
    await expect(page.locator('#size-width')).toHaveValue('5');
    await expect(page.locator('#size-height')).toHaveValue('5');
  });

  test('«عندي تصميم جاهز» after a free height on page 1 also brings the design ratio back', async ({ page }) => {
    await page.goto('/');
    await chooseShape(page, builder.shape.rect);
    await setSize(page, '5');
    await page.locator('#size-height').fill('5');
    await page.locator('#ai-idea').fill('مقهي الورد');
    await page.getByRole('button', { name: builder.ai.generate, exact: true }).click();
    await page.getByRole('button', { name: builder.ai.confirm, exact: true }).click();
    await page.getByRole('button', { name: builder.ai.accept, exact: true }).click({ timeout: 60_000 });
    const sizeHeading = page.getByRole('heading', { level: 2, name: builder.size.title });
    await expect(sizeHeading).toBeVisible();

    const back = page.getByRole('button', { name: common.actions.back, exact: true });
    await back.click();
    await back.click();
    await page.locator('#size-height').fill('3');
    await expect(page.locator('#size-width')).toHaveValue('5');

    // The upload step keeps the accepted design; the size it carries on must be the design's (5 × 5), not 5 × 3.
    await readyDesign(page);
    await expect(page.getByRole('heading', { level: 2, name: builder.upload.title })).toBeVisible();
    await expect(async () => {
      await next(page).click();
      await expect(sizeHeading).toBeVisible({ timeout: 2_000 });
    }).toPass();
    await expect(page.locator('#size-width')).toHaveValue('5');
    await expect(page.locator('#size-height')).toHaveValue('5');
  });
});
