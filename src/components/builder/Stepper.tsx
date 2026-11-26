'use client';

import { Check } from 'lucide-react';
import { builder } from '@/content/ar';
import { cn } from '@/lib/utils';
import { StepNumber } from '@/components/collage';
import { STEPS } from './logic';
import type { BuilderApi } from './useBuilder';

export function Stepper({ b }: { b: BuilderApi }) {
  return (
    <nav aria-label={builder.stepper.label} className="paper-card p-2">
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
                  'flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[2px] px-1 text-xs focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink sm:flex-row sm:gap-2 sm:text-sm',
                  current ? 'font-bold text-foreground' : 'text-muted-foreground',
                  !reachable && 'opacity-60',
                )}
              >
                <StepNumber
                  size="sm"
                  n={i + 1}
                  tone={current ? 'red' : done ? 'navy' : 'white'}
                  className={cn(!current && !done && 'shadow-[0_0_0_2px_rgb(18_31_52/0.3)]')}
                >
                  {done ? <Check className="size-4" aria-hidden /> : undefined}
                </StepNumber>
                <span className="text-center leading-tight text-balance sm:text-start">{builder.steps[id]}</span>
              </button>
              {i < STEPS.length - 1 && <span aria-hidden className="dashed-divider hidden h-px w-3 shrink-0 sm:block" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
