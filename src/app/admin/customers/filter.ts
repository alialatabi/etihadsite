import { normaliseDigits } from '@/lib/parse/digits';

export interface CustomerRow {
  phone: string;
  name: string;
  governorate: string;
  district: string;
  landmark: string;
  ordersCount: number;
  totalIqd: number;
  /** Pre-formatted (shop time) on the server. */
  lastLabel: string;
  lastDisplayNo: string;
  /** Only set when that order still exists. */
  lastOrderId: string | null;
}

export function matchesQuery(row: CustomerRow, query: string): boolean {
  const q = normaliseDigits(query).trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  const phoneHit = digits.length > 0 && row.phone.includes(digits.replace(/^0+/, '') || digits);
  return phoneHit || row.name.toLowerCase().includes(q) || row.governorate.toLowerCase().includes(q);
}
