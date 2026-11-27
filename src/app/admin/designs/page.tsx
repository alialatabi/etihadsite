import Link from 'next/link';
import { ArrowLeft, ArrowRight, ImageOff } from 'lucide-react';
import { Ltr } from '@/components/Ltr';
import { fillLtr } from '@/components/fill-ltr';
import { AdminPageHeader, EmptyState, InfoStrip, Panel, Pill, StatTile, btn, segment } from '@/components/admin/kit';
import { PendingSubmit } from '@/components/admin/PendingSubmit';
import { ORDERS_LIST_CAP, UNORDERED_DESIGN_DAYS } from '@/config/defaults';
import { admin, common } from '@/content/ar';
import { count } from '@/lib/plural';
import { requireAdmin } from '@/lib/auth/guard';
import { getSettings } from '@/lib/settings';
import { shopDayKey } from '@/lib/shop-time';
import { getStorage } from '@/lib/storage';
import type { AiBlock, AiGenerationFilter, AiGenerationRecord, AiUsageRow, OrderRecord } from '@/lib/types';
import { formatBaghdad, isPdfPurged } from '../_lib';
import { blockIpAction, unblockIpAction } from './actions';
import { customerAllTime } from './all-time';
import { listAiBlocks } from './blocks';
import { DesignGrid, type DesignOrderInfo } from './DesignGrid';
import { FilterBar, type StaffOption } from './FilterBar';
import { filterQuery, matchOrderIds, parseDesignFilters } from './filters';
import { designsSummary, usageSince } from './summary';

export const dynamic = 'force-dynamic';

