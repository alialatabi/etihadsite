// Manual performance lab for the Softy sticker site: real-user-style loads on throttled mobile, medians over N runs.
// It is NOT part of `pnpm check` (lab timings are noisy, so it reports and never passes or fails on a number).
//
//   pnpm build
//   pnpm perf:lab --serve --label before --runs 5      starts `next start` on the --base port with a throwaway env
//   ... change code, pnpm build ...
//   pnpm perf:lab --serve --label after --runs 5       then compare perf-lab-out/summary-before.md and summary-after.md
//
// Options:
//   --base <url>     server to measure (default http://localhost:3217)
//   --label <name>   names the result files (default "lab")
//   --runs <n>       cold runs per page and profile (default 5)
//   --serve          start `next start` on the base port with a generated throwaway env (STORAGE=local, own data dir,
//                    random admin password / session secret / staff key, no Telegram, OpenAI pointed at a dead port).
//                    Needs a finished `pnpm build`. Localhost only.
//   --seed           submit one order first (unthrottled). Localhost only.
//   --only a,b       pages, builder, network (default: all three on localhost, pages only on a remote base)
//   --pages a,b      limit the page list by name (debugging)
//   --block cdp      block through Network.setBlockedURLs instead of Playwright routes (default "route")
//
// Without --serve, point --base at a server you started yourself. Admin and staff pages are measured only when you
// also set PERF_ADMIN_PASSWORD / STAFF_PAGE_KEY (the server must use the same values).
//
// SAFETY: /api/track, /api/log, /monitoring, /sentry-tunnel, connect.facebook.net and facebook.com/tr are aborted in the
// browser (see BLOCK_RE), so a run never writes analytics, client logs or Sentry events and never pings Meta, even if
// --base points at the live site. A remote base is measured with page loads only: --seed, --serve and the builder /
// network flows (which upload and order) are refused. Any blocked request that still got a response fails the run.
//
// Output goes to perf-lab-out/ (git-ignored): results-<label>.json, summary-<label>.md, network-<label>.json.
// Blind spots: a local server is not the live region + Supabase, and no Meta pixel id is set, so server/DB latency and
// the third-party pixel cost are not in these numbers. Measure live TTFB separately.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
export const OUT_DIR = path.join(REPO, 'perf-lab-out');
const FIX_JPG = path.join(REPO, 'tests', 'fixtures', 'opaque-300x300.jpg');
const FIX_PDF = path.join(REPO, 'tests', 'fixtures', 'two-page.pdf');
const BODY_MAX = 300;

/** Parses `--flag` / `--key value` arguments into an object. */
export function parseArgs(argv) {
  return Object.fromEntries(
    argv.reduce((acc, a, i) => {
      if (a.startsWith('--')) acc.push([a.slice(2), argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true]);
      return acc;
    }, []),
  );
}

// Analytics / monitoring / Meta requests are aborted so a measurement never writes analytics or pings third parties.
export const BLOCK_RE = /\/api\/track|\/api\/log|\/monitoring|\/sentry-tunnel|connect\.facebook\.net|facebook\.com\/tr|fbevents/i;
export const BLOCK_CDP_URLS = ['*/api/track*', '*/api/log*', '*/monitoring*', '*/sentry-tunnel*', '*connect.facebook.net*', '*facebook.com/tr*', '*fbevents*'];

/** Aborts every blocked request on a Playwright browser context (route predicate on the URL only, as before). */
export async function installBlocking(ctx) {
  await ctx.route((u) => BLOCK_RE.test(u.href), (route) => route.abort());
}

export const isLocalBase = (base) => {
  try {
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(base).hostname);
  } catch {
    return false;
  }
};

const throwaway = () => crypto.randomBytes(24).toString('hex');

/**
 * The throwaway env for `next start --serve`: nothing here is a real secret. Every value is random per run, the data
 * directory is private to the lab, and the order / Telegram / OpenAI integrations point nowhere.
 */
export function throwawayEnv(dataDir) {
  return {
    STORAGE: 'local',
    DATA_DIR: dataDir,
    ORDER_TRANSPORT: 'console',
    ADMIN_PASSWORD: `perf-${throwaway()}`,
    SESSION_SECRET: `perf-${throwaway()}`,
    STAFF_PAGE_KEY: `perf-${throwaway()}`,
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_CHAT_ID: '',
    OPENAI_API_KEY: `perf-${throwaway()}`,
    OPENAI_BASE_URL: 'http://127.0.0.1:9/v1', // nothing listens here
    NEXT_TELEMETRY_DISABLED: '1',
    // `next start` also loads .env.local for every variable that is not already defined (an empty string counts as defined),
    // so anything that could send data from the server is blanked here: the code treats '' as unset.
    META_CAPI_TOKEN: '',
    META_TEST_EVENT_CODE: '',
    NEXT_PUBLIC_META_PIXEL_ID: '',
    NEXT_PUBLIC_SENTRY_DSN: '',
    SUPABASE_URL: '',
    SUPABASE_SECRET_KEY: '',
    TURNSTILE_SECRET_KEY: '',
    CRON_SECRET: '',
  };
}

