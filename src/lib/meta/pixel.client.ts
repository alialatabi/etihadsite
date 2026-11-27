/**
 * Browser side of the Meta Pixel (see src/lib/meta/config.ts). No React. Every function is a no-op
 * without NEXT_PUBLIC_META_PIXEL_ID, on an excluded path (admin, staff link, staff designer), and
 * whenever anything throws: measurement must never break the page.
 */
import type { BuilderStep } from '@/lib/types';
import {
  META_STEP_EVENTS,
  isMetaExcludedPath,
  metaIqdPerUsd,
  metaPixelId,
  purchaseParams,
  type MetaStandardEvent,
} from './config';

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  push: Fbq;
  loaded: boolean;
  version: string;
  disablePushState?: boolean;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

export const META_PIXEL_SCRIPT = 'https://connect.facebook.net/en_US/fbevents.js';

/** The pixel id `init` was sent for in this page load. */
let initialised: string | null = null;

/**
 * Meta's standard base code, written out: a queue stub now and the real script loaded async, then
 * `init`. Idempotent. Before `init`: no history-change PageViews (MetaPixel sends one per route
 * itself, after the excluded-path check) and no automatic button or page-metadata events.
 * Returns whether events can be sent.
 */
export function ensureMetaPixel(pixelId: string | null = metaPixelId()): boolean {
  if (!pixelId || typeof window === 'undefined' || typeof document === 'undefined') return false;
  try {
    if (isMetaExcludedPath(window.location.pathname)) return false;
    if (initialised === pixelId && window.fbq) return true;
    if (!window.fbq) {
      const n = function (...args: unknown[]) {
        if (n.callMethod) n.callMethod(...args);
        else n.queue.push(args);
      } as Fbq;
      n.push = n;
      n.loaded = true;
      n.version = '2.0';
      n.queue = [];
      window.fbq = n;
      if (!window._fbq) window._fbq = n;
      const script = document.createElement('script');
      script.async = true;
      script.src = META_PIXEL_SCRIPT;
      document.head.appendChild(script);
    }
    const fbq = window.fbq;
    fbq.disablePushState = true;
    fbq('set', 'autoConfig', false, pixelId);
    fbq('init', pixelId);
    initialised = pixelId;
    return true;
  } catch {
    return false;
  }
}

/** One standard event. `eventId` lets Meta merge it with the server's copy of the same event. */
export function metaTrack(event: MetaStandardEvent, params?: Record<string, unknown>, eventId?: string): void {
  try {
    if (!ensureMetaPixel()) return;
    const fbq = window.fbq!;
    if (eventId) fbq('track', event, params ?? {}, { eventID: eventId });
    else if (params && Object.keys(params).length > 0) fbq('track', event, params);
    else fbq('track', event);
  } catch {
    /* measurement must never break the page */
  }
}

/** The builder showed `step` (the caller sends this once per step per session). */
export function trackMetaStep(step: BuilderStep): void {
  const event = META_STEP_EVENTS[step];
  if (event) metaTrack(event);
}

const PURCHASE_KEY = 'meta-purchase:';

/**
 * The browser copy of a purchase, once per order per tab (a reload of the success page does not
 * count it again). eventID = the order id, which the server's Conversions API copy also carries.
 */
export function trackMetaPurchase(orderId: string, totalIqd: number | null): void {
  try {
    if (!metaPixelId()) return;
    try {
      if (sessionStorage.getItem(PURCHASE_KEY + orderId)) return;
      sessionStorage.setItem(PURCHASE_KEY + orderId, '1');
    } catch {
      /* no sessionStorage: send anyway, the eventID keeps Meta from counting twice */
    }
    metaTrack('Purchase', purchaseParams(totalIqd, metaIqdPerUsd()), orderId);
  } catch {
    /* measurement must never break the page */
  }
}

/** Tests only: forget the `init` of this page load. */
export function __resetMetaPixelForTests(): void {
  initialised = null;
}
