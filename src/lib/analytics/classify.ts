import type { DeviceKind, TrafficSource } from '@/lib/types';

/** Host suffix → source. Matched as exact host or subdomain. */
const HOSTS: Array<[TrafficSource, string[]]> = [
  ['instagram', ['instagram.com', 'ig.me']],
  ['facebook', ['facebook.com', 'fb.com', 'fb.me', 'fb.watch', 'messenger.com']],
  ['tiktok', ['tiktok.com']],
  ['whatsapp', ['whatsapp.com', 'wa.me']],
  ['telegram', ['telegram.org', 'telegram.me', 't.me']],
  ['snapchat', ['snapchat.com']],
  ['youtube', ['youtube.com', 'youtu.be']],
  ['google', ['google.com']],
];

function matchHost(host: string): TrafficSource | null {
  for (const [source, suffixes] of HOSTS) {
    if (suffixes.some((s) => host === s || host.endsWith(`.${s}`))) return source;
  }
  // google.iq, google.co.uk, ...
  if (/(^|\.)google\.[a-z.]{2,6}$/.test(host)) return 'google';
  return null;
}

function fromName(name: string): TrafficSource | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  if (n === 'ig' || n.includes('instagram')) return 'instagram';
  if (n === 'fb' || n.includes('facebook')) return 'facebook';
  if (n.includes('tiktok')) return 'tiktok';
  if (n.includes('whatsapp') || n === 'wa') return 'whatsapp';
  if (n.includes('telegram') || n === 'tg') return 'telegram';
  if (n.includes('snap')) return 'snapchat';
  if (n.includes('youtube') || n === 'yt') return 'youtube';
  if (n.includes('google')) return 'google';
  return null;
}

/** Referrer URL / utm_source → normalised source. Same host or empty → direct. */
export function classifySource(
  referrer: string | null | undefined,
  utmSource: string | null | undefined,
  ownHost?: string | null,
): TrafficSource {
  const utm = (utmSource ?? '').trim();
  if (utm) return fromName(utm) ?? 'other';

  const ref = (referrer ?? '').trim();
  if (!ref) return 'direct';
  let host: string;
  try {
    host = new URL(ref).hostname.toLowerCase();
  } catch {
    return 'other';
  }
  if (!host) return 'direct';
  const own = (ownHost ?? '').toLowerCase().replace(/:\d+$/, '');
  if (own && host === own) return 'direct';
  return matchHost(host) ?? 'other';
}

export function classifyDevice(userAgent: string | null | undefined): DeviceKind {
  const ua = userAgent ?? '';
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'mobile' : 'tablet';
  if (/iPhone|iPod|Mobile|Windows Phone|BlackBerry|Opera Mini/i.test(ua)) return 'mobile';
  return 'desktop';
}

const BOT_RE =
  /bot|crawl|spider|slurp|facebookexternalhit|facebookcatalog|whatsapp\/|preview|lighthouse|headless|curl\/|wget|python-requests|httpclient|monitor|uptime|vercel-screenshot/i;

/** Empty UA counts as a bot. */
export function isBot(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? '').trim();
  return !ua || BOT_RE.test(ua);
}