/**
 * Validates the option combination and returns the run settings. Throws an Error with a message on a refusal.
 * Pure (no I/O) so it can be unit-tested.
 * @param {Record<string, string | boolean | undefined>} args
 * @param {Record<string, string | undefined>} [env]
 */
export function resolveSettings(args, env = {}) {
  const base = String(args.base || 'http://localhost:3217').replace(/\/$/, '');
  const local = isLocalBase(base);
  const only = args.only ? String(args.only).split(',') : local ? ['pages', 'builder', 'network'] : ['pages'];
  if (!local && (args.serve || args.seed || only.some((o) => o !== 'pages'))) {
    throw new Error(`${base} is not localhost: only page loads are allowed there (no --serve, --seed, builder or network flows).`);
  }
  if (args.serve && !local) throw new Error('--serve needs a localhost --base.');
  const runs = Number(args.runs || 5);
  if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a whole number of at least 1.');
  const block = String(args.block || 'route');
  if (block !== 'route' && block !== 'cdp') throw new Error('--block must be "route" or "cdp".');
  return {
    base,
    local,
    label: String(args.label || 'lab').replace(/[^\w.-]/g, '_'),
    runs,
    only,
    block,
    serve: !!args.serve,
    seed: !!args.seed,
    pages: args.pages ? String(args.pages).split(',') : null,
    adminPassword: env.PERF_ADMIN_PASSWORD || null,
    staffKey: env.STAFF_PAGE_KEY || null,
  };
}

// Arabic UI strings from src/content/ar/* (kept literal: this is plain Node, no TS). tests/unit/scripts/perf-lab.test.ts
// fails if one of them stops existing in src/content/ar, so a copy change cannot silently break the selectors.
export const T = { circle: 'دائري', ready: 'عندي تصميم جاهز', next: 'التالي', submit: 'أرسل الطلب', baghdad: 'بغداد', loginPw: 'كلمة السر', loginBtn: 'دخول' };

let S = null; // run settings, set by main()

const PROFILES = {
  slow4g: { latency: 150, down: (1.6 * 1000 * 1000) / 8, up: (750 * 1000) / 8, cpu: 4 },
  '3g': { latency: 300, down: (750 * 1000) / 8, up: (250 * 1000) / 8, cpu: 6 },
};
const UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const CTX_OPTS = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA, locale: 'ar-IQ' };

