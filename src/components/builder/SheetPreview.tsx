import { useId } from 'react';
import { builder } from '@/content/ar';
import { A4_UM } from '@/lib/units';
import { CountLabel } from './labels';
import { cn } from '@/lib/utils';
import { placementRotated, placementSize } from '@/lib/layout';
import type { LayoutResult } from '@/lib/types';

interface Props {
  layout: LayoutResult | null;
  /** Object URL of the normalised artwork; null renders plain cells. */
  previewUrl: string | null;
  className?: string;
  /** Hide the count badge (the mobile strip renders its own). */
  hideBadge?: boolean;
}

/**
 * True-proportion A4 sheet in µm space. The artwork is declared ONCE in <defs>
 * (one <image>, one clipPath) and every cell is a cheap <use>, so hundreds of
 * stickers stay smooth on phones.
 */
export function SheetPreview({ layout, previewUrl, className, hideBadge }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const artId = `art-${uid}`;
  const clipId = `clip-${uid}`;

  return (
    <div className={cn('relative', className)}>
      <svg
        viewBox={`0 0 ${A4_UM.widthUm} ${A4_UM.heightUm}`}
        className="block h-auto w-full rounded-[2px] bg-white drop-shadow-[0_6px_18px_rgba(30,42,74,0.22)]"
        role="img"
        aria-label={builder.preview.sheet}
        preserveAspectRatio="xMidYMid meet"
      >
        <rect x={0} y={0} width={A4_UM.widthUm} height={A4_UM.heightUm} fill="#fff" />
        {layout && (
          <g>
            <rect
              x={layout.marginUm}
              y={layout.marginUm}
              width={A4_UM.widthUm - 2 * layout.marginUm}
              height={A4_UM.heightUm - 2 * layout.marginUm}
              fill="none"
              stroke="#94a3b8"
              strokeOpacity={0.55}
              strokeWidth={1}
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
            <Cells layout={layout} previewUrl={previewUrl} artId={artId} clipId={clipId} />
          </g>
        )}
        {!layout && (
          <rect
            x={A4_UM.widthUm * 0.05}
            y={A4_UM.heightUm * 0.05}
            width={A4_UM.widthUm * 0.9}
            height={A4_UM.heightUm * 0.9}
            fill="none"
            stroke="#94a3b8"
            strokeOpacity={0.5}
            strokeWidth={1}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {!layout && (
        <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
          {builder.preview.empty}
        </p>
      )}
      {layout && !hideBadge && (
        <span className="absolute bottom-2 start-2 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow">
          <CountLabel n={layout.countPerSheet} /> {builder.preview.perSheet}
        </span>
      )}
    </div>
  );
}

function Cells({ layout, previewUrl, artId, clipId }: { layout: LayoutResult; previewUrl: string | null; artId: string; clipId: string }) {
  const { rotated, cell, clip } = layout;
  // Sticker (unrotated) box; the cell is this box turned 90° when rotated.
  const sw = rotated ? cell.heightUm : cell.widthUm;
  const sh = rotated ? cell.widthUm : cell.heightUm;

  return (
    <>
      <defs>
        {clip.kind === 'circle' && (
          <clipPath id={clipId}>
            <ellipse cx={sw / 2} cy={sh / 2} rx={sw / 2} ry={sh / 2} />
          </clipPath>
        )}
        {clip.kind === 'roundedRect' && (
          <clipPath id={clipId}>
            <rect x={0} y={0} width={sw} height={sh} rx={clip.radiusUm} ry={clip.radiusUm} />
          </clipPath>
        )}
        <g id={artId}>
          {previewUrl ? (
            <image
              href={previewUrl}
              x={0}
              y={0}
              width={sw}
              height={sh}
              preserveAspectRatio="xMidYMid slice"
              clipPath={clip.kind === 'none' ? undefined : `url(#${clipId})`}
            />
          ) : (
            <rect width={sw} height={sh} fill="#e2e8f0" clipPath={clip.kind === 'none' ? undefined : `url(#${clipId})`} />
          )}
          {clip.kind === 'circle' ? (
            <ellipse cx={sw / 2} cy={sh / 2} rx={sw / 2} ry={sh / 2} {...OUTLINE} />
          ) : (
            <rect
              width={sw}
              height={sh}
              rx={clip.kind === 'roundedRect' ? clip.radiusUm : 0}
              ry={clip.kind === 'roundedRect' ? clip.radiusUm : 0}
              {...OUTLINE}
            />
          )}
        </g>
      </defs>
      {layout.placements.map((p, i) => {
        // Mixed layouts: a `turned` cell is the cell swapped, and its art flips orientation.
        const size = placementSize(layout, p);
        const transform = placementRotated(layout, p)
          ? `translate(${p.xUm + size.widthUm / 2} ${p.yUm + size.heightUm / 2}) rotate(90) translate(${-sw / 2} ${-sh / 2})`
          : `translate(${p.xUm} ${p.yUm})`;
        return <use key={i} href={`#${artId}`} transform={transform} />;
      })}
    </>
  );
}

const OUTLINE = {
  fill: 'none',
  stroke: '#1e2a4a',
  strokeOpacity: 0.25,
  strokeWidth: 1,
  vectorEffect: 'non-scaling-stroke',
} as const;

