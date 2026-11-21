import { builder, common, chooseQuantity, chooseShape, expect, makeFixtures, next, perSheetBadge, readyDesign, setSize, test, upload } from './helpers';

/** A reload keeps the customer on the same step with the design and the typed values. */
test('reload keeps the step, the design and the typed values', async ({ page }) => {
  const { png } = await makeFixtures();

  await page.goto('/');
  await chooseShape(page, builder.shape.circle);
  await readyDesign(page);

  await upload(page, png);
  await expect(page.locator('img[src^="blob:"]').first()).toBeVisible();
  await next(page).click();

  await setSize(page, '3');
  await expect(perSheetBadge(page, 54)).toBeVisible();
  await next(page).click();

  await chooseQuantity(page, 'plastic', 1050);
  await expect(page.locator('#qty-result')).toContainText('1,080');
  await expect(page.getByRole('heading', { level: 2, name: builder.quantity.title })).toBeVisible();

  await page.reload();

  // Same step, same values.
  await expect(page.getByRole('heading', { level: 2, name: builder.quantity.title })).toBeVisible();
  await expect(page.locator('#stickers-input')).toHaveValue('1050');
  await expect(page.locator('input[name="material"][value="plastic"]')).toBeChecked();
  await expect(page.locator('#qty-result')).toContainText('1,080');

  // The size and the design are back too.
  const back = page.getByRole('button', { name: common.actions.back, exact: true });
  await back.click();
  await expect(page.locator('#size-width')).toHaveValue('3');
  await back.click();
  await expect(page.locator('img[src^="blob:"]').first()).toBeVisible();
});
