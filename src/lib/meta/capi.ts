import 'server-only';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { after } from 'next/server';
import { reportError } from '@/lib/monitoring/report';
import type { OrderRecord } from '@/lib/types';
import { metaIqdPerUsd, metaPixelId, purchaseParams } from './config';

/**
 * Conversions API: the server's copy of a purchase (POST /api/orders, new orders only). The
 * browser's Pixel can be blocked or closed before the success page loads; this copy cannot. Both
 * carry event_id = orderId, so Meta counts one purchase. Off unless NEXT_PUBLIC_META_PIXEL_ID and
 * META_CAPI_TOKEN are both set. Sent after the answer (`after()`), never fails or slows an order.
 *
 * What leaves for Meta: the phone number and the country as SHA-256 hashes (Meta's format), the
 * visitor's IP address and user agent as they are (Meta needs them to match the ad click), the
 * `_fbp` / `_fbc` cookies the Pixel set, the page URL without its query, the order id and the
 * value. Nothing of it is stored by the site. Name, address and notes are not sent.
 */

/** Graph API version of the endpoint. Meta keeps a version for about two years; bump it then. */
export const META_GRAPH_VERSION = 'v24.0';
const TIMEOUT_MS = 5000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** A cookie value from the Cookie header, or null. */
export function cookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    const v = part.slice(eq + 1).trim();
    return v || null;
  }
  return null;
}

/** The Pixel's own cookies look like `fb.1.<ms>.<id>`; anything else is not sent. */
const FB_COOKIE = /^fb\.\d\.\d{10,16}\.[A-Za-z0-9_.-]{1,400}$/;

/** The visitor's address as Vercel reports it (first x-forwarded-for entry), only when it is an IP. */
export function visitorIp(headers: Headers): string | null {
  const raw = headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip')?.trim() || '';
  return raw && isIP(raw) ? raw : null;
}

/** The page the order came from (same host as the request, no query or fragment); the site root otherwise. */
export function sourceUrl(requestUrl: string, referer: string | null): string {
  const site = new URL(requestUrl);
  try {
    if (referer) {
      const r = new URL(referer);
      if (r.host === site.host && (r.protocol === 'https:' || r.protocol === 'http:')) return `${r.origin}${r.pathname}`;
    }
  } catch {
    /* fall through */
  }
  return `${site.origin}/`;
}

export interface CapiPurchaseInput {
  orderId: string;
  /** Normalised E.164 without plus, "9647XXXXXXXXX" (CustomerInfo.phone). */
  phone: string;
  totalIqd: number | null;
  eventTimeSec: number;
  sourceUrl: string;
  ip: string | null;
  userAgent: string | null;
  fbp: string | null;
  fbc: string | null;
}

/** Pure: the request body for one purchase, without the access token. */
export function capiPurchaseBody(input: CapiPurchaseInput, iqdPerUsd: number | null, testEventCode?: string) {
  const userData: Record<string, unknown> = {
    ph: [sha256(input.phone.replace(/\D/g, ''))],
    country: [sha256('iq')],
  };
  if (input.ip) userData.client_ip_address = input.ip;
  if (input.userAgent) userData.client_user_agent = input.userAgent.slice(0, 512);
  if (input.fbp && FB_COOKIE.test(input.fbp)) userData.fbp = input.fbp;
  if (input.fbc && FB_COOKIE.test(input.fbc)) userData.fbc = input.fbc;
  return {
    data: [
      {
        event_name: 'Purchase',
        event_time: input.eventTimeSec,
        event_id: input.orderId,
        action_source: 'website',
        event_source_url: input.sourceUrl,
        user_data: userData,
        custom_data: { ...purchaseParams(input.totalIqd, iqdPerUsd), order_id: input.orderId },
      },
    ],
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  };
}

/** The POST itself. Reports a failure to Sentry with the status code only, never the answer body. */
export async function postCapi(pixelId: string, token: string, body: object, orderId: string): Promise<void> {
  try {
    const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${pixelId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, access_token: token }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      reportError(new Error(`Meta Conversions API answered ${res.status}`), {
        where: 'orders.metaCapi',
        route: '/api/orders',
        level: 'warning',
        tags: { orderId, status: res.status },
      });
    }
  } catch {
    reportError(new Error('Meta Conversions API request failed'), {
      where: 'orders.metaCapi',
      route: '/api/orders',
      level: 'warning',
      tags: { orderId },
    });
  }
}

/** Queues the server copy of a new order's purchase. Never throws; a no-op until both variables are set. */
export function sendMetaPurchase(request: Request, record: OrderRecord, totalIqd: number | null, now: Date = new Date()): void {
  try {
    const pixelId = metaPixelId();
    const token = process.env.META_CAPI_TOKEN?.trim();
    if (!pixelId || !token) return;
    const cookies = request.headers.get('cookie');
    const body = capiPurchaseBody(
      {
        orderId: record.orderId,
        phone: record.customer.phone,
        totalIqd,
        eventTimeSec: Math.floor(now.getTime() / 1000),
        sourceUrl: sourceUrl(request.url, request.headers.get('referer')),
        ip: visitorIp(request.headers),
        userAgent: request.headers.get('user-agent'),
        fbp: cookieValue(cookies, '_fbp'),
        fbc: cookieValue(cookies, '_fbc'),
      },
      metaIqdPerUsd(),
      process.env.META_TEST_EVENT_CODE?.trim() || undefined,
    );
    const send = () => postCapi(pixelId, token, body, record.orderId);
    try {
      after(send);
    } catch {
      void send(); // not inside a request (script, test)
    }
  } catch {
    /* measurement must never break an order */
  }
}
