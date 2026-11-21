import 'server-only';
import { createHmac } from 'node:crypto';

const DEV_SALT = 'softy-dev-ai-salt';

/** Stable, non-reversible per-IP key for AI rate limits (HMAC-SHA256 hex, 64 chars). */
export function aiIpKey(ip: string): string {
  const key = process.env.SESSION_SECRET || DEV_SALT;
  return createHmac('sha256', key).update(`ai-ip|${ip}`).digest('hex');
}
