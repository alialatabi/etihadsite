/** CSV helpers for the customers export. Pure. */
import type { CustomerRecord } from '@/lib/types';

/** Quote a cell; neutralise spreadsheet formula injection (= + - @ and control chars). */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** "964 770 123 4567": spaces keep Excel from turning the 13 digits into 9.64E+12. */
export function phoneForCsv(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length < 10) return d;
  return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`.trim();
}

const dtFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Baghdad',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function csvDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return dtFmt.format(d).replace(',', '');
}

export const CSV_BOM = '﻿';

export function customersToCsv(headers: string[], customers: CustomerRecord[]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const c of customers) {
    lines.push(
      [
        c.name ?? '',
        phoneForCsv(c.phone),
        c.governorate,
        c.district,
        c.landmark,
        c.ordersCount,
        c.totalIqd,
        csvDate(c.firstOrderAt),
        csvDate(c.lastOrderAt),
        c.lastDisplayNo,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}
