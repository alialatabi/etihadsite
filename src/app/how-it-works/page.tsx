import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { common, fill, pages } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import { CtaLink } from '@/components/shell/CtaLink';
import { ScrapHeadline, SectionTitle, StepNumber, Tape } from '@/components/collage';
import { getSettings } from '@/lib/settings';
import { SHAPE_KEYS, resolveShapeSpacing, type ShapeKey, type ShapeSpacing } from '@/lib/layout/spacing';
import { count, countLabel } from '@/lib/plural';
import { enabledMaterials, formatIqd } from '@/lib/pricing';
import { A4_UM, umToMm, umToCm } from '@/lib/units';
import { computeExamples, discountRows, illustrationLayout, priceExample } from './examples';
import { fillLtr } from '@/components/fill-ltr';
import { cn } from '@/lib/utils';
import { SheetIllustration } from './SheetIllustration';

// ISR: prerendered, regenerated hourly and on an admin save (revalidatePath('/', 'layout') in admin/actions.ts); force-static makes cookies()/headers() read empty, so never read them here.
export const dynamic = 'force-static';
export const revalidate = 3600;

const t = pages.howItWorks;

export const metadata: Metadata = {
  title: t.title,
  description: pages.seo.howItWorksDescription,
  alternates: { canonical: '/how-it-works' },
};

/** The section title scrap + intro paragraph that open a section. */
function SectionIntro({ title, intro }: { title: string; intro: string }) {
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <p className="mt-4 text-ink-muted">{intro}</p>
    </div>
  );
}

/** One row of the A4 spec list. */
function SpecRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-bold">{children}</dd>
    </div>
  );
}

/** One card of the shape-rules grid. */
function RuleCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="paper-card p-5">
      <h3 className="font-bold text-ink">{title}</h3>
      <p className="mt-2 leading-7 text-ink-muted">{children}</p>
    </div>
  );
}

