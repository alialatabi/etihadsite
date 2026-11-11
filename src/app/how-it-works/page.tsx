import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { builder, common, fill, pages } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import { CtaLink } from '@/components/shell/CtaLink';
import { WhatsAppCard } from '@/components/WhatsAppButton';
import { whatsappLink } from '@/components/shell/whatsapp';
import { getSettings } from '@/lib/settings';
import { count, countLabel } from '@/lib/plural';
import { enabledMaterials, formatIqd } from '@/lib/pricing';
import { A4_UM, umToMm, umToCm } from '@/lib/units';
import { computeExamples, discountRows, illustrationLayout, priceExample } from './examples';
import { fillLtr } from '@/components/fill-ltr';
import { SheetIllustration } from './SheetIllustration';

export const dynamic = 'force-dynamic';

const t = pages.howItWorks;

export const metadata: Metadata = {
  title: t.title,
  description: pages.seo.howItWorksDescription,
  alternates: { canonical: '/how-it-works' },
};

/** The glass title + intro block that opens a section. */
function SectionIntro({ title, intro }: { title: string; intro: string }) {
  return (
    <div className="glass rounded-2xl px-5 py-4">
      <h2 className="text-2xl font-bold">{title}</h2>
      <p className="mt-2 text-muted-foreground">{intro}</p>
    </div>
  );
}

/** One row of the A4 spec list. */
function SpecRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-bold">{children}</dd>
    </div>
  );
}

/** One card of the shape-rules grid. */
function RuleCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h3 className="font-bold">{title}</h3>
      <p className="mt-2 leading-7 text-muted-foreground">{children}</p>
    </div>
  );
}

