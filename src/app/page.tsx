import { builder } from '@/content/ar';
import { Builder } from '@/components/builder/Builder';
import { StepNumber, StickerMark, Tape } from '@/components/collage';
import { fillLtr } from '@/components/fill-ltr';
import { aiReady } from '@/lib/ai/ready';
import { getSettings, toPublicSettings } from '@/lib/settings';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const flow = builder.hero.flow;

/**
 * Every step card is a link down to the order form, which opens on the shape choice (owner request:
 * customers kept tapping the steps). The list is an aria-hidden decorative copy of the sr-only <h1>, so the
 * cards are taken out of the tab order; keyboard and screen-reader users reach the form next anyway.
 */
const TO_SHAPE = '#builder';

/** Col-Story: three paper cards (the second on squared paper) and the goal on the one red scrap. */
const CARD = ['paper-card -rotate-[1.5deg]', 'paper-card grid-paper rotate-[1.5deg]', 'paper-card -rotate-1', 'scrap scrap-red rotate-2 py-4'];
const NUM = ['red', 'navy', 'red', 'navy'] as const;

export default async function HomePage() {
  const settings = await getSettings();
  return (
    <>
      <section className="relative isolate mx-auto max-w-6xl overflow-x-clip px-4 pb-4 pt-6 md:pt-10">
        <div aria-hidden className="pointer-events-none absolute -z-10 top-0 end-4 hidden h-36 w-72 md:block">
          <div className="news-lines torn4 absolute inset-0 bg-news -rotate-6" />
          <span className="halftone absolute -bottom-6 start-6 size-24 rounded-[50%] opacity-40" />
        </div>
        <div className="flex items-center justify-between gap-4">
          <Tape>{builder.hero.badge}</Tape>
          <StickerMark size={64} tilt={8} className="hidden sm:block" />
        </div>
        {/* One accessible heading; the step cards below are a decorative copy. */}
        <h1 className="sr-only">{flow.join(' ← ')}</h1>
        <ol aria-hidden className="mt-6 grid grid-cols-2 gap-x-3 gap-y-4 md:grid-cols-4 md:gap-5">
          {flow.map((label, i) => (
            <li key={label}>
              <a
                href={TO_SHAPE}
                tabIndex={-1}
                className={cn(
                  'anim-slap flex h-full min-h-16 items-center gap-3 px-3 py-3 transition-[rotate,translate] hover:-translate-y-0.5 hover:rotate-0 md:px-4',
                  CARD[i],
                )}
                style={{ animationDelay: `${i * 120}ms` }}
              >
                <StepNumber n={i + 1} tone={NUM[i]} size="md" />
                <span
                  className={
                    i === 3
                      ? 'font-lalezar text-xl font-normal leading-tight md:text-2xl'
                      : 'text-base font-bold leading-snug text-ink md:text-lg'
                  }
                >
                  {label}
                </span>
              </a>
            </li>
          ))}
        </ol>
        <p className="mt-6 max-w-2xl text-base text-ink-soft md:text-lg">
          {fillLtr(builder.hero.subtitle, { shop: <span className="font-bold text-foreground">{settings.shopName}</span> })}
        </p>
      </section>
      <Builder settings={toPublicSettings(settings)} aiReady={aiReady(settings)} />
    </>
  );
}
