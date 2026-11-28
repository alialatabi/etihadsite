/** AI sticker designer constants. Plain values: safe to import from browser code too. */
export const AI_IMAGE_MODEL = 'gpt-image-2.6-flare';
export const AI_BRIEF_MODEL = 'gpt-5.4-mini';
export const AI_IMAGE_LONG_SIDE = 1024;
export const AI_IDEA_MAX_CHARS = 1000;
export const AI_MAX_LINES = 8;
export const AI_LINE_MAX_CHARS = 60;
export const AI_MAX_REFS = 5;
export const AI_BRIEF_PER_IP = 20;
export const AI_BRIEF_SITE = 1500;
export const AI_OPENAI_TIMEOUT_MS = 50_000;
/**
 * `maxDuration` of POST /api/design/generate and /api/team/design/generate in ms (the route files must keep a literal 300).
 * 300 s is the most a function may run on every plan with Fluid Compute (on); long stickers (outpainting) need the time.
 */
export const AI_ROUTE_MAX_DURATION_MS = 300_000;
/**
 * Time kept back from `maxDuration` for the rest of the request: 10 s for the pixel clean-up and the save after the
 * OpenAI call, and 10 s so the route answers before the platform kills it (the call is cut off 110 s in at the latest).
 */
export const AI_AFTER_OPENAI_SAFETY_MS = 20_000;
/** Below this much usable budget the image call is not started (the use is given back). */
export const AI_MIN_OPENAI_BUDGET_MS = 20_000;
export const AI_MIN_PIXELS = 655_360;
/** The longest ratio (long side : short side) the image model draws (OpenAI accepts 1:3 to 3:1); a longer rectangle is drawn at this ratio, then extended along its long axis (outpainting, src/lib/ai/outpaint.ts). */
export const AI_MAX_ASPECT = 3;
/** Longest side (px) of an extended long rectangle; the same ceiling as an upload (MAX_SIDE_PX). The builder's own sizes never reach it. */
export const AI_MAX_EXTENDED_SIDE = 60_000;

/*
 * Outpainting of a rectangle longer than AI_MAX_ASPECT : 1 (src/lib/ai/outpaint-plan.ts, outpaint.ts).
 * One extension call is a 3:1 canvas (the main image's size: pinned to imageRequestSize by a test) holding the
 * outer KEEP px of the current picture at the edge that touches it, the rest transparent for the model to paint.
 * The new part (CANVAS_LONG - KEEP px) plus FEATHER px of overlap is blended onto the picture.
 */
export const AI_OUTPAINT_CANVAS_LONG = 1424;
export const AI_OUTPAINT_CANVAS_SHORT = 480;
export const AI_OUTPAINT_KEEP_PX = 456;
export const AI_OUTPAINT_FEATHER_PX = 96;
/** An end that needs fewer pixels than this (a ratio just over 3, or the remainder after full steps) is not worth a paid call: it is blur-filled. */
export const AI_OUTPAINT_MIN_END_PX = 64;
/**
 * COST + ABUSE BOUND: extension calls per end of the sticker (two ends, so at most 2x this many extra calls per
 * generation; the schema accepts ratios up to 400000:1). What the cap cannot reach is blur-filled. These calls do NOT
 * count as extra customer uses: one generation = one use, as before.
 */
export const AI_MAX_EXTEND_STEPS_PER_SIDE = 6;
/** One extension call may run this long (a call takes about 7 s). */
export const AI_EXTEND_TIMEOUT_MS = 40_000;
/** An extension call is not started with less than this left before the extension deadline. */
export const AI_MIN_EXTEND_BUDGET_MS = 15_000;
/** Kept back (on top of AI_AFTER_OPENAI_SAFETY_MS) for joining, blur-filling and encoding a long image after the last extension call. */
export const AI_EXTEND_FINISH_RESERVE_MS = 20_000;
export const AI_REF_LONG_SIDE = 1024;
/** Longest design-instructions text (UTF-16 units) the generate route accepts. */
export const AI_INSTRUCTIONS_MAX_CHARS = 600;
/** Staff designer: image generations per account per shop day (separate from the customer limits). */
export const STAFF_IMAGE_DAILY_LIMIT = 50;
/** Staff designer: briefs per account per shop day. */
export const STAFF_BRIEF_DAILY_LIMIT = 300;
/** Site-wide daily cap of each staff kind (separate kinds, so staff never eat the customer caps). */
export const STAFF_SITE_CAP = 5000;
/** The Arabic → English instructions translation call may run this long. */
export const AI_TRANSLATE_TIMEOUT_MS = 15_000;
