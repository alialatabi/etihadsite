'use client';

import { useRef } from 'react';
import { Check, Circle, Shapes, Square } from 'lucide-react';
import { builder } from '@/content/ar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import type { Corners, Shape } from '@/lib/types';
import { nextRadioIndex, radioTabIndex } from '../radio-nav';
import type { BuilderApi } from '../useBuilder';

const OPTIONS: { id: Shape; Icon: typeof Circle; label: string; hint: string }[] = [
  { id: 'circle', Icon: Circle, label: builder.shape.circle, hint: builder.shape.circleHint },
  { id: 'rect', Icon: Square, label: builder.shape.rect, hint: builder.shape.rectHint },
  { id: 'custom', Icon: Shapes, label: builder.shape.custom, hint: builder.shape.customHint },
];

export function ShapeStep({ b }: { b: BuilderApi }) {
  // «يحتاج PNG شفاف» is advice for an uploaded file; a design made here needs none.
  const hintFor = (id: Shape, hint: string) => (id === 'custom' && b.mode !== 'upload' ? builder.shape.customHintAi : hint);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = OPTIONS.findIndex((o) => o.id === b.shape);
  // Radio-group keyboard pattern: one Tab stop, the arrow keys move the choice (and the focus) between the options.
  const onKeyDown = (ev: React.KeyboardEvent<HTMLDivElement>) => {
    const from = buttons.current.findIndex((el) => el === document.activeElement);
    const to = nextRadioIndex(ev.key, from < 0 ? Math.max(selectedIndex, 0) : from, OPTIONS.length);
    if (to === null) return;
    ev.preventDefault();
    b.setShape(OPTIONS[to].id);
    buttons.current[to]?.focus();
  };
  return (
    <div className="space-y-5">
      <div role="radiogroup" aria-label={builder.shape.title} onKeyDown={onKeyDown} className="grid gap-3 sm:grid-cols-3">
        {OPTIONS.map(({ id, Icon, label, hint }, i) => {
          const selected = b.shape === id;
          return (
            <button
              key={id}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={radioTabIndex(i, selectedIndex)}
              onClick={() => b.setShape(id)}
              className={cn(
                'relative flex min-h-11 items-center gap-4 rounded-[2px] border-2 bg-white p-4 text-start shadow-paper outline-none transition-colors focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink sm:flex-col sm:items-start sm:gap-3',
                selected ? 'border-ink ring-[3px] ring-ink/15' : 'border-ink/20 hover:border-ink/50',
              )}
            >
              <span
                className={cn(
                  'flex size-14 shrink-0 items-center justify-center rounded-[2px]',
                  selected ? 'bg-ink text-paper' : 'bg-news text-ink',
                )}
              >
                <Icon className="size-7" aria-hidden />
              </span>
              <span className="min-w-0 pe-7 sm:pe-0">
                <span className="block text-lg font-bold text-ink">{label}</span>
                <span className="mt-1 block text-sm leading-relaxed text-ink-muted">{hintFor(id, hint)}</span>
              </span>
              {selected && (
                <span aria-hidden className="absolute end-2 top-2 flex size-6 items-center justify-center rounded-[50%] bg-ink text-paper">
                  <Check className="size-4" strokeWidth={3} aria-hidden />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {b.shape === 'rect' && (
        <fieldset className="rounded-[2px] border border-ink/20 bg-white p-4 shadow-paper">
          <legend className="px-1 text-sm font-bold text-ink">{builder.shape.corners}</legend>
          <RadioGroup value={b.corners} onValueChange={(v) => b.setCorners(v as Corners)} className="mt-1 gap-3 sm:grid-cols-2">
            {(
              [
                ['rounded', builder.shape.rounded, builder.shape.roundedHint],
                ['sharp', builder.shape.sharp, builder.shape.sharpHint],
              ] as const
            ).map(([id, label, hint]) => (
              <label
                key={id}
                htmlFor={`corners-${id}`}
                className={cn(
                  'flex min-h-11 cursor-pointer items-start gap-3 rounded-[2px] border-2 p-3',
                  b.corners === id ? 'border-ink ring-[3px] ring-ink/15' : 'border-ink/20',
                )}
              >
                <RadioGroupItem id={`corners-${id}`} value={id} className="mt-1" />
                <span>
                  <span className="block text-sm font-bold text-ink">{label}</span>
                  <span className="block text-xs text-ink-muted">{hint}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </fieldset>
      )}
    </div>
  );
}