const median = (a) => {
  const v = a.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((x, y) => x - y);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const round = (x, d = 0) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const kb = (b) => round(b / 1024, 1);

// Injected before any page script: paint / LCP / CLS / longtask collectors + builder-flow markers.
const INIT = () => {
  const m = (window.__m = { fcp: null, lcp: null, cls: 0, clsWin: [], longtasks: [], t0: null, previewAt: null });
  const po = (type, cb) => {
    try {
      new PerformanceObserver((l) => l.getEntries().forEach(cb)).observe({ type, buffered: true });
    } catch {}
  };
  po('paint', (e) => {
    if (e.name === 'first-contentful-paint') m.fcp = e.startTime;
  });
  po('largest-contentful-paint', (e) => {
    m.lcp = e.startTime;
  });
  let cur = 0;
  let curFirst = 0;
  let curLast = 0;
  po('layout-shift', (e) => {
    if (e.hadRecentInput) return;
    if (cur && e.startTime - curLast < 1000 && e.startTime - curFirst < 5000) {
      cur += e.value;
    } else {
      cur = e.value;
      curFirst = e.startTime;
    }
    curLast = e.startTime;
    m.cls = Math.max(m.cls, cur);
  });
  po('longtask', (e) => m.longtasks.push([e.startTime, e.duration]));
  document.addEventListener(
    'change',
    (e) => {
      if (e.target && e.target.id === 'design-file') m.t0 = performance.now();
    },
    true,
  );
  const check = () => {
    if (m.t0 != null && m.previewAt == null) {
      const img = document.querySelector('img[src^="blob:"]');
      if (img && img.complete && img.naturalWidth > 0) m.previewAt = performance.now();
    }
    requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
};

async function newCtx(browser, profile, storageState) {
  const ctx = await browser.newContext({ ...CTX_OPTS, ...(storageState ? { storageState } : {}) });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  if (profile) {
    const p = PROFILES[profile];
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: p.latency, downloadThroughput: p.down, uploadThroughput: p.up });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
  }
  if (S.block === 'cdp') await cdp.send('Network.setBlockedURLs', { urls: BLOCK_CDP_URLS });
  else await installBlocking(ctx);
  const net = { reqs: new Map(), order: [] };
  cdp.on('Network.requestWillBeSent', (e) => {
    if (e.request.url.startsWith('data:')) return;
    const r = { id: e.requestId, method: e.request.method, url: e.request.url, type: e.type || 'Other', initiator: e.initiator?.type || '', body: e.request.postData ? String(e.request.postData).slice(0, BODY_MAX) : undefined, status: null, bytes: 0, cache: false, done: false, blocked: false };
    if (!r.body && e.request.hasPostData) {
      // beacons / fetch with a body that CDP did not inline: fetch it (best effort, async)
      cdp.send('Network.getRequestPostData', { requestId: e.requestId }).then((b) => { r.body = String(b.postData || '').slice(0, BODY_MAX); }).catch(() => {});
    }
    net.reqs.set(e.requestId, r); // a redirect reuses the id; the last hop wins
    net.order.push(r);
  });
  cdp.on('Network.loadingFailed', (e) => {
    const r = net.reqs.get(e.requestId);
    if (r) {
      r.done = true;
      r.blocked = BLOCK_RE.test(r.url); // aborted by us (route / setBlockedURLs)
      r.failed = e.errorText || '';
    }
  });
  cdp.on('Network.responseReceived', (e) => {
    const r = net.reqs.get(e.requestId);
    if (r) {
      r.status = e.response.status;
      r.type = e.type || r.type;
      r.cache = !!(e.response.fromDiskCache || e.response.fromPrefetchCache || e.response.fromServiceWorker);
      r.encoding = e.response.headers?.['content-encoding'] || e.response.headers?.['Content-Encoding'] || '';
    }
  });
  cdp.on('Network.loadingFinished', (e) => {
    const r = net.reqs.get(e.requestId);
    if (r) {
      r.bytes = e.encodedDataLength || 0;
      r.done = true;
    }
  });
  return { ctx, page, cdp, net };
}

/** Requests that match the block list but still got a response from the server: the blocking failed. */
export const leaked = (order) => order.filter((r) => BLOCK_RE.test(r.url) && r.status != null).length;

function summariseNet(net) {
  const by = {};
  let total = 0;
  const sent = net.order.filter((r) => !r.blocked); // aborted analytics/monitoring requests never reach the server: kept in 'resources' (flagged) for duplicate detection, not counted here
  for (const r of sent) {
    const t = r.type;
    by[t] = (by[t] || 0) + r.bytes;
    total += r.bytes;
  }
  return {
    requests: sent.length,
    blockedRequests: net.order.length - sent.length,
    leakedRequests: leaked(net.order),
    totalBytes: total,
    jsBytes: by.Script || 0,
    cssBytes: by.Stylesheet || 0,
    fontBytes: by.Font || 0,
    imageBytes: by.Image || 0,
    docBytes: by.Document || 0,
    otherBytes: total - (by.Script || 0) - (by.Stylesheet || 0) - (by.Font || 0) - (by.Image || 0) - (by.Document || 0),
    resources: net.order.map((r) => ({ method: r.method, url: r.url, type: r.type, status: r.status, bytes: r.bytes, cache: r.cache, initiator: r.initiator, body: r.body, blocked: r.blocked || undefined })),
  };
}

async function collectPage(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const m = window.__m || {};
    const fcp = m.fcp;
    const loadEnd = nav ? nav.loadEventEnd : 0;
    let tbt = 0;
    for (const [s, d] of m.longtasks || []) if (fcp != null && s >= fcp && s <= loadEnd + 2000) tbt += Math.max(0, d - 50);
    return {
      ttfb: nav ? nav.responseStart : null,
      fcp,
      lcp: m.lcp,
      cls: m.cls,
      tbt,
      dcl: nav ? nav.domContentLoadedEventEnd : null,
      load: loadEnd,
      longtaskCount: (m.longtasks || []).length,
    };
  });
}

const TILE_SEL = 'img[src*="/api/admin/designs/"]';
const TILE_URL_RE = /\/api\/admin\/designs\//;

