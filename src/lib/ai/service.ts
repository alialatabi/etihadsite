import 'server-only';
/**
 * Server logic of the two AI design routes (POST /api/design/brief and /api/design/generate).
 * The route files only read the body and turn the outcome into a Response.
 *
 * Trust rules:
 *  - Every value from the browser is validated with zod; prices, limits and the image prompt are
 *    built here, never taken from the client.
 *  - The customer's free text (`idea`) is sent to OpenAI only by `brief` (as data, see brief.ts).
 *    `generate` stores it for the admin page but never sends it: the image prompt is built from
 *    the fixed template, the brief's `visualDescription` and the confirmed `lines`.
 *  - `visualDescription` reaches `generate` from the browser, so `brief` signs it (`briefToken`,
 *    HMAC with SESSION_SECRET) and `generate` refuses any description it did not sign.
 *  - Reports carry fixed messages and codes only: no idea text, no IP, no key, no caught error
 *    (a storage error can echo the row, which holds the idea and the IP).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import { z } from 'zod';
import { reportError } from '@/lib/monitoring/report';
import { sniffKind } from '@/lib/design/kind';
import { ALPHA_THRESHOLD, alphaBoundingBox, hasAnyAlpha } from '@/lib/design/pixels';
import { clientIp, limiters } from '@/lib/rate-limit';
import { getSettings } from '@/lib/settings';
import { shopDayKey } from '@/lib/shop-time';
import { getStorage } from '@/lib/storage';
import { ID_RE } from '@/lib/storage/paths';
import type { AiKind, AiReserveResult } from '@/lib/types';
import { extractBrief } from './brief';
import {
  AI_BRIEF_PER_IP,
  AI_BRIEF_SITE,
  AI_IDEA_MAX_CHARS,
  AI_AFTER_OPENAI_SAFETY_MS,
  AI_IMAGE_MODEL,
  AI_LINE_MAX_CHARS,
  AI_MAX_LINES,
  AI_MAX_REFS,
  AI_MIN_OPENAI_BUDGET_MS,
  AI_OPENAI_TIMEOUT_MS,
  AI_ROUTE_MAX_DURATION_MS,
} from './config';
import { aiIpKey } from './ip';
import { normaliseGenerated, prepareRef } from './normalise';
import { generateImage, openAiConfig, type ImageRef } from './openai';
import { aiReady, hasAiStorage, secretReady, type AiStorage } from './ready';
import { aiAspectOk, buildImagePrompt, imageRequestSize } from './prompt-template';
// The review box cleans the lines with the same function (browser-safe module).
import { capUnits, cleanLine } from './sanitize';

/* ───────────────────────────── API contract (used by the builder) ───────────────────────────── */

export type BriefError = 'unavailable' | 'rate_limited' | 'invalid_request' | 'failed';
export type BriefResponse =
  | { ok: true; lines: string[]; fixes: { from: string; to: string }[]; visualDescription: string; briefToken: string }
  | { ok: false; error: BriefError };

export type GenerateError =
  | 'unavailable'
  | 'blocked'
  | 'ip_limit'
  | 'site_limit'
  | 'text_too_long'
  | 'refused'
  | 'failed'
  | 'invalid_request';
export type GenerateResponse =
  | { ok: true; uploadId: string; png: string; pxWidth: number; pxHeight: number; remainingToday: number | null }
  | { ok: false; error: GenerateError };

export const BRIEF_STATUS: Record<BriefError, number> = {
  invalid_request: 400,
  rate_limited: 429,
  failed: 502,
  unavailable: 503,
};

export const GENERATE_STATUS: Record<GenerateError, number> = {
  invalid_request: 400,
  text_too_long: 400,
  blocked: 403,
  refused: 422,
  ip_limit: 429,
  site_limit: 429,
  failed: 502,
  unavailable: 503,
};

/** Longest `visualDescription` (UTF-16 units, as zod counts) the generate route accepts. */
export const AI_VISUAL_MAX_CHARS = 600;
/** Byte cap of both JSON bodies (an idea of 1,000 Arabic letters is about 2 KB). */
export const AI_BODY_MAX_BYTES = 16 * 1024;

/* ───────────────────────────── Pure helpers ───────────────────────────── */

/**
 * Defence in depth for the model's English artwork description before it is signed and before it
 * enters the image prompt: control characters and newlines become spaces, « » go (they quote the
 * printed lines in the template), spaces collapse, and the length is capped.
 */
