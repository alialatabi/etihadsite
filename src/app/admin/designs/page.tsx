import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Ltr } from '@/components/Ltr';
import { admin, common } from '@/content/ar';
import { count } from '@/lib/plural';
import { requireAdmin } from '@/lib/auth/guard';
import { getSettings } from '@/lib/settings';
import { shopDayKey } from '@/lib/shop-time';
import { getStorage } from '@/lib/storage';
import type { AiBlock, AiGenerationRecord, AiUsageRow } from '@/lib/types';
import { formatBaghdad } from '../_lib';
import { blockIpAction, unblockIpAction } from './actions';
import { DesignGrid } from './DesignGrid';
import { designsSummary, pageFromParam, usageSince } from './summary';

export const dynamic = 'force-dynamic';

const d = admin.designs;
const PAGE_SIZE = 48;
const IP_KEY_RE = /^[0-9a-f]{64}$/;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

function Counter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="text-3xl font-bold">{children}</CardContent>
    </Card>
  );
}

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
    storage.aiListBlocks?.() ?? [],
  ]);

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
      <h1 className="text-2xl font-bold">{d.title}</h1>

      <div className="grid gap-4 sm:grid-cols-3">
        <Counter label={d.today}>
          <Ltr>
            {summary.today} / {settings.ai.siteDailyLimit}
          </Ltr>
        </Counter>
        <Counter label={d.month}>
          <Ltr>{summary.month}</Ltr>
        </Counter>
        <Counter label={d.all}>
          <Ltr>{allTime}</Ltr>
        </Counter>
      </div>

      {summary.alerts.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-bold">{d.alerts}</h2>
          <ul className="flex flex-col gap-2">
            {summary.alerts.map((a) => (
              <li
                key={`${a.ipKey}-${a.day}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border bg-card p-3 shadow-sm"
              >
                <Ltr className="font-medium">{a.ip}</Ltr>
                <span>
                  <Ltr>{a.count}</Ltr> {count(a.count, common.plural.design)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {formatBaghdad(a.lastAt)}
                </span>
                <div className="ms-auto flex items-center gap-2">
                  <Link href={`/admin/designs?ip=${a.ipKey}`} className={buttonVariants({ variant: 'outline' })}>
                    {d.view}
                  </Link>
                  <form action={blockIpAction}>
                    <input type="hidden" name="ipKey" value={a.ipKey} />
                    <input type="hidden" name="ip" value={a.ip} />
                    <Button type="submit" variant="destructive">
                      {d.block}
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {blocks.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-bold">{d.blocked}</h2>
          <ul className="flex flex-col gap-2">
            {blocks.map((b) => (
              <li key={b.ipKey} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border bg-card p-3 shadow-sm">
                <Ltr className="font-medium">{b.ip}</Ltr>
                <span className="text-sm text-muted-foreground">
                  {formatBaghdad(b.createdAt)}
                </span>
                <div className="ms-auto flex items-center gap-2">
                  <Link href={`/admin/designs?ip=${b.ipKey}`} className={buttonVariants({ variant: 'outline' })}>
                    {d.view}
                  </Link>
                  <form action={unblockIpAction}>
                    <input type="hidden" name="ipKey" value={b.ipKey} />
                    <Button type="submit" variant="outline">
                      {d.unblock}
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {ipKey ? (
        <div>
          <Link href="/admin/designs" className={buttonVariants({ variant: 'ghost' })}>
            {d.all}
          </Link>
        </div>
      ) : null}

      {generations.rows.length === 0 ? (
        <p className="rounded-2xl border bg-card p-6 text-center text-muted-foreground">{d.empty}</p>
      ) : (
        <DesignGrid rows={generations.rows} />
      )}

      {pages > 1 ? (
        <nav className="flex items-center justify-between gap-4">
          {pageNo > 1 ? (
            <Link href={href(pageNo - 1)} className={buttonVariants({ variant: 'outline' })}>
              {d.prev}
            </Link>
          ) : (
            <span />
          )}
          <Ltr>
            {pageNo} / {pages}
          </Ltr>
          {pageNo < pages ? (
            <Link href={href(pageNo + 1)} className={buttonVariants({ variant: 'outline' })}>
              {d.next}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </section>
  );
}
