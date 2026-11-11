/** CSV helpers for the customers export. Pure. */
import { SHOP_TIME_ZONE } from '@/config/defaults';
import { admin } from '@/content/ar';
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
  timeZone: SHOP_TIME_ZONE,
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

const col = admin.customers.columns;

/** The columns of the customers export, in file order: the header text and the cell of one customer. */
const CUSTOMER_CSV_COLUMNS: readonly { header: string; value: (c: CustomerRecord) => string | number }[] = [
  { header: col.name, value: (c) => c.name ?? '' },
  { header: col.phone, value: (c) => phoneForCsv(c.phone) },
  { header: col.governorate, value: (c) => c.governorate },
  { header: col.district, value: (c) => c.district },
  { header: col.landmark, value: (c) => c.landmark },
  { header: col.orders, value: (c) => c.ordersCount },
  { header: col.spent, value: (c) => c.totalIqd },
  { header: admin.customers.firstOrder, value: (c) => csvDate(c.firstOrderAt) },
  { header: col.last, value: (c) => csvDate(c.lastOrderAt) },
  { header: admin.customers.lastNo, value: (c) => c.lastDisplayNo },
];

export function customersToCsv(headers: string[], customers: CustomerRecord[]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const c of customers) {
    lines.push(CUSTOMER_CSV_COLUMNS.map((column) => csvCell(column.value(c))).join(','));
  }
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}

/** The whole export as GET /api/admin/customers serves it: header row plus one row per customer. */
export function customersCsv(customers: CustomerRecord[]): string {
  return customersToCsv(
    CUSTOMER_CSV_COLUMNS.map((column) => column.header),
    customers,
  );
}
