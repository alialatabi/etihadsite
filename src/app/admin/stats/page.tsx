import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Ltr } from '@/components/Ltr';
import { admin, common } from '@/content/ar';
import { requireAdmin } from '@/lib/auth/guard';
import { formatIqd } from '@/lib/pricing';
import { getStorage } from '@/lib/storage';
import { cn } from '@/lib/utils';
import { RANGE_OPTIONS, aggregate, parseRange, sinceFor } from './aggregate';
import { BarList, DayColumns, Kpi, Section } from './parts';
import { buildStatsRows } from './rows';

export const dynamic = 'force-dynamic';

const S = admin.stats;
const A = S.audience;

function Pct({ v }: { v: number | null }) {
  return v === null ? <>{admin.orders.missing}</> : <Ltr>{v}%</Ltr>;
}

export default async function StatsPage({ searchParams }: { searchParams: Promise<{ days?: string | string[] }> }) {
  await requireAdmin();
  const days = parseRange((await searchParams).days);
  const now = new Date();
  const storage = getStorage();
  const [events, customers] = await Promise.all([storage.listEvents(sinceFor(now, days)), storage.listCustomers()]);
  const st = aggregate(events, customers, { now, days });

  const funnelLabels = S.funnel;
  const { sourceRows, deviceRows, cityRows, govRows, materialRows, shapeRows, sizeRows, weekdayRows, hourRows, customerRows } =
    buildStatsRows(st);

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
            admin.orders.missing
          ) : (
            <>
              <Ltr>{formatIqd(st.avgOrderIqd)}</Ltr> <span className="text-sm font-normal">{common.units.iqd}</span>
            </>
          )}
        </Kpi>
        <Kpi label={S.kpi.avgSheets}>{st.avgSheets === null ? admin.orders.missing : <Ltr>{st.avgSheets}</Ltr>}</Kpi>
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
