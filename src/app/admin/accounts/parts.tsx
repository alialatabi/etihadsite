import Link from 'next/link';
import type { ReactNode } from 'react';
import { Panel, StatusPill, TableFrame, btn, field, tableCls } from '@/components/admin/kit';
import { PendingSubmit } from '@/components/admin/PendingSubmit';
import { Ltr } from '@/components/Ltr';
import { Money } from '@/components/Money';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { admin, common } from '@/content/ar';
import { accounts } from '@/content/ar/accounts';
import { changePercent, type DayRow, type MaterialRow, type OrderRow } from '@/lib/accounting/compute';
import { currentCost } from '@/lib/accounting/costs';
import type { HistoryRow } from '@/lib/accounting/view';
import type { SheetCostEntry } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatBaghdad } from '../_lib';
import { saveSheetCostAction } from './actions';

const th = cn(tableCls.head, 'px-3');
const td = cn(tableCls.cell, 'px-3');
const tdNum = cn(tableCls.cell, tableCls.num, 'px-3');
const linkCls =
  'inline-flex min-h-11 items-center text-[15px] font-bold text-ink underline-offset-4 hover:text-brand-ink hover:underline focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink';

/** An amount, or a dash for "no figure" (never a fake 0). */
export function Amount({ v }: { v: number | null }) {
  return v === null ? <>{admin.orders.missing}</> : <Money amount={v} />;
}

/** "+12.5%" / "-3%" against the previous week; words when there is nothing to compare with. */
export function Delta({ current, previous }: { current: number | null; previous: number | null }) {
  const pct = changePercent(current, previous);
  if (pct === null) return <>{accounts.vsLast.none}</>;
  return <Ltr>{`${pct > 0 ? '+' : ''}${pct}%`}</Ltr>;
}

export function MiniStat({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-[2px] bg-white p-4 shadow-paper">
      <p className="text-[14px] font-semibold leading-[1.4] text-ink-muted">{label}</p>
      <p className="mt-1 break-words text-[20px] font-bold leading-tight tabular-nums text-ink">{children}</p>
      {hint ? <p className="mt-1 text-[14px] leading-[1.4] text-ink-muted">{hint}</p> : null}
    </div>
  );
}

export function MaterialTable({ rows }: { rows: MaterialRow[] }) {
  const c = accounts.material;
  return (
    <TableFrame label={c.title}>
      <Table>
        <TableHeader>
          <TableRow className="border-line hover:bg-transparent">
            <TableHead className={th}>{admin.orders.columns.material}</TableHead>
            <TableHead className={th}>{c.orders}</TableHead>
            <TableHead className={th}>{c.sheets}</TableHead>
            <TableHead className={th}>{c.stickers}</TableHead>
            <TableHead className={th}>{c.sales}</TableHead>
            <TableHead className={th}>{c.cost}</TableHead>
            <TableHead className={th}>{c.profit}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.material} className={tableCls.row}>
              <TableCell className={cn(td, 'font-bold')}>{common.materials[r.material]}</TableCell>
              <TableCell className={tdNum}>
                <Ltr>{r.orders}</Ltr>
              </TableCell>
              <TableCell className={tdNum}>
                <Ltr>{r.sheets}</Ltr>
              </TableCell>
              <TableCell className={tdNum}>
                <Ltr>{r.stickers}</Ltr>
              </TableCell>
              <TableCell className={tdNum}>
                <Amount v={r.salesIqd} />
              </TableCell>
              <TableCell className={tdNum}>
                <Amount v={r.costIqd} />
              </TableCell>
              <TableCell className={tdNum}>
                <Amount v={r.profitIqd} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableFrame>
  );
}

