import Link from 'next/link';
import { redirect } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { Ltr } from '@/components/Ltr';
import { admin, builder, common } from '@/content/ar';
import { verifySession } from '@/lib/auth/session';
import { formatIqd } from '@/lib/pricing';
import { getStorage } from '@/lib/storage';
import { cn } from 'cn';
import type { Material } from '@/lib/types';
import { RANGE_OPTIONS, aggregate, parseRange, pct, sinceFor } from './aggregate';
import { BarList, DayColumns, Kpi, Section, type BarRow } from './parts';

export const dynamic = 'force-dynamic';

const S = admin.stats;
const A = S.audience;

function Pct({ v }: { v: number | null }) {
  return v === null ? <>—</> : <Ltr>{v}%</Ltr>;
}

export default async function StatsPage({ searchParams }: { searchParams: Promise<{ days?: string | string[] }> }) {
  if (!(await verifySession())) redirect('/admin/login');
  const days = parseRange((await searchParams).days);
  const now = new Date();
  const storage = getStorage();
  const [events, customers] = await Promise.all([storage.listEvents(sinceFor(now, days)), storage.listCustomers()]);
  const st = aggregate(events, customers, { now, days });

  const funnelLabels = S.funnel;
  const sourceRows: BarRow[] = st.sources.map((r) => ({ label: S.sources[r.key] ?? S.sources.other, value: r.count }));
  const deviceTotal = st.devices.reduce((a, r) => a + r.count, 0);
  const deviceRows: BarRow[] = st.devices.map((r) => ({
    label: S.devices[r.key] ?? r.key,
    value: r.count,
    note: `${pct(r.count, deviceTotal) ?? 0}%`,
  }));
  const cityRows: BarRow[] = st.cities.map((r) => ({ label: r.key, value: r.count }));
  const govRows: BarRow[] = st.governorates.map((r) => ({ label: r.key, value: r.count }));
  const materialRows: BarRow[] = st.materials.map((r) => ({
    label: common.materials[r.key as Material] ?? r.key,
    value: r.count,
  }));
  const shapeRows: BarRow[] = st.shapes.map((r) => ({
    label: (builder.shape as Record<string, unknown>)[r.key] && typeof (builder.shape as Record<string, unknown>)[r.key] === 'string'
      ? ((builder.shape as Record<string, string>)[r.key] as string)
      : r.key,
    value: r.count,
  }));
  const sizeRows: BarRow[] = st.sizes.map((r) => ({ label: `${r.key} ${common.units.cm}`, value: r.count }));
  const weekdayRows: BarRow[] = st.weekdays.map((w, i) => ({
    label: S.weekdays[i],
    value: w.visitors,
    note: w.orders ? `${w.orders} ${A.ordersLabel}` : undefined,
  }));
  const topHours = st.hours
    .map((h, hour) => ({ hour, ...h }))
    .filter((h) => h.visitors > 0)
    .sort((a, b) => b.visitors - a.visitors)
    .slice(0, 6);
  const hourRows: BarRow[] = topHours.map((h) => ({
    label: `${S.hourLabel} ${String(h.hour).padStart(2, '0')}:00`,
    value: h.visitors,
    note: h.orders ? `${h.orders} ${A.ordersLabel}` : undefined,
  }));
  const customerRows: BarRow[] = [
    { label: A.newCustomers, value: st.newCustomers },
    { label: A.returningCustomers, value: st.returningCustomers },
  ];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{S.title}</h1>
        <div className="flex flex-wrap gap-2">
          {RANGE_OPTIONS.map((d) => (
            <Link
              key={d}
              href={`/admin/stats?days=${d}`}
              aria-current={d === days ? 'page' : undefined}
              className={cn(buttonVariants({ variant: d === days ? 'default' : 'outline' }))}
            >
              {S.ranges[String(d) as keyof typeof S.ranges]}
            </Link>
          ))}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{S.note}</p>

      {!st.hasData ? <p className="rounded-lg border p-8 text-center text-muted-foreground">{S.empty}</p> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label={S.kpi.visits} hint={S.kpi.visitsHint}>
          <Ltr>{st.visits}</Ltr>
        </Kpi>
        <Kpi label={S.kpi.today}>
          <Ltr>{st.visitorsToday}</Ltr>
        </Kpi>
        <Kpi label={S.kpi.uploads}>
          <Ltr>{st.uploads}</Ltr>
        </Kpi>
        <Kpi label={S.kpi.orders}>
          <Ltr>{st.orders}</Ltr>
        </Kpi>
        <Kpi label={S.kpi.uploadToOrder}>
          <Pct v={st.uploadToOrderPct} />
        </Kpi>
        <Kpi label={S.kpi.visitToOrder}>
          <Pct v={st.visitToOrderPct} />
        </Kpi>
        <Kpi label={S.kpi.revenue}>
          <Ltr>{formatIqd(st.revenueIqd)}</Ltr> <span className="text-sm font-normal">{common.units.iqd}</span>
        </Kpi>
        <Kpi label={S.kpi.avgOrder}>
          {st.avgOrderIqd === null ? (
            '—'
          ) : (
            <>
              <Ltr>{formatIqd(st.avgOrderIqd)}</Ltr> <span className="text-sm font-normal">{common.units.iqd}</span>
            </>
          )}
        </Kpi>
        <Kpi label={S.kpi.avgSheets}>{st.avgSheets === null ? '—' : <Ltr>{st.avgSheets}</Ltr>}</Kpi>
        <Kpi label={S.kpi.installs}>
          <Ltr>{st.installs}</Ltr>
        </Kpi>
      </div>

      <Section title={funnelLabels.title} hint={funnelLabels.hint}>
        <ol className="flex flex-col gap-3">
          {st.funnel.map((f) => (
            <li key={f.id} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span>{funnelLabels[f.id]}</span>
                <span className="text-muted-foreground">
                  <Ltr>{f.count}</Ltr>
                  {f.ofPreviousPct !== null ? (
                    <>
                      {' · '}
                      <Ltr>{f.ofPreviousPct}%</Ltr> {funnelLabels.ofPrevious}
                    </>
                  ) : null}
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div className="h-full rounded-full bg-primary" style={{ width: `${f.ofFirstPct}%` }} />
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section title={S.daily.title}>
        <div className="flex flex-col gap-6">
          <DayColumns points={st.daily} pick={(p) => p.visitors} label={S.daily.visitors} />
          <DayColumns points={st.daily} pick={(p) => p.orders} label={S.daily.orders} />
        </div>
      </Section>

      <h2 className="mt-2 text-xl font-bold">{A.title}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <Section title={A.sources}>
          <BarList rows={sourceRows} />
        </Section>
        <Section title={A.devices}>
          <BarList rows={deviceRows} />
        </Section>
        <Section title={A.cities} hint={st.cities.length === 0 ? A.citiesNote : undefined}>
          <BarList rows={cityRows} />
        </Section>
        <Section title={A.governorates}>
          <BarList rows={govRows} />
        </Section>
        <Section title={A.materials}>
          <BarList rows={materialRows} />
        </Section>
        <Section title={A.shapes}>
          <BarList rows={shapeRows} />
        </Section>
        <Section title={A.sizes}>
          <BarList rows={sizeRows} />
        </Section>
        <Section title={A.returning}>
          <BarList rows={customerRows} />
        </Section>
        <Section title={A.weekdays}>
          <BarList rows={weekdayRows} />
        </Section>
        <Section title={A.hours}>
          <BarList rows={hourRows} />
        </Section>
      </div>
    </section>
  );
}