export default async function HowItWorksPage() {
  const settings = await getSettings();
  const noDesignWa = whatsappLink(settings.whatsapp, builder.whatsappText.noDesign);
  const lay = settings.layout;
  const examples = computeExamples(lay);
  const sheet = illustrationLayout(lay);
  const sheetLabel = sheet ? fill(t.illustrationAlt, { n: sheet.countPerSheet }) : '';

  const marginMm = umToMm(lay.marginUm);
  const pageW = umToCm(A4_UM.widthUm);
  const pageH = umToCm(A4_UM.heightUm);
  const usableW = umToCm(A4_UM.widthUm - 2 * lay.marginUm);
  const usableH = umToCm(A4_UM.heightUm - 2 * lay.marginUm);

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
      <section className="border-b border-border/60 bg-primary text-primary-foreground">
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-12 md:grid-cols-[1.2fr_1fr] md:py-16">
          <div>
            <p className="mb-3 inline-block rounded-full bg-brand px-3 py-1 text-xs font-bold text-brand-foreground">{common.nav.howItWorks}</p>
            <h1 className="text-3xl font-bold leading-tight md:text-5xl">{t.hero}</h1>
            <p className="mt-4 max-w-xl text-base leading-8 text-primary-foreground/80 md:text-lg">{t.heroSub}</p>
            <CtaLink href="/#builder" className="text-base mt-8">
              {t.cta}
            </CtaLink>
          </div>
          {sheet ? (
            <div className="mx-auto w-full max-w-[16rem] md:max-w-xs">
              <SheetIllustration
                layout={sheet}
                label={sheetLabel}
                className="h-auto w-full -rotate-2 rounded-md shadow-2xl"
              />
            </div>
          ) : null}
        </div>
      </section>

      {/* Steps */}
      <section className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="glass w-fit max-w-full rounded-2xl px-5 py-3 text-2xl font-bold">{t.stepsTitle}</h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {t.steps.map((s, i) => (
            <li key={s.title} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <span className="flex size-10 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
                <Ltr>{i + 1}</Ltr>
              </span>
              <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
              <p className="mt-2 leading-7 text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
        {noDesignWa && (
          <WhatsAppCard href={noDesignWa} title={t.noDesignTitle} hint={t.noDesignBody} cta={builder.noDesign.cta} className="mt-6 md:max-w-xl" />
        )}
      </section>

      <div className="cut-line mx-auto h-px max-w-6xl text-border" aria-hidden />

      {/* A4 spec + illustration */}
      <section className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-2">
        <div>
          <SectionIntro title={t.specTitle} intro={t.specIntro} />
          <dl className="mt-5 divide-y divide-border rounded-2xl border border-border bg-card">
            <SpecRow label={t.spec.size}>
              <Ltr>
                {pageW} × {pageH}
              </Ltr>{' '}
              {common.units.cm}
              <span className="ms-2 text-sm font-normal text-muted-foreground">
                (<Ltr>{common.units.a4}</Ltr>)
              </span>
            </SpecRow>
            <SpecRow label={t.spec.margin}>
              <Ltr>{marginMm}</Ltr> {common.units.mm}
            </SpecRow>
            <SpecRow label={t.spec.usable}>
              <Ltr>
                {usableW} × {usableH}
              </Ltr>{' '}
              {common.units.cm}
            </SpecRow>
          </dl>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">{t.specNote}</p>
          {sheet?.marks && <p className="mt-1 text-sm leading-7 text-muted-foreground">{common.marksHint}</p>}
        </div>

        {sheet ? (
          <figure className="rounded-2xl border border-border bg-muted/50 p-5">
            <SheetIllustration
              layout={sheet}
              label={sheetLabel}
              className="mx-auto h-auto w-full max-w-[14rem]"
            />
            <figcaption className="mt-4 text-center text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{t.illustrationTitle}</span>
              <br />
              {fillLtr(t.illustrationCaption, { size: umToCm(sheet.cell.widthUm), n: sheet.countPerSheet })}
            </figcaption>
          </figure>
        ) : null}
      </section>

      {/* Shape rules */}
      <section className="border-y border-border/60 bg-muted/40">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <h2 className="text-2xl font-bold">{t.rulesTitle}</h2>
          <p className="mt-2 text-muted-foreground">{t.rulesIntro}</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <RuleCard title={t.rules.circle.title}>
              {fillLtr(t.rules.circle.columns, { gapX: umToMm(lay.circleGapXUm) })}{' '}
              {lay.circleGapYUm === 0
                ? t.rules.circle.rowsTouching
                : fillLtr(t.rules.circle.rowsGap, { gapY: umToMm(lay.circleGapYUm) })}
            </RuleCard>
            <RuleCard title={t.rules.rounded.title}>{fillLtr(t.rules.rounded.body, { gap: umToMm(lay.rectRoundedGapUm) })}</RuleCard>
            <RuleCard title={t.rules.sharp.title}>{fillLtr(t.rules.sharp.body, { gap: umToMm(lay.rectSharpGapUm) })}</RuleCard>
            <RuleCard title={t.rules.custom.title}>{fillLtr(t.rules.custom.body, { gap: umToMm(lay.customGapUm) })}</RuleCard>
          </div>
        </div>
      </section>

      {/* Live examples */}
      <section className="mx-auto max-w-3xl px-4 py-12">
        <SectionIntro title={t.examplesTitle} intro={t.examplesIntro} />
        <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-start">
            <thead className="bg-muted/60 text-sm text-muted-foreground">
              <tr>
                <th scope="col" className="px-5 py-3 text-start font-medium">
                  {t.examplesHeaders.sticker}
                </th>
                <th scope="col" className="px-5 py-3 text-start font-medium">
                  {t.examplesHeaders.perSheet}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
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
            <li key={m} className="rounded-2xl border border-border bg-card p-5">
              <p className="text-xl font-bold">{common.materials[m]}</p>
              <p className="mt-2 text-muted-foreground">
                {settings.pricesPublished ? (
                  <>
                    <Ltr className="font-bold text-foreground">{formatIqd(pricing.materials[m].pricePerSheetIqd)}</Ltr>{' '}
                    {common.units.iqd} {t.perSheet}
                  </>
                ) : (
                  t.priceUnset
                )}
              </p>
            </li>
          ))}
        </ul>

        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card sm:max-w-md">
          <table className="w-full text-start">
            <caption className="bg-muted/60 px-5 py-3 text-start text-sm font-medium text-muted-foreground">{t.discountTitle}</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">{t.discountHeaders.sheets}</th>
                <th scope="col">{t.discountHeaders.discount}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.from}>
                  <th scope="row" className="px-5 py-3 text-start font-medium">
                    {r.to === null ? fillLtr(t.rangeFrom, { from: r.from }) : fillLtr(t.rangeTo, { from: r.from, to: r.to })}
                  </th>
                  <td className="px-5 py-3 font-bold">
                    {r.percent === 0 ? (
                      t.noDiscount
                    ) : (
                      <span className="inline-block rounded-full bg-discount px-3 py-0.5 text-discount-foreground">
                        {fillLtr(t.percentOff, { percent: r.percent })}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
          <li>
            {t.minOrder} <Ltr>{pricing.minSheets}</Ltr> {count(pricing.minSheets, common.plural.sheet)}. {t.minOrderNote}
          </li>
          <li>
            {t.deliveryLabel}: <span className="font-bold text-foreground">{fillLtr(t.deliveryValue, { fee: formatIqd(settings.deliveryFeeIqd) })}</span>
          </li>
          {example ? (
            <li>
              {t.exampleLabel}: <Ltr>{example.sheets}</Ltr> {count(example.sheets, common.plural.sheet)} {common.materials[example.material]} ={' '}
              <Ltr className="font-bold text-foreground">{formatIqd(example.price)}</Ltr> {common.units.iqd} {t.exampleAnd}{' '}
              {t.exampleEquals}
            </li>
          ) : null}
        </ul>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-4">
        <div className="rounded-3xl bg-primary px-6 py-10 text-center text-primary-foreground md:py-14">
          <h2 className="text-2xl font-bold md:text-3xl">{t.ctaTitle}</h2>
          <p className="mx-auto mt-3 max-w-md text-primary-foreground/80">{t.ctaBody}</p>
          <CtaLink href="/#builder" className="text-base mt-6">
            {t.cta}
          </CtaLink>
        </div>
      </section>
    </div>
  );
}
