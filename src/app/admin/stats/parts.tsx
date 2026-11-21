import type { ReactNode } from 'react';
import { Panel, StatTile } from '@/components/admin/kit';
import { Ltr } from '@/components/Ltr';
import { admin } from '@/content/ar';
import type { DailyPoint } from './aggregate';

/** One KPI tile. The value is a touch smaller on phones so long amounts fit a two-column grid. */
export function Kpi({
  label,
  hint,
  tone,
  children,
}: {
  label: string;
  hint?: string;
  tone?: 'default' | 'ink';
  children: ReactNode;
}) {
  return (
    <StatTile
      label={label}
      hint={hint}
      tone={tone}
      className="min-w-0"
      value={<span className="block break-words text-[22px] leading-tight sm:text-[30px]">{children}</span>}
    />
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Panel title={title} description={hint}>
      {children}
    </Panel>
  );
}

export interface BarRow {
  label: string;
  value: number;
  /** Optional second number shown after the value (e.g. a percentage). */
  note?: string;
}

/** Horizontal bars with the label above the bar so long Arabic names never get clipped. */
export function BarList({ rows }: { rows: BarRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-[15px] leading-normal text-[#5a6475]">{admin.stats.audience.none}</p>;
  return (
    <ul className="flex flex-col gap-4">
      {rows.map((r) => (
        <li key={r.label} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-[15px] leading-normal text-[#121f34]">
            <span className="min-w-0">{r.label}</span>
            <span className="shrink-0 text-[14px] font-medium tabular-nums text-[#5a6475]">
              <Ltr>{r.value}</Ltr>
              {r.note ? (
                <>
                  {' · '}
                  <Ltr>{r.note}</Ltr>
                </>
              ) : null}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[#f7f0ef]" aria-hidden="true">
            <div className="h-full rounded-full bg-[#121f34]" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Column chart, oldest day on the left (time axis stays LTR). One metric per chart. */
export function DayColumns({
  points,
  pick,
  label,
}: {
  points: DailyPoint[];
  pick: (p: DailyPoint) => number;
  label: string;
}) {
  const max = Math.max(1, ...points.map(pick));
  const total = points.reduce((a, p) => a + pick(p), 0);
  const first = points[0]?.day.slice(5);
  const last = points[points.length - 1]?.day.slice(5);
  return (
    <figure className="flex flex-col gap-1.5" aria-label={`${label}: ${total}`}>
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-semibold text-[#121f34]">{label}</span>
        <span className="text-[14px] font-medium text-[#5a6475]">
          {admin.stats.daily.axisMax} <Ltr>{max}</Ltr>
        </span>
      </figcaption>
      <div
        dir="ltr"
        className="flex h-28 items-end gap-px border-b border-s border-[#e7dfdf] ps-0.5"
        role="img"
        aria-label={`${label}: ${total}`}
      >
        {points.map((p) => {
          const v = pick(p);
          return (
            <div key={p.day} className="flex h-full flex-1 items-end" title={`${p.day}: ${v}`}>
              <div
                className="w-full rounded-t-sm bg-[#121f34]"
                style={{ height: v ? `${Math.max(4, (v / max) * 100)}%` : '0%' }}
              />
            </div>
          );
        })}
      </div>
      <div dir="ltr" className="flex justify-between text-[14px] font-medium tabular-nums text-[#5a6475]">
        <span>{first}</span>
        <span>{last}</span>
      </div>
    </figure>
  );
}
