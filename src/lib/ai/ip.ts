import 'server-only';
import { createHmac } from 'node:crypto';
import { isIPv6 } from 'node:net';

const DEV_SALT = 'softy-dev-ai-salt';

/** Stable, non-reversible per-IP key for AI rate limits (HMAC-SHA256 hex, 64 chars). */
export function aiIpKey(ip: string): string {
  const key = process.env.SESSION_SECRET || DEV_SALT;
  return createHmac('sha256', key).update(`ai-ip|${ip}`).digest('hex');
}

/**
 * The address the AI limits count by. A single IPv6 client controls a whole /64, so a real IPv6 address
 * becomes its /64 ("2001:db8:1:2::/64"): the first 4 hextets, lower-case, no leading zeros.
 * IPv4, IPv4-mapped addresses and anything odd (garbage, zone id, brackets) come back unchanged, so
 * every existing IPv4 key stays the same. Never throws.
 */
export function aiLimitAddress(ip: string): string {
  if (!isIPv6(ip) || /[.%[\]]/.test(ip)) return ip;
  const [left, right] = ip.split('::');
  const head = left ? left.split(':') : [];
  const tail = right ? right.split(':') : [];
  const missing = ip.includes('::') ? 8 - head.length - tail.length : 0;
  const hextets = [...head, ...Array<string>(Math.max(missing, 0)).fill('0'), ...tail].map((h) => parseInt(h, 16));
  if (hextets.length !== 8 || hextets.some((n) => Number.isNaN(n))) return ip;
  // IPv4-mapped in hex form (::ffff:c633:6404) is an IPv4 client: keep its full address.
  if (hextets.slice(0, 5).every((n) => n === 0) && hextets[5] === 0xffff) return ip;
  return `${hextets.slice(0, 4).map((n) => n.toString(16)).join(':')}::/64`;
}
