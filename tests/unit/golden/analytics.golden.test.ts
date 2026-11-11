/**
 * GOLDEN — src/lib/analytics/classify.ts, src/lib/analytics/server.ts and
 * src/app/admin/stats/aggregate.ts.
 *
 * Deterministic inputs only: fixed `now`, fixed SESSION_SECRET, synthetic events. The one
 * place that reads the clock (trackServer) runs under a frozen Date (2026-11-10T09:00:00Z).
 * Nothing is masked.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RANGE,
  RANGE_OPTIONS,
  STATS_TZ,
  aggregate,
  dayKey,
  mmToCmText,
  parseRange,
  pct,
  rangeDayKeys,
  sinceFor,
  weekdayAndHour,
  type Stats,
} from '@/app/admin/stats/aggregate';
import { classifyDevice, classifySource, isBot } from '@/lib/analytics/classify';
import { baghdadDay, geoFrom, trackServer, visitorHash } from '@/lib/analytics/server';
import { getStorage } from '@/lib/storage';
import type { AnalyticsEvent, CustomerRecord, DeviceKind, TrafficSource } from '@/lib/types';
import { SECRET, setupEnv } from '../server/helpers';
import { canon, removeTempDirs, sha256, show, track } from './_util';

afterAll(removeTempDirs);

/* ───────────────────────── classify ───────────────────────── */

describe('golden: classifySource', () => {
  const REFERRERS: (string | null | undefined)[] = [
    undefined, null, '', '   ',
    'https://www.instagram.com/softy', 'https://l.instagram.com/?u=https%3A%2F%2Fsofty.iq', 'https://ig.me/m/softy', 'http://instagram.com',
    'https://www.facebook.com/', 'https://m.facebook.com/story', 'https://l.facebook.com/l.php?u=x', 'https://fb.com/x', 'https://fb.me/x', 'https://fb.watch/abc', 'https://www.messenger.com/t/1',
    'https://www.tiktok.com/@softy', 'https://vm.tiktok.com/abc',
    'https://wa.me/9647701234567', 'https://web.whatsapp.com/', 'https://api.whatsapp.com/send',
    'https://t.me/softy', 'https://web.telegram.org/k/', 'https://telegram.me/softy',
    'https://www.snapchat.com/add/softy', 'https://www.youtube.com/watch?v=1', 'https://youtu.be/abc', 'https://m.youtube.com/',
    'https://www.google.com/', 'https://google.com/search?q=stickers', 'https://www.google.iq/', 'https://www.google.co.uk/', 'https://google.com.tr/', 'https://mail.google.com/', 'https://googleusercontent.com/',
    'https://notgoogle.com/', 'https://google.evil.example/', 'https://instagram.com.evil.example/', 'https://myinstagram.com/', 'https://xt.me/',
    'https://www.bing.com/search', 'https://duckduckgo.com/', 'https://softy.iq/how-it-works', 'https://SOFTY.IQ/', 'https://www.softy.iq/', 'http://localhost:3000/',
    'android-app://com.instagram.android', 'android-app://com.google.android.gm/', 'not a url', 'www.instagram.com', '//instagram.com/x', 'mailto:someone@example.com', 'file:///C:/x.html',
  ];
  it('referrer only (no utm), with and without own host', () => {
    expect(
      REFERRERS.map((r) => `${show(r)} -> ${classifySource(r, undefined)} | own=softy.iq: ${classifySource(r, null, 'softy.iq')} | own=localhost:3000: ${classifySource(r, '', 'LOCALHOST:3000')}`),
    ).toMatchSnapshot();
  });
  it('utm_source wins over the referrer', () => {
    const UTMS = [
      'ig', 'IG', 'instagram', 'Instagram_Story', 'insta', 'fb', 'FB', 'facebook', 'facebook-ads', 'meta', 'tiktok', 'TikTok Ads', 'tt', 'whatsapp', 'wa', 'WA',
      'whatsapp_status', 'telegram', 'tg', 'telegram-channel', 'snap', 'snapchat', 'Snap Ads', 'youtube', 'yt', 'google', 'google_ads', 'adwords', 'newsletter',
      'direct', 'x', ' ig ', '  ', '', 'fbig', 'wa.me', 'tgram',
    ];
    expect(
      UTMS.map((u) => `${show(u)} -> ${classifySource('https://www.google.com/', u)} | no referrer: ${classifySource(null, u)} | own referrer: ${classifySource('https://softy.iq/', u, 'softy.iq')}`),
    ).toMatchSnapshot();
  });
});

