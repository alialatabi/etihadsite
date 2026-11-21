'use client';

import { ArrowLeft, Plus, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import { builder, common } from '@/content/ar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fillLtr } from '@/components/fill-ltr';
import { Ltr } from '@/components/Ltr';
import { AI_LINE_MAX_CHARS, AI_MAX_LINES } from '@/lib/ai/config';
import { safeFormatCm } from '../safe';
import type { AiDesignApi } from './useAiDesign';

/** The box after «ولّد التصميم»: the exact lines that will be printed (editable), the spelling fixes, the 12 pt check. */
export function TextReview({ ai }: { ai: AiDesignApi }) {
  const { lines, fixes, capacity } = ai;
  const canConfirm = capacity.ok && !ai.block;

  return (
    <section aria-labelledby="ai-review-title" className="space-y-4 rounded-2xl border-2 border-brand/40 bg-brand/5 p-4">
      <h3 id="ai-review-title" className="text-base font-bold">
        {builder.ai.reviewTitle}
      </h3>

      <ul className="space-y-2">
        {lines.map((line, i) => (
          <li key={i} className="flex items-center gap-2">
            <Input
              id={`ai-line-${i}`}
              dir="auto"
              value={line}
              maxLength={AI_LINE_MAX_CHARS}
              aria-label={`${builder.ai.reviewTitle} ${i + 1}`}
              onChange={(e) => ai.setLines(lines.map((l, k) => (k === i ? e.target.value : l)))}
              className="h-11 flex-1 text-base md:text-base"
            />
            <Button
              type="button"
              variant="ghost"
              className="size-11 shrink-0"
              aria-label={builder.ai.removeLine}
              onClick={() => ai.setLines(lines.filter((_, k) => k !== i))}
            >
              <Trash2 className="size-5" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>

      <Button
        type="button"
        variant="outline"
        className="h-11 px-4"
        disabled={lines.length >= AI_MAX_LINES}
        onClick={() => ai.setLines([...lines, ''])}
      >
        <Plus className="size-4" aria-hidden />
        {builder.ai.addLine}
      </Button>

      {fixes.length > 0 && (
        <div className="rounded-xl bg-background p-3 text-sm">
          <p className="font-medium">{builder.ai.fixesTitle}</p>
          <ul className="mt-1 space-y-1">
            {fixes.map((f, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <bdi className="text-muted-foreground line-through">{f.from}</bdi>
                <ArrowLeft className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <bdi className="font-bold">{f.to}</bdi>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!capacity.ok && (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {capacity.minSizeUm !== null
              ? fillLtr(builder.ai.tooMuchText, {
                  size: (
                    <>
                      <Ltr>{safeFormatCm(capacity.minSizeUm)}</Ltr> {common.units.cm}
                    </>
                  ),
                })
              : builder.ai.errors.text_too_long}
          </span>
        </p>
      )}

      <Button
        type="button"
        disabled={!canConfirm}
        onClick={() => void ai.generate()}
        className="h-12 w-full bg-brand px-6 text-base font-bold text-brand-foreground hover:bg-brand/90 sm:w-auto"
      >
        <Sparkles className="size-5" aria-hidden />
        {builder.ai.confirm}
      </Button>
    </section>
  );
}
