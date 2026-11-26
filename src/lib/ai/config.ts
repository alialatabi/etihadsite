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
/** `maxDuration` of POST /api/design/generate in ms (the route file must keep a literal 120). */
export const AI_ROUTE_MAX_DURATION_MS = 120_000;
/**
 * Time kept back from `maxDuration` for the rest of the request: 10 s for the pixel clean-up and the save after the
 * OpenAI call, and 10 s so the route answers before the platform kills it (the call is cut off 110 s in at the latest).
 */
export const AI_AFTER_OPENAI_SAFETY_MS = 20_000;
/** Below this much usable budget the image call is not started (the use is given back). */
export const AI_MIN_OPENAI_BUDGET_MS = 20_000;
export const AI_MIN_PIXELS = 655_360;
export const AI_MAX_ASPECT = 3;
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
