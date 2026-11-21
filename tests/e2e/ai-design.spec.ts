import fs from 'node:fs';
import path from 'node:path';
import {
  ORDERS_DIR,
  builder,
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

test('too much text for the size: the confirm button is disabled', async ({ page }) => {
  await page.goto('/');
  await chooseShape(page, builder.shape.circle);
  await setSize(page, '1');
  await page.locator('#ai-idea').fill('مقهي الورد');
  await page.getByRole('button', { name: builder.ai.generate, exact: true }).click();
  await expect(page.locator('#ai-line-0')).toHaveValue(MOCK_BRIEF.printed_text[0]);
  await expect(page.getByRole('alert').filter({ hasText: builder.ai.tooMuchText.split(' — ')[0] })).toBeVisible();
  await expect(page.getByRole('button', { name: builder.ai.confirm, exact: true })).toBeDisabled();
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
