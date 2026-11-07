import { test, expect, snap } from './helpers';

for (const [name, url, status] of [
  ['home', '/', 200],
  ['how-it-works', '/how-it-works', 200],
  ['not-found', '/nope', 404],
  ['admin-login', '/admin/login', 200],
] as const) {
  test(`screenshot ${name}`, async ({ page }, info) => {
    const res = await page.goto(url);
    expect(res?.status()).toBe(status);
    await page.waitForLoadState('networkidle');
    await snap(page, info, `page-${name}`);
  });
}
