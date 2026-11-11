import { randomInt } from 'node:crypto';
import { DISPLAY_NO_ALPHABET, SHOP_TIME_ZONE } from '@/config/defaults';
import type { StickerSpec } from '@/lib/types';
import { umToMm } from '@/lib/units';

const DATE_PARTS_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: SHOP_TIME_ZONE,
  year: '2-digit',
  month: '2-digit',
  day: '2-digit',
});

/** EP-YYMMDD-XXXX with the Baghdad calendar date and 4 crypto-random alphabet chars. */
export function makeDisplayNo(date: Date = new Date(), rand: (max: number) => number = (m) => randomInt(0, m)): string {
  const parts = DATE_PARTS_FORMAT.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += DISPLAY_NO_ALPHABET[rand(DISPLAY_NO_ALPHABET.length)];
  return `EP-${get('year')}${get('month')}${get('day')}-${suffix}`;
}

const mm = (um: number) => String(Number(umToMm(um).toFixed(2)));

/** ASCII file name of the A4 PDF: EP-251107-AB3C_circle-30x30mm_x20.pdf */
export function pdfFileNameFor(
  displayNo: string,
  spec: Pick<StickerSpec, 'shape' | 'widthUm' | 'heightUm'>,
  sheets: number,
): string {
  return `${displayNo}_${spec.shape}-${mm(spec.widthUm)}x${mm(spec.heightUm)}mm_x${sheets}.pdf`;
}
