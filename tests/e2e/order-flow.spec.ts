import fs from 'node:fs';
import path from 'node:path';
import { chooseQuantity, test, expect, builder, makeFixtures, snap, next, chooseShape, upload, setSize, perSheetBadge, fillDetails, ORDERS_DIR, fakeIpHeaders, withLock } from './helpers';

test.use({ extraHTTPHeaders: fakeIpHeaders() });

test('customer order flow: circle 3cm, 1050 stickers (20 sheets), Baghdad', async ({ page }, info) => {
  await withLock(() => flow(page, info));
});

async function flow(page: import('@playwright/test').Page, info: import('@playwright/test').TestInfo) {
  const { png } = await makeFixtures();

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(builder.hero.flow.join(' ← '));
  await snap(page, info, '01-home-shape');

  await chooseShape(page, builder.shape.circle);
  await snap(page, info, '02-shape-circle');
  await next(page).click();

  await upload(page, png);
  await expect(page.locator('img[src^="blob:"]').first()).toBeVisible();
  await snap(page, info, '03-design-uploaded');
  await next(page).click();

  await setSize(page, '3');
  await expect(perSheetBadge(page, 54)).toBeVisible();
  await snap(page, info, '04-size');
  await next(page).click();

  // 1050 / 54 per sheet = 19.4 -> 20 sheets: the customer receives 1080 stickers.
  await chooseQuantity(page, 'plastic', 1050);
  await expect(page.getByText(builder.quantity.receive)).toContainText('1,080');
  await snap(page, info, '05-quantity');
  await next(page).click();

  await fillDetails(page);
  await snap(page, info, '06-details');
  await page.getByRole('button', { name: builder.details.submit, exact: true }).click();

  await page.waitForURL('**/order/success', { timeout: 60_000 });
  const noEl = page.getByText(/EP-\d{6}-[A-Z0-9]{4}/).first();
  await expect(noEl).toBeVisible();
  const displayNo = (await noEl.textContent())!.match(/EP-\d{6}-[A-Z0-9]{4}/)![0];
  await snap(page, info, '07-success');
  console.log(`[${info.project.name}] ORDER ${displayNo}`);
  info.annotations.push({ type: 'order', description: displayNo });

  const files = fs.readdirSync(ORDERS_DIR).filter((f) => f.endsWith('.json'));
  const hit = files
    .map((f) => ({ f, j: JSON.parse(fs.readFileSync(path.join(ORDERS_DIR, f), 'utf8')) }))
    .find((x) => x.j.displayNo === displayNo);
  expect(hit, `order json for ${displayNo}`).toBeTruthy();
  const j = hit!.j;
  expect(j.layout.countPerSheet).toBe(54);
  expect(j.price.deliveryFeeIqd).toBe(5000);
  expect(j.price.sheets).toBe(20);
  expect(j.price.totalStickers).toBe(1080);
  expect(j.price.requestedStickers).toBe(1050);
  // The local e2e data dir may have prices unpublished (every money field null): check rounding
  // only when there is a total. The maths itself is pinned by the pricing unit and golden tests.
  if (j.price.totalIqd === null) {
    expect(j.price.subtotalIqd).toBeNull();
    expect(j.price.roundingIqd ?? null).toBeNull();
  } else {
    expect(j.price.totalIqd % 1000).toBe(0);
    expect(j.price.subtotalIqd + j.price.deliveryFeeIqd).toBe(j.price.totalIqd);
  }
  expect(j.customer.phone).toBe('9647701234567');
  const pdf = path.join(ORDERS_DIR, hit!.f.replace(/\.json$/, '.pdf'));
  expect(fs.existsSync(pdf), pdf).toBe(true);
  const buf = fs.readFileSync(pdf);
  expect(buf.length).toBeGreaterThan(1024);
  expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
}
