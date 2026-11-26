'use client';

import { useEffect, useRef } from 'react';
import { ArrowLeft, Plus, Sparkles, Trash2 } from 'lucide-react';
import { builder } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AI_INSTRUCTIONS_MAX_CHARS, AI_LINE_MAX_CHARS, AI_MAX_LINES } from '@/lib/ai/config';
import { TextWarningNote } from './TextWarningNote';
import type { AiDesignApi } from './useAiDesign';

/** The box after «ولّد التصميم»: the exact lines that will be printed (editable), the design instructions (editable, Arabic), the spelling fixes, the 12 pt warning (never a block). */
export function TextReview({ ai }: { ai: AiDesignApi }) {
  const { lines, fixes, textWarning } = ai;
  // Too much text for the size only warns: the customer may go on.
  const canConfirm = !ai.block;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  // After a delete: the line that takes its place (or the one before, or «أضف سطر») gets the focus.
  const focusAfterDelete = useRef<number | null>(null);

  // The box just opened (after «ولّد التصميم»): move the focus to it.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    const i = focusAfterDelete.current;
    if (i === null) return;
    focusAfterDelete.current = null;
    if (lines.length === 0) addRef.current?.focus();
    else document.getElementById(`ai-line-${Math.min(i, lines.length - 1)}`)?.focus();
  }, [lines.length]);

  return (
    <section aria-labelledby="ai-review-title" className="space-y-4 rounded-2xl border-2 border-brand/40 bg-brand/5 p-4">
      <h3 id="ai-review-title" ref={headingRef} tabIndex={-1} className="text-base font-bold outline-none">
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
              onClick={() => {
                focusAfterDelete.current = i;
                ai.setLines(lines.filter((_, k) => k !== i));
              }}
            >
              <Trash2 className="size-5" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>

      <Button
        ref={addRef}
        type="button"
        variant="outline"
        className="h-11 px-4"
        disabled={lines.length >= AI_MAX_LINES}
        onClick={() => ai.setLines([...lines, ''])}
      >
        <Plus className="size-4" aria-hidden />
        {builder.ai.addLine}
      </Button>

      <div className="space-y-2">
        <Label htmlFor="ai-instructions" className="text-base font-bold">
          {builder.ai.instructionsTitle}
        </Label>
        <p id="ai-instructions-hint" className="text-sm text-muted-foreground">
          {builder.ai.instructionsHint}
        </p>
        <Textarea
          id="ai-instructions"
          dir="auto"
          value={ai.instructions}
          maxLength={AI_INSTRUCTIONS_MAX_CHARS}
          rows={4}
          onChange={(e) => ai.setInstructions(e.target.value)}
          aria-describedby="ai-instructions-hint ai-instructions-count"
          className="min-h-28 text-base md:text-base"
        />
        <p id="ai-instructions-count" className="text-end text-xs text-muted-foreground">
          <Ltr>
            {ai.instructions.length}/{AI_INSTRUCTIONS_MAX_CHARS}
          </Ltr>
        </p>
        {/* Always in the DOM so the polite live region announces the change. */}
        <p role="status" aria-live="polite" className="text-sm font-medium">
          {ai.instructionsEdited ? builder.ai.instructionsEdited : ''}
        </p>
      </div>

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

      <TextWarningNote warning={textWarning} />

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
