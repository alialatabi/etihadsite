'use client';

import { Check } from 'lucide-react';
import { builder } from '@/content/ar';
import { cn } from '@/lib/utils';
import { STEPS } from './logic';
import type { BuilderApi } from './useBuilder';

export function Stepper({ b }: { b: BuilderApi }) {
  return (
    <nav aria-label={builder.hero.title}>
      <ol className="flex items-center gap-1 sm:gap-2">
        {STEPS.map((id, i) => {
          const done = i < b.step;
          const current = i === b.step;
          const reachable = b.canGoTo(i);
          return (
            <li key={id} className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2">
              <button
                type="button"
                disabled={!reachable}
                onClick={() => b.goTo(i)}
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-row sm:gap-2 sm:text-sm',
                  current ? 'font-bold text-foreground' : 'text-muted-foreground',
                  !reachable && 'opacity-60',
                )}
              >
                <span
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold tabular-nums',
                    current && 'border-brand bg-brand text-brand-foreground',
                    done && 'border-primary bg-primary text-primary-foreground',
                  )}
                >
                  {done ? <Check className="size-4" aria-hidden /> : i + 1}
                </span>
                <span className="truncate">{builder.steps[id]}</span>
              </button>
              {i < STEPS.length - 1 && <span aria-hidden className="cut-line hidden h-px w-3 shrink-0 text-border sm:block" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