// opts.expectStatus: the document must answer this status (else the run is an error: we would be measuring a 404/redirect).
// opts.gallery: count the design tiles (a fresh lab data dir has none, so the gallery is then just an empty admin page);
// opts.fullPass: after the standard window, scroll through the whole gallery and record all-tile image bytes + time until
// every tile image is complete (run 0 only; bytes do not vary between runs).
async function loadOnce(page, cdp, net, url, opts = {}) {
  net.reqs.clear();
  net.order.length = 0;
  const resp = await page.goto(url, { waitUntil: 'load', timeout: opts.gallery ? 600000 : 180000 });
  const status = resp ? resp.status() : null;
  if (opts.expectStatus && status !== opts.expectStatus) throw new Error(`${url} answered ${status}, expected ${opts.expectStatus} (final url ${page.url()})`);
  await page.waitForTimeout(2000); // TBT window: load + 2 s
  const m = await collectPage(page);
  const out = { ...m, status, ...summariseNet(net) };
  if (opts.gallery) {
    out.tiles = await page.locator(TILE_SEL).count();
    out.tileImagesDoneInWindow = net.order.filter((r) => r.type === 'Image' && r.done && !r.blocked && TILE_URL_RE.test(r.url)).length;
    if (opts.fullPass && out.tiles > 0) {
      const t1 = Date.now();
      // Lazy tiles only start loading once they intersect the viewport, so scroll to each tile in turn (a single jump to the bottom
      // would skip the middle ones and they would never load).
      for (let t = 0; t < out.tiles; t++) {
        await page.locator(TILE_SEL).nth(t).scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
      }
      await page.waitForFunction((sel) => [...document.querySelectorAll(sel)].every((i) => i.complete && i.naturalWidth > 0), TILE_SEL, { timeout: 900000, polling: 500 });
      const tileReqs = net.order.filter((r) => r.type === 'Image' && !r.blocked && TILE_URL_RE.test(r.url));
      const after = summariseNet(net);
      out.fullPass = { tilesComplete: out.tiles, timeToAllTilesMs: Date.now() - t1, tileImageRequests: tileReqs.length, tileImageBytes: tileReqs.reduce((n, r) => n + r.bytes, 0), imageBytesAllTiles: after.imageBytes, totalBytesAfterScroll: after.totalBytes };
    }
  }
  return out;
}

async function adminState(browser) {
  const { ctx, page } = await newCtx(browser, null);
  await page.goto(S.base + '/admin/login', { waitUntil: 'load' });
  await page.getByLabel(T.loginPw).fill(S.adminPassword);
  await page.getByRole('button', { name: T.loginBtn, exact: true }).click();
  await page.waitForURL(/\/admin\/?$/, { timeout: 60000 });
  const st = await ctx.storageState();
  await ctx.close();
  return st;
}

// Builder helpers (selectors from tests/e2e/helpers.ts).
async function toUploadStep(page) {
  await page.waitForLoadState('load');
  await page.waitForTimeout(1500);
  await page.getByRole('radio', { name: new RegExp(T.circle) }).first().click();
  await page.getByRole('button', { name: T.ready, exact: true }).click();
  await page.waitForSelector('#design-file', { state: 'attached', timeout: 90000 });
}
const nextBtn = (page) => page.getByRole('button', { name: T.next, exact: true });
async function fillDetails(page) {
  await page.locator('#cust-phone').fill('07701234567');
  await page.locator('#cust-gov').click();
  await page.getByRole('option', { name: T.baghdad, exact: true }).click();
  await page.locator('#cust-district').fill('الكرادة');
  await page.locator('#cust-landmark').fill('قرب مطعم المنصور');
}

async function seedOrder(browser) {
  const { ctx, page } = await newCtx(browser, null);
  await page.goto(S.base + '/', { waitUntil: 'load' });
  await toUploadStep(page);
  await page.locator('#design-file').setInputFiles(FIX_JPG);
  await page.locator('img[src^="blob:"]').first().waitFor({ timeout: 60000 });
  await nextBtn(page).click();
  await page.locator('#size-width').fill('3');
  await nextBtn(page).click();
  await page.locator('label').filter({ has: page.locator('input[name="material"][value="plastic"]') }).first().click();
  await page.locator('#stickers-input').fill('1050');
  await nextBtn(page).click();
  await fillDetails(page);
  await page.getByRole('button', { name: T.submit, exact: true }).click();
  await page.waitForURL('**/order/success', { timeout: 90000 });
  await ctx.close();
}

