import { test, expect, snap, newestOrder, ADMIN_PASSWORD, withLock } from './helpers';
import { admin, order } from '../../src/content/ar';

// Needs at least one order in data-e2e (created by order-flow.spec.ts). That file sorts AFTER this one
// alphabetically, so on a clean data dir run `pnpm e2e order-flow` first (or run the suite twice).
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop only');
});

test('admin: auth, orders, detail, pdf, status, settings', async ({ page }, info) => {
  const { json } = newestOrder();
  const displayNo: string = json.displayNo;

  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login/);
  await snap(page, info, 'admin-login');

  await page.getByLabel(admin.login.password).fill('wrong-password');
  await page.getByRole('button', { name: admin.login.submit }).click();
  await expect(page.getByText(admin.login.error)).toBeVisible();

  await page.getByLabel(admin.login.password).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: admin.login.submit }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
  await expect(page.getByRole('link', { name: displayNo })).toBeVisible();
  await snap(page, info, 'admin-orders');

  await page.getByRole('link', { name: displayNo }).click();
  await expect(page.getByRole('heading', { name: displayNo })).toBeVisible();
  await snap(page, info, 'admin-detail');

  const href = await page.getByRole('link', { name: admin.orders.downloadPdf }).getAttribute('href');
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/pdf');
  expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');

  const setStatus = async (label: string) => {
    await page.getByRole('combobox', { name: admin.detail.status }).click();
    await page.getByRole('option', { name: label }).click();
    await page.getByRole('button', { name: admin.orders.changeStatus }).click();
    await expect(page.getByText(admin.detail.statusSaved)).toBeVisible();
  };
  // the order may already be "printing" from an earlier run: reset first so the change button is enabled
  if (json.status === 'printing' || (await page.getByRole('heading', { name: displayNo }).locator('..').getByText(order.status.printing).count()) > 0) {
    await setStatus(order.status.new);
  }
  await setStatus(order.status.printing);
  await snap(page, info, 'admin-detail-printing');

  await withLock(async () => {
  await page.goto('/admin/settings');
  const fee = page.getByLabel(admin.settings.deliveryFee);
  await expect(fee).toHaveValue('5000');
  await snap(page, info, 'admin-settings');
  await fee.fill('6000');
  await page.getByRole('button', { name: admin.settings.save, exact: true }).click();
  await expect(page.getByText(admin.settings.saved)).toBeVisible();
  await page.goto('/admin/settings');
  await expect(page.getByLabel(admin.settings.deliveryFee)).toHaveValue('6000');

  await page.getByLabel(admin.settings.deliveryFee).fill('5000');
  await page.getByRole('button', { name: admin.settings.save, exact: true }).click();
  await expect(page.getByText(admin.settings.saved)).toBeVisible();
  await page.goto('/admin/settings');
  await expect(page.getByLabel(admin.settings.deliveryFee)).toHaveValue('5000');
  });
});
