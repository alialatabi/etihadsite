'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ImagePlus, LoaderCircle, Pencil, RefreshCw, Sparkles, TriangleAlert, X } from 'lucide-react';
import { builder, team } from '@/content/ar';
import { btnCls, ctaCls, fieldCls } from '@/components/collage';
import { Ltr } from '@/components/Ltr';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AiProgress } from '@/components/builder/ai/AiProgress';
import { REF_ACCEPT, aiBusy, canRetryAi, resultShown } from '@/components/builder/ai/ai-logic';
import { TextReview } from '@/components/builder/ai/TextReview';
import { useAiDesign } from '@/components/builder/ai/useAiDesign';
import { SizeInputs } from '@/components/builder/steps/SizeFields';
import { AI_IDEA_MAX_CHARS, AI_MAX_REFS } from '@/lib/ai/config';
import type { Corners, Shape, ShopSettings } from '@/lib/types';
import { cn } from '@/lib/utils';
import { TeamResult } from './TeamResult';
import { TeamShape } from './TeamShape';
import {
  TEAM_AI_ENDPOINTS,
  TEAM_SIZE_IDS,
  teamErrorText,
  teamFullSettings,
  teamHost,
  teamShapeTexts,
  teamSizeEdit,
  teamSizeState,
  type SizeTexts,
  type TeamSettings,
} from './team-logic';

function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-[2px] border border-brand-ink/30 bg-brand-tint p-4 text-sm text-brand-ink">
      <TriangleAlert className="size-5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">{children}</p>
    </div>
  );
}

/** The way back to the login page when the session ended. */
function SessionLink() {
  return (
    <Link href="/team/login" className="ms-2 font-medium underline decoration-2 underline-offset-4">
      {team.login.submit}
    </Link>
  );
}

/**
 * The staff designer: shape, size, idea and references, then the same text review, progress and result as the
 * customer's AI designer (the shared `useAiDesign` hook), against the staff routes. «تصميم جديد» keeps the shape and
 * size and starts the rest again (the session below is re-mounted, which also frees the image URLs).
 */
export function TeamDesigner({ settings, ready, remainingToday }: { settings: TeamSettings; ready: boolean; remainingToday: number | null }) {
  const [shape, setShape] = useState<Shape | null>(null);
  const [corners, setCorners] = useState<Corners>('rounded');
  const [texts, setTexts] = useState<SizeTexts>({ widthText: '', heightText: '' });
  const [session, setSession] = useState(0);
  const [seed, setSeed] = useState<number | null>(remainingToday);
  const full = useMemo(() => teamFullSettings(settings), [settings]);

  const onNewDesign = (rem: number | null) => {
    if (rem !== null) setSeed(rem);
    setSession((k) => k + 1);
  };

  return (
    <TeamSession
      key={session}
      settings={full}
      ready={ready}
      seed={seed}
      focusOnMount={session > 0}
      shape={shape}
      corners={corners}
      texts={texts}
      onShape={(s) => {
        setShape(s);
        setTexts((t) => teamShapeTexts(s, t));
      }}
      onCorners={setCorners}
      onWidth={(v) => setTexts((t) => teamSizeEdit(shape, 'width', v, t))}
      onHeight={(v) => setTexts((t) => teamSizeEdit(shape, 'height', v, t))}
      onNewDesign={onNewDesign}
    />
  );
}

