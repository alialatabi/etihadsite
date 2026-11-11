import { Fragment } from 'react';
import { ArrowLeft, ArrowRight, Grid3x3, Layers, PackageCheck, Upload, type LucideIcon } from 'lucide-react';
import { builder } from '@/content/ar';
import { Builder } from '@/components/builder/Builder';
import { fillLtr } from '@/components/fill-ltr';
import { WhatsAppButton } from '@/components/WhatsAppButton';
import { whatsappLink } from '@/components/shell/whatsapp';
import { getSettings } from '@/lib/settings';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * Headline = the order journey (owner request). Colour rises with importance:
 * start (navy) → preview (logo purple) → quantity (lime, the money/discount colour) → receive (brand gradient, the goal).
 */
const FLOW_STYLE: { icon: LucideIcon; className: string }[] = [
  { icon: Upload, className: 'bg-primary text-primary-foreground' },
  { icon: Grid3x3, className: 'bg-[#8a2b8f] text-white' },
  { icon: Layers, className: 'bg-discount text-discount-foreground' },
  { icon: PackageCheck, className: 'bg-brand-gradient-cta text-white shadow-md ring-2 ring-brand/25' },
];

const flow = builder.hero.flow;

/** Desktop / tablet: one row, arrows pointing to the next step (left, RTL). */
function FlowRow() {
  return (
    <div aria-hidden className="hidden flex-wrap items-center gap-x-3 gap-y-3 text-xl font-bold leading-tight sm:flex md:text-2xl">
      {flow.map((label, i) => {
        const { icon: Icon, className } = FLOW_STYLE[i];
        return (
          <Fragment key={label}>
            {i > 0 && <ArrowLeft className="size-6 shrink-0 text-muted-foreground md:size-7" />}
            <span className={cn('inline-flex items-center gap-2 rounded-2xl px-4 py-2.5', className)}>
              <Icon className="size-6 shrink-0" />
              {label}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

function Tile({ i }: { i: number }) {
  const { icon: Icon, className } = FLOW_STYLE[i];
  return (
    <span className={cn('flex h-16 flex-col items-center justify-center gap-1 rounded-2xl px-2 text-center', className)}>
      <Icon className="size-5 shrink-0" />
      <span className="text-sm font-bold leading-tight">{flow[i]}</span>
    </span>
  );
}

/**
 * Mobile: 2 × 2 "snake". Row 1 runs right→left (1 → 2); a dashed cut-line curls round the
 * left edge down to step 3, and row 2 runs left→right (3 → 4).
 */
function FlowSnake() {
  return (
    <div aria-hidden className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-x-2 gap-y-5 sm:hidden">
      <Tile i={0} />
      <ArrowLeft className="size-5 text-muted-foreground" />
      <Tile i={1} />

      <Tile i={3} />
      <ArrowRight className="size-5 text-muted-foreground" />
      <Tile i={2} />

      {/* Curl from step 2 (end of row 1) down to step 3 (start of row 2), on the left edge. */}
      <svg viewBox="0 0 18 84" className="absolute -end-[18px] top-8 h-[84px] w-[18px] overflow-visible text-muted-foreground" fill="none">
        <path d="M18 1C2 1 1 12 1 42s1 41 17 41" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" strokeLinecap="round" />
        <path d="M12 77.5 18 83l-6 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export default async function HomePage() {
  const settings = await getSettings();
  const noDesignWa = whatsappLink(settings.whatsapp, builder.whatsappText.noDesign);
  return (
    <>
      <section className="mx-auto max-w-6xl px-4 pb-4 pt-6 md:pt-10">
        <div className="glass rounded-3xl p-5 md:p-8">
          <span className="inline-block rounded-full bg-brand/15 px-3 py-1 text-xs font-medium text-brand">{builder.hero.badge}</span>
          {/* One accessible heading; the two visual layouts below are decorative copies. */}
          <h1 className="sr-only">{flow.join(' ← ')}</h1>
          <div className="mt-4 font-heading">
            <FlowRow />
            <FlowSnake />
          </div>
          <p className="mt-4 max-w-2xl text-base text-muted-foreground md:text-lg">
            {fillLtr(builder.hero.subtitle, { shop: <span className="font-bold text-foreground">{settings.shopName}</span> })}
          </p>
          {noDesignWa && (
            <WhatsAppButton href={noDesignWa} className="mt-4 w-full sm:w-auto">
              {builder.noDesign.short}
            </WhatsAppButton>
          )}
        </div>
      </section>
      <Builder settings={settings} />
    </>
  );
}
