import type { LayoutResult } from '@/lib/types';
import { umToMm } from '@/lib/units';

/**
 * Decorative A4 sheet drawn from a real LayoutResult (positions in µm → viewBox in mm).
 * Pure SVG, server-rendered. Circles use the layout's cell size, so the picture is
 * always consistent with the numbers on the page.
 */
export function SheetIllustration({ layout, label, className }: { layout: LayoutResult; label: string; className?: string }) {
  const mm = umToMm;
  const W = mm(layout.page.widthUm);
  const H = mm(layout.page.heightUm);
  const r = mm(layout.cell.widthUm) / 2;
  const m = mm(layout.marginUm);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className={className}>
      <rect x={0} y={0} width={W} height={H} rx={2} className="fill-card stroke-border" strokeWidth={0.6} />
      <rect
        x={m}
        y={m}
        width={W - 2 * m}
        height={H - 2 * m}
        fill="none"
        className="stroke-muted-foreground/40"
        strokeWidth={0.4}
        strokeDasharray="2 2"
      />
      {layout.marks?.centres.map((c, i) => (
        <circle key={`mark-${i}`} data-mark cx={mm(c.xUm)} cy={mm(c.yUm)} r={mm(layout.marks!.diameterUm) / 2} fill="#000" />
      ))}
      {layout.placements.map((p, i) => {
        // Alternate the three brand-adjacent tints so the sheet reads like printed stickers.
        const tone = i % 3 === 0 ? 'fill-brand' : i % 3 === 1 ? 'fill-primary' : 'fill-brand/40';
        return <circle key={i} cx={mm(p.xUm) + r} cy={mm(p.yUm) + r} r={r - 0.3} className={tone} />;
      })}
    </svg>
  );
}
