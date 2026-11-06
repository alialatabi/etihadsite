import 'server-only';
/**
 * Validated server environment. Evaluated lazily (and not cached) so tests and
 * scripts can change process.env. Empty strings count as "not set".
 */
import { z } from 'zod';

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optional = z.preprocess(blank, z.string().optional());

const envSchema = z.object({
  ADMIN_PASSWORD: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  STORAGE: z.preprocess(blank, z.enum(['local']).default('local')),
  DATA_DIR: z.preprocess(blank, z.string().default('./data')),
  ORDER_TRANSPORT: z.preprocess(blank, z.enum(['console', 'telegram']).default('console')),
  TELEGRAM_BOT_TOKEN: optional,
  TELEGRAM_CHAT_ID: optional,
  TURNSTILE_SECRET_KEY: optional,
});

export type Env = z.infer<typeof envSchema>;

export function getEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment variables: ${names}`);
  }
  return parsed.data;
}