export function DayTable({ rows }: { rows: DayRow[] }) {
  const c = accounts.day;
  return (
    <TableFrame label={c.title}>
      <Table>
        <TableHeader>
          <TableRow className="border-line hover:bg-transparent">
            <TableHead className={th}>{c.day}</TableHead>
            <TableHead className={th}>{c.orders}</TableHead>
            <TableHead className={th}>{c.sheets}</TableHead>
            <TableHead className={th}>{c.sales}</TableHead>
            <TableHead className={th}>{c.profit}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.day} className={tableCls.row}>
              <TableCell className={cn(td, 'font-bold')}>{c.names[r.day]}</TableCell>
              <TableCell className={tdNum}>
                <Ltr>{r.orders}</Ltr>
              </TableCell>
              <TableCell className={tdNum}>
                <Ltr>{r.sheets}</Ltr>
              </TableCell>
              <TableCell className={tdNum}>
                <Amount v={r.salesIqd} />
              </TableCell>
              <TableCell className={tdNum}>
                <Amount v={r.profitIqd} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableFrame>
  );
}

export function OrdersTable({ rows }: { rows: OrderRow[] }) {
  const c = accounts.orders;
  return (
    <TableFrame label={c.title}>
      <Table>
        <TableHeader>
          <TableRow className="border-line hover:bg-transparent">
            <TableHead className={th}>{c.no}</TableHead>
            <TableHead className={th}>{c.date}</TableHead>
            <TableHead className={th}>{c.status}</TableHead>
            <TableHead className={th}>{c.material}</TableHead>
            <TableHead className={th}>{c.sheets}</TableHead>
            <TableHead className={th}>{c.stickers}</TableHead>
            <TableHead className={th}>{c.sales}</TableHead>
            <TableHead className={th}>{c.cost}</TableHead>
            <TableHead className={th}>{c.profit}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.orderId} className={cn(tableCls.row, !r.counted && 'text-ink-muted')}>
              <TableCell className={tdNum}>
                <Link href={`/admin/orders/${r.orderId}`} className={linkCls}>
                  <Ltr>{r.displayNo}</Ltr>
                </Link>
              </TableCell>
              <TableCell className={td}>{formatBaghdad(r.createdAt)}</TableCell>
              <TableCell className={td}>
                <StatusPill status={r.status} />
              </TableCell>
              <TableCell className={td}>{r.material === null ? admin.orders.missing : common.materials[r.material]}</TableCell>
              <TableCell className={tdNum}>
                {r.sheets === null ? admin.orders.missing : <Ltr>{r.sheets}</Ltr>}
              </TableCell>
              <TableCell className={tdNum}>
                <Ltr>{r.stickers}</Ltr>
              </TableCell>
              <TableCell className={tdNum}>
                {r.counted && r.salesIqd === null ? c.unpriced : <Amount v={r.salesIqd} />}
              </TableCell>
              <TableCell className={tdNum}>
                <Amount v={r.costIqd} />
              </TableCell>
              <TableCell className={tdNum}>
                <Amount v={r.profitIqd} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableFrame>
  );
}

export function HistoryTable({
  rows,
  total,
  selectedKey,
  currentKey,
}: {
  rows: HistoryRow[];
  total: Omit<HistoryRow, 'key'>;
  selectedKey: string;
  currentKey: string;
}) {
  const c = accounts.history;
  return (
    <TableFrame label={c.title}>
      <Table>
        <TableHeader>
          <TableRow className="border-line hover:bg-transparent">
            <TableHead className={th}>{c.week}</TableHead>
            <TableHead className={th}>{c.orders}</TableHead>
            <TableHead className={th}>{c.sheets}</TableHead>
            <TableHead className={th}>{c.sales}</TableHead>
            <TableHead className={th}>{c.cost}</TableHead>
            <TableHead className={th}>{c.profit}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...rows].reverse().map((r) => {
            const selected = r.key === selectedKey;
            return (
              <TableRow key={r.key} className={cn(tableCls.row, selected && 'bg-news font-bold')}>
                <TableCell className={tdNum}>
                  <Link
                    href={r.key === currentKey ? '/admin/accounts' : `/admin/accounts?week=${r.key}`}
                    aria-current={selected ? 'page' : undefined}
                    className={linkCls}
                  >
                    <Ltr>{r.key}</Ltr>
                  </Link>
                  {r.key === currentKey ? <span className="ms-2 text-[14px] text-ink-muted">{c.current}</span> : null}
                </TableCell>
                <TableCell className={tdNum}>
                  <Ltr>{r.orders}</Ltr>
                </TableCell>
                <TableCell className={tdNum}>
                  <Ltr>{r.sheets}</Ltr>
                </TableCell>
                <TableCell className={tdNum}>
                  <Amount v={r.salesIqd} />
                </TableCell>
                <TableCell className={tdNum}>
                  <Amount v={r.costIqd} />
                </TableCell>
                <TableCell className={tdNum}>
                  <Amount v={r.profitIqd} />
                </TableCell>
              </TableRow>
            );
          })}
          <TableRow className="border-line bg-news-light font-bold hover:bg-news-light">
            <TableCell className={td}>{c.total}</TableCell>
            <TableCell className={tdNum}>
              <Ltr>{total.orders}</Ltr>
            </TableCell>
            <TableCell className={tdNum}>
              <Ltr>{total.sheets}</Ltr>
            </TableCell>
            <TableCell className={tdNum}>
              <Amount v={total.salesIqd} />
            </TableCell>
            <TableCell className={tdNum}>
              <Amount v={total.costIqd} />
            </TableCell>
            <TableCell className={tdNum}>
              <Amount v={total.profitIqd} />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </TableFrame>
  );
}

