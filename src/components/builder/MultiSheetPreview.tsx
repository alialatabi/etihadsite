import { memo, useId } from 'react';
import { builder } from '@/content/ar';
import { A4_UM } from '@/lib/units';
import { CountLabel } from './labels';
import { tagCls } from '@/components/collage';
import { cn } from '@/lib/utils';
import type { MultiLayoutDesign, MultiLayoutResult } from '@/lib/types';

interface Props {
  layout: MultiLayoutResult | null;
  /** Object URL of each design's artwork, by design index; null renders plain cells. Keep it referentially stable. */
  previewUrls: readonly (string | null)[];
  className?: string;
  /** Hide the count badge (the mobile strip renders its own). */
  hideBadge?: boolean;
  /** Text shown without a layout (default builder.preview.empty). */
  emptyText?: string;
}

/**
 * The A4 sheet of a multi-design order: every design's cells with its own artwork, cell size and clip, a cell that
 * the packer turned drawn turned 90° clockwise. Same technique as SheetPreview: each design's artwork is declared
 * ONCE in <defs> (one <image>, one clipPath) and every cell is a cheap <use>.
 */
export const MultiSheetPreview = memo(function MultiSheetPreview({ layout, previewUrls, className, hideBadge, emptyText }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');

  return (
    <div className={cn('relative', className)}>
      <svg
        viewBox={`0 0 ${A4_UM.widthUm} ${A4_UM.heightUm}`}
        className="block h-auto w-full bg-white shadow-paper"
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
            <Cells layout={layout} previewUrls={previewUrls} uid={uid} />
            {layout.marks &&
              layout.marks.centres.map((c, i) => (
                <circle key={`mark-${i}`} data-mark cx={c.xUm} cy={c.yUm} r={layout.marks!.diameterUm / 2} fill="#000" />
              ))}
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
          {emptyText ?? builder.preview.empty}
        </p>
      )}
      {layout && !hideBadge && (
        <span className={cn(tagCls('navy'), 'absolute bottom-2 start-2')}>
          <CountLabel n={layout.countPerSheet} /> {builder.preview.perSheet}
        </span>
      )}
    </div>
  );
});

const artId = (uid: string, i: number) => `art-${uid}-${i}`;
const clipId = (uid: string, i: number) => `clip-${uid}-${i}`;

function Cells({ layout, previewUrls, uid }: { layout: MultiLayoutResult; previewUrls: readonly (string | null)[]; uid: string }) {
  return (
    <>
      <defs>
        {layout.designs.map((d, i) => (
          <DesignDef key={i} design={d} url={previewUrls[i] ?? null} artId={artId(uid, i)} clipId={clipId(uid, i)} />
        ))}
      </defs>
      {layout.placements.map((p, i) => {
        const d = layout.designs[p.designIndex];
        if (!d) return null;
        const w = d.cell.widthUm;
        const h = d.cell.heightUm;
        // A turned cell is the design's cell with width and height swapped, its art turned 90° clockwise.
        const transform = p.turned
          ? `translate(${p.xUm + h / 2} ${p.yUm + w / 2}) rotate(90) translate(${-w / 2} ${-h / 2})`
          : `translate(${p.xUm} ${p.yUm})`;
        return <use key={i} href={`#${artId(uid, p.designIndex)}`} transform={transform} />;
      })}
    </>
  );
}

function DesignDef({ design, url, artId: aid, clipId: cid }: { design: MultiLayoutDesign; url: string | null; artId: string; clipId: string }) {
  const { clip } = design;
  const sw = design.cell.widthUm;
  const sh = design.cell.heightUm;
  const clipAttr = clip.kind === 'none' ? undefined : `url(#${cid})`;
  return (
    <>
      {clip.kind === 'circle' && (
        <clipPath id={cid}>
          <ellipse cx={sw / 2} cy={sh / 2} rx={sw / 2} ry={sh / 2} />
        </clipPath>
      )}
      {clip.kind === 'roundedRect' && (
        <clipPath id={cid}>
          <rect x={0} y={0} width={sw} height={sh} rx={clip.radiusUm} ry={clip.radiusUm} />
        </clipPath>
      )}
      <g id={aid}>
        {url ? (
          <image href={url} x={0} y={0} width={sw} height={sh} preserveAspectRatio="xMidYMid slice" clipPath={clipAttr} />
        ) : (
          <rect width={sw} height={sh} fill="#e2e8f0" clipPath={clipAttr} />
        )}
        {clip.kind === 'circle' ? (
          <ellipse cx={sw / 2} cy={sh / 2} rx={sw / 2} ry={sh / 2} {...OUTLINE} />
        ) : (
          <rect width={sw} height={sh} rx={clip.kind === 'roundedRect' ? clip.radiusUm : 0} ry={clip.kind === 'roundedRect' ? clip.radiusUm : 0} {...OUTLINE} />
        )}
      </g>
    </>
  );
}

const OUTLINE = {
  fill: 'none',
  stroke: '#121f34',
  strokeOpacity: 0.25,
  strokeWidth: 1,
  vectorEffect: 'non-scaling-stroke',
} as const;