async function builderRun(browser, profile, file) {
  const { ctx, page } = await newCtx(browser, profile);
  try {
    await page.goto(S.base + '/', { waitUntil: 'load', timeout: 180000 });
    await toUploadStep(page);
    await page.locator('#design-file').setInputFiles(file);
    await page.waitForFunction(() => window.__m && window.__m.previewAt != null, null, { timeout: 180000 });
    await page.waitForTimeout(500);
    return await page.evaluate(() => {
      const m = window.__m;
      let lt = 0;
      let blocking = 0;
      let n = 0;
      for (const [s, d] of m.longtasks) if (s + d >= m.t0 && s <= m.previewAt) { lt += d; blocking += Math.max(0, d - 50); n++; }
      return { uploadToPreviewMs: m.previewAt - m.t0, longTaskMs: lt, blockingMs: blocking, longTaskCount: n };
    });
  } finally {
    await ctx.close();
  }
}

async function networkLogs(browser) {
  const out = {};
  // (c1) one cold view of "/" (slow4g)
  {
    const { ctx, page, cdp, net } = await newCtx(browser, 'slow4g');
    const r = await loadOnce(page, cdp, net, S.base + '/');
    out.home = r.resources.map((x) => ({ ...x, path: new URL(x.url).pathname + (new URL(x.url).search ? '?' + new URL(x.url).search.slice(1, 40) : '') }));
    await ctx.close();
  }
  // (c2) full builder flow up to (not including) submit, jpg fixture (slow4g)
  {
    const { ctx, page, net } = await newCtx(browser, 'slow4g');
    await page.goto(S.base + '/', { waitUntil: 'load', timeout: 180000 });
    await toUploadStep(page);
    await page.locator('#design-file').setInputFiles(FIX_JPG);
    await page.locator('img[src^="blob:"]').first().waitFor({ timeout: 120000 });
    await nextBtn(page).click();
    await page.locator('#size-width').fill('3');
    await page.waitForTimeout(800);
    await nextBtn(page).click();
    await page.locator('label').filter({ has: page.locator('input[name="material"][value="plastic"]') }).first().click();
    await page.locator('#stickers-input').fill('1050');
    await page.locator('#qty-result').waitFor({ timeout: 60000 });
    await page.waitForTimeout(800);
    await nextBtn(page).click();
    await fillDetails(page);
    await page.waitForTimeout(1500);
    const s = summariseNet(net);
    out.builder = s.resources.map((x) => ({ ...x, path: new URL(x.url).pathname + (new URL(x.url).search ? '?' + new URL(x.url).search.slice(1, 40) : '') }));
    await ctx.close();
  }
  // Duplicate = same method + path + body (blob: URLs skipped). Blocked analytics requests are included (they are what the page *tried* to send).
  // distinctUrls > 1 means the repeats differ only in their query string (so they are not truly identical requests).
  const dupes = (list) => {
    const g = new Map();
    for (const r of list) {
      if (r.url.startsWith('blob:')) continue;
      const u = new URL(r.url);
      const k = r.method + ' ' + u.pathname + ' ' + (r.body || '');
      const e = g.get(k) || { method: r.method, path: u.pathname, body: r.body || '', count: 0, urls: new Set(), blocked: !!r.blocked, cache: 0 };
      e.count++;
      e.urls.add(u.search);
      if (r.cache) e.cache++;
      g.set(k, e);
    }
    return [...g.values()].filter((e) => e.count > 1).map((e) => ({ key: e.method + ' ' + e.path, body: e.body, count: e.count, distinctUrls: e.urls.size, blocked: e.blocked, fromCache: e.cache }));
  };
  out.duplicates = { home: dupes(out.home), builder: dupes(out.builder) };
  return out;
}

/**
 * The pages to measure. Admin and staff pages need credentials (--serve generates them; otherwise PERF_ADMIN_PASSWORD / STAFF_PAGE_KEY).
 * @param {{ adminPassword: string | null, staffKey: string | null, pages: string[] | null }} settings
 */
export function pageList(settings) {
  const list = [
    { name: '/', path: '/' },
    { name: '/how-it-works', path: '/how-it-works' },
    { name: '/order/success', path: '/order/success' },
    { name: '/admin/login', path: '/admin/login' },
  ];
  if (settings.adminPassword) list.push({ name: '/admin (orders list, logged in)', path: '/admin', admin: true });
  // Staff page: reached as /staff/<STAFF_PAGE_KEY>; src/proxy.ts rewrites it to /staff-sheets (a direct /staff-sheets request is a 404).
  if (settings.staffKey) list.push({ name: '/staff-sheets', path: `/staff/${settings.staffKey}`, expectStatus: 200 });
  // Gallery: lazy design tiles; a fresh lab data dir has none, so this is then an empty admin page.
  if (settings.adminPassword) list.push({ name: '/admin/designs', path: '/admin/designs', admin: true, gallery: true, expectStatus: 200 });
  return list.filter((p) => !settings.pages || settings.pages.includes(p.name));
}

