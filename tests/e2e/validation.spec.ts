import { chooseQuantity, test, expect, builder, makeFixtures, snap, next, chooseShape, upload, setSize, perSheetBadge, fillDetails, fakeIpHeaders } from './helpers';

test.use({ extraHTTPHeaders: fakeIpHeaders() });

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop only');
});

async function toSizeStep(page: import('@playwright/test').Page, png: string) {
  await page.goto('/');
  await chooseShape(page, builder.shape.circle);
  await next(page).click();
  await upload(page, png);
  await expect(page.locator('img[src^="blob:"]').first()).toBeVisible();
  await next(page).click();
}

test('invalid phone shows error', async ({ page }, info) => {
  const { png } = await makeFixtures();
  await toSizeStep(page, png);
  await setSize(page, '3');
  await next(page).click();
  await chooseQuantity(page, 'plastic', 1080); // 20 sheets of 54
  await next(page).click();
  await fillDetails(page, '0680123456');
  await page.getByRole('button', { name: builder.details.submit, exact: true }).click();
  await expect(page.getByText(builder.details.errors.invalid_phone)).toBeVisible();
  await snap(page, info, 'validation-phone');
  await expect(page).not.toHaveURL(/success/);
});

test('JPEG with custom shape shows no_alpha', async ({ page }, info) => {
  const { jpg } = await makeFixtures();
  await page.goto('/');
  await chooseShape(page, builder.shape.custom);
  await next(page).click();
  await upload(page, jpg);
  await expect(page.getByRole('alert').filter({ hasText: 'الشكل المخصص يحتاج PNG شفاف' })).toBeVisible();
  await snap(page, info, 'validation-no-alpha');
});

test('size 50 cm is too big', async ({ page }, info) => {
  const { png } = await makeFixtures();
  await toSizeStep(page, png);
  await setSize(page, '50');
  await expect(page.getByRole('alert').filter({ hasText: 'القياس أكبر من الورقة' })).toBeVisible();
  await snap(page, info, 'validation-too-big');
});

test('Arabic-Indic digits accepted in size', async ({ page }) => {
  const { png } = await makeFixtures();
  await toSizeStep(page, png);
  await setSize(page, '٣');
  await expect(perSheetBadge(page, 54)).toBeVisible();
});
