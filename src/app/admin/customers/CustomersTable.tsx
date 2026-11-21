'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { MessageCircle, Users } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, Pill, TableFrame, field, segment, tableCls } from '@/components/admin/kit';
import { Ltr } from '@/components/Ltr';
import { Money } from '@/components/Money';
import { admin } from '@/content/ar';
import { formatPhoneLocal, whatsappUrl } from '@/lib/parse/phone';
import { matchesOffers, matchesQuery, type CustomerRow } from './filter';

const C = admin.customers;

const LINK = 'font-bold text-[#121f34] underline-offset-4 hover:text-[#d01c4a] hover:underline';

export function CustomersTable({ rows }: { rows: CustomerRow[] }) {
  const [query, setQuery] = useState('');
  const [gov, setGov] = useState('');
  const [offersOnly, setOffersOnly] = useState(false);

  const governorates = useMemo(() => [...new Set(rows.map((r) => r.governorate))].sort((a, b) => a.localeCompare(b, 'ar')), [rows]);
  const filtered = useMemo(
    () => rows.filter((r) => (!gov || r.governorate === gov) && matchesOffers(r, offersOnly) && matchesQuery(r, query)),
    [rows, query, gov, offersOnly],
  );

  if (rows.length === 0) {
    return <EmptyState icon={Users} title={C.empty} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={C.search}
          aria-label={C.search}
          className={`${field.input} sm:max-w-sm sm:flex-1`}
        />
        <select
          value={gov}
          onChange={(e) => setGov(e.target.value)}
          aria-label={C.governorateFilter}
          className={`${field.input} border text-[#121f34] outline-none focus-visible:ring-3`}
        >
          <option value="">{C.allGovernorates}</option>
          {governorates.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <button type="button" aria-pressed={offersOnly} onClick={() => setOffersOnly((v) => !v)} className={segment(offersOnly)}>
          {C.marketingFilter}
        </button>
        <span className="text-[15px] text-[#5a6475] sm:ms-auto">
          {C.total}: <Ltr className="font-bold text-[#121f34]">{filtered.length}</Ltr>
        </span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title={C.noResults} />
      ) : (
        <TableFrame label={C.title}>
          <Table>
            <TableHeader>
              <TableRow className="border-[#e7dfdf] hover:bg-transparent">
                <TableHead className={tableCls.head}>{C.columns.name}</TableHead>
                <TableHead className={tableCls.head}>{C.columns.phone}</TableHead>
                <TableHead className={tableCls.head}>{C.columns.governorate}</TableHead>
                <TableHead className={tableCls.head}>{C.columns.district}</TableHead>
                <TableHead className={tableCls.head}>{C.columns.landmark}</TableHead>
                <TableHead className={tableCls.head}>{C.columns.orders}</TableHead>
                <TableHead className={tableCls.head}>{C.columns.spent}</TableHead>
                <TableHead className={tableCls.head}>{C.columns.last}</TableHead>
                <TableHead className={tableCls.head}>{C.columns.marketing}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.phone} className={tableCls.row}>
                  <TableCell className={`${tableCls.cell} font-bold text-[#121f34]`}>{r.name || C.noName}</TableCell>
                  <TableCell className={tableCls.cell}>
                    <div className="flex flex-col items-start gap-1">
                      <a href={`tel:+${r.phone}`} aria-label={C.call} className="text-[#121f34] underline-offset-4 hover:underline">
                        <Ltr>{formatPhoneLocal(r.phone)}</Ltr>
                      </a>
                      <a
                        href={whatsappUrl(r.phone)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-[14px] font-medium text-[#0b5a2e] underline-offset-4 hover:underline"
                      >
                        <MessageCircle aria-hidden className="size-[18px] shrink-0 text-[#25d366]" />
                        {C.whatsapp}
                      </a>
                    </div>
                  </TableCell>
                  <TableCell className={`${tableCls.cell} whitespace-nowrap`}>{r.governorate}</TableCell>
                  <TableCell className={tableCls.cell}>{r.district}</TableCell>
                  <TableCell className={`${tableCls.cell} min-w-40 text-[#5a6475]`}>{r.landmark}</TableCell>
                  <TableCell className={`${tableCls.cell} ${tableCls.num}`}>
                    <Ltr>{r.ordersCount}</Ltr>
                  </TableCell>
                  <TableCell className={`${tableCls.cell} ${tableCls.num} font-semibold`}>
                    <Money amount={r.totalIqd} />
                  </TableCell>
                  <TableCell className={`${tableCls.cell} whitespace-nowrap`}>
                    {r.lastOrderId ? (
                      <Link href={`/admin/orders/${r.lastOrderId}`} className={LINK}>
                        <Ltr>{r.lastDisplayNo}</Ltr>
                      </Link>
                    ) : (
                      <Ltr className="font-bold text-[#121f34]">{r.lastDisplayNo}</Ltr>
                    )}
                    <span className="block text-[14px] text-[#5a6475]">{r.lastLabel}</span>
                  </TableCell>
                  <TableCell className={tableCls.cell}>
                    <Pill tone={r.marketingOptIn ? 'ok' : 'neutral'}>{r.marketingOptIn ? C.marketingYes : C.marketingNo}</Pill>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableFrame>
      )}
    </div>
  );
}
