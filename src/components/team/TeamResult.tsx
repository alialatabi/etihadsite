'use client';

import { Download, RefreshCw } from 'lucide-react';
import { builder, team } from '@/content/ar';
import { btnCls, ctaCls } from '@/components/collage';
import { Button } from '@/components/ui/button';
import { fillLtr } from '@/components/fill-ltr';
import { count } from '@/lib/plural';
import { cn } from '@/lib/utils';
import type { AiDesignApi } from '@/components/builder/ai/useAiDesign';
import { teamPngName } from './team-logic';

const CHECKER = 'bg-[repeating-conic-gradient(#e2e8f0_0_25%,#fff_0_50%)] bg-[length:16px_16px]';

/** The design as it will be cut: on a checkerboard for a custom shape, clipped round for a circle (same look as the customer's result). */
function DesignImage({ src, custom, circle }: { src: string; custom: boolean; circle: boolean }) {
  return (
    <div className={cn('mx-auto flex aspect-square w-full max-w-sm items-center justify-center overflow-hidden rounded-[2px] bg-white p-3 shadow-paper', custom ? CHECKER : 'bg-white')}>
      {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL preview */}
      <img src={src} alt={builder.ai.resultAlt} className={cn('max-h-full max-w-full object-contain', circle && 'aspect-square rounded-full object-cover')} />
    </div>
  );
}

/** The result of the staff page: the preview, the printed lines, the tries left, and download / retry / new design. */
export function TeamResult({
  ai,
  remaining,
  canRetry,
  onNewDesign,
}: {
  ai: AiDesignApi;
  remaining: number | null;
  canRetry: boolean;
  onNewDesign: () => void;
}) {
  const result = ai.result;
  if (!result) return null;
  const { madeFor } = result;
  return (
    <div className="space-y-4">
      <DesignImage src={result.previewUrl} custom={madeFor.shape === 'custom'} circle={madeFor.shape === 'circle'} />
      {result.lines.length > 0 && (
        <p className="text-sm text-ink">
          <span className="font-medium">{builder.ai.printedText}</span>{' '}
          {result.lines.map((l, i) => (
            <span key={i}>
              {i > 0 && ' · '}
              <bdi>{l}</bdi>
            </span>
          ))}
        </p>
      )}
      {remaining !== null && (
        <p className="text-sm text-ink-muted">{fillLtr(builder.ai.remaining, { n: remaining, attempts: <>{count(remaining, builder.ai.attempts)}</> })}</p>
      )}
      <div className="flex flex-wrap gap-3">
        <a
          href={result.previewUrl}
          download={teamPngName(madeFor)}
          className={ctaCls('md')}
        >
          <Download className="size-5" aria-hidden />
          {team.download}
        </a>
        <Button type="button" variant="outline" className={btnCls('outline')} disabled={!canRetry} onClick={() => void ai.retry()}>
          <RefreshCw className="size-4" aria-hidden />
          {builder.ai.retry}
        </Button>
        <Button type="button" variant="outline" className={btnCls('outline')} onClick={onNewDesign}>
          {team.newDesign}
        </Button>
      </div>
    </div>
  );
}
