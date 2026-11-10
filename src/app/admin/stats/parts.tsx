import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Ltr } from '@/components/Ltr';
import { admin } from '@/content/ar';
import type { DailyPoint } from './aggregate';

export function Kpi({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-2xl font-bold leading-tight">{children}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </CardContent>
    </Card>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export interface BarRow {
  label: string;
  value: number;
  /** Optional second number shown after the value (e.g. a percentage). */
  note?: string;
}

/** Horizontal bars with the label above the bar so long Arabic names never get clipped. */
export function BarList({ rows, empty }: { rows: BarRow[]; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty ?? admin.stats.audience.none}</p>;
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.label} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span>{r.label}</span>
            <span className="text-muted-foreground">
              <Ltr>{r.value}</Ltr>
              {r.note ? (
                <>
                  {' · '}
                  <Ltr>{r.note}</Ltr>
                </>
              ) : null}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(r.value / max) * 100}%` }} />
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
    <figure className="flex flex-col gap-1" aria-label={`${label}: ${total}`}>
      <figcaption className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">
          {admin.stats.daily.axisMax} <Ltr>{max}</Ltr>
        </span>
      </figcaption>
      <div dir="ltr" className="flex h-28 items-end gap-px border-b border-s ps-0.5" role="img" aria-label={`${label}: ${total}`}>
        {points.map((p) => {
          const v = pick(p);
          return (
            <div key={p.day} className="flex h-full flex-1 items-end" title={`${p.day}: ${v}`}>
              <div
                className="w-full rounded-t-sm bg-primary"
                style={{ height: v ? `${Math.max(4, (v / max) * 100)}%` : '0%' }}
              />
            </div>
          );
        })}
      </div>
      <div dir="ltr" className="flex justify-between text-xs text-muted-foreground">
        <span>{first}</span>
        <span>{last}</span>
      </div>
    </figure>
  );
}
