/**
 * The week's orders as CSV for Excel. Pure. UTF-8 with BOM, CRLF line ends, every cell quoted.
 * No customer fields (no name, phone or address): the file is the shop's books, not the customer list.
 */
import { SHOP_TIME_ZONE } from '@/config/defaults';
import { accounts } from '@/content/ar/accounts';
import { common, order } from '@/content/ar';
import type { WeekFigures } from './compute';

export const CSV_BOM = '﻿';

/**
 * One quoted cell. Only TEXT that starts with = + - @ tab or CR gets a leading apostrophe (spreadsheet
 * formula injection); a number is written as it is, so a negative profit stays a number.
 */
export function accountCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const dtFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHOP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function csvDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dtFmt.format(d).replace(',', '');
}

const col = accounts.csv.columns;

/** Header row + one row per sold order (oldest first) + a totals row. */
export function weekCsv(week: WeekFigures): string {
  const lines: string[] = [
    [col.no, col.date, col.status, col.material, col.sheets, col.stickers, col.sales, col.cost, col.profit].map(accountCsvCell).join(','),
  ];
  // Cancelled orders are in no total, so they are not in the file either: the columns add up.
  for (const r of week.rows.filter((x) => x.counted)) {
    lines.push(
      [
        r.displayNo,
        csvDate(r.createdAt),
        order.status[r.status],
        common.materials[r.material],
        r.sheets,
        r.stickers,
        r.salesIqd,
        r.costIqd,
        r.profitIqd,
      ]
        .map(accountCsvCell)
        .join(','),
    );
  }
  lines.push(
    [accounts.csv.total, '', '', '', week.sheets.total, week.stickers, week.salesIqd, week.costIqd, week.profitIqd]
      .map(accountCsvCell)
      .join(','),
  );
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}
