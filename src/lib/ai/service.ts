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
 *  - The Arabic design instructions (`instructions`, v2) also come back from the browser. `brief` signs them with
 *    the description (`instructionsToken`); when they come back unchanged the signed English description is drawn
 *    and nothing extra is called. Edited instructions are untrusted customer text: hardened and capped
 *    (AI_INSTRUCTIONS_MAX_CHARS), they reach OpenAI only through the translator (instructions.ts: after the
 *    reservation, as `input` data), and its English enters the image prompt wrapped as design instructions that
 *    are never printed, followed by a rule that the shape/size/text rules win.
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
import { ID_RE, uploadPath } from '@/lib/storage/paths';
import type {
  AiKind,
  AiReserveResult,
  BriefError,
  BriefResponse,
  GenerateError,
  GenerateResponse,
  ShopSettings,
} from '@/lib/types';
import { extractBrief } from './brief';
import {
  AI_BRIEF_PER_IP,
  AI_BRIEF_SITE,
  AI_IDEA_MAX_CHARS,
  AI_INSTRUCTIONS_MAX_CHARS,
  AI_AFTER_OPENAI_SAFETY_MS,
  AI_IMAGE_MODEL,
  AI_LINE_MAX_CHARS,
  AI_MAX_LINES,
  AI_MAX_REFS,
  AI_MIN_OPENAI_BUDGET_MS,
  AI_OPENAI_TIMEOUT_MS,
  AI_ROUTE_MAX_DURATION_MS,
  AI_TRANSLATE_TIMEOUT_MS,
  STAFF_BRIEF_DAILY_LIMIT,
  STAFF_IMAGE_DAILY_LIMIT,
  STAFF_SITE_CAP,
} from './config';
import { translateInstructions } from './instructions';
import { aiIpKey } from './ip';
import { normaliseGenerated, prepareRef } from './normalise';
import { generateImage, type ImageRef } from './openai';
import { aiReady, aiSetup, secretReady, type AiStorage } from './ready';
import { aiAspectOk, buildImagePrompt, imageRequestSize } from './prompt-template';
// The review box cleans the lines with the same function (browser-safe module).
import { capUnits, cleanLine } from './sanitize';

/* ───────────────────────────── API contract (declared in @/lib/types, shared with the builder) ───────────────────────────── */

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
  return hardenText(s, AI_VISUAL_MAX_CHARS);
}

/** The same clean-up for the Arabic design instructions (the brief's answer and what the browser sends back). */
export function hardenInstructions(s: string): string {
  return hardenText(s, AI_INSTRUCTIONS_MAX_CHARS);
}

