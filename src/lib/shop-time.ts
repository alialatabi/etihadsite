/**
 * Shop time: everything the shop reads is shown in SHOP_TIME_ZONE. Pure (no I/O), so it is
 * safe to import from client and server code. The formatters are built once, at module load.
 */
import { SHOP_TIME_ZONE } from '@/config/defaults';

/** Milliseconds in one day. */
export const DAY_MS = 86_400_000;

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('ar-IQ-u-nu-latn', {
  timeZone: SHOP_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});

const DAY_KEY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHOP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Date and time of an ISO instant in shop time (Arabic, Western digits). Throws RangeError for an invalid date. */
export function formatShopDateTime(iso: string): string {
  return DATE_TIME_FORMAT.format(new Date(iso));
}

/** "YYYY-MM-DD" calendar day of `date` in shop time. */
export function shopDayKey(date: Date): string {
  return DAY_KEY_FORMAT.format(date);
}
