import "server-only";
/**
 * Validated server environment, split by audience so the public order path never
 * depends on admin secrets. Evaluated lazily (and not cached) so tests and scripts
 * can change process.env. Empty strings count as "not set".
 */
import { z } from "zod";

const blank = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;
const optional = z.preprocess(blank, z.string().optional());

const EXAMPLE_VALUES = new Set([
  "change-me",
  "change-me-to-a-long-random-string",
  "generate-a-secret-see-comment",
]);
const notPlaceholder = (v: string) =>
  !v.toLowerCase().startsWith("change-me") && !EXAMPLE_VALUES.has(v);
const PLACEHOLDER_MSG = "must not be a placeholder value from .env.example";

const orderEnvSchema = z.object({
  STORAGE: z.preprocess(blank, z.enum(["local", "supabase"]).default("local")),
  SUPABASE_URL: optional,
  SUPABASE_SECRET_KEY: optional,
  DATA_DIR: z.preprocess(blank, z.string().default("./data")),
  ORDER_TRANSPORT: z.preprocess(
    blank,
    z.enum(["console", "telegram"]).default("console"),
  ),
  TELEGRAM_BOT_TOKEN: optional,
  TELEGRAM_CHAT_ID: optional,
  TURNSTILE_SECRET_KEY: optional,
  /** Number of trusted reverse-proxy hops for x-forwarded-for. 0 = ignore the header. */
  TRUST_PROXY: z.preprocess(
    blank,
    z.coerce.number().int().min(0).max(10).default(0),
  ),
});

const adminEnvSchema = z.object({
  ADMIN_PASSWORD: z.string().min(8).refine(notPlaceholder, PLACEHOLDER_MSG),
  SESSION_SECRET: z.string().min(32).refine(notPlaceholder, PLACEHOLDER_MSG),
});

export type OrderEnv = z.infer<typeof orderEnvSchema>;
export type AdminEnv = z.infer<typeof adminEnvSchema>;

function parse<T extends z.ZodType>(schema: T): z.infer<T> {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment variables: ${names}`);
  }
  return parsed.data;
}

/** Env for the public order/upload/log/notify path. Never requires admin secrets. */
export const getOrderEnv = (): OrderEnv => parse(orderEnvSchema);
/** Env for /admin only (login + session signing). */
export const getAdminEnv = (): AdminEnv => parse(adminEnvSchema);
/** Both at once (admin vars still validated). Prefer the specific getters. */
export const getEnv = (): OrderEnv & AdminEnv => ({
  ...getOrderEnv(),
  ...getAdminEnv(),
});