export function hardenVisualDescription(s: string): string {
  const cleaned = s
    .replace(/[\p{Cc}\u2028\u2029]/gu, ' ')
    .replace(/[«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return capUnits(cleaned, AI_VISUAL_MAX_CHARS).trim();
}

const DEV_SALT = 'softy-dev-ai-brief-salt';

// secretReady / aiReady / hasAiStorage live in ready.ts (the home page imports it without the image code).
export { aiReady, secretReady };

/** HMAC-SHA256 hex of the description `brief` returned; `generate` accepts only signed descriptions. */
export function briefToken(visualDescription: string): string {
  const key = process.env.SESSION_SECRET || DEV_SALT;
  return createHmac('sha256', key).update(`ai-brief|${visualDescription}`).digest('hex');
}

function briefTokenOk(visualDescription: string, token: string): boolean {
  const want = Buffer.from(briefToken(visualDescription), 'hex');
  const got = Buffer.from(token, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * The browser's custom-shape decode (decode.client.ts) and the order route both need some
 * transparency (else 'no_alpha') and some content above ALPHA_THRESHOLD (else 'empty' / 'corrupt').
 * Same pure helpers, on the pixels sharp decodes.
 */
export async function customArtworkUsable(png: Uint8Array): Promise<boolean> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) return false;
  const px = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return hasAnyAlpha(px, info.width, info.height) && alphaBoundingBox(px, info.width, info.height, ALPHA_THRESHOLD) !== null;
}

/**
 * Largest stored and returned PNG: base64 (×4/3) must stay well under Vercel's 4.5 MB response
 * limit, together with the rest of the JSON.
 */
export const AI_PNG_MAX_BYTES = 3_200_000;

/**
 * The PNG when it fits `maxBytes`; else the same pixels re-encoded at maximum compression when that
 * fits; else null (the route gives the use back and answers `failed`).
 */
export async function fitPngBudget(png: Uint8Array, maxBytes: number = AI_PNG_MAX_BYTES): Promise<Uint8Array | null> {
  if (png.byteLength <= maxBytes) return png;
  const smaller = await sharp(png).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  return smaller.byteLength <= maxBytes ? new Uint8Array(smaller) : null;
}

/* ───────────────────────────── Schemas ───────────────────────────── */

const um = z.number().int().min(1).max(400_000);
const shape = z.enum(['circle', 'rect', 'custom']);
const idea = z.string().trim().min(1).max(AI_IDEA_MAX_CHARS);
const circleSquare = (s: { shape: string; widthUm: number; heightUm: number }) =>
  s.shape !== 'circle' || s.widthUm === s.heightUm;

export const briefRequestSchema = z
  .object({ idea, shape, widthUm: um, heightUm: um })
  .refine(circleSquare, 'circle must be square');

export const generateRequestSchema = z
  .object({
    shape,
    corners: z.enum(['rounded', 'sharp']),
    widthUm: um,
    heightUm: um,
    idea,
    // Not trimmed or transformed: the token signs the exact string.
    visualDescription: z.string().min(1).max(AI_VISUAL_MAX_CHARS),
    briefToken: z.string().regex(/^[0-9a-f]{64}$/),
    lines: z.array(z.string().max(AI_LINE_MAX_CHARS)).max(AI_MAX_LINES),
    refUploadIds: z.array(z.string().regex(ID_RE)).max(AI_MAX_REFS),
  })
  .refine(circleSquare, 'circle must be square');

/* ───────────────────────────── Shared plumbing ───────────────────────────── */

function report(where: string, what: string, tags: Record<string, string | number> = {}, level: 'warning' | 'error' = 'error'): void {
  reportError(new Error(`ai ${what}`), { where, tags, level });
}

/** The limit key: '' (site-only) when there is no trusted proxy and clientIp() is 'global'. */
function identify(request: Request): { ip: string; ipKey: string } {
  const ip = clientIp(request);
  return ip === 'global' ? { ip: '', ipKey: '' } : { ip, ipKey: aiIpKey(ip) };
}

/** Gives a reserved use back; never throws (a failed release is reported, the answer stands). */
async function release(storage: AiStorage, a: { day: string; ipKey: string; kind: AiKind }, where: string): Promise<void> {
  try {
    await storage.aiRelease(a);
  } catch {
    report(where, 'release failed', { kind: a.kind });
  }
}

/* ───────────────────────────── POST /api/design/brief ───────────────────────────── */

export interface BriefOutcome {
  body: BriefResponse;
  retryAfterSec?: number;
}

const briefFail = (error: BriefError, retryAfterSec?: number): BriefOutcome => ({
  body: { ok: false, error },
  ...(retryAfterSec !== undefined ? { retryAfterSec } : {}),
});

export async function runBrief(request: Request, json: unknown): Promise<BriefOutcome> {
  const parsed = briefRequestSchema.safeParse(json);
  if (!parsed.success) return briefFail('invalid_request');

  const settings = await getSettings();
  const cfg = openAiConfig();
  const storage = getStorage();
  if (!settings.ai.enabled || !cfg || !secretReady() || !hasAiStorage(storage)) return briefFail('unavailable');

  const { ip, ipKey } = identify(request);
  const rl = limiters().brief.check(ip || 'global');
  if (!rl.ok) return briefFail('rate_limited', rl.retryAfterSec);

  const day = shopDayKey(new Date());
  const reserved = await storage.aiReserve({
    day,
    ipKey,
    ip,
    kind: 'brief',
    perIpLimit: AI_BRIEF_PER_IP,
    siteLimit: AI_BRIEF_SITE,
  });
  // The brief has one limit answer for the customer: blocked, per-IP and site caps all read «wait».
  if (reserved.status !== 'ok') return briefFail('rate_limited');

  try {
    const result = await extractBrief(cfg, parsed.data.idea);
    if (!result.ok) {
      await release(storage, { day, ipKey, kind: 'brief' }, 'ai.brief');
      return briefFail('failed');
    }

    const lines = result.brief.lines.map(cleanLine).filter((l) => l.length > 0);
    const visualDescription = hardenVisualDescription(result.brief.visualDescription);
    if (!visualDescription) {
      report('ai.brief', 'empty description', {}, 'warning');
      await release(storage, { day, ipKey, kind: 'brief' }, 'ai.brief');
      return briefFail('failed');
    }
    // Only changes the customer can see in a printed line are shown in the review box.
    const fixes = result.brief.fixes
      .map((f) => ({ from: capUnits(f.from.trim(), AI_LINE_MAX_CHARS), to: f.to.trim() }))
      .filter((f) => f.to.length > 0 && lines.some((l) => l.includes(f.to)));

    return {
      body: { ok: true, lines, fixes, visualDescription, briefToken: briefToken(visualDescription) },
    };
  } catch {
    report('ai.brief', 'unexpected failure');
    await release(storage, { day, ipKey, kind: 'brief' }, 'ai.brief');
    return briefFail('failed');
  }
}

/* ───────────────────────────── POST /api/design/generate ───────────────────────────── */

export interface GenerateOutcome {
  body: GenerateResponse;
  retryAfterSec?: number;
}

const genFail = (error: GenerateError, retryAfterSec?: number): GenerateOutcome => ({
  body: { ok: false, error },
  ...(retryAfterSec !== undefined ? { retryAfterSec } : {}),
});

/**
 * How long the OpenAI image call may run, given the time already spent in this request: the route's
 * `maxDuration` less `elapsedMs` less the time the save needs afterwards, capped at
 * AI_OPENAI_TIMEOUT_MS. null when less than AI_MIN_OPENAI_BUDGET_MS is left, i.e. the call must not
 * start (a platform kill after OpenAI charged would keep the use and show the customer nothing).
 */
export function openAiTimeoutMs(elapsedMs: number): number | null {
  const budget = AI_ROUTE_MAX_DURATION_MS - Math.max(0, elapsedMs) - AI_AFTER_OPENAI_SAFETY_MS;
  if (budget < AI_MIN_OPENAI_BUDGET_MS) return null;
  return Math.min(AI_OPENAI_TIMEOUT_MS, budget);
}

/**
 * Non-atomic, read-only look at the stored counters and blocks, run before the reference images
 * are downloaded: what `aiReserve` would answer right now when it is already a refusal, else null.
 * Same order as the reservation (blocked, site cap, per-IP cap). It only saves work: the atomic
 * reservation still decides, and any read failure here just means "no opinion".
 */
async function precheckAi(
  storage: AiStorage,
  a: { day: string; ip: string; ipKey: string; perIpLimit: number; siteLimit: number },
): Promise<Exclude<AiReserveResult, 'ok'> | null> {
  if (!storage.aiListBlocks || !storage.aiUsage) return null;
  try {
    const [blocks, usage] = await Promise.all([storage.aiListBlocks(), storage.aiUsage(a.day)]);
    // By key, or by the full IP (a new SESSION_SECRET changes every key; it must not lift blocks). Same as the reservation.
    if (blocks.some((b) => b.ipKey === a.ipKey || (a.ip !== '' && b.ip === a.ip))) return 'blocked';
    const rows = usage.filter((r) => r.day === a.day && r.kind === 'image');
    if (rows.reduce((n, r) => n + r.count, 0) >= a.siteLimit) return 'site_limit';
    const mine = rows.find((r) => r.ipKey === a.ipKey);
    if (a.ipKey !== '' && (mine?.count ?? 0) >= a.perIpLimit) return 'ip_limit';
  } catch {
    // No opinion: the reservation below decides.
  }
  return null;
}

/**
 * `startedAt`: when the route started (before the body read, which counts against its `maxDuration`);
 * without it the budget starts here. `clock` is for tests only (the time budget).
 */
export async function runGenerate(request: Request, json: unknown, clock: () => number = Date.now, startedAt?: number): Promise<GenerateOutcome> {
  const started = startedAt ?? clock();
  const parsed = generateRequestSchema.safeParse(json);
  if (!parsed.success) return genFail('invalid_request');
  const req = parsed.data;

  // Checked on the exact string received, before any clean-up.
  if (!briefTokenOk(req.visualDescription, req.briefToken)) return genFail('invalid_request');
  if (!aiAspectOk(req.shape, req.widthUm, req.heightUm)) return genFail('invalid_request');

  const settings = await getSettings();
  const cfg = openAiConfig();
  const storage = getStorage();
  if (!settings.ai.enabled || !cfg || !secretReady() || !hasAiStorage(storage)) return genFail('unavailable');

  const lines = req.lines.map(cleanLine).filter((l) => l.length > 0);
  // The amount of text never refuses a try: the page warns the customer, who may go on (the size and line limits are in the schema).

  const visualDescription = hardenVisualDescription(req.visualDescription);
  if (!visualDescription) return genFail('invalid_request');

  // In-memory guard BEFORE any ref work and the stored reservation: every attempt counts, even one
  // whose stored use is later given back, so failing calls cannot be repeated without limit.
  const { ip, ipKey } = identify(request);
  const rl = limiters().generate.check(ip || 'global');
  if (!rl.ok) return genFail('ip_limit', rl.retryAfterSec);

  const day = shopDayKey(new Date());
  const perIpLimit = settings.ai.perIpDailyLimit;
  const siteLimit = settings.ai.siteDailyLimit;

  // Reference images: checked and prepared BEFORE the reservation, so a bad one costs nothing.
  // Downloading and decoding them is the expensive part, so first (only when there are refs) a
  // read-only look answers a blocked IP or a reached cap without touching a single file, and each
  // ref's meta and size are checked before its bytes are read. The atomic reservation still decides.
  if (req.refUploadIds.length > 0) {
    const early = await precheckAi(storage, { day, ip, ipKey, perIpLimit, siteLimit });
    if (early) return genFail(early);
  }
  // Each ref's meta and size first (all in parallel, no bytes read yet), then the bytes (each a storage round trip,
  // also in parallel); any bad one refuses the request.
  const uploadInfo = storage.uploadInfo?.bind(storage);
  if (uploadInfo) {
    const infos = await Promise.all(req.refUploadIds.map((id) => uploadInfo(id)));
    for (const info of infos) {
      if (!info) return genFail('invalid_request');
      if (info.meta.mime !== 'image/png' && info.meta.mime !== 'image/jpeg') return genFail('invalid_request');
      if (info.size > settings.maxUploadBytes) return genFail('invalid_request');
    }
  }
  const prepared = await Promise.all(
    req.refUploadIds.map(async (id): Promise<ImageRef | null> => {
      const upload = await storage.readUpload(id);
      if (!upload) return null;
      const kind = sniffKind(upload.bytes);
      if (kind !== 'png' && kind !== 'jpeg') return null;
      try {
        return await prepareRef(upload.bytes);
      } catch {
        return null;
      }
    }),
  );
  if (prepared.some((r) => r === null)) return genFail('invalid_request');
  const refs = prepared as ImageRef[];

  // Time left in this request: with too little for an image call nothing is reserved (the check right before the
  // call, below, still guards the time the reservation itself took).
  if (openAiTimeoutMs(clock() - started) === null) {
    report('ai.generate', 'no time left before reserving', { refs: refs.length }, 'warning');
    return genFail('failed');
  }

  const reserved = await storage.aiReserve({
    day,
    ipKey,
    ip,
    kind: 'image',
    perIpLimit,
    siteLimit,
  });
  if (reserved.status !== 'ok') return genFail(reserved.status);

  // From here on every failure gives the use back: a failed try does not count.
  const giveBack = () => release(storage, { day, ipKey, kind: 'image' }, 'ai.generate');
  let stored: { uploadId: string; png: Uint8Array; pxWidth: number; pxHeight: number };
  try {
    // Time left in this request: never start (or run) an image call that a platform kill at
    // maxDuration could cut off after OpenAI has charged.
    const timeoutMs = openAiTimeoutMs(clock() - started);
    if (timeoutMs === null) {
      report('ai.generate', 'no time left for the image call', {}, 'warning');
      await giveBack();
      return genFail('failed');
    }
    const size = imageRequestSize(req.shape, req.widthUm, req.heightUm);
    const result = await generateImage(cfg, {
      prompt: buildImagePrompt({
        shape: req.shape,
        corners: req.corners,
        widthUm: req.widthUm,
        heightUm: req.heightUm,
        visualDescription,
        lines,
        hasRefs: refs.length > 0,
      }),
      size: size.size,
      background: size.background,
      refs,
      timeoutMs,
    });
    if (!result.ok) {
      await giveBack();
      return genFail(result.reason === 'refused' ? 'refused' : 'failed');
    }

    let norm: Awaited<ReturnType<typeof normaliseGenerated>>;
    try {
      norm = await normaliseGenerated(result.png, req.shape);
    } catch {
      report('ai.generate', 'normalise failed', { shape: req.shape });
      await giveBack();
      return genFail('failed');
    }
    if (req.shape === 'custom' && !(await customArtworkUsable(norm.png))) {
      // The model ignored the transparent background (or drew nothing): the builder would answer
      // no_alpha. OpenAI already charged for this image, so the use is KEPT (ruling, fix round 1)
      // and the answer is `refused`, whose copy does not claim the try was free.
      report('ai.generate', 'custom output not usable', { code: 'custom_no_alpha' }, 'warning');
      return genFail('refused');
    }

    const png = await fitPngBudget(norm.png);
    if (!png) {
      report('ai.generate', 'png too large', { shape: req.shape, bytes: norm.png.byteLength });
      await giveBack();
      return genFail('failed');
    }

    const uploadId = nanoid();
    await storage.saveUpload(uploadId, png, {
      mime: 'image/png',
      originalName: 'ai-design.png',
      bytes: png.byteLength,
      createdAt: new Date().toISOString(),
    });
    stored = { uploadId, png, pxWidth: norm.pxWidth, pxHeight: norm.pxHeight };
  } catch {
    report('ai.generate', 'unexpected failure', { shape: req.shape });
    await giveBack();
    return genFail('failed');
  }

  // The image is saved and delivered; a failed record only costs the admin gallery entry (and the purge's
  // protection of the upload), so it is tried twice before giving up. The answer stays ok either way.
  const record = {
    id: nanoid(),
    createdAt: new Date().toISOString(),
    day,
    ip,
    ipKey,
    shape: req.shape,
    corners: req.corners,
    widthUm: req.widthUm,
    heightUm: req.heightUm,
    idea: req.idea,
    lines,
    hasRefs: refs.length > 0,
    model: AI_IMAGE_MODEL,
    uploadId: stored.uploadId,
    orderId: null,
  };
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await storage.aiRecordGeneration?.(record);
      break;
    } catch {
      if (attempt === 2) report('ai.generate', 'record failed', { uploadId: stored.uploadId });
    }
  }

  return {
    body: {
      ok: true,
      uploadId: stored.uploadId,
      png: Buffer.from(stored.png).toString('base64'),
      pxWidth: stored.pxWidth,
      pxHeight: stored.pxHeight,
      remainingToday: ipKey === '' ? null : Math.max(0, perIpLimit - reserved.used),
    },
  };
}
