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

const LINK = 'inline-flex min-h-11 items-center font-bold text-ink underline-offset-4 hover:text-brand-ink hover:underline focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink';

function WhatsappLink({ phone }: { phone: string }) {
  return (
    <a
      href={whatsappUrl(phone)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-11 items-center gap-1.5 text-[14px] font-medium text-[#0b5a2e] underline-offset-4 hover:underline focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      <MessageCircle aria-hidden className="size-[18px] shrink-0 text-[#25d366]" />
      {C.whatsapp}
    </a>
  );
}

function LastOrder({ row }: { row: CustomerRow }) {
  return (
    <>
      {row.lastOrderId ? (
        <Link href={`/admin/orders/${row.lastOrderId}`} className={LINK}>
          <Ltr>{row.lastDisplayNo}</Ltr>
        </Link>
      ) : (
        <Ltr className="font-bold text-ink">{row.lastDisplayNo}</Ltr>
      )}
      <span className="block text-[14px] text-ink-muted">{row.lastLabel}</span>
    </>
  );
}

function OptInPill({ optedIn }: { optedIn: boolean }) {
  return <Pill tone={optedIn ? 'ok' : 'neutral'}>{optedIn ? C.marketingYes : C.marketingNo}</Pill>;
}

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
          className={`${field.input} border text-ink focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink`}
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
        <span className="text-[15px] text-ink-muted sm:ms-auto">
          {C.total}: <Ltr className="font-bold text-ink">{filtered.length}</Ltr>
        </span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title={C.noResults} />
      ) : (
        <>
        <ul className="flex flex-col gap-3 md:hidden">
          {filtered.map((r) => (
            <li key={r.phone} className="paper-card flex flex-col gap-3 rounded-[2px] p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-[16px] font-bold leading-normal text-ink">{r.name || C.noName}</p>
                <OptInPill optedIn={r.marketingOptIn === true} />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <a href={`tel:+${r.phone}`} aria-label={C.call} className="inline-flex min-h-11 items-center text-[15px] text-ink underline-offset-4 hover:underline focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink">
                  <Ltr>{formatPhoneLocal(r.phone)}</Ltr>
                </a>
                <WhatsappLink phone={r.phone} />
              </div>
              <p className="text-[15px] leading-normal text-ink">
                {[r.governorate, r.district].filter(Boolean).join(' · ')}
                {r.landmark ? <span className="block text-[14px] text-ink-muted">{r.landmark}</span> : null}
              </p>
              <dl className="grid grid-cols-3 gap-2 border-t border-dashed border-line pt-3">
                <div>
                  <dt className="text-[14px] text-ink-muted">{C.columns.orders}</dt>
                  <dd className="text-[15px] font-semibold tabular-nums">
                    <Ltr>{r.ordersCount}</Ltr>
                  </dd>
                </div>
                <div>
                  <dt className="text-[14px] text-ink-muted">{C.columns.spent}</dt>
                  <dd className="text-[15px] font-semibold tabular-nums">
                    <Money amount={r.totalIqd} />
                  </dd>
                </div>
                <div>
                  <dt className="text-[14px] text-ink-muted">{C.columns.last}</dt>
                  <dd className="text-[15px]">
                    <LastOrder row={r} />
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
        <TableFrame label={C.title} className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow className="border-line hover:bg-transparent">
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
                  <TableCell className={`${tableCls.cell} font-bold text-ink`}>{r.name || C.noName}</TableCell>
                  <TableCell className={tableCls.cell}>
                    <div className="flex flex-col items-start gap-1">
                      <a href={`tel:+${r.phone}`} aria-label={C.call} className="inline-flex min-h-11 items-center text-ink underline-offset-4 hover:underline focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink">
                        <Ltr>{formatPhoneLocal(r.phone)}</Ltr>
                      </a>
                      <WhatsappLink phone={r.phone} />
                    </div>
                  </TableCell>
                  <TableCell className={`${tableCls.cell} whitespace-nowrap`}>{r.governorate}</TableCell>
                  <TableCell className={tableCls.cell}>{r.district}</TableCell>
                  <TableCell className={`${tableCls.cell} min-w-40 text-ink-muted`}>{r.landmark}</TableCell>
                  <TableCell className={`${tableCls.cell} ${tableCls.num}`}>
                    <Ltr>{r.ordersCount}</Ltr>
                  </TableCell>
                  <TableCell className={`${tableCls.cell} ${tableCls.num} font-semibold`}>
                    <Money amount={r.totalIqd} />
                  </TableCell>
                  <TableCell className={`${tableCls.cell} whitespace-nowrap`}>
                    <LastOrder row={r} />
                  </TableCell>
                  <TableCell className={tableCls.cell}>
                    <OptInPill optedIn={r.marketingOptIn === true} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableFrame>
        </>
      )}
    </div>
  );
}
