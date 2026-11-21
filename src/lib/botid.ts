import 'server-only';
import { headers } from 'next/headers';
import { checkBotId } from 'botid/server';
import { reportError } from '@/lib/monitoring/report';

/** A slow BotID answer must never hold up an order or an upload. */
export const BOTID_TIMEOUT_MS = 3000;
/** A broken check (no OIDC token on a preview, BotID down) is reported at most this often per instance. */
const REPORT_EVERY_MS = 60_000;
let lastReportAt = 0;

/**
 * Vercel BotID (basic level, no keys) for the public POST routes. Resolves to true only when the
 * caller must be refused: BotID says "bot" AND `BOTID_ENFORCE=1`. Otherwise it resolves to false;
 * when BotID says "bot" without enforcement it logs one fixed line (no IP, no User-Agent), so the
 * owner can read a week of "would block" lines before flipping `BOTID_ENFORCE`. A second fixed line,
 * `[botid] no challenge header <route>`, marks the verdicts of requests that never carried BotID's `x-is-human`
 * header: a plain script, but also a customer whose ad blocker or network stops the challenge script (the browser
 * then sends the plain request, see botid-client.ts). With `BOTID_ENFORCE=1` those customers are refused too.
 *
 * - A no-op (false) anywhere but Vercel (`VERCEL=1`): local dev, tests and `next start` never call BotID.
 * - Fails open: any error or a check slower than BOTID_TIMEOUT_MS never blocks; it is reported to
 *   Sentry with a fixed message (the error text is dropped).
 * `route` is a fixed route name such as '/api/orders'.
 */
export async function botBlocked(route: string): Promise<boolean> {
  if (process.env.VERCEL !== '1') return false;
  let isBot = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const verdict = await Promise.race([
      checkBotId(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), BOTID_TIMEOUT_MS);
      }),
    ]);
    isBot = verdict.isBot === true;
  } catch {
    const now = Date.now();
    if (now - lastReportAt >= REPORT_EVERY_MS) {
      lastReportAt = now;
      reportError(new Error('botid check failed'), { where: 'botid.check', route, level: 'warning' });
    }
    return false;
  } finally {
    clearTimeout(timer);
  }
  if (!isBot) return false;
  if (process.env.BOTID_ENFORCE === '1') return true;
  console.warn(`[botid] would block ${route}`);
  if (await lacksChallengeHeader()) console.warn(`[botid] no challenge header ${route}`);
  return false;
}

/** True when the request has no `x-is-human` header (BotID's challenge never ran); false when it has one or this cannot be told. */
async function lacksChallengeHeader(): Promise<boolean> {
  try {
    return (await headers()).get('x-is-human') === null;
  } catch {
    return false;
  }
}