export default async function HowItWorksPage() {
  const settings = await getSettings();
  const lay = settings.layout;
  const examples = computeExamples(lay);
  const sheet = illustrationLayout(lay);
  const sheetLabel = sheet ? fill(t.illustrationAlt, { n: sheet.countPerSheet }) : '';

  // Every shape has its own margin and gaps. The margin stat shows one value when all shapes agree
  // and a min–max range otherwise; the usable area is the one of the illustration's shape (circle).
  const spacing = Object.fromEntries(SHAPE_KEYS.map((k) => [k, resolveShapeSpacing(lay, k)])) as Record<ShapeKey, ShapeSpacing>;
  const marginsMm = SHAPE_KEYS.map((k) => umToMm(spacing[k].marginUm));
  const minMarginMm = Math.min(...marginsMm);
  const maxMarginMm = Math.max(...marginsMm);
  const marginText = minMarginMm === maxMarginMm ? minMarginMm : `${minMarginMm}–${maxMarginMm}`;
  const illustrationMarginUm = spacing.circle.marginUm;
  const pageW = umToCm(A4_UM.widthUm);
  const pageH = umToCm(A4_UM.heightUm);
  const usableW = umToCm(A4_UM.widthUm - 2 * illustrationMarginUm);
  const usableH = umToCm(A4_UM.heightUm - 2 * illustrationMarginUm);

  /** "gap between columns" plus "gap between rows" sentence, for a shape whose two gaps differ. */
  const columnsAndRows = (sp: ShapeSpacing) => (
    <>
      {fillLtr(t.rules.circle.columns, { gapX: umToMm(sp.gapXUm) })}{' '}
      {sp.gapYUm === 0 ? t.rules.circle.rowsTouching : fillLtr(t.rules.circle.rowsGap, { gapY: umToMm(sp.gapYUm) })}
    </>
  );

  const exampleLabel = (e: (typeof examples)[number]) => {
    const key = e.key;
    return fillLtr(t.examples[key], { size: e.size ?? '', w: e.w ?? '', h: e.h ?? '' });
  };

  const pricing = settings.pricing;
  const mats = enabledMaterials(pricing);
  const rows = discountRows(pricing);
  const example = priceExample(settings);

  return (
    <div>
      {/* Hero */}
      <section className="relative isolate mx-auto max-w-6xl overflow-x-clip px-4 py-10 md:grid md:grid-cols-[1.2fr_1fr] md:items-center md:gap-8 md:py-14">
        <div aria-hidden className="pointer-events-none absolute -z-10 top-4 start-1/2 hidden h-32 w-64 md:block">
          <div className="news-lines torn4 absolute inset-0 bg-news rotate-3" />
        </div>
        <div>
          <Tape>{common.nav.howItWorks}</Tape>
          <ScrapHeadline as="h1" text={t.hero} size="xl" animate className="mt-5" />
          <p className="mt-6 max-w-xl leading-8 text-ink-soft md:text-lg">{t.heroSub}</p>
          <CtaLink href="/#builder" className="mt-8">
            {t.cta}
          </CtaLink>
        </div>
        {sheet ? (
          <div className="mx-auto mt-10 w-full max-w-[16rem] md:mt-0 md:max-w-xs">
            <div className="paper-card relative -rotate-2 p-3">
              <span aria-hidden className="tape-strip pointer-events-none absolute -top-3 start-6 h-6 w-20 -rotate-6" />
              <SheetIllustration layout={sheet} label={sheetLabel} className="h-auto w-full" />
            </div>
          </div>
        ) : null}
      </section>

      {/* Steps */}
      <section className="mx-auto max-w-6xl px-4 py-12">
        <SectionTitle>{t.stepsTitle}</SectionTitle>
        <ol className="mt-8 grid gap-5 md:grid-cols-3">
          {t.steps.map((s, i) => (
            <li key={s.title} className={cn('paper-card p-5', i % 2 === 1 ? 'grid-paper md:rotate-1' : 'md:-rotate-1')}>
              <StepNumber n={i + 1} tone={i % 2 ? 'navy' : 'red'} size="md" />
              <h3 className="mt-4 text-lg font-bold text-ink">{s.title}</h3>
              <p className="mt-2 leading-7 text-ink-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <div className="dashed-divider mx-auto max-w-6xl" aria-hidden />

      {/* A4 spec + illustration */}
      <section className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-2">
        <div>
          <SectionIntro title={t.specTitle} intro={t.specIntro} />
          <dl className="paper-card mt-6 divide-y divide-dashed divide-line">
            <SpecRow label={t.spec.size}>
              <Ltr>
                {pageW} × {pageH}
              </Ltr>{' '}
              {common.units.cm}
              <span className="ms-2 text-sm font-normal text-ink-muted">
                (<Ltr>{common.units.a4}</Ltr>)
              </span>
            </SpecRow>
            <SpecRow label={t.spec.margin}>
              <Ltr>{marginText}</Ltr> {common.units.mm}
            </SpecRow>
            <SpecRow label={t.spec.usable}>
              <Ltr>
                {usableW} × {usableH}
              </Ltr>{' '}
              {common.units.cm}
            </SpecRow>
          </dl>
          <p className="mt-3 text-sm leading-7 text-ink-muted">{t.specNote}</p>
          {sheet?.marks && <p className="mt-1 text-sm leading-7 text-ink-muted">{common.marksHint}</p>}
        </div>

        {sheet ? (
          <figure className="paper-card grid-paper p-5">
            <SheetIllustration
              layout={sheet}
              label={sheetLabel}
              className="mx-auto h-auto w-full max-w-[14rem]"
            />
            <figcaption className="mt-4 text-center text-sm text-ink-muted">
              <span className="font-medium text-ink">{t.illustrationTitle}</span>
              <br />
              {fillLtr(t.illustrationCaption, { size: umToCm(sheet.cell.widthUm), n: sheet.countPerSheet })}
            </figcaption>
          </figure>
        ) : null}
      </section>

      {/* Shape rules */}
      <section className="bg-news">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <SectionIntro title={t.rulesTitle} intro={t.rulesIntro} />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <RuleCard title={t.rules.circle.title}>{columnsAndRows(spacing.circle)}</RuleCard>
            <RuleCard title={t.rules.rounded.title}>
              {spacing.rounded.gapXUm === spacing.rounded.gapYUm
                ? fillLtr(t.rules.rounded.body, { gap: umToMm(spacing.rounded.gapXUm) })
                : columnsAndRows(spacing.rounded)}
            </RuleCard>
            <RuleCard title={t.rules.sharp.title}>
              {spacing.sharp.gapXUm !== spacing.sharp.gapYUm
                ? columnsAndRows(spacing.sharp)
                : // "No gap" copy only while the gap really is 0; otherwise the plain gap sentence.
                  fillLtr(spacing.sharp.gapXUm > 0 ? t.rules.rounded.body : t.rules.sharp.body, { gap: umToMm(spacing.sharp.gapXUm) })}
            </RuleCard>
            <RuleCard title={t.rules.custom.title}>
              {spacing.custom.gapXUm === spacing.custom.gapYUm
                ? fillLtr(t.rules.custom.body, { gap: umToMm(spacing.custom.gapXUm) })
                : (
                  <>
                    {columnsAndRows(spacing.custom)} {t.rules.custom.png}
                  </>
                )}
            </RuleCard>
          </div>
        </div>
      </section>

      {/* Live examples */}
      <section className="mx-auto max-w-3xl px-4 py-12">
        <SectionIntro title={t.examplesTitle} intro={t.examplesIntro} />
        <div className="paper-card mt-6 overflow-x-auto">
          <table className="w-full text-start">
            <thead className="bg-news text-sm text-ink-soft">
              <tr>
                <th scope="col" className="px-5 py-3 text-start font-medium">
                  {t.examplesHeaders.sticker}
                </th>
                <th scope="col" className="px-5 py-3 text-start font-medium">
                  {t.examplesHeaders.perSheet}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {examples.map((e) => (
                <tr key={e.key}>
                  <th scope="row" className="px-5 py-4 text-start font-medium">
                    {exampleLabel(e)}
                  </th>
                  <td className="px-5 py-4 font-bold">
                    {e.count === null ? t.exampleUnavailable : fill(t.perSheetLabel, { count: countLabel(e.count, common.plural.sticker) })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pricing */}
      <section className="mx-auto max-w-6xl px-4 pb-12">
        <SectionIntro title={t.pricingTitle} intro={t.pricingIntro} />
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {mats.map((m) => (
            <li key={m} className="paper-card p-5">
              <p className="text-xl font-bold text-ink">{common.materials[m]}</p>
              <p className="mt-2 text-ink-muted">
                {settings.pricesPublished ? (
                  <>
                    <Ltr className="font-lalezar text-xl font-normal text-ink">{formatIqd(pricing.materials[m].pricePerSheetIqd)}</Ltr>{' '}
                    {common.units.iqd} {t.perSheet}
                  </>
                ) : (
                  t.priceUnset
                )}
              </p>
            </li>
          ))}
        </ul>

        <div className="paper-card mt-6 overflow-x-auto sm:max-w-md">
          <table className="w-full text-start">
            <caption className="bg-news px-5 py-3 text-start text-sm font-medium text-ink-soft">{t.discountTitle}</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">{t.discountHeaders.sheets}</th>
                <th scope="col">{t.discountHeaders.discount}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.from}>
                  <th scope="row" className="px-5 py-3 text-start font-medium">
                    {r.to === null ? fillLtr(t.rangeFrom, { from: r.from }) : fillLtr(t.rangeTo, { from: r.from, to: r.to })}
                  </th>
                  <td className="px-5 py-3 font-bold">
                    {r.percent === 0 ? (
                      t.noDiscount
                    ) : (
                      <span className="inline-block rounded-[2px] bg-discount px-3 py-0.5 text-discount-foreground">
                        {fillLtr(t.percentOff, { percent: r.percent })}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="mt-4 space-y-1 text-sm text-ink-muted">
          <li>
            {t.minOrder} <Ltr>{pricing.minSheets}</Ltr> {count(pricing.minSheets, common.plural.sheet)}. {t.minOrderNote}
          </li>
          <li>
            {t.deliveryLabel}: <span className="font-bold text-ink">{fillLtr(t.deliveryValue, { fee: formatIqd(settings.deliveryFeeIqd) })}</span>
          </li>
          {example ? (
            <li>
              {t.exampleLabel}: <Ltr>{example.sheets}</Ltr> {count(example.sheets, common.plural.sheet)} {common.materials[example.material]} ={' '}
              <Ltr className="font-bold text-ink">{formatIqd(example.price)}</Ltr> {common.units.iqd} {t.exampleAnd}{' '}
              {t.exampleEquals}
            </li>
          ) : null}
        </ul>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-4">
        <div className="paper-card relative px-6 py-10 text-center md:py-14">
          <span aria-hidden className="tape-strip pointer-events-none absolute -top-3 start-8 h-6 w-20 -rotate-6" />
          <SectionTitle>{t.ctaTitle}</SectionTitle>
          <p className="mx-auto mt-5 max-w-md text-ink-muted">{t.ctaBody}</p>
          <CtaLink href="/#builder" className="mt-6">
            {t.cta}
          </CtaLink>
        </div>
      </section>
    </div>
  );
}