/** The form that sets a new cost per A4 sheet, the cost in force and the history of changes. */
export function CostPanel({ entries, weekKey }: { entries: SheetCostEntry[]; weekKey: string }) {
  const c = accounts.costForm;
  const inForce = currentCost(entries);
  const history = [...entries].sort((a, b) => Date.parse(b.from) - Date.parse(a.from));
  return (
    <Panel title={c.title} description={c.description}>
      <div className="flex flex-col gap-5">
        <form action={saveSheetCostAction} className="flex flex-col gap-4">
          <input type="hidden" name="week" value={weekKey} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="paperCost" className={field.label}>
                {c.paper} ({common.units.iqd})
              </Label>
              <Input
                id="paperCost"
                name="paperCost"
                type="text"
                inputMode="numeric"
                dir="ltr"
                required
                className={field.input}
                defaultValue={inForce?.paperIqd ?? ''}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="plasticCost" className={field.label}>
                {c.plastic} ({common.units.iqd})
              </Label>
              <Input
                id="plasticCost"
                name="plasticCost"
                type="text"
                inputMode="numeric"
                dir="ltr"
                required
                className={field.input}
                defaultValue={inForce?.plasticIqd ?? ''}
              />
            </div>
          </div>
          <ul className="flex flex-col gap-1">
            {c.explain.map((t) => (
              <li key={t} className={field.hint}>
                {t}
              </li>
            ))}
          </ul>
          <div>
            <PendingSubmit className={btn.primary}>
              {c.submit}
            </PendingSubmit>
          </div>
        </form>

        <div>
          <h3 className="text-lg font-bold text-ink">{c.current}</h3>
          <p className="mt-1 text-[15px] text-ink">
            {inForce ? (
              <>
                {c.historyPaper}: <Money amount={inForce.paperIqd} /> · {c.historyPlastic}: <Money amount={inForce.plasticIqd} />
              </>
            ) : (
              c.notSet
            )}
          </p>
        </div>

        {history.length > 0 ? (
          <div>
            <h3 className="mb-2 text-lg font-bold text-ink">{c.historyTitle}</h3>
            <TableFrame label={c.historyTitle}>
              <Table>
                <TableHeader>
                  <TableRow className="border-line hover:bg-transparent">
                    <TableHead className={th}>{c.historyDate}</TableHead>
                    <TableHead className={th}>{c.historyPaper}</TableHead>
                    <TableHead className={th}>{c.historyPlastic}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((e) => (
                    <TableRow key={e.from} className={tableCls.row}>
                      <TableCell className={td}>{formatBaghdad(e.from)}</TableCell>
                      <TableCell className={tdNum}>
                        <Money amount={e.paperIqd} />
                      </TableCell>
                      <TableCell className={tdNum}>
                        <Money amount={e.plasticIqd} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableFrame>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
