'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Ltr } from '@/components/Ltr';
import { Money } from '@/components/Money';
import { admin } from '@/content/ar';
import { formatPhoneLocal, whatsappUrl } from '@/lib/parse/phone';
import { matchesQuery, type CustomerRow } from './filter';

const C = admin.customers;

export function CustomersTable({ rows }: { rows: CustomerRow[] }) {
  const [query, setQuery] = useState('');
  const [gov, setGov] = useState('');

  const governorates = useMemo(() => [...new Set(rows.map((r) => r.governorate))].sort((a, b) => a.localeCompare(b, 'ar')), [rows]);
  const filtered = useMemo(
    () => rows.filter((r) => (!gov || r.governorate === gov) && matchesQuery(r, query)),
    [rows, query, gov],
  );

  if (rows.length === 0) {
    return <p className="rounded-lg border p-8 text-center text-muted-foreground">{C.empty}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={C.search}
          aria-label={C.search}
          className="h-10 sm:max-w-sm"
        />
        <select
          value={gov}
          onChange={(e) => setGov(e.target.value)}
          aria-label={C.governorateFilter}
          className="h-10 rounded-lg border border-input bg-background px-2.5 text-sm"
        >
          <option value="">{C.allGovernorates}</option>
          {governorates.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground sm:ms-2">
          {C.total}: <Ltr>{filtered.length}</Ltr>
        </span>
        <a href="/api/admin/customers" download className={`${buttonVariants({ variant: 'default' })} sm:ms-auto`}>
          {C.download}
        </a>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border p-8 text-center text-muted-foreground">{C.noResults}</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {filtered.map((r) => (
            <li key={r.phone}>
              <Card size="sm">
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="font-bold">{r.name || C.noName}</span>
                      <a href={`tel:+${r.phone}`} aria-label={C.call} className="underline-offset-4 hover:underline">
                        <Ltr>{formatPhoneLocal(r.phone)}</Ltr>
                      </a>
                    </div>
                    <a
                      href={whatsappUrl(r.phone)}
                      target="_blank"
                      rel="noreferrer"
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    >
                      {C.whatsapp}
                    </a>
                  </div>
                  <p className="text-sm">
                    {[r.governorate, r.district, r.landmark].filter(Boolean).join(' - ')}
                  </p>
                  <dl className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <div>
                      <dt>{C.columns.orders}</dt>
                      <dd className="text-sm font-medium text-foreground">
                        <Ltr>{r.ordersCount}</Ltr>
                      </dd>
                    </div>
                    <div>
                      <dt>{C.columns.spent}</dt>
                      <dd className="text-sm font-medium text-foreground">
                        <Money amount={r.totalIqd} />
                      </dd>
                    </div>
                    <div>
                      <dt>{C.columns.last}</dt>
                      <dd className="text-sm font-medium text-foreground">
                        {r.lastOrderId ? (
                          <Link href={`/admin/orders/${r.lastOrderId}`} className="underline-offset-4 hover:underline">
                            <Ltr>{r.lastDisplayNo}</Ltr>
                          </Link>
                        ) : (
                          <Ltr>{r.lastDisplayNo}</Ltr>
                        )}
                        <span className="block text-xs font-normal text-muted-foreground">{r.lastLabel}</span>
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
