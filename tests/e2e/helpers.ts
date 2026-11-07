import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { builder, common } from '../../src/content/ar';

export { builder, common, expect, test };
export const TMP = path.join(__dirname, '.tmp');
export const SCREENS = path.join(__dirname, '..', 'output', 'screens');
export const ORDERS_DIR = path.join(process.cwd(), 'data-e2e', 'orders');
export const ADMIN_PASSWORD = 'admin1234';

export async function makeFixtures() {
  fs.mkdirSync(TMP, { recursive: true });
  const id = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; // unique: a shared file rewritten by another worker makes Chrome abort the upload (ERR_UPLOAD_FILE_CHANGED)
  const png = path.join(TMP, `design-${id}.png`);
  const jpg = path.join(TMP, `design-${id}.jpg`);
  const base = { create: { width: 900, height: 900, channels: 3 as const, background: { r: 230, g: 60, b: 40 } } };
  const overlay = await sharp({ create: { width: 450, height: 450, channels: 3, background: { r: 20, g: 90, b: 200 } } }).png().toBuffer();
  await sharp(base).composite([{ input: overlay, left: 225, top: 225 }]).png().toFile(png);
  await sharp(base).composite([{ input: overlay, left: 225, top: 225 }]).jpeg().toFile(jpg);
  return { png, jpg };
}

export async function snap(page: Page, info: TestInfo, name: string) {
  const dir = path.join(SCREENS, info.project.name);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

export const next = (page: Page) => page.getByRole('button', { name: common.actions.next, exact: true });

export async function chooseShape(page: Page, label: string) {
  await page.getByRole('radio', { name: new RegExp(label) }).first().click();
}

export async function upload(page: Page, file: string) {
  await page.locator('#design-file').setInputFiles(file);
}

export async function setSize(page: Page, value: string) {
  await page.locator('#size-width').fill(value);
}

export function perSheetBadge(page: Page, n: string | number) {
  return page.getByText(new RegExp(`(^|\\s)${n}\\s+\\S+\\s*${builder.preview.perSheet}`)).locator('visible=true').first();
}

export async function fillDetails(page: Page, phone = '07701234567') {
  await page.locator('#cust-phone').fill(phone);
  await page.locator('#cust-gov').click();
  await page.getByRole('option', { name: 'بغداد', exact: true }).click();
  await page.locator('#cust-district').fill('الكرادة');
  await page.locator('#cust-landmark').fill('قرب مطعم المنصور');
}

export function newestOrder(): { file: string; json: any } {
  const files = fs.readdirSync(ORDERS_DIR).filter((f) => f.endsWith('.json'));
  if (!files.length) throw new Error('no orders in ' + ORDERS_DIR);
  const all = files
    .map((f) => ({ file: path.join(ORDERS_DIR, f), json: JSON.parse(fs.readFileSync(path.join(ORDERS_DIR, f), 'utf8')) }))
    .sort((a, b) => String(a.json.createdAt).localeCompare(String(b.json.createdAt)));
  return all[all.length - 1];
}

/**
 * The app rate-limits orders (5/h) and uploads (20/h) per client IP, trusting X-Forwarded-For.
 * Give every test run its own fake IP so repeated e2e runs do not exhaust the limiter.
 */
export function fakeIpHeaders() {
  const r = () => Math.floor(Math.random() * 250) + 1;
  return { 'x-forwarded-for': `10.${r()}.${r()}.${r()}` };
}

/**
 * Cross-worker mutex (atomic mkdir). The admin test changes the global delivery fee, which would
 * race with order-flow asserting `deliveryFeeIqd === 5000`, so both hold this lock while they run.
 */
export async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const lock = path.join(TMP, 'settings.lock');
  fs.mkdirSync(TMP, { recursive: true });
  const start = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch {
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 120_000) fs.rmSync(lock, { recursive: true, force: true }); // stale
      } catch {}
      if (Date.now() - start > 80_000) throw new Error('lock timeout');
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}