const d = admin.designs;
const PAGE_SIZE = 48;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function DesignsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const { echo, filter: baseFilter, page: pageNo, active } = parseDesignFilters(sp);
  const ipKey = echo.ip || undefined;

  const storage = getStorage();
  const settings = await getSettings();
  const now = new Date();
  const today = shopDayKey(now);

  // Search: the customer's name / phone / order number live on the order, so find the matching orders first
  // and let storage match the design text OR those order ids.
  let filter: AiGenerationFilter = baseFilter;
  let searchCapped = false;
  let searchTruncated = false;
  if (echo.q) {
    let allOrders: OrderRecord[] = [];
    try {
      allOrders = await storage.listOrders();
    } catch {
      // the design text is still searched
    }
    searchCapped = allOrders.length >= ORDERS_LIST_CAP;
    const matched = matchOrderIds(echo.q, allOrders);
    searchTruncated = matched.truncated;
    filter = { ...baseFilter, search: { text: echo.q, orderIds: matched.ids } };
  }

  const [generations, allTimeCustomer, usage, blocks, staffList]: [
    { rows: AiGenerationRecord[]; total: number },
    number | null,
    AiUsageRow[],
    AiBlock[],
    StaffOption[],
  ] = await Promise.all([
    storage.aiListGenerations?.({ limit: PAGE_SIZE, offset: (pageNo - 1) * PAGE_SIZE, ...filter }) ?? { rows: [], total: 0 },
    // All time = every stored CUSTOMER generation, the same population as today and this month (which count kind 'image');
    // staff designs show in the gallery below but not in these tiles. A storage without the staff column (migration not
    // applied yet) cannot hold staff designs, so its plain total is the same number.
    customerAllTime(storage),
    // Today, this month and the alerts (today and yesterday) need nothing older.
    storage.aiUsage?.(usageSince(today), 'image') ?? [],
    listAiBlocks(),
    // Staff accounts: the «منو سوّاه» list and the «موظف: <name>» badge. Never breaks the page
    // (before the staff migration the table does not exist: the badge then shows the id).
    storage.staffList
      ? storage
          .staffList()
          .then((l) => l.map((s) => ({ id: s.id, name: s.name })))
          .catch((): StaffOption[] => [])
      : [],
  ]);

  const staffNames: Record<string, string> = {};
  for (const s of staffList) staffNames[s.id] = s.name;

  // The orders behind the ordered cards (customer, WhatsApp, the printed PDF). A failed load only hides those buttons.
  const orderIds = [...new Set(generations.rows.flatMap((r) => (r.orderId ? [r.orderId] : [])))];
  const loaded = await Promise.allSettled(orderIds.map((id) => storage.getOrder(id)));
  const orders: Record<string, DesignOrderInfo> = {};
  loaded.forEach((r, i) => {
    if (r.status !== 'fulfilled' || !r.value) return;
    const o = r.value;
    orders[orderIds[i]] = {
      displayNo: o.displayNo,
      customerName: o.customer.name || admin.orders.noName,
      phone: o.customer.phone,
      pdfAvailable: !o.designs && !isPdfPurged(o.createdAt, settings.retentionDays, now),
    };
  });

  const blockedKeys = new Set(blocks.map((b) => b.ipKey));
  const summary = designsSummary(usage, today, settings.ai.perIpDailyLimit, blockedKeys);
  const allTime = allTimeCustomer ?? generations.total;
  const pages = Math.max(1, Math.ceil(generations.total / PAGE_SIZE));
  const href = (page: number) => {
    const q = filterQuery(echo, page);
    return q ? `/admin/designs?${q}` : '/admin/designs';
  };

  return (
    <section className="flex flex-col gap-6">
      <AdminPageHeader
        className="!mb-0"
        title={d.title}
        description={fillLtr(d.retentionNote, {
          days: (
            <>
              <Ltr>{UNORDERED_DESIGN_DAYS}</Ltr> {count(UNORDERED_DESIGN_DAYS, d.dayPlural)}
            </>
          ),
        })}
        actions={
          ipKey ? (
            <Link href="/admin/designs" className={btn.outline}>
              <ArrowRight aria-hidden className="size-5" />
              {d.all}
            </Link>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          tone="ink"
          label={d.today}
          value={
            <Ltr>
              {summary.today} / {settings.ai.siteDailyLimit}
            </Ltr>
          }
        />
        <StatTile label={d.month} value={<Ltr>{summary.month}</Ltr>} />
        <StatTile label={d.stored} value={<Ltr>{allTime}</Ltr>} />
      </div>

      {summary.alerts.length > 0 ? (
        <Panel title={d.alerts} bodyClassName="!p-0 pt-3">
          <ul className="divide-y divide-line">
            {summary.alerts.map((a) => (
              <li key={`${a.ipKey}-${a.day}`} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
                <Ltr className="text-[16px] font-bold text-ink">{a.ip}</Ltr>
                <Pill tone="warn">
                  <Ltr>{a.count}</Ltr> {count(a.count, common.plural.design)}
                </Pill>
                <span className="text-[14px] font-medium text-ink-muted">{formatBaghdad(a.lastAt)}</span>
                <div className="ms-auto flex flex-wrap items-center gap-2">
                  <Link href={`/admin/designs?ip=${a.ipKey}`} className={btn.outline}>
                    {d.view}
                  </Link>
                  <form action={blockIpAction}>
                    <input type="hidden" name="ipKey" value={a.ipKey} />
                    <input type="hidden" name="ip" value={a.ip} />
                    <PendingSubmit className={btn.danger}>
                      {d.block}
                    </PendingSubmit>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {blocks.length > 0 ? (
        <Panel title={d.blocked} bodyClassName="!p-0 pt-3">
          <ul className="divide-y divide-line">
            {blocks.map((b) => (
              <li key={b.ipKey} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
                <Ltr className="text-[16px] font-bold text-ink">{b.ip}</Ltr>
                <span className="text-[14px] font-medium text-ink-muted">{formatBaghdad(b.createdAt)}</span>
                <div className="ms-auto flex flex-wrap items-center gap-2">
                  <Link href={`/admin/designs?ip=${b.ipKey}`} className={btn.outline}>
                    {d.view}
                  </Link>
                  <form action={unblockIpAction}>
                    <input type="hidden" name="ipKey" value={b.ipKey} />
                    <PendingSubmit className={btn.outline}>
                      {d.unblock}
                    </PendingSubmit>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <FilterBar values={echo} staff={staffList} />

      {searchCapped ? (
        <div role="status">
          <InfoStrip>
            {fillLtr(d.filters.searchCapped, { n: ORDERS_LIST_CAP, unit: <>{count(ORDERS_LIST_CAP, d.orderPlural)}</> })}
          </InfoStrip>
        </div>
      ) : null}

      {searchTruncated ? (
        <div role="status">
          <InfoStrip>{d.filters.searchTruncated}</InfoStrip>
        </div>
      ) : null}

      {active ? (
        <p role="status" className="text-[15px] font-medium text-ink-muted">
          {fillLtr(d.filters.found, { n: generations.total, unit: <>{count(generations.total, common.plural.design)}</> })}
        </p>
      ) : null}

      {generations.rows.length === 0 ? (
        <EmptyState icon={ImageOff} title={d.empty} />
      ) : (
        <DesignGrid rows={generations.rows} staffNames={staffNames} orders={orders} nowMs={now.getTime()} />
      )}

      {pages > 1 ? (
        <nav className="flex items-center justify-between gap-4">
          {pageNo > 1 ? (
            <Link href={href(pageNo - 1)} className={segment(false)}>
              <ArrowRight aria-hidden className="size-5" />
              {d.prev}
            </Link>
          ) : (
            <span />
          )}
          <Ltr className="text-[15px] font-medium tabular-nums text-ink-muted">
            {pageNo} / {pages}
          </Ltr>
          {pageNo < pages ? (
            <Link href={href(pageNo + 1)} className={segment(false)}>
              {d.next}
              <ArrowLeft aria-hidden className="size-5" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </section>
  );
}
