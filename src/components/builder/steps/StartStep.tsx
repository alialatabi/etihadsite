'use client';

import { useRef } from 'react';
import { Eye, ImagePlus, LoaderCircle, Sparkles, TriangleAlert, Upload, X } from 'lucide-react';
import { builder } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AI_IDEA_MAX_CHARS, AI_MAX_REFS } from '@/lib/ai/config';
import { REF_ACCEPT, aiErrorMessage, showViewResult } from '../ai/ai-logic';
import { TextReview } from '../ai/TextReview';
import type { AiDesignApi } from '../ai/useAiDesign';
import type { BuilderApi } from '../useBuilder';
import { ShapeStep } from './ShapeStep';
import { SizeFields } from './SizeFields';

/**
 * The first page (step id `shape`): shape → size → the idea and reference images → «ولّد التصميم» (text review first).
 * Under everything «عندي تصميم جاهز» leads to the upload step. Without the AI feature the idea part gives way to a
 * notice and the upload path stays: ordering never depends on it.
 */
export function StartStep({ b, ai }: { b: BuilderApi; ai: AiDesignApi }) {
  const refInput = useRef<HTMLInputElement>(null);
  const showBriefError = ai.phase === 'idle' && ai.error !== undefined && !ai.off;

  return (
    <div className="space-y-6">
      <section aria-labelledby="start-shape" className="space-y-3">
        <h3 id="start-shape" className="text-lg font-bold">
          {builder.shape.title}
        </h3>
        <ShapeStep b={b} />
      </section>

      {b.shape && (
        <section aria-labelledby="start-size" className="space-y-3">
          <h3 id="start-size" className="text-lg font-bold">
            {builder.size.title}
          </h3>
          <SizeFields b={b} />
          {ai.block === 'aspect' && !ai.off && (
            <p role="status" className="rounded-xl border border-brand/50 bg-brand/10 p-3 text-sm">
              {builder.ai.aspect}
            </p>
          )}
        </section>
      )}

      {ai.off ? (
        <p role="status" className="rounded-xl bg-muted px-4 py-3 text-sm">
          {builder.ai.unavailable}
        </p>
      ) : (
        <section aria-labelledby="start-idea" className="space-y-4">
          <div className="space-y-2">
            <Label id="start-idea" htmlFor="ai-idea" className="text-lg font-bold">
              {builder.ai.ideaLabel}
            </Label>
            <p id="ai-idea-hint" className="text-sm text-muted-foreground">
              {builder.ai.ideaHint}
            </p>
            <Textarea
              id="ai-idea"
              value={b.idea}
              maxLength={AI_IDEA_MAX_CHARS}
              onChange={(e) => ai.onIdeaChange(e.target.value)}
              aria-describedby="ai-idea-hint ai-idea-count"
              rows={4}
              className="min-h-28 text-base md:text-base"
            />
            <p id="ai-idea-count" className="text-end text-xs text-muted-foreground">
              <Ltr>
                {b.idea.length}/{AI_IDEA_MAX_CHARS}
              </Ltr>
            </p>
          </div>

          <div className="space-y-2">
            <p id="ai-refs-caption" className="text-sm font-medium">
              {builder.ai.refs}
            </p>
            <input
              ref={refInput}
              id="ai-refs"
              type="file"
              multiple
              accept={REF_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              aria-describedby="ai-refs-caption"
              onChange={(e) => {
                ai.addRefFiles(Array.from(e.target.files ?? []));
                e.target.value = ''; // allow picking the same file again
              }}
            />
            <div className="flex flex-wrap items-center gap-3">
              {ai.refs.map((r) => (
                <div key={r.key} className="relative size-20">
                  <div className="size-full overflow-hidden rounded-xl border bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL preview */}
                    <img src={r.previewUrl} alt="" className="size-full object-cover" />
                  </div>
                  {/* 44 px hit area around a small visible circle at the corner. */}
                  <button
                    type="button"
                    aria-label={builder.ai.removeRef}
                    onClick={() => ai.removeRef(r.key)}
                    className="group absolute -end-3 -top-3 flex size-11 items-center justify-center rounded-full outline-none"
                  >
                    <span className="flex size-7 items-center justify-center rounded-full border bg-background text-foreground shadow group-focus-visible:ring-3 group-focus-visible:ring-ring/50">
                      <X className="size-4" aria-hidden />
                    </span>
                  </button>
                </div>
              ))}
              {ai.refs.length < AI_MAX_REFS && (
                <Button
                  type="button"
                  variant="outline"
                  aria-describedby="ai-refs-caption"
                  className="h-20 min-w-20 flex-col gap-1 px-3"
                  onClick={() => refInput.current?.click()}
                >
                  <ImagePlus className="size-6" aria-hidden />
                  <span className="text-xs">{builder.ai.addRef}</span>
                </Button>
              )}
            </div>
          </div>

          {ai.refRejected && (
            <p role="status" className="rounded-xl border border-brand/50 bg-brand/10 p-3 text-sm">
              {builder.ai.refRejected}
            </p>
          )}

          {showBriefError && (
            <p role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{aiErrorMessage(ai.error!)}</span>
            </p>
          )}

          {ai.phase !== 'reviewing' && (
            <Button
              type="button"
              disabled={ai.block !== null}
              onClick={() => void ai.review()}
              className="h-12 w-full bg-brand px-6 text-base font-bold text-brand-foreground hover:bg-brand/90 sm:w-auto"
            >
              {ai.briefing ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <Sparkles className="size-5" aria-hidden />}
              {builder.ai.generate}
            </Button>
          )}

          {ai.phase === 'reviewing' && <TextReview ai={ai} />}

          {showViewResult(ai.phase) && (
            <Button type="button" variant="outline" onClick={b.showDesignStep} className="h-12 w-full px-5 text-base sm:w-auto">
              <Eye className="size-5" aria-hidden />
              {builder.ai.viewResult}
            </Button>
          )}
        </section>
      )}

      <Button type="button" variant="outline" disabled={!b.shape} onClick={b.chooseUpload} className="mt-2 h-12 w-full px-5 text-base sm:w-auto">
        <Upload className="size-5" aria-hidden />
        {builder.ai.readyDesign}
      </Button>
    </div>
  );
}