async function withRetry(fn, tries = 2) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
      console.error('  retry after error:', String(e.message || e).split('\n')[0]);
    }
  }
  return { error: String(err.message || err).split('\n')[0] };
}

const METRICS = ['ttfb', 'fcp', 'lcp', 'cls', 'tbt', 'dcl', 'load', 'requests', 'totalBytes', 'jsBytes', 'cssBytes', 'fontBytes', 'imageBytes', 'blockedRequests', 'tiles', 'tileImagesDoneInWindow'];
const medObj = (runs, keys) => Object.fromEntries(keys.map((k) => [k, median(runs.filter((r) => !r.error).map((r) => r[k]))]));

const analyticsLines = (dataDir) => {
  try {
    const dir = path.join(dataDir, 'analytics');
    return fs.readdirSync(dir).reduce((n, f) => n + fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).length, 0);
  } catch {
    return 0;
  }
};

/**
 * Rejects when something already listens on `port` (any interface). `next start` exits 1 on a busy port, but the
 * readiness poll would meanwhile be answered by that other server, so the lab would measure (and, with --seed or the
 * builder run, write orders and uploads into) the wrong server. Probe before spawning.
 */
export async function assertPortFree(port) {
  const tryListen = (host) =>
    new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.once('error', reject);
      srv.listen({ port: Number(port), host, exclusive: true }, () => srv.close(() => resolve()));
    });
  for (const host of [undefined, '127.0.0.1']) {
    try {
      await tryListen(host);
    } catch (e) {
      if (e && (e.code === 'EADDRINUSE' || e.code === 'EACCES')) throw new Error(`Port ${port} is already in use: refusing to start \`next start\` (the lab would measure and write into that other server). Pick a free port with --base http://localhost:<port>.`);
      /* other errors (e.g. no IPv6) are not "busy" */
    }
  }
}

