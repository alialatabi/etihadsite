import Link from 'next/link';
import { Download } from 'lucide-react';
import { AdminPageHeader, InfoStrip, Panel, Pill, btn, segment } from '@/components/admin/kit';
import { MarkerCircle } from '@/components/collage';
import { fillLtr } from '@/components/fill-ltr';
import { Ltr } from '@/components/Ltr';
import { admin, common, order } from '@/content/ar';
import { accounts } from '@/content/ar/accounts';
import { loadAccountsView, resolveWeek } from '@/lib/accounting/view';
import { addWeeks, weekEndKey } from '@/lib/accounting/week';
import { requireAdmin } from '@/lib/auth/guard';
import { count } from '@/lib/plural';
import { getSettings } from '@/lib/settings';
import { getStorage } from '@/lib/storage';
import { Kpi } from '../stats/parts';
import { Amount, CostPanel, DayTable, Delta, HistoryTable, MaterialTable, MiniStat, OrdersTable } from './parts';

export const dynamic = 'force-dynamic';

const A = accounts;
type Param = string | string[] | undefined;

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: Param; saved?: Param; error?: Param }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const now = new Date();
  const weekKey = resolveWeek(sp.week, now);
  const first = (v: Param) => (Array.isArray(v) ? v[0] : v);
  const settings = await getSettings();
  const entries = settings.accounting?.sheetCosts ?? [];
  const view = await loadAccountsView(getStorage(), entries, weekKey, now);
  const { week, previous } = view;
  const costForm = <CostPanel entries={entries} weekKey={weekKey} />;
  const errorCode = first(sp.error);
  const errorMessage = errorCode && Object.hasOwn(A.costForm.errors, errorCode) ? A.costForm.errors[errorCode as keyof typeof A.costForm.errors] : null;
  const prevHref = `/admin/accounts?week=${addWeeks(weekKey, -1)}`;
  const nextKey = addWeeks(weekKey, 1);
  const nextHref = nextKey === view.currentWeekKey ? '/admin/accounts' : `/admin/accounts?week=${nextKey}`;
  const rows = [...week.rows].reverse();

  return (
    <section className="flex flex-col gap-6">
      <AdminPageHeader
        className="mb-0"
        title={A.title}
        description={A.description}
        actions={
          <>
            <Link href={prevHref} className={segment(false)}>
              {A.prevWeek}
            </Link>
            {!view.isCurrent ? (
              <Link href={nextHref} className={segment(false)}>
                {A.nextWeek}
              </Link>
            ) : null}
            <Link href="/admin/accounts" aria-current={view.isCurrent ? 'page' : undefined} className={segment(view.isCurrent)}>
              {A.thisWeek}
            </Link>
            <a href={`/api/admin/accounts/export?week=${weekKey}`} download className={btn.outline}>
              <Download aria-hidden className="size-[18px]" />
              {A.download}
            </a>
          </>
        }
      />

      <div className="flex flex-col gap-2">
        <p className="text-[18px] font-bold leading-normal text-ink [&_bdi]:whitespace-nowrap">
          {fillLtr(A.weekLabel, { from: weekKey, to: weekEndKey(weekKey) })}
        </p>
        <InfoStrip>{A.weekNote}</InfoStrip>
      </div>

      {first(sp.saved) === '1' ? (
        <p role="status" className="rounded-[2px] border border-[#15803d]/30 bg-white px-4 py-3 text-[15px] font-bold text-[#15803d]">
          {A.costForm.saved}
        </p>
      ) : null}

      {errorMessage ? (
        <p role="alert" className="rounded-[2px] border border-[#b91c1c]/30 bg-white px-4 py-3 text-[15px] font-bold text-[#b91c1c]">
          {errorMessage}
        </p>
      ) : null}

      {week.costMissing ? (
        <>
          <div role="alert" className="rounded-[2px] border border-brand-ink/30 bg-brand-tint px-4 py-3 text-brand-ink">
            <p className="text-[16px] font-bold">{A.noCost.title}</p>
            <p className="mt-1 text-[15px] leading-normal">{A.noCost.text}</p>
          </div>
          {costForm}
        </>
      ) : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Kpi label={A.kpi.sales} hint={A.kpi.salesHint}>
          <Amount v={week.salesIqd} />
        </Kpi>
        <Kpi label={A.kpi.cost}>
          <Amount v={week.costIqd} />
        </Kpi>
        {/* Full width on phones and a single line, so the marker loop never wraps around a 7-digit amount. */}
        <div className="col-span-2 min-w-0 md:col-span-1">
          <Kpi label={A.kpi.profit} hint={week.profitIqd === null ? A.profitNeedsCost : A.kpi.profitHint} tone="ink">
            {week.profitIqd === null ? (
              admin.orders.missing
            ) : (
              <MarkerCircle animate={false} className="whitespace-nowrap">
                <Amount v={week.profitIqd} />
              </MarkerCircle>
            )}
          </Kpi>
        </div>
        <Kpi label={A.kpi.orders}>
          <Ltr>{week.ordersCount}</Ltr>
        </Kpi>
        <Kpi label={A.kpi.sheets}>
          <Ltr>{week.sheets.total}</Ltr> <span className="text-[14px] font-medium">{count(week.sheets.total, common.plural.sheet)}</span>
        </Kpi>
        <Kpi label={A.kpi.stickers}>
          <Ltr>{week.stickers}</Ltr> <span className="text-[14px] font-medium">{count(week.stickers, common.plural.sticker)}</span>
        </Kpi>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <MiniStat label={A.more.delivery} hint={A.more.deliveryHint}>
          <Amount v={week.deliveryIqd} />
        </MiniStat>
        <MiniStat label={A.more.discounts} hint={A.more.discountsHint}>
          <Amount v={week.discountIqd} />
        </MiniStat>
        <MiniStat label={A.more.margin}>{week.marginPercent === null ? admin.orders.missing : <Ltr>{week.marginPercent}%</Ltr>}</MiniStat>
        <MiniStat label={A.more.cancelled} hint={A.more.cancelledHint}>
          <Ltr>{week.cancelledCount}</Ltr>
        </MiniStat>
        <MiniStat label={A.more.unpriced} hint={week.unpricedCount > 0 ? A.more.unpricedHint : undefined}>
          <Ltr>{week.unpricedCount}</Ltr>
        </MiniStat>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title={A.more.byStatus}>
          <ul className="flex flex-wrap gap-2">
            {(['new', 'printing', 'done'] as const).map((s) => (
              <li key={s}>
                <Pill>
                  {order.status[s]}: <Ltr>{week.byStatus[s]}</Ltr>
                </Pill>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title={A.vsLast.title}>
          <dl className="flex flex-col gap-2 text-[15px] text-ink">
            {(
              [
                [A.vsLast.sales, week.salesIqd, previous.salesIqd],
                [A.vsLast.profit, week.profitIqd, previous.profitIqd],
                [A.vsLast.orders, week.ordersCount, previous.ordersCount],
              ] as const
            ).map(([label, cur, prev]) => (
              <div key={label} className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-muted">{label}</dt>
                <dd className="font-bold tabular-nums">
                  <Delta current={cur} previous={prev} />
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-[20px] font-bold text-ink">{A.material.title}</h2>
        <MaterialTable rows={week.byMaterial} />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-[20px] font-bold text-ink">{A.day.title}</h2>
        <DayTable rows={week.byDay} />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-[20px] font-bold text-ink">{A.orders.title}</h2>
        {rows.length === 0 ? (
          <InfoStrip>{A.orders.empty}</InfoStrip>
        ) : (
          <OrdersTable rows={rows} />
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-[20px] font-bold text-ink">{A.history.title}</h2>
        <HistoryTable rows={view.history} total={view.historyTotal} selectedKey={weekKey} currentKey={view.currentWeekKey} />
      </div>

      {week.costMissing ? null : costForm}
    </section>
  );
}
