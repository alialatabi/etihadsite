'use client';

import { useRef } from 'react';
import { Eye, ImagePlus, LoaderCircle, Sparkles, TriangleAlert, Upload, X } from 'lucide-react';
import { builder } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import { ctaCls } from '@/components/collage';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AI_IDEA_MAX_CHARS, AI_MAX_REFS } from '@/lib/ai/config';
import { AiProgress } from '../ai/AiProgress';
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
        <h3 id="start-shape" className="text-lg font-bold text-ink">
          {builder.shape.title}
        </h3>
        <ShapeStep b={b} />
      </section>

      {b.shape && (
        <section aria-labelledby="start-size" className="space-y-3">
          <h3 id="start-size" className="text-lg font-bold text-ink">
            {builder.size.title}
          </h3>
          <SizeFields b={b} />
          {ai.block === 'aspect' && !ai.off && (
            <p role="status" className="rounded-[2px] border border-brand-ink/30 bg-brand-tint p-3 text-sm text-ink">
              {builder.ai.aspect}
            </p>
          )}
        </section>
      )}

      {ai.off ? (
        <p role="status" className="rounded-[2px] bg-news px-4 py-3 text-sm text-ink-soft">
          {builder.ai.unavailable}
        </p>
      ) : (
        <section aria-labelledby="start-idea" className="space-y-4">
          <div className="space-y-2">
            <Label id="start-idea" htmlFor="ai-idea" className="text-lg font-bold text-ink">
              {builder.ai.ideaLabel}
            </Label>
            <p id="ai-idea-hint" className="text-sm text-ink-muted">
              {builder.ai.ideaHint}
            </p>
            <Textarea
              id="ai-idea"
              value={b.idea}
              maxLength={AI_IDEA_MAX_CHARS}
              onChange={(e) => ai.onIdeaChange(e.target.value)}
              aria-describedby="ai-idea-hint ai-idea-count"
              rows={4}
              className="min-h-28 rounded-[2px] border-input bg-white text-base md:text-base"
            />
            <p id="ai-idea-count" className="text-end text-xs text-ink-muted">
              <Ltr>
                {b.idea.length}/{AI_IDEA_MAX_CHARS}
              </Ltr>
            </p>
          </div>

          <div className="space-y-2">
            <p id="ai-refs-caption" className="text-sm font-medium text-ink">
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
                  <div className="size-full overflow-hidden rounded-[2px] border border-ink/20 bg-news">
                    {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL preview */}
                    <img src={r.previewUrl} alt="" className="size-full object-cover" />
                  </div>
                  {/* 44 px hit area around a small visible circle at the corner. */}
                  <button
                    type="button"
                    aria-label={builder.ai.removeRef}
                    onClick={() => ai.removeRef(r.key)}
                    className="group absolute -end-3 -top-3 flex size-11 items-center justify-center rounded-[50%] outline-none"
                  >
                    <span className="flex size-7 items-center justify-center rounded-[50%] border border-ink/30 bg-white text-ink shadow-paper group-focus-visible:outline-solid group-focus-visible:outline-[3px] group-focus-visible:outline-offset-2 group-focus-visible:outline-ink">
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
                  className="h-20 min-w-20 flex-col gap-1 rounded-[2px] border-ink/30 bg-white px-3 text-ink hover:bg-news"
                  onClick={() => refInput.current?.click()}
                >
                  <ImagePlus className="size-6" aria-hidden />
                  <span className="text-xs">{builder.ai.addRef}</span>
                </Button>
              )}
            </div>
          </div>

          {ai.refRejected && (
            <p role="status" className="rounded-[2px] border border-brand-ink/30 bg-brand-tint p-3 text-sm text-ink">
              {builder.ai.refRejected}
            </p>
          )}

          {showBriefError && (
            <p role="alert" className="flex items-start gap-2 rounded-[2px] border border-brand-ink/30 bg-brand-tint p-3 text-sm text-brand-ink">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{aiErrorMessage(ai.error!)}</span>
            </p>
          )}

          {ai.phase !== 'reviewing' && (
            <>
              <Button
                type="button"
                disabled={ai.block !== null}
                onClick={() => void ai.review()}
                className={`${ctaCls('md')} w-full sm:w-auto`}
              >
                {ai.briefing ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <Sparkles className="size-5" aria-hidden />}
                {builder.ai.generate}
              </Button>
              {ai.briefing && <AiProgress kind="brief" startedAt={ai.busySince ?? undefined} />}
            </>
          )}

          {ai.phase === 'reviewing' && <TextReview ai={ai} />}
        </section>
      )}

      {/* The kept (paid) result stays reachable, also when the site cannot design any more today. */}
      {showViewResult(ai.phase, ai.result !== undefined) && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            b.startAi(); // after «عندي تصميم جاهز» the design step would show the upload instead
            b.showDesignStep();
          }}
          className="h-12 w-full rounded-[2px] border-ink/30 bg-white px-5 text-base text-ink hover:bg-news sm:w-auto"
        >
          <Eye className="size-5" aria-hidden />
          {builder.ai.viewResult}
        </Button>
      )}

      <Button type="button" variant="outline" disabled={!b.shape} onClick={b.chooseUpload} className="mt-2 h-12 w-full rounded-[2px] border-ink/30 bg-white px-5 text-base text-ink hover:bg-news sm:w-auto">
        <Upload className="size-5" aria-hidden />
        {builder.ai.readyDesign}
      </Button>
    </div>
  );
}
