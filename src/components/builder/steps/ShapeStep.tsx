'use client';

import { Circle, MessageCircle, Shapes, Square } from 'lucide-react';
import { builder } from '@/content/ar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { WhatsAppCard } from '@/components/WhatsAppButton';
import { whatsappLink } from '@/components/shell/whatsapp';
import type { Corners, Shape } from '@/lib/types';
import type { BuilderApi } from '../useBuilder';

const OPTIONS: { id: Shape; Icon: typeof Circle; label: string; hint: string }[] = [
  { id: 'circle', Icon: Circle, label: builder.shape.circle, hint: builder.shape.circleHint },
  { id: 'rect', Icon: Square, label: builder.shape.rect, hint: builder.shape.rectHint },
  { id: 'custom', Icon: Shapes, label: builder.shape.custom, hint: builder.shape.customHint },
];

export function ShapeStep({ b }: { b: BuilderApi }) {
  const noDesignWa = b.settings.whatsapp ? whatsappLink(b.settings.whatsapp, builder.whatsappText.noDesign) : null;
  const readyFileWa = b.settings.whatsapp ? whatsappLink(b.settings.whatsapp, builder.whatsappText.readyFile) : null;
  return (
    <div className="space-y-5">
      <div role="radiogroup" aria-label={builder.shape.title} className="grid gap-3 sm:grid-cols-3">
        {OPTIONS.map(({ id, Icon, label, hint }) => {
          const selected = b.shape === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => b.setShape(id)}
              className={cn(
                'flex min-h-11 items-center gap-4 rounded-2xl border-2 bg-card p-4 text-start outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-col sm:items-start sm:gap-3',
                selected ? 'border-brand bg-brand/5' : 'border-border hover:border-foreground/30',
              )}
            >
              <span
                className={cn(
                  'flex size-14 shrink-0 items-center justify-center rounded-xl',
                  selected ? 'bg-brand text-brand-foreground' : 'bg-muted text-foreground',
                )}
              >
                <Icon className="size-7" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-lg font-bold">{label}</span>
                <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {b.shape === 'rect' && (
        <fieldset className="rounded-2xl border bg-card p-4">
          <legend className="px-1 text-sm font-medium">{builder.shape.corners}</legend>
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
                  'flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3',
                  b.corners === id ? 'border-brand bg-brand/5' : 'border-border',
                )}
              >
                <RadioGroupItem id={`corners-${id}`} value={id} className="mt-1" />
                <span>
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </fieldset>
      )}

      {noDesignWa && (
        <WhatsAppCard href={noDesignWa} title={builder.noDesign.title} hint={builder.noDesign.hint} cta={builder.noDesign.cta}>
          {readyFileWa && (
            <a
              href={readyFileWa}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-medium text-primary underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <MessageCircle className="size-4 shrink-0" aria-hidden />
              {builder.shape.readyFileLink}
            </a>
          )}
        </WhatsAppCard>
      )}
    </div>
  );
}