function hardenText(s: string, max: number): string {
  const cleaned = s
    .replace(/[\p{Cc}\u2028\u2029]/gu, ' ')
    .replace(/[«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return capUnits(cleaned, max).trim();
}

const DEV_SALT = 'softy-dev-ai-brief-salt';

// secretReady / aiReady / aiSetup / hasAiStorage live in ready.ts (the home page imports it without the image code).
export { aiReady, secretReady };

/** HMAC-SHA256 hex of the description `brief` returned; `generate` accepts only signed descriptions. */
export function briefToken(visualDescription: string): string {
  const key = process.env.SESSION_SECRET || DEV_SALT;
  return createHmac('sha256', key).update(`ai-brief|${visualDescription}`).digest('hex');
}

/**
 * HMAC-SHA256 hex that signs the English description together with the Arabic design instructions
 * shown to the customer (`generate` skips the translation call when they come back unchanged).
 */
export function instructionsToken(visualDescription: string, instructions: string): string {
  const key = process.env.SESSION_SECRET || DEV_SALT;
  return createHmac('sha256', key).update(`ai-instr|${visualDescription}|${instructions}`).digest('hex');
}

function hexEqual(wantHex: string, gotHex: string): boolean {
  const want = Buffer.from(wantHex, 'hex');
  const got = Buffer.from(gotHex, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

function briefTokenOk(visualDescription: string, token: string): boolean {
  return hexEqual(briefToken(visualDescription), token);
}

/** True when `token` signs exactly this pair (no token = not signed). */
function instructionsTokenOk(visualDescription: string, instructions: string, token: string | undefined): boolean {
  return token !== undefined && hexEqual(instructionsToken(visualDescription, instructions), token);
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
    // Not trimmed or transformed: the token signs the exact string.
    instructions: z.string().max(AI_INSTRUCTIONS_MAX_CHARS).optional(),
    instructionsToken: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  })
  .refine(circleSquare, 'circle must be square');

/* ───────────────────────────── Shared plumbing ───────────────────────────── */

function report(where: string, what: string, tags: Record<string, string | number> = {}, level: 'warning' | 'error' = 'error'): void {
  reportError(new Error(`ai ${what}`), { where, tags, level });
}

/** The daily limits an actor works under: per usage key (IP or staff account) and for the whole site, per kind. */
export interface AiLimits {
  briefPerKey: number;
  briefSite: number;
  imagePerKey: number;
  imageSite: number;
}

/**
 * Who is asking and under which limits (strategy). The customer actor is today's behaviour; the staff
 * actor counts per account under its own usage kinds, so staff use never touches the customer limits.
 */
export interface AiActor {
  /** `ip` is the full address ('' without a trusted proxy); `ipKey` is the usage key: customer = aiIpKey(ip), staff = 'staff:<id>'. */
  identify(request: Request): { ip: string; ipKey: string };
  briefKind: AiKind;
  imageKind: AiKind;
  limits(settings: ShopSettings): AiLimits;
  /** Key of the in-memory first-line guard. */
  limiterKey(ip: string): string;
  /** Which in-memory first-line guards: 'customer' = limiters().brief / .generate (per IP), 'staff' = .staffBrief / .staffGenerate (per account). */
  guard: 'customer' | 'staff';
  /** Written to the generation record; null for a customer. */
  staffId: string | null;
}

/** The limit key: '' (site-only) when there is no trusted proxy and clientIp() is 'global'. */
function identify(request: Request): { ip: string; ipKey: string } {
  const ip = clientIp(request);
  return ip === 'global' ? { ip: '', ipKey: '' } : { ip, ipKey: aiIpKey(ip) };
}

/** The site's visitors: per-IP daily limits from the admin settings, the fixed brief limits. */
export const customerActor: AiActor = {
  identify,
  briefKind: 'brief',
  imageKind: 'image',
  limits: (settings) => ({
    briefPerKey: AI_BRIEF_PER_IP,
    briefSite: AI_BRIEF_SITE,
    imagePerKey: settings.ai.perIpDailyLimit,
    imageSite: settings.ai.siteDailyLimit,
  }),
  limiterKey: (ip) => ip || 'global',
  guard: 'customer',
  staffId: null,
};

/**
 * A logged-in staff account (the caller has already checked the session): own usage kinds, 50 images a day.
 * `ip` is always '': staff are identified by their account, so an admin block on the shop's IP (which matches by
 * full IP in reserve_ai and the precheck) never stops them, and no staff IP is stored.
 */
export function staffActor(staffId: string): AiActor {
  const key = `staff:${staffId}`;
  return {
    identify: () => ({ ip: '', ipKey: key }),
    briefKind: 'staff_brief',
    imageKind: 'staff_image',
    limits: () => ({
      briefPerKey: STAFF_BRIEF_DAILY_LIMIT,
      briefSite: STAFF_SITE_CAP,
      imagePerKey: STAFF_IMAGE_DAILY_LIMIT,
      imageSite: STAFF_SITE_CAP,
    }),
    limiterKey: () => key,
    guard: 'staff',
    staffId,
  };
}

/** Gives a reserved use back; never throws (a failed release is reported, the answer stands). */
async function release(storage: AiStorage, a: { day: string; ipKey: string; kind: AiKind }, where: string): Promise<void> {
  try {
    await storage.aiRelease(a);
  } catch {
    report(where, 'release failed', { kind: a.kind });
  }
}

/** An error outcome for either route: the body the browser sees plus an optional Retry-After. */
const failure = <E extends string>(
  error: E,
  retryAfterSec?: number,
): { body: { ok: false; error: E }; retryAfterSec?: number } => ({
  body: { ok: false, error },
  ...(retryAfterSec !== undefined ? { retryAfterSec } : {}),
});

/* ───────────────────────────── POST /api/design/brief ───────────────────────────── */

export interface BriefOutcome {
  body: BriefResponse;
  retryAfterSec?: number;
}

export async function runBrief(request: Request, json: unknown, actor: AiActor = customerActor): Promise<BriefOutcome> {
  const parsed = briefRequestSchema.safeParse(json);
  if (!parsed.success) return failure('invalid_request');

  const settings = await getSettings();
  const setup = aiSetup(settings);
  if (!setup) return failure('unavailable');
  const { cfg, storage } = setup;

  const { ip, ipKey } = actor.identify(request);
  const guards = limiters();
  const rl = (actor.guard === 'staff' ? guards.staffBrief : guards.brief).check(actor.limiterKey(ip));
  if (!rl.ok) return failure('rate_limited', rl.retryAfterSec);

  const day = shopDayKey(new Date());
  const limits = actor.limits(settings);
  const reserved = await storage.aiReserve({
    day,
    ipKey,
    ip,
    kind: actor.briefKind,
    perIpLimit: limits.briefPerKey,
    siteLimit: limits.briefSite,
  });
  // The brief has one limit answer for the customer: blocked, per-IP and site caps all read «wait».
  if (reserved.status !== 'ok') return failure('rate_limited');
  const giveBack = () => release(storage, { day, ipKey, kind: actor.briefKind }, 'ai.brief');

  try {
    const result = await extractBrief(cfg, parsed.data.idea);
    if (!result.ok) {
      await giveBack();
      return failure('failed');
    }

    const lines = result.brief.lines.map(cleanLine).filter((l) => l.length > 0);
    const visualDescription = hardenVisualDescription(result.brief.visualDescription);
    if (!visualDescription) {
      report('ai.brief', 'empty description', {}, 'warning');
      await giveBack();
      return failure('failed');
    }
    // Only changes the customer can see in a printed line are shown in the review box.
    const fixes = result.brief.fixes
      .map((f) => ({ from: capUnits(f.from.trim(), AI_LINE_MAX_CHARS), to: f.to.trim() }))
      .filter((f) => f.to.length > 0 && lines.some((l) => l.includes(f.to)));

    // May be '' (the model gave none): still signed; the review box then shows an empty field.
    const instructions = hardenInstructions(result.brief.instructions);
    return {
      body: {
        ok: true,
        lines,
        fixes,
        visualDescription,
        briefToken: briefToken(visualDescription),
        instructions,
        instructionsToken: instructionsToken(visualDescription, instructions),
      },
    };
  } catch {
    report('ai.brief', 'unexpected failure');
    await giveBack();
    return failure('failed');
  }
}

/* ───────────────────────────── POST /api/design/generate ───────────────────────────── */

export interface GenerateOutcome {
  body: GenerateResponse;
  retryAfterSec?: number;
}

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

/** Shortest translation call worth starting. */
export const AI_TRANSLATE_MIN_MS = 5_000;

/**
 * How long the instructions translation may run: at most AI_TRANSLATE_TIMEOUT_MS, and never so long that less than
 * AI_MIN_OPENAI_BUDGET_MS would be left for the image call after it. null when that is under AI_TRANSLATE_MIN_MS
 * (the use is given back, 'failed').
 */
export function translateTimeoutMs(elapsedMs: number): number | null {
  const left = openAiTimeoutMs(elapsedMs);
  if (left === null) return null;
  const t = Math.min(AI_TRANSLATE_TIMEOUT_MS, left - AI_MIN_OPENAI_BUDGET_MS);
  return t >= AI_TRANSLATE_MIN_MS ? t : null;
}

/**
 * Non-atomic, read-only look at the stored counters and blocks, run before the reference images
 * are downloaded: what `aiReserve` would answer right now when it is already a refusal, else null.
 * Same order as the reservation (blocked, site cap, per-IP cap). It only saves work: the atomic
 * reservation still decides, and any read failure here just means "no opinion".
 */
async function precheckAi(
  storage: AiStorage,
  a: { day: string; ip: string; ipKey: string; kind: AiKind; perIpLimit: number; siteLimit: number },
): Promise<Exclude<AiReserveResult, 'ok'> | null> {
  if (!storage.aiListBlocks || !storage.aiUsage) return null;
  try {
    const [blocks, usage] = await Promise.all([storage.aiListBlocks(), storage.aiUsage(a.day)]);
    // By key, or by the full IP (a new SESSION_SECRET changes every key; it must not lift blocks). Same as the reservation.
    if (blocks.some((b) => b.ipKey === a.ipKey || (a.ip !== '' && b.ip === a.ip))) return 'blocked';
    const rows = usage.filter((r) => r.day === a.day && r.kind === a.kind);
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
export async function runGenerate(
  request: Request,
  json: unknown,
  clock: () => number = Date.now,
  startedAt?: number,
  actor: AiActor = customerActor,
): Promise<GenerateOutcome> {
  const started = startedAt ?? clock();
  const parsed = generateRequestSchema.safeParse(json);
  if (!parsed.success) return failure('invalid_request');
  const req = parsed.data;

  // Checked on the exact string received, before any clean-up.
  if (!briefTokenOk(req.visualDescription, req.briefToken)) return failure('invalid_request');
  if (!aiAspectOk(req.shape, req.widthUm, req.heightUm)) return failure('invalid_request');

  const settings = await getSettings();
  const setup = aiSetup(settings);
  if (!setup) return failure('unavailable');
  const { cfg, storage } = setup;

  const lines = req.lines.map(cleanLine).filter((l) => l.length > 0);
  // The amount of text never refuses a try: the page warns the customer, who may go on (the size and line limits are in the schema).

  const visualDescription = hardenVisualDescription(req.visualDescription);
  if (!visualDescription) return failure('invalid_request');

  // v2 design instructions. '' = none (an old page, or the field was emptied): the signed description, as before.
  const instructions = req.instructions === undefined ? '' : hardenInstructions(req.instructions);
  // Unchanged since the brief (checked on the exact strings received) → no translation. No token = edited.
  const needsTranslation =
    instructions !== '' &&
    !instructionsTokenOk(req.visualDescription, req.instructions as string, req.instructionsToken);

  // In-memory guard BEFORE any ref work and the stored reservation: every attempt counts, even one
  // whose stored use is later given back, so failing calls cannot be repeated without limit.
  const { ip, ipKey } = actor.identify(request);
  const guards = limiters();
  const rl = (actor.guard === 'staff' ? guards.staffGenerate : guards.generate).check(actor.limiterKey(ip));
  if (!rl.ok) return failure('ip_limit', rl.retryAfterSec);

  const day = shopDayKey(new Date());
  const { imagePerKey: perIpLimit, imageSite: siteLimit } = actor.limits(settings);

  // Reference images: checked and prepared BEFORE the reservation, so a bad one costs nothing.
  // Downloading and decoding them is the expensive part, so first (only when there are refs) a
  // read-only look answers a blocked IP or a reached cap without touching a single file, and each
  // ref's meta and size are checked before its bytes are read. The atomic reservation still decides.
  if (req.refUploadIds.length > 0) {
    const early = await precheckAi(storage, { day, ip, ipKey, kind: actor.imageKind, perIpLimit, siteLimit });
    if (early) return failure(early);
  }
  // Each ref's meta and size first (all in parallel, no bytes read yet), then the bytes (each a storage round trip,
  // also in parallel); any bad one refuses the request. With uploadInfo the meta is already checked, so the bytes
  // are read with readFile instead of fetching the meta again through readUpload.
  const uploadInfo = storage.uploadInfo?.bind(storage);
  if (uploadInfo) {
    const infos = await Promise.all(req.refUploadIds.map((id) => uploadInfo(id)));
    for (const info of infos) {
      if (!info) return failure('invalid_request');
      if (info.meta.mime !== 'image/png' && info.meta.mime !== 'image/jpeg') return failure('invalid_request');
      if (info.size > settings.maxUploadBytes) return failure('invalid_request');
    }
  }
  const prepared = await Promise.all(
    req.refUploadIds.map(async (id): Promise<ImageRef | null> => {
      const bytes = uploadInfo ? await storage.readFile(uploadPath(id)) : ((await storage.readUpload(id))?.bytes ?? null);
      if (!bytes) return null;
      const kind = sniffKind(bytes);
      if (kind !== 'png' && kind !== 'jpeg') return null;
      try {
        return await prepareRef(bytes);
      } catch {
        return null;
      }
    }),
  );
  if (prepared.some((r) => r === null)) return failure('invalid_request');
  const refs = prepared as ImageRef[];

  // Time left in this request: with too little for an image call nothing is reserved (the check right before the
  // call, below, still guards the time the reservation itself took).
  if (openAiTimeoutMs(clock() - started) === null) {
    report('ai.generate', 'no time left before reserving', { refs: refs.length }, 'warning');
    return failure('failed');
  }

  const reserved = await storage.aiReserve({
    day,
    ipKey,
    ip,
    kind: actor.imageKind,
    perIpLimit,
    siteLimit,
  });
  if (reserved.status !== 'ok') return failure(reserved.status);

  // From here on every failure gives the use back: a failed try does not count.
  const giveBack = () => release(storage, { day, ipKey, kind: actor.imageKind }, 'ai.generate');
  let stored: { uploadId: string; png: Uint8Array; pxWidth: number; pxHeight: number };
  try {
    // Edited instructions: the English the image model reads comes from the translator (after the reservation).
    let artwork = visualDescription;
    let descriptionSource: 'brief' | 'customer' = 'brief';
    if (needsTranslation) {
      const translateMs = translateTimeoutMs(clock() - started);
      if (translateMs === null) {
        report('ai.generate', 'no time left for the translation', {}, 'warning');
        await giveBack();
        return failure('failed');
      }
      const tr = await translateInstructions(cfg, instructions, translateMs);
      if (!tr.ok) {
        await giveBack();
        return failure(tr.reason === 'refused' ? 'refused' : 'failed');
      }
      const english = hardenVisualDescription(tr.visualDescription);
      if (!english) {
        report('ai.generate', 'empty translation', {}, 'warning');
        await giveBack();
        return failure('failed');
      }
      artwork = english;
      descriptionSource = 'customer';
    }

    // Time left in this request: never start (or run) an image call that a platform kill at
    // maxDuration could cut off after OpenAI has charged.
    const timeoutMs = openAiTimeoutMs(clock() - started);
    if (timeoutMs === null) {
      report('ai.generate', 'no time left for the image call', {}, 'warning');
      await giveBack();
      return failure('failed');
    }
    const size = imageRequestSize(req.shape, req.widthUm, req.heightUm);
    const result = await generateImage(cfg, {
      prompt: buildImagePrompt({
        shape: req.shape,
        corners: req.corners,
        widthUm: req.widthUm,
        heightUm: req.heightUm,
        visualDescription: artwork,
        descriptionSource,
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
      return failure(result.reason === 'refused' ? 'refused' : 'failed');
    }

    let norm: Awaited<ReturnType<typeof normaliseGenerated>>;
    try {
      norm = await normaliseGenerated(result.png, req.shape);
    } catch {
      report('ai.generate', 'normalise failed', { shape: req.shape });
      await giveBack();
      return failure('failed');
    }
    if (req.shape === 'custom' && !(await customArtworkUsable(norm.png))) {
      // The model ignored the transparent background (or drew nothing): the builder would answer
      // no_alpha. OpenAI already charged for this image, so the use is KEPT (ruling, fix round 1)
      // and the answer is `refused`, whose copy does not claim the try was free.
      report('ai.generate', 'custom output not usable', { code: 'custom_no_alpha' }, 'warning');
      return failure('refused');
    }

    const png = await fitPngBudget(norm.png);
    if (!png) {
      report('ai.generate', 'png too large', { shape: req.shape, bytes: norm.png.byteLength });
      await giveBack();
      return failure('failed');
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
    return failure('failed');
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
    instructions: instructions === '' ? null : instructions,
    // Only a staff generation carries the account; a customer record keeps today's shape.
    ...(actor.staffId !== null ? { staffId: actor.staffId } : {}),
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
