'use client';

import { useRef } from 'react';
import { Circle, Shapes, Square } from 'lucide-react';
import { builder, team } from '@/content/ar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import type { Corners, Shape } from '@/lib/types';
import { nextRadioIndex, radioTabIndex } from '@/components/builder/radio-nav';

// A design made here is always drawn by the site, so the custom shape needs no «PNG شفاف» advice.
const OPTIONS: { id: Shape; Icon: typeof Circle; label: string; hint: string }[] = [
  { id: 'circle', Icon: Circle, label: builder.shape.circle, hint: builder.shape.circleHint },
  { id: 'rect', Icon: Square, label: builder.shape.rect, hint: builder.shape.rectHint },
  { id: 'custom', Icon: Shapes, label: builder.shape.custom, hint: builder.shape.customHintAi },
];

/** The shape (and, for a rectangle, the corners) picker of the staff page: the same look and keyboard pattern as the customer's ShapeStep. */
export function TeamShape({
  shape,
  onShape,
  corners,
  onCorners,
}: {
  shape: Shape | null;
  onShape: (s: Shape) => void;
  corners: Corners;
  onCorners: (c: Corners) => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = OPTIONS.findIndex((o) => o.id === shape);
  // Radio-group keyboard pattern: one Tab stop, the arrow keys move the choice (and the focus) between the options.
  const onKeyDown = (ev: React.KeyboardEvent<HTMLDivElement>) => {
    const from = buttons.current.findIndex((el) => el === document.activeElement);
    const to = nextRadioIndex(ev.key, from < 0 ? Math.max(selectedIndex, 0) : from, OPTIONS.length);
    if (to === null) return;
    ev.preventDefault();
    onShape(OPTIONS[to].id);
    buttons.current[to]?.focus();
  };
  return (
    <div className="space-y-5">
      <div role="radiogroup" aria-label={team.shape} onKeyDown={onKeyDown} className="grid gap-3 sm:grid-cols-3">
        {OPTIONS.map(({ id, Icon, label, hint }, i) => {
          const selected = shape === id;
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
              onClick={() => onShape(id)}
              className={cn(
                'paper-card flex min-h-11 items-center gap-4 p-4 text-start transition-colors focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink sm:flex-col sm:items-start sm:gap-3',
                selected ? 'outline outline-[3px] outline-ink' : 'hover:bg-news-light',
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
              <span className="min-w-0">
                <span className="block text-lg font-bold text-ink">{label}</span>
                <span className="mt-1 block text-sm leading-relaxed text-ink-muted">{hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {shape === 'rect' && (
        <fieldset className="paper-card p-4">
          <legend className="px-1 text-sm font-medium text-ink">{builder.shape.corners}</legend>
          <RadioGroup value={corners} onValueChange={(v) => onCorners(v as Corners)} className="mt-1 gap-3 sm:grid-cols-2">
            {(
              [
                ['rounded', builder.shape.rounded, builder.shape.roundedHint],
                ['sharp', builder.shape.sharp, builder.shape.sharpHint],
              ] as const
            ).map(([id, label, hint]) => (
              <label
                key={id}
                htmlFor={`team-corners-${id}`}
                className={cn(
                  'flex min-h-11 cursor-pointer items-start gap-3 rounded-[2px] border p-3',
                  corners === id ? 'border-ink bg-news-light' : 'border-line bg-white',
                )}
              >
                <RadioGroupItem id={`team-corners-${id}`} value={id} className="mt-1" />
                <span>
                  <span className="block text-sm font-medium text-ink">{label}</span>
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