function TeamSession({
  settings,
  ready,
  seed,
  focusOnMount,
  shape,
  corners,
  texts,
  onShape,
  onCorners,
  onWidth,
  onHeight,
  onNewDesign,
}: {
  settings: ShopSettings;
  ready: boolean;
  seed: number | null;
  /** True for every session after the first: «تصميم جديد» destroyed the focused button, so focus starts at the top of the form. */
  focusOnMount: boolean;
  shape: Shape | null;
  corners: Corners;
  texts: SizeTexts;
  onShape: (s: Shape) => void;
  onCorners: (c: Corners) => void;
  onWidth: (v: string) => void;
  onHeight: (v: string) => void;
  onNewDesign: (remaining: number | null) => void;
}) {
  const [idea, setIdea] = useState('');
  const sz = useMemo(
    () => teamSizeState(shape, corners, texts.widthText, texts.heightText, settings.layout),
    [shape, corners, texts.widthText, texts.heightText, settings.layout],
  );
  const host = useMemo(
    () => teamHost({ shape, corners, spec: sz.spec, sizeOk: sz.sizeOk, idea, setIdea, settings }),
    [shape, corners, sz.spec, sz.sizeOk, idea, settings],
  );
  const ai = useAiDesign(host, ready, TEAM_AI_ENDPOINTS);

  const refInput = useRef<HTMLInputElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const shapeHeading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  // «تصميم جديد» re-mounts this whole session, so the button that had focus is gone and focus would fall to <body>.
  // Put it on the first heading of the fresh form (announced by screen readers), but not on the first visit to the page.
  useEffect(() => {
    if (focusOnMount) shapeHeading.current?.focus();
  }, [focusOnMount]);

  // «جرّب مرة ثانية» can unmount the focused button when the phase changes, which would drop keyboard focus on
  // <body>. Put it on the results region then, but only when it really was lost and not on first paint (as AiResult does).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const active = document.activeElement;
    if (active === null || active === document.body) regionRef.current?.focus({ preventScroll: true });
  }, [ai.phase]);

  const busy = aiBusy(ai.phase, ai.briefing);
  const remaining = ai.remainingToday ?? seed;
  // The staff routes answer 401 'unauthorized' when the session ended; the shared error type does not list it.
  const unauthorized = (ai.error as string | undefined) === 'unauthorized';
  const canRetry = canRetryAi({ off: ai.off, remainingToday: remaining, phase: ai.phase, error: ai.error }) && !unauthorized;
  // Offered only while nothing runs, so a late answer never reaches an unmounted hook.
  const newDesign = () => {
    if (!busy) onNewDesign(ai.remainingToday);
  };

  const showSessionLink = unauthorized ? <SessionLink /> : null;
  const generating = ai.phase === 'generating';
  const errorBox =
    ai.phase === 'error' && ai.error ? (
      <ErrorBox>
        {teamErrorText(ai.error)}
        {showSessionLink}
      </ErrorBox>
    ) : null;

  return (
    <div className="space-y-6">
      <fieldset disabled={generating || ai.briefing} className="min-w-0 space-y-6">
        <section aria-labelledby="team-shape" className="paper-card space-y-3 p-4 sm:p-5">
          <h2 id="team-shape" ref={shapeHeading} tabIndex={-1} className="text-lg font-bold text-ink outline-none">
            {team.shape}
          </h2>
          <TeamShape shape={shape} onShape={onShape} corners={corners} onCorners={onCorners} />
        </section>

        {shape && (
          <section aria-labelledby="team-size" className="paper-card space-y-3 p-4 sm:p-5">
            <h2 id="team-size" className="text-lg font-bold text-ink">
              {team.size}
            </h2>
            <SizeInputs
              ids={TEAM_SIZE_IDS}
              isCircle={shape === 'circle'}
              widthText={texts.widthText}
              heightText={texts.heightText}
              onWidth={onWidth}
              onHeight={onHeight}
              invalid={!!sz.error}
            />
            <div id={TEAM_SIZE_IDS.msg} aria-live="polite">
              {sz.error && (
                <p role="alert" className="flex items-start gap-2 rounded-[2px] border border-brand-ink/30 bg-brand-tint p-3 text-sm text-brand-ink">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{sz.error}</span>
                </p>
              )}
            </div>
          </section>
        )}

        {ai.off ? (
          <p role="status" className="rounded-[2px] border border-ink/20 bg-news-light px-4 py-3 text-sm text-ink">
            {team.login.unavailable}
          </p>
        ) : (
          <section aria-labelledby="team-idea-label" className="paper-card space-y-4 p-4 sm:p-5">
            <div className="space-y-2">
              <Label id="team-idea-label" htmlFor="team-idea" className="text-lg font-bold text-ink">
                {builder.ai.ideaLabel}
              </Label>
              <p id="team-idea-hint" className={fieldCls.hint}>
                {builder.ai.ideaHint}
              </p>
              <Textarea
                id="team-idea"
                value={idea}
                maxLength={AI_IDEA_MAX_CHARS}
                onChange={(e) => ai.onIdeaChange(e.target.value)}
                aria-describedby="team-idea-hint team-idea-count"
                rows={4}
                className="min-h-28 rounded-[2px] border-input bg-white px-3 py-2 text-[16px] focus-visible:border-brand focus-visible:ring-brand/30 md:text-[16px]"
              />
              <p id="team-idea-count" className={cn(fieldCls.hint, 'text-end')}>
                <Ltr>
                  {idea.length}/{AI_IDEA_MAX_CHARS}
                </Ltr>
              </p>
            </div>

            <div className="space-y-2">
              <p id="team-refs-caption" className="text-sm font-medium text-ink">
                {builder.ai.refs}
              </p>
              <input
                ref={refInput}
                id="team-refs"
                type="file"
                multiple
                accept={REF_ACCEPT}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                aria-describedby="team-refs-caption"
                onChange={(e) => {
                  ai.addRefFiles(Array.from(e.target.files ?? []));
                  e.target.value = ''; // allow picking the same file again
                }}
              />
              <div className="flex flex-wrap items-center gap-3">
                {ai.refs.map((r) => (
                  <div key={r.key} className="relative size-20">
                    <div className="size-full overflow-hidden rounded-[2px] border border-line bg-news">
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
                      <span className="flex size-7 items-center justify-center rounded-[50%] border border-ink/30 bg-white text-ink shadow group-focus-visible:outline-solid group-focus-visible:outline-[3px] group-focus-visible:outline-offset-2 group-focus-visible:outline-ink">
                        <X className="size-4" aria-hidden />
                      </span>
                    </button>
                  </div>
                ))}
                {ai.refs.length < AI_MAX_REFS && (
                  <Button
                    type="button"
                    variant="outline"
                    aria-describedby="team-refs-caption"
                    className={cn(btnCls('outline'), 'h-20 min-w-20 flex-col gap-1 px-3')}
                    onClick={() => refInput.current?.click()}
                  >
                    <ImagePlus className="size-6" aria-hidden />
                    <span className="text-xs">{builder.ai.addRef}</span>
                  </Button>
                )}
              </div>
            </div>

            {ai.refRejected && (
              <p role="status" className="rounded-[2px] border border-ink/20 bg-news-light p-3 text-sm text-ink">
                {builder.ai.refRejected}
              </p>
            )}
          </section>
        )}
      </fieldset>

      {!ai.off && (
        <div className="space-y-4">
          {ai.phase === 'idle' && ai.error && (
            <p role="alert" className="flex items-start gap-2 rounded-[2px] border border-brand-ink/30 bg-brand-tint p-3 text-sm text-brand-ink">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {teamErrorText(ai.error)}
                {showSessionLink}
              </span>
            </p>
          )}

          {remaining === 0 && !(ai.phase === 'error' && ai.error === 'ip_limit') && (
            <p role="status" className="rounded-[2px] border border-ink/20 bg-news-light p-3 text-sm text-ink">
              {teamErrorText('ip_limit')}
            </p>
          )}

          {ai.phase !== 'reviewing' && !generating && (
            <>
              <Button
                type="button"
                disabled={ai.block !== null || remaining === 0}
                onClick={() => void ai.review()}
                className={ai.result && resultShown(ai.phase, true) ? btnCls('outline') : ctaCls('md')}
              >
                {ai.briefing ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <Sparkles className="size-5" aria-hidden />}
                {builder.ai.generate}
              </Button>
              {ai.briefing && <AiProgress kind="brief" startedAt={ai.busySince ?? undefined} />}
            </>
          )}

          {ai.phase === 'reviewing' && <TextReview ai={ai} />}
        </div>
      )}

      <div ref={regionRef} tabIndex={-1} aria-live="polite" className="space-y-4 outline-none">
        {generating ? (
          <div className="paper-card flex min-h-64 flex-col items-center justify-center gap-4 p-6 text-center">
            <LoaderCircle className="size-6 animate-spin text-brand" aria-hidden />
            <p className="text-base font-medium text-ink">{builder.ai.generating}</p>
            <AiProgress kind="image" startedAt={ai.busySince ?? undefined} />
          </div>
        ) : ai.result && resultShown(ai.phase, true) ? (
          <>
            {errorBox}
            <TeamResult ai={ai} remaining={remaining} canRetry={canRetry && !busy} onNewDesign={newDesign} />
          </>
        ) : ai.phase === 'error' && ai.error ? (
          <>
            {errorBox}
            <div className="flex flex-wrap items-center gap-3">
              {canRetry && (
                <Button type="button" variant="outline" className={btnCls('outline')} onClick={() => void ai.retry()}>
                  <RefreshCw className="size-4" aria-hidden />
                  {builder.ai.retry}
                </Button>
              )}
              <Button type="button" variant="outline" className={btnCls('outline')} onClick={ai.editIdea}>
                <Pencil className="size-4" aria-hidden />
                {builder.ai.editIdea}
              </Button>
              <Button type="button" variant="outline" className={btnCls('outline')} onClick={newDesign}>
                {team.newDesign}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
