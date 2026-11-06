import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const SECRET = 'x'.repeat(40);

/** Fresh DATA_DIR + env for a test; also resets the shared rate limiters. */
export function setupEnv(extra: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ep-test-'));
  process.env.ADMIN_PASSWORD = 'pw-test';
  process.env.SESSION_SECRET = SECRET;
  process.env.DATA_DIR = dir;
  process.env.ORDER_TRANSPORT = 'console';
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.TURNSTILE_SECRET_KEY;
  for (const [k, v] of Object.entries(extra)) process.env[k] = v;
  (globalThis as { __epLimiters?: unknown }).__epLimiters = undefined;
  return dir;
}
