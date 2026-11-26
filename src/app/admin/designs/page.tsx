import Link from 'next/link';
import { ArrowLeft, ArrowRight, ImageOff } from 'lucide-react';
import { Ltr } from '@/components/Ltr';
import { AdminPageHeader, EmptyState, Panel, Pill, StatTile, btn } from '@/components/admin/kit';
import { admin, common } from '@/content/ar';
import { count } from '@/lib/plural';
import { requireAdmin } from '@/lib/auth/guard';
import { getSettings } from '@/lib/settings';
import { shopDayKey } from '@/lib/shop-time';
import { getStorage } from '@/lib/storage';
import type { AiBlock, AiGenerationRecord, AiUsageRow } from '@/lib/types';
import { formatBaghdad } from '../_lib';
import { blockIpAction, unblockIpAction } from './actions';
import { listAiBlocks } from './blocks';
import { DesignGrid } from './DesignGrid';
import { designsSummary, IP_KEY_RE, pageFromParam, usageSince } from './summary';

export const dynamic = 'force-dynamic';

const d = admin.designs;
const PAGE_SIZE = 48;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function DesignsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const ipParam = first(sp.ip);
  const ipKey = ipParam && IP_KEY_RE.test(ipParam) ? ipParam : undefined;
  const pageNo = pageFromParam(first(sp.page));

  const storage = getStorage();
  const settings = await getSettings();
  const today = shopDayKey(new Date());

  const [generations, allTimeFiltered, usage, blocks]: [
    { rows: AiGenerationRecord[]; total: number },
    number | null,
    AiUsageRow[],
    AiBlock[],
  ] = await Promise.all([
    storage.aiListGenerations?.({ limit: PAGE_SIZE, offset: (pageNo - 1) * PAGE_SIZE, ipKey }) ?? { rows: [], total: 0 },
    // All time = every stored generation. Without ?ip the page's own total already is that number.
    ipKey && storage.aiListGenerations ? storage.aiListGenerations({ limit: 0, offset: 0 }).then((g) => g.total) : null,
    // Today, this month and the alerts (today and yesterday) need nothing older.
    storage.aiUsage?.(usageSince(today), 'image') ?? [],
    listAiBlocks(),
  ]);

  // Staff names for the «موظف: <name>» badge, loaded once and only when the page has staff designs. Never breaks the page
  // (before the staff migration the table does not exist: the badge then shows the id).
  const staffNames: Record<string, string> = {};
  if (storage.staffList && generations.rows.some((r) => r.staffId)) {
    try {
      for (const s of await storage.staffList()) staffNames[s.id] = s.name;
    } catch {
      // not ready or an outage: ids are shown instead
    }
  }

  const blockedKeys = new Set(blocks.map((b) => b.ipKey));
  const summary = designsSummary(usage, today, settings.ai.perIpDailyLimit, blockedKeys);
  const allTime = allTimeFiltered ?? generations.total;
  const pages = Math.max(1, Math.ceil(generations.total / PAGE_SIZE));
  const href = (page: number) => {
    const q = new URLSearchParams();
    if (ipKey) q.set('ip', ipKey);
    if (page > 1) q.set('page', String(page));
    const s = q.toString();
    return s ? `/admin/designs?${s}` : '/admin/designs';
  };

  return (
    <section className="flex flex-col gap-6">
      <AdminPageHeader
        className="!mb-0"
        title={d.title}
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
        <StatTile label={d.all} value={<Ltr>{allTime}</Ltr>} />
      </div>

      {summary.alerts.length > 0 ? (
        <Panel title={d.alerts} bodyClassName="!p-0 pt-3">
          <ul className="divide-y divide-[#e7dfdf]">
            {summary.alerts.map((a) => (
              <li key={`${a.ipKey}-${a.day}`} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
                <Ltr className="text-[16px] font-bold text-[#121f34]">{a.ip}</Ltr>
                <Pill tone="warn">
                  <Ltr>{a.count}</Ltr> {count(a.count, common.plural.design)}
                </Pill>
                <span className="text-[14px] font-medium text-[#5a6475]">{formatBaghdad(a.lastAt)}</span>
                <div className="ms-auto flex flex-wrap items-center gap-2">
                  <Link href={`/admin/designs?ip=${a.ipKey}`} className={btn.outline}>
                    {d.view}
                  </Link>
                  <form action={blockIpAction}>
                    <input type="hidden" name="ipKey" value={a.ipKey} />
                    <input type="hidden" name="ip" value={a.ip} />
                    <button type="submit" className={btn.danger}>
                      {d.block}
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {blocks.length > 0 ? (
        <Panel title={d.blocked} bodyClassName="!p-0 pt-3">
          <ul className="divide-y divide-[#e7dfdf]">
            {blocks.map((b) => (
              <li key={b.ipKey} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
                <Ltr className="text-[16px] font-bold text-[#121f34]">{b.ip}</Ltr>
                <span className="text-[14px] font-medium text-[#5a6475]">{formatBaghdad(b.createdAt)}</span>
                <div className="ms-auto flex flex-wrap items-center gap-2">
                  <Link href={`/admin/designs?ip=${b.ipKey}`} className={btn.outline}>
                    {d.view}
                  </Link>
                  <form action={unblockIpAction}>
                    <input type="hidden" name="ipKey" value={b.ipKey} />
                    <button type="submit" className={btn.outline}>
                      {d.unblock}
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {generations.rows.length === 0 ? (
        <EmptyState icon={ImageOff} title={d.empty} />
      ) : (
        <DesignGrid rows={generations.rows} staffNames={staffNames} />
      )}

      {pages > 1 ? (
        <nav className="flex items-center justify-between gap-4">
          {pageNo > 1 ? (
            <Link href={href(pageNo - 1)} className={btn.outline}>
              <ArrowRight aria-hidden className="size-5" />
              {d.prev}
            </Link>
          ) : (
            <span />
          )}
          <Ltr className="text-[15px] font-medium tabular-nums text-[#5a6475]">
            {pageNo} / {pages}
          </Ltr>
          {pageNo < pages ? (
            <Link href={href(pageNo + 1)} className={btn.outline}>
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
