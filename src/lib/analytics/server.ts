import 'server-only';
import { createHash } from 'node:crypto';
import { shopDayKey } from '@/lib/shop-time';
import { getStorage } from '@/lib/storage';
import type { AnalyticsEvent } from '@/lib/types';
import { classifyDevice } from './classify';

const DEV_SALT = 'softy-dev-analytics-salt';

/** YYYY-MM-DD in shop time (SHOP_TIME_ZONE). */
export function baghdadDay(date: Date = new Date()): string {
  return shopDayKey(date);
}

function ipOf(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return request.headers.get('x-real-ip')?.trim() ?? '';
}

/** Daily-rotating anonymous visitor id: 16 hex chars. IP and UA are hashed, never stored. */
export function visitorHash(request: Request, now: Date = new Date()): string {
  const salt = process.env.SESSION_SECRET || DEV_SALT;
  const ua = request.headers.get('user-agent') ?? '';
  return createHash('sha256')
    .update(`${baghdadDay(now)}|${ipOf(request)}|${ua}|${salt}`)
    .digest('hex')
    .slice(0, 16);
}

function decode(v: string | null): string | undefined {
  if (!v) return undefined;
  try {
    return decodeURIComponent(v).slice(0, 80) || undefined;
  } catch {
    return v.slice(0, 80);
  }
}

export function geoFrom(request: Request): Pick<AnalyticsEvent, 'city' | 'region' | 'country'> {
  const h = request.headers;
  const out: Pick<AnalyticsEvent, 'city' | 'region' | 'country'> = {};
  const city = decode(h.get('x-vercel-ip-city'));
  const region = decode(h.get('x-vercel-ip-country-region'));
  const country = decode(h.get('x-vercel-ip-country'));
  if (city) out.city = city;
  if (region) out.region = region;
  if (country) out.country = country;
  return out;
}

/** Builds and stores an event. Never throws. Await it (it is quick) so serverless does not cut it off. */
export async function trackServer(
  request: Request,
  partial: Pick<AnalyticsEvent, 'type'> & Partial<AnalyticsEvent>,
): Promise<void> {
  try {
    const event: AnalyticsEvent = {
      ts: new Date().toISOString(),
      visitor: visitorHash(request),
      device: classifyDevice(request.headers.get('user-agent')),
      ...geoFrom(request),
      ...partial,
    };
    await getStorage().recordEvent(event);
  } catch (e) {
    console.error('[analytics] record failed', e instanceof Error ? e.message : e);
  }
}