/** Starts `next start` on the base port with a throwaway env. Resolves with { stop() } once the home page answers. */
async function startServer(settings, dataDir) {
  if (!fs.existsSync(path.join(REPO, '.next', 'BUILD_ID'))) throw new Error('No production build found: run `pnpm build` first.');
  const env = throwawayEnv(dataDir);
  const port = new URL(settings.base).port || '80';
  await assertPortFree(port);
  const child = spawn(process.execPath, [path.join(REPO, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', port], { cwd: REPO, env: { ...process.env, ...env }, stdio: 'ignore' });
  let exited = false;
  child.on('exit', () => { exited = true; });
  const stop = () => {
    if (exited) return;
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill();
  };
  for (let i = 0; i < 90; i++) {
    if (exited) throw new Error('`next start` exited early (is the port already in use?).');
    try {
      const res = await fetch(settings.base + '/', { redirect: 'manual' });
      if (res.status < 500) {
        // Tie readiness to OUR child: if it lost a port race it exits right after boot, so give it a moment before trusting the answer.
        await new Promise((r) => setTimeout(r, 750));
        if (exited) throw new Error('`next start` exited early (is the port already in use?).');
        return { stop, env };
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  stop();
  throw new Error('`next start` did not answer within 90 s.');
}

async function main() {
  const t0 = Date.now();
  S = resolveSettings(parseArgs(process.argv.slice(2)), process.env);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(OUT_DIR, 'data');
  let server = null;
  if (S.serve) {
    server = await startServer(S, dataDir);
    S.adminPassword = server.env.ADMIN_PASSWORD;
    S.staffKey = server.env.STAFF_PAGE_KEY;
  }
  try {
    return await measure(t0, dataDir);
  } finally {
    if (server) server.stop();
  }
}

async function measure(t0, dataDir) {
  const { chromium } = await import('@playwright/test'); // resolved from the repo's node_modules; loaded late so the helpers above can be imported without it
  const browser = await chromium.launch();
  const results = { label: S.label, base: S.base, runs: S.runs, date: new Date().toISOString(), chromium: browser.version(), profiles: PROFILES, pages: {}, builder: {}, errors: [], blockMode: S.block, blockPattern: String(BLOCK_RE), analyticsLinesBefore: analyticsLines(dataDir) };
  if (S.seed) {
    console.log('seeding one order (unthrottled)');
    await seedOrder(browser);
  }
  let admin = null;
  if (S.only.includes('pages')) {
    const pages = pageList(S);
    if (pages.some((p) => p.admin)) admin = await adminState(browser);
    for (const [pname, prof] of Object.entries(PROFILES)) {
      void prof;
      for (const pg of pages) {
        const key = `${pg.name} @ ${pname}`;
        console.log(new Date().toISOString().slice(11, 19), 'page', key);
        const cold = [];
        for (let i = 0; i < S.runs; i++) {
          const r = await withRetry(async () => {
            const { ctx, page, cdp, net } = await newCtx(browser, pname, pg.admin ? admin : null);
            try {
              return await loadOnce(page, cdp, net, S.base + pg.path, { ...pg, fullPass: pg.gallery && i === 0 });
            } finally {
              await ctx.close();
            }
          });
          if (r.error) results.errors.push({ key, run: i, error: r.error });
          else if (i > 0) delete r.resources; // keep the resource list of run 0 only
          cold.push(r);
        }
        const warm = await withRetry(async () => {
          const { ctx, page, cdp, net } = await newCtx(browser, pname, pg.admin ? admin : null);
          try {
            await loadOnce(page, cdp, net, S.base + pg.path, pg); // prime the HTTP cache
            return await loadOnce(page, cdp, net, S.base + pg.path, pg);
          } finally {
            await ctx.close();
          }
        });
        if (warm.error) results.errors.push({ key: key + ' warm', error: warm.error });
        else delete warm.resources;
        results.pages[key] = { page: pg.name, profile: pname, cold, warm, coldMedian: medObj(cold, METRICS) };
      }
    }
  }
  if (S.only.includes('builder')) {
    for (const [fname, file] of [['jpg 300x300', FIX_JPG], ['pdf two-page', FIX_PDF]]) {
      for (const pname of Object.keys(PROFILES)) {
        const key = `builder ${fname} @ ${pname}`;
        console.log(key);
        const runs = [];
        for (let i = 0; i < S.runs; i++) {
          const r = await withRetry(() => builderRun(browser, pname, file));
          if (r.error) results.errors.push({ key, run: i, error: r.error });
          runs.push(r);
        }
        results.builder[key] = { file: fname, profile: pname, runs, median: medObj(runs, ['uploadToPreviewMs', 'longTaskMs', 'blockingMs', 'longTaskCount']) };
      }
    }
  }
  let network = null;
  if (S.only.includes('network')) {
    console.log('network logs');
    network = await networkLogs(browser);
    fs.writeFileSync(path.join(OUT_DIR, `network-${S.label}.json`), JSON.stringify(network, null, 1));
  }
  await browser.close();
  results.analyticsLinesAfter = analyticsLines(dataDir);
  results.elapsedSec = Math.round((Date.now() - t0) / 1000);
  // A request that matches the block list but got a response means the blocking failed: the run may have written data.
  const leakedTotal = [...Object.values(results.pages).flatMap((v) => [...v.cold, v.warm]), ...(network ? [{ leakedRequests: leaked([...network.home, ...network.builder]) }] : [])].reduce((n, r) => n + ((r && r.leakedRequests) || 0), 0);
  if (leakedTotal) results.errors.push({ key: 'blocking', error: `${leakedTotal} analytics/monitoring request(s) reached the server despite the block list` });
  fs.writeFileSync(path.join(OUT_DIR, `results-${S.label}.json`), JSON.stringify(results, null, 1));
  fs.writeFileSync(path.join(OUT_DIR, `summary-${S.label}.md`), summarise(results, network));
  console.log('done in', results.elapsedSec, 's; results in', OUT_DIR);
  if (leakedTotal) process.exitCode = 1;
}

function summarise(res, network) {
  const L = [];
  const s = (v) => (v == null ? '-' : round(v / 1000, 2));
  L.push(`# Performance summary (${res.label})`, '', `scripts/perf-lab.mjs: analytics, client-log, monitoring and Meta requests aborted (${res.blockMode}, ${res.blockPattern}); analytics event lines in the data dir before/after the run: ${res.analyticsLinesBefore} / ${res.analyticsLinesAfter}.`, '', 'Blind spots: a local server is not the live region + Supabase and no pixel id is set, so server/DB latency and third-party pixel cost are not included. Lab timings are noisy: compare medians, do not treat one number as pass/fail.', '', `Base: ${res.base} | runs: ${res.runs} (cold, fresh context each; medians) + 1 warm | ${res.date} | Chromium ${res.chromium}`, '', 'Profiles: slow4g = 150 ms RTT, 1.6/0.75 Mbps, CPU 4x; 3g = 300 ms RTT, 0.75/0.25 Mbps, CPU 6x; mobile 390x844 @3x. Times in seconds; sizes in KB transferred (encoded). TBT in ms.', '');
  for (const pname of Object.keys(PROFILES)) {
    L.push(`## Page loads - ${pname}`, '', '| Page | TTFB s | FCP s | LCP s | CLS | TBT ms | DCL s | Load s | Reqs | Total KB | JS KB | CSS KB | Font KB | Img KB | Blocked |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const v of Object.values(res.pages)) {
      if (v.profile !== pname) continue;
      const m = v.coldMedian;
      L.push(`| ${v.page} (cold) | ${s(m.ttfb)} | ${s(m.fcp)} | ${s(m.lcp)} | ${round(m.cls, 3)} | ${round(m.tbt)} | ${s(m.dcl)} | ${s(m.load)} | ${m.requests} | ${kb(m.totalBytes)} | ${kb(m.jsBytes)} | ${kb(m.cssBytes)} | ${kb(m.fontBytes)} | ${kb(m.imageBytes)} | ${m.blockedRequests} |`);
      const w = v.warm;
      if (w && !w.error) L.push(`| ${v.page} (warm, 1 run) | ${s(w.ttfb)} | ${s(w.fcp)} | ${s(w.lcp)} | ${round(w.cls, 3)} | ${round(w.tbt)} | ${s(w.dcl)} | ${s(w.load)} | ${w.requests} | ${kb(w.totalBytes)} | ${kb(w.jsBytes)} | ${kb(w.cssBytes)} | ${kb(w.fontBytes)} | ${kb(w.imageBytes)} | ${w.blockedRequests} |`);
    }
    L.push('');
    for (const v of Object.values(res.pages)) {
      const f = v.profile === pname && v.cold[0] && v.cold[0].fullPass;
      if (f) L.push(`- ${v.page} @ ${pname}: ${v.coldMedian.tiles} tiles; in the standard load window ${v.coldMedian.tileImagesDoneInWindow} tile images finished (Img KB column, lazy tiles, timing-dependent). Full-gallery pass (run 0: scroll through, wait for every tile): ${kb(f.imageBytesAllTiles)} KB image bytes over ${f.tileImageRequests} tile requests (${round(f.imageBytesAllTiles / 1048576, 1)} MB), all ${f.tilesComplete} tiles complete after ${round(f.timeToAllTilesMs / 1000, 1)} s of scrolling, page total ${kb(f.totalBytesAfterScroll)} KB.`);
    }
    L.push('');
  }
  L.push('## Builder flow (choose shape, "ready design", set file, until blob preview visible)', '', '| Case | upload-to-preview s | long-task total ms | blocking (>50ms part) ms | long tasks |', '|---|---|---|---|---|');
  for (const v of Object.values(res.builder)) L.push(`| ${v.file} @ ${v.profile} | ${s(v.median.uploadToPreviewMs)} | ${round(v.median.longTaskMs)} | ${round(v.median.blockingMs)} | ${v.median.longTaskCount} |`);
  L.push('', '## Largest JS resources (run 0, slow4g cold)', '');
  for (const v of Object.values(res.pages)) {
    if (v.profile !== 'slow4g' || !v.cold[0] || v.cold[0].error) continue;
    const js = (v.cold[0].resources || []).filter((r) => r.type === 'Script').sort((a, b) => b.bytes - a.bytes).slice(0, 5);
    L.push(`- ${v.page}: ` + js.map((r) => `${new URL(r.url).pathname} ${kb(r.bytes)} KB`).join('; '));
  }
  if (network) {
    L.push('', '## Duplicate requests (same method + path + body, count > 1; blocked = analytics aborted by the harness; distinctUrls > 1 = query strings differ)', '');
    for (const [w, d] of Object.entries(network.duplicates)) {
      L.push(`- ${w}: ` + (d.length ? d.map((x) => `${x.key}${x.body ? ' body=' + JSON.stringify(x.body.slice(0, 80)) : ''} x${x.count}${x.blocked ? ' [blocked]' : ''}${x.distinctUrls > 1 ? ` (${x.distinctUrls} distinct URLs)` : ''}${x.fromCache ? ` (${x.fromCache} from cache)` : ''}`).join('; ') : 'none'));
    }
  }
  if (res.errors.length) L.push('', '## Errors / flaky runs', '', ...res.errors.map((e) => `- ${e.key} run ${e.run ?? ''}: ${e.error}`));
  return L.join('\n') + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(process.env.DEBUG ? e : e.message);
    process.exit(1);
  });
}