const USER_AGENTS: [string, string | null | undefined][] = [
  ['undefined', undefined],
  ['null', null],
  ['empty', ''],
  ['spaces', '   '],
  ['iPhone Safari', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'],
  ['iPhone Instagram in-app', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0'],
  ['iPad Safari', 'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'],
  ['iPadOS desktop-class', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'],
  ['iPod', 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15'],
  ['Android phone Chrome', 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'],
  ['Android tablet Chrome', 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'],
  ['Android Firefox Tablet', 'Mozilla/5.0 (Android 13; Tablet; rv:120.0) Gecko/120.0 Firefox/120.0'],
  ['Android Firefox Mobile', 'Mozilla/5.0 (Android 13; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0'],
  ['Android WebView Facebook', 'Mozilla/5.0 (Linux; Android 12; wv) AppleWebKit/537.36 Chrome/119.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/440.0.0.0;]'],
  ['Windows Chrome', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'],
  ['Windows Phone', 'Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1; Microsoft; Lumia 950) AppleWebKit/537.36 Edge/15.0'],
  ['Mac Safari', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'],
  ['Linux Firefox', 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0'],
  ['Kindle', 'Mozilla/5.0 (Linux; Android 9; KFMAWI) AppleWebKit/537.36 Silk/100 like Chrome/100 Safari/537.36'],
  ['BlackBerry', 'Mozilla/5.0 (BlackBerry; U; BlackBerry 9900; en) AppleWebKit/534.11+'],
  ['Opera Mini', 'Opera/9.80 (J2ME/MIDP; Opera Mini/9.80/37.0; U; en) Presto/2.12'],
  ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
  ['Googlebot smartphone', 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 (compatible; Googlebot/2.1)'],
  ['bingbot', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
  ['facebookexternalhit', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
  ['WhatsApp link preview', 'WhatsApp/2.23.20.0 A'],
  ['WhatsApp in-app browser word only', 'Mozilla/5.0 (iPhone) Mobile WhatsApp'],
  ['TelegramBot', 'TelegramBot (like TwitterBot)'],
  ['Slack preview', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
  ['Twitter preview', 'Twitterbot/1.0'],
  ['Lighthouse', 'Mozilla/5.0 (Linux; Android 11; moto g power) Chrome/120 Mobile Safari/537.36 Chrome-Lighthouse'],
  ['HeadlessChrome', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/120.0.0.0 Safari/537.36'],
  ['curl', 'curl/8.4.0'],
  ['Wget', 'Wget/1.21.4'],
  ['python-requests', 'python-requests/2.31.0'],
  ['Go http client', 'Go-http-client/2.0'],
  ['Apache HttpClient', 'Apache-HttpClient/4.5.13 (Java/17)'],
  ['UptimeRobot', 'Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)'],
  ['vercel-screenshot', 'vercel-screenshot/1.0'],
  ['Yahoo Slurp', 'Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)'],
  ['node fetch', 'node'],
  ['random string', 'x'],
];

describe('golden: classifyDevice / isBot', () => {
  it('user-agent table', () => {
    expect(USER_AGENTS.map(([name, ua]) => `${name} -> device=${classifyDevice(ua)} bot=${isBot(ua)}`)).toMatchSnapshot();
  });
});

/* ───────────────────────── server helpers ───────────────────────── */

const UA_IPHONE = USER_AGENTS[4][1] as string;
const req = (headers: Record<string, string> = {}) => new Request('https://softy.iq/api/track', { method: 'POST', headers });

describe('golden: baghdadDay / visitorHash / geoFrom', () => {
  afterEach(() => vi.useRealTimers());

  it('baghdadDay', () => {
    const instants = ['2026-11-09T20:59:59.999Z', '2026-11-09T21:00:00.000Z', '2026-11-10T12:00:00.000Z', '2026-12-31T21:00:00.000Z', '2024-02-28T21:00:00.000Z', '2026-03-28T23:30:00.000Z'];
    expect(instants.map((i) => `${i} -> ${baghdadDay(new Date(i))}`)).toMatchSnapshot();
  });

  it('visitorHash with a fixed secret and fixed days', () => {
    track(setupEnv()); // SESSION_SECRET = 'x' * 40
    const days = ['2026-11-10T08:00:00Z', '2026-11-10T20:59:59Z', '2026-11-10T21:00:00Z', '2026-11-11T08:00:00Z'];
    const requests: [string, Request][] = [
      ['no headers', req()],
      ['ua only', req({ 'user-agent': UA_IPHONE })],
      ['xff single', req({ 'user-agent': UA_IPHONE, 'x-forwarded-for': '1.2.3.4' })],
      ['xff list (first entry is used)', req({ 'user-agent': UA_IPHONE, 'x-forwarded-for': ' 1.2.3.4 , 10.0.0.1, 10.0.0.2' })],
      ['xff other ip', req({ 'user-agent': UA_IPHONE, 'x-forwarded-for': '5.6.7.8' })],
      ['x-real-ip only', req({ 'user-agent': UA_IPHONE, 'x-real-ip': ' 1.2.3.4 ' })],
      ['xff beats x-real-ip', req({ 'user-agent': UA_IPHONE, 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '9.9.9.9' })],
      ['other ua', req({ 'user-agent': 'curl/8.4.0', 'x-forwarded-for': '1.2.3.4' })],
      ['ipv6', req({ 'user-agent': UA_IPHONE, 'x-forwarded-for': '2001:db8::1' })],
    ];
    const withSecret = requests.map(([name, r]) => `${name} | ${days.map((d) => visitorHash(r, new Date(d))).join(' ')}`);
    expect(process.env.SESSION_SECRET).toBe(SECRET);
    delete process.env.SESSION_SECRET;
    const devSalt = requests.map(([name, r]) => `${name} | ${visitorHash(r, new Date(days[0]))}`);
    process.env.SESSION_SECRET = '';
    const emptySecretIsDevSalt = visitorHash(requests[2][1], new Date(days[0])) === devSalt[2].split(' | ')[1];
    process.env.SESSION_SECRET = SECRET;
    expect({ days, withSecret, devSalt, emptySecretIsDevSalt }).toMatchSnapshot();
  });

  it('visitorHash default `now` is the current clock', () => {
    track(setupEnv());
    vi.setSystemTime(new Date('2026-11-10T09:00:00.000Z'));
    const r = req({ 'user-agent': UA_IPHONE, 'x-forwarded-for': '1.2.3.4' });
    expect(visitorHash(r)).toBe(visitorHash(r, new Date('2026-11-10T08:00:00Z')));
    expect(baghdadDay()).toBe('2026-11-10');
  });

  it('geoFrom header table', () => {
    const cases: [string, Record<string, string>][] = [
      ['none', {}],
      ['all three', { 'x-vercel-ip-city': 'Baghdad', 'x-vercel-ip-country-region': 'BG', 'x-vercel-ip-country': 'IQ' }],
      ['percent-encoded city', { 'x-vercel-ip-city': encodeURIComponent('بغداد'), 'x-vercel-ip-country': 'IQ' }],
      ['encoded space', { 'x-vercel-ip-city': 'Al%20Basrah', 'x-vercel-ip-country-region': 'BA' }],
      ['malformed encoding is kept raw', { 'x-vercel-ip-city': '%E0%A4%A' }],
      ['long value cut at 80 chars', { 'x-vercel-ip-city': 'x'.repeat(200) }],
      ['long encoded value: decoded first, then cut', { 'x-vercel-ip-city': '%D8%A8'.repeat(100) }],
      ['empty values are dropped', { 'x-vercel-ip-city': '', 'x-vercel-ip-country': '' }],
      ['plus sign is not a space', { 'x-vercel-ip-city': 'New+York' }],
      ['unrelated geo headers ignored', { 'cf-ipcity': 'Baghdad', 'x-vercel-ip-latitude': '33.3' }],
    ];
    expect(
      cases.map(([name, headers]) => {
        const g = geoFrom(req(headers));
        return `${name} -> keys=[${Object.keys(g).join(',')}] ${show(g.city && g.city.length > 30 ? { ...g, city: `${g.city.slice(0, 10)}…(${g.city.length})` } : g)}`;
      }),
    ).toMatchSnapshot();
  });
});

describe('golden: trackServer', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('builds and stores events (frozen clock); never throws', async () => {
    track(setupEnv());
    vi.setSystemTime(new Date('2026-11-10T09:00:00.000Z'));
    const base = { 'user-agent': UA_IPHONE, 'x-forwarded-for': '1.2.3.4' };
    await trackServer(req(base), { type: 'upload', meta: { kind: 'png' } });
    await trackServer(req({ ...base, 'x-vercel-ip-city': 'Baghdad', 'x-vercel-ip-country-region': 'BG', 'x-vercel-ip-country': 'IQ' }), { type: 'pageview', path: '/', source: 'instagram' });
    // `partial` is spread last: it can override visitor, device, geo and even ts.
    await trackServer(req(base), { type: 'step', step: 'size', visitor: 'custom-visitor', device: 'desktop', city: 'Override', ts: '2026-11-09T00:00:00.000Z' });
    await trackServer(req(), { type: 'install', step: 'installed' });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await trackServer(req(base), { type: 'pageview', ts: 'not-a-date' });
    const stored = await getStorage().listEvents(new Date(0));
    expect({
      stored: stored.map((e) => `keys=[${Object.keys(e).join(',')}] ${canon(e)}`),
      loggedOnFailure: err.mock.calls.map((c) => c.map(String)),
    }).toMatchSnapshot();
  });
});

/* ───────────────────────── stats helpers ───────────────────────── */

// 2026-11-10 is a Tuesday. 12:00 UTC = 15:00 in Baghdad.
const NOW = new Date('2026-11-10T12:00:00.000Z');

describe('golden: stats helpers', () => {
  it('constants', () => {
    expect({ STATS_TZ, RANGE_OPTIONS, DEFAULT_RANGE }).toMatchSnapshot();
  });
  it('parseRange', () => {
    const inputs: (string | string[] | undefined)[] = [undefined, '', '7', '30', '90', '15', '0', '-7', '7.0', ' 7 ', '07', '7days', '9e1', 'abc', ['7', '90'], ['x', '7'], []];
    expect(inputs.map((v) => `${show(v)} -> ${parseRange(v)}`)).toMatchSnapshot();
  });
  it('dayKey / weekdayAndHour', () => {
    const instants = [
      '2026-11-06T20:59:59.000Z', '2026-11-06T21:00:00.000Z', '2026-11-07T08:30:00.000Z', '2026-11-08T12:00:00.000Z', '2026-11-09T12:00:00.000Z', '2026-11-09T20:59:59.999Z',
      '2026-11-09T21:00:00.000Z', '2026-11-10T12:00:00.000Z', '2026-11-11T02:15:00.000Z', '2026-11-12T23:00:00.000Z', '2026-11-13T20:00:00.000Z', '2026-12-31T21:30:00.000Z',
      '2024-02-29T10:00:00.000Z',
    ];
    expect(
      instants.map((i) => {
        const w = weekdayAndHour(new Date(i));
        return `${i} -> day=${dayKey(new Date(i))} weekday=${w.weekday} hour=${w.hour}`;
      }),
    ).toMatchSnapshot();
  });
  it('rangeDayKeys / sinceFor', () => {
    const nows = ['2026-11-10T12:00:00.000Z', '2026-11-09T20:59:59.000Z', '2026-11-09T21:00:00.000Z', '2026-03-01T00:30:00.000Z', '2027-01-01T05:00:00.000Z'];
    const out: Record<string, unknown> = {};
    for (const n of nows) {
      const d = new Date(n);
      out[n] = {
        keys7: rangeDayKeys(d, 7).join(' '),
        keys1: rangeDayKeys(d, 1).join(' '),
        keys0: rangeDayKeys(d, 0).join(' '),
        keys30: `${rangeDayKeys(d, 30)[0]} … ${rangeDayKeys(d, 30)[29]} (${rangeDayKeys(d, 30).length})`,
        keys90: `${rangeDayKeys(d, 90)[0]} … ${rangeDayKeys(d, 90)[89]} (${rangeDayKeys(d, 90).length}) sha=${sha256(canon(rangeDayKeys(d, 90))).slice(0, 16)}`,
        since: [7, 30, 90].map((days) => `${days}=>${sinceFor(d, days).toISOString()}`).join(' '),
      };
    }
    expect(out).toMatchSnapshot();
  });
  it('pct / mmToCmText', () => {
    const pairs: [number, number][] = [[1, 3], [2, 3], [1, 0], [0, 5], [5, 5], [7, 5], [1, 8], [1, 1_000], [1, 2_000], [1, 7], [-1, 4], [1, Number.NaN], [Number.NaN, 4], [0, 0]];
    const mms = [40, 45, 30, 42.42, 42.4, 42.5, 43.5, 0, 5, 196, 1, 0.4, -30, 12.345, Number.NaN];
    expect({
      pct: pairs.map(([a, b]) => `${show(a)}/${show(b)}=>${show(pct(a, b))}`).join(' '),
      mmToCmText: mms.map((m) => `${show(m)}=>${show(mmToCmText(m))}`).join(' '),
    }).toMatchSnapshot();
  });
});

/* ───────────────────────── aggregate ───────────────────────── */

const SOURCES: TrafficSource[] = ['instagram', 'facebook', 'tiktok', 'whatsapp', 'telegram', 'google', 'snapchat', 'youtube', 'direct', 'other'];
const DEVICES: DeviceKind[] = ['mobile', 'mobile', 'desktop', 'tablet', 'mobile'];
const CITIES = ['Baghdad', 'Basra', 'Erbil', 'Mosul', 'Najaf', 'Karbala', 'Kirkuk', 'Sulaymaniyah', 'Duhok', 'Hillah', 'Nasiriyah', 'Amarah'];
const GOVERNORATES = ['بغداد', 'البصرة', 'أربيل', 'نينوى', 'النجف'];
// Days before NOW (Baghdad calendar): today, yesterday, …, range edges for 7 / 30 / 90, and beyond.
const DAY_OFFSETS = [0, 0, 0, 1, 1, 2, 3, 5, 6, 7, 8, 14, 21, 29, 30, 31, 45, 60, 89, 90, 91, 120];
const SIZES_MM: [number, number][] = [[30, 30], [50, 30], [42.42, 30], [50, 50], [100, 40], [30, 30], [70, 50], [25, 25], [60, 60], [85.6, 53.98], [20, 20], [30, 30], [45, 45], [15, 90]];

/** UTC ISO string for a Baghdad wall-clock time `dayOffset` days before 2026-11-10. */
const at = (dayOffset: number, hour: number, minute = 0): string => new Date(Date.UTC(2026, 10, 10 - dayOffset, hour - 3, minute)).toISOString();

function syntheticEvents(): AnalyticsEvent[] {
  const events: AnalyticsEvent[] = [];
  let orderNo = 0;
  for (let i = 0; i < 40; i++) {
    const day = DAY_OFFSETS[i % DAY_OFFSETS.length];
    const hour = (i * 5 + 1) % 24;
    const visitor = `v${String(i).padStart(2, '0')}`;
    const source = SOURCES[i % SOURCES.length];
    const device = DEVICES[i % DEVICES.length];
    const city = CITIES[(i * 5 + Math.floor(i / 12)) % CITIES.length];
    // Today's events must not be in the future relative to NOW (15:00 Baghdad).
    const h = day === 0 ? hour % 15 : hour;
    events.push({ ts: at(day, h, 5), type: 'pageview', visitor, path: '/', source, device, ...(i % 7 === 3 ? {} : { city }) });
    if (i % 4 === 1) events.push({ ts: at(day, h, 6), type: 'pageview', visitor, path: '/how-it-works', source: 'other', device: 'desktop', city: 'Second-pageview-city' });
    if (i % 2 === 0) events.push({ ts: at(day, h, 10), type: 'step', visitor, path: '/', step: 'shape' });
    if (i % 3 === 0) events.push({ ts: at(day, h, 12), type: 'step', visitor, path: '/', step: 'design' });
    if (i % 5 === 0) events.push({ ts: at(day, h, 13), type: 'upload', visitor, meta: { kind: i % 10 === 0 ? 'png' : 'pdf' } });
    if (i % 4 === 0) events.push({ ts: at(day, h, 15), type: 'step', visitor, path: '/', step: 'size' });
    if (i % 6 === 0) events.push({ ts: at(day, h, 18), type: 'step', visitor, path: '/', step: 'quantity' });
    if (i % 6 === 0) events.push({ ts: at(day, h, 20), type: 'step', visitor, path: '/', step: 'details' });
    if (i % 3 === 0) {
      const [w, hgt] = SIZES_MM[orderNo % SIZES_MM.length];
      const sheets = [10, 20, 50, 100, 12][orderNo % 5];
      const material = orderNo % 3 === 0 ? 'plastic' : 'paper';
      const priced = orderNo % 4 !== 3;
      events.push({
        ts: at(day, h, 30),
        type: 'order',
        visitor,
        meta: {
          material,
          sheets,
          totalIqd: priced ? sheets * (material === 'plastic' ? 1_500 : 800) + 5_000 : null,
          governorate: GOVERNORATES[orderNo % GOVERNORATES.length],
          shape: ['circle', 'rect', 'custom'][orderNo % 3],
          widthMm: w,
          heightMm: hgt,
        },
      });
      orderNo++;
    }
    if (i % 8 === 0) events.push({ ts: at(day, h, 40), type: 'install', visitor, step: 'shown' });
    if (i % 16 === 0) events.push({ ts: at(day, h, 41), type: 'install', visitor, step: 'accepted' });
    if (i % 8 === 0 && i % 16 !== 0) events.push({ ts: at(day, h, 42), type: 'install', visitor, step: 'installed' });
  }
  // Hand-made edge cases.
  events.push(
    { ts: '2026-11-09T20:59:59.000Z', type: 'pageview', visitor: 'edge-before-midnight', source: 'direct', device: 'mobile', city: 'Baghdad' }, // 23:59 on 11-09
    { ts: '2026-11-09T21:00:00.000Z', type: 'pageview', visitor: 'edge-after-midnight', source: 'direct', device: 'mobile', city: 'Baghdad' }, // 00:00 on 11-10
    { ts: '2026-11-10T13:00:00.000Z', type: 'pageview', visitor: 'later-today', device: 'desktop' }, // after NOW but still today -> counted
    { ts: '2026-11-11T09:00:00.000Z', type: 'pageview', visitor: 'tomorrow', source: 'google', device: 'desktop' }, // outside every range
    { ts: 'not-a-date', type: 'pageview', visitor: 'invalid-ts', source: 'google' },
    { ts: at(1, 10), type: 'pageview', visitor: 'no-extras' },
    { ts: at(1, 10), type: 'upload', visitor: 'upload-only' }, // uploaded without any step/pageview event
    { ts: at(1, 11), type: 'order', visitor: 'order-only' }, // order without meta
    { ts: at(2, 11), type: 'order', visitor: 'order-odd-meta', meta: { material: '  paper  ', sheets: '20', totalIqd: -5, governorate: '   ', shape: '', widthMm: 0, heightMm: 30 } },
    { ts: at(2, 12), type: 'order', visitor: 'order-odd-meta', meta: { material: 'gold', sheets: 0, totalIqd: 0, governorate: 'بغداد', shape: 'circle', widthMm: 30, heightMm: Number.NaN } },
    { ts: at(2, 13), type: 'order', visitor: 'order-odd-meta-2', meta: { material: true, sheets: 12.5, totalIqd: 1_234.5, governorate: 5, shape: null, widthMm: 29.96, heightMm: 30.04 } },
    { ts: at(3, 9), type: 'step', visitor: 'step-unknown', step: 'checkout' },
    { ts: at(3, 9), type: 'step', visitor: 'step-missing' },
    { ts: at(3, 9), type: 'step', visitor: 'step-proto', step: 'constructor' },
    { ts: at(3, 9), type: 'install', visitor: 'install-no-step' },
    { ts: at(3, 9), type: 'weird' as AnalyticsEvent['type'], visitor: 'unknown-type' },
    { ts: at(4, 23, 59), type: 'pageview', visitor: 'v00', source: 'youtube', device: 'tablet', city: 'Reused-hash-other-day' }, // same hash on another day
  );
  return events;
}

const customer = (i: number, ordersCount: number): CustomerRecord => ({
  phone: `96477000000${String(i).padStart(2, '0')}`,
  governorate: GOVERNORATES[i % GOVERNORATES.length],
  district: 'x',
  landmark: 'y',
  firstOrderAt: '2026-10-01T00:00:00.000Z',
  lastOrderAt: '2026-11-02T00:00:00.000Z',
  ordersCount,
  totalIqd: 10_000 * ordersCount,
  lastOrderId: `o${i}`,
  lastDisplayNo: `EP-${i}`,
});
const CUSTOMERS: CustomerRecord[] = [1, 1, 2, 1, 5, 3, 1, 0, 2].map((n, i) => customer(i, n));

/** Whole Stats object, with the long row lists folded to one line per row (lossless). */
function compact(s: Stats) {
  return {
    ...s,
    funnel: s.funnel.map((f) => `${f.id}: count=${f.count} ofPrevious=${show(f.ofPreviousPct)} ofFirst=${f.ofFirstPct}`),
    daily: s.daily.map((d) => `${d.day} visitors=${d.visitors} orders=${d.orders}`),
    weekdays: s.weekdays.map((w, i) => `${i}: visitors=${w.visitors} orders=${w.orders}`),
    hours: s.hours.map((h, i) => `${String(i).padStart(2, '0')}: visitors=${h.visitors} orders=${h.orders}`),
    sources: s.sources.map((r) => `${r.key}=${r.count}`),
    devices: s.devices.map((r) => `${r.key}=${r.count}`),
    cities: s.cities.map((r) => `${r.key}=${r.count}`),
    governorates: s.governorates.map((r) => `${r.key}=${r.count}`),
    materials: s.materials.map((r) => `${r.key}=${r.count}`),
    shapes: s.shapes.map((r) => `${r.key}=${r.count}`),
    sizes: s.sizes.map((r) => `${r.key}=${r.count}`),
    keyOrder: Object.keys(s).join(','),
    sha256OfRawStats: sha256(canon(s)),
  };
}

describe('golden: aggregate', () => {
  const events = syntheticEvents();

  it('the synthetic input itself is stable', () => {
    const byType: Record<string, number> = {};
    for (const e of events) byType[e.type] = (byType[e.type] ?? 0) + 1;
    expect({ events: events.length, byType, customers: CUSTOMERS.length, sha256: sha256(canon({ events, CUSTOMERS })) }).toMatchSnapshot();
  });

  for (const days of [7, 30, 90] as const) {
    it(`${days} days`, () => {
      expect(compact(aggregate(events, CUSTOMERS, { now: NOW, days }))).toMatchSnapshot();
    });
  }

  it('input order does not matter except for first-seen attribution', () => {
    const reversed = [...events].reverse();
    const a = aggregate(events, CUSTOMERS, { now: NOW, days: 30 });
    const b = aggregate(reversed, CUSTOMERS, { now: NOW, days: 30 });
    const differing = (Object.keys(a) as (keyof Stats)[]).filter((k) => canon(a[k]) !== canon(b[k]));
    expect({ differingKeys: differing, reversed: { sources: b.sources.map((r) => `${r.key}=${r.count}`), devices: b.devices.map((r) => `${r.key}=${r.count}`), cities: b.cities.map((r) => `${r.key}=${r.count}`) } }).toMatchSnapshot();
  });

  it('no data, customers only, events only', () => {
    expect({
      empty30: compact(aggregate([], [], { now: NOW, days: 30 })),
      customersOnly7: compact(aggregate([], CUSTOMERS, { now: NOW, days: 7 })),
      eventsOutOfRangeOnly: compact(aggregate([{ ts: '2020-01-01T00:00:00.000Z', type: 'pageview', visitor: 'old' }], [], { now: NOW, days: 7 })),
    }).toMatchSnapshot();
  });

  it('different `now` shifts the window', () => {
    const s = aggregate(events, CUSTOMERS, { now: new Date('2026-11-03T21:30:00.000Z'), days: 7 });
    expect(compact(s)).toMatchSnapshot();
  });
});
