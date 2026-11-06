import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { common, fill, pages } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import { getSettings } from '@/lib/settings';
import { countLabel } from '@/lib/plural';
import { formatIqd } from '@/lib/pricing';
import { A4_UM, umToMm, umToCm } from '@/lib/units';
import { computeExamples, illustrationLayout } from './examples';
import { fillLtr } from './fill-ltr';
import { SheetIllustration } from './SheetIllustration';

export const dynamic = 'force-dynamic';

const t = pages.howItWorks;

export function generateMetadata(): Metadata {
  return {
    title: t.title,
    description: pages.seo.howItWorksDescription,
    alternates: { canonical: '/how-it-works' },
  };
}

/** "54 ستيكر" — falls back if the plural module is not available yet. */
function stickerCount(n: number): string {
  try {
    return countLabel(n, common.plural.sticker);
  } catch {
    return `${n} ${common.plural.sticker.other}`;
  }
}

const CTA_CLASS =
  'inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-brand px-6 text-base font-bold text-brand-foreground transition-colors hover:bg-brand/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

export default async function HowItWorksPage() {
  const settings = await getSettings();
  const lay = settings.layout;
  const examples = computeExamples(lay);
  const sheet = illustrationLayout(lay);

  const mm = (um: number) => umToMm(um);
  const marginMm = mm(lay.marginUm);
  const pageW = umToCm(A4_UM.widthUm);
  const pageH = umToCm(A4_UM.heightUm);
  const usableW = umToCm(A4_UM.widthUm - 2 * lay.marginUm);
  const usableH = umToCm(A4_UM.heightUm - 2 * lay.marginUm);

  const exampleLabel = (e: (typeof examples)[number]) => {
    const key = e.key;
    return fillLtr(t.examples[key], { size: e.size ?? '', w: e.w ?? '', h: e.h ?? '' });
  };

  const offers = settings.offers.filter((o) => o.enabled);

  return (
    <div>
      {/* Hero */}
      <section className="border-b border-border/60 bg-primary text-primary-foreground">
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-12 md:grid-cols-[1.2fr_1fr] md:py-16">
          <div>
            <p className="mb-3 inline-block rounded-full bg-brand px-3 py-1 text-xs font-bold text-brand-foreground">{common.nav.howItWorks}</p>
            <h1 className="text-3xl font-bold leading-tight md:text-5xl">{t.hero}</h1>
            <p className="mt-4 max-w-xl text-base leading-8 text-primary-foreground/80 md:text-lg">{t.heroSub}</p>
            <Link href="/#builder" className={`${CTA_CLASS} mt-8`}>
              {t.cta}
              <ArrowLeft className="size-5" aria-hidden />
            </Link>
          </div>
          {sheet ? (
            <div className="mx-auto w-full max-w-[16rem] md:max-w-xs">
              <SheetIllustration
                layout={sheet}
                label={fill(t.illustrationAlt, { n: sheet.countPerSheet })}
                className="h-auto w-full -rotate-2 rounded-md shadow-2xl"
              />
            </div>
          ) : null}
        </div>
      </section>

      {/* Steps */}
      <section className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="text-2xl font-bold">{t.stepsTitle}</h2>
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
      </section>

      <div className="cut-line mx-auto h-px max-w-6xl text-border" aria-hidden />

      {/* A4 spec + illustration */}
      <section className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-2">
        <div>
          <h2 className="text-2xl font-bold">{t.specTitle}</h2>
          <p className="mt-2 text-muted-foreground">{t.specIntro}</p>
          <dl className="mt-5 divide-y divide-border rounded-2xl border border-border bg-card">
            <div className="flex items-center justify-between gap-4 px-5 py-4">
              <dt className="text-muted-foreground">{t.spec.size}</dt>
              <dd className="font-bold">
                <Ltr>
                  {pageW} × {pageH}
                </Ltr>{' '}
                {common.units.cm}
                <span className="ms-2 text-sm font-normal text-muted-foreground">
                  (<Ltr>{common.units.a4}</Ltr>)
                </span>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 px-5 py-4">
              <dt className="text-muted-foreground">{t.spec.margin}</dt>
              <dd className="font-bold">
                <Ltr>{marginMm}</Ltr> {common.units.mm}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 px-5 py-4">
              <dt className="text-muted-foreground">{t.spec.usable}</dt>
              <dd className="font-bold">
                <Ltr>
                  {usableW} × {usableH}
                </Ltr>{' '}
                {common.units.cm}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">{t.specNote}</p>
        </div>

        {sheet ? (
          <figure className="rounded-2xl border border-border bg-muted/50 p-5">
            <SheetIllustration
              layout={sheet}
              label={fill(t.illustrationAlt, { n: sheet.countPerSheet })}
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
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="font-bold">{t.rules.circle.title}</h3>
              <p className="mt-2 leading-7 text-muted-foreground">
                {fillLtr(t.rules.circle.columns, { gapX: mm(lay.circleGapXUm) })}{' '}
                {lay.circleGapYUm === 0
                  ? t.rules.circle.rowsTouching
                  : fillLtr(t.rules.circle.rowsGap, { gapY: mm(lay.circleGapYUm) })}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="font-bold">{t.rules.rounded.title}</h3>
              <p className="mt-2 leading-7 text-muted-foreground">{fillLtr(t.rules.rounded.body, { gap: mm(lay.rectRoundedGapUm) })}</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="font-bold">{t.rules.sharp.title}</h3>
              <p className="mt-2 leading-7 text-muted-foreground">{fillLtr(t.rules.sharp.body, { gap: mm(lay.rectSharpGapUm) })}</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="font-bold">{t.rules.custom.title}</h3>
              <p className="mt-2 leading-7 text-muted-foreground">{fillLtr(t.rules.custom.body, { gap: mm(lay.customGapUm) })}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Live examples */}
      <section className="mx-auto max-w-3xl px-4 py-12">
        <h2 className="text-2xl font-bold">{t.examplesTitle}</h2>
        <p className="mt-2 text-muted-foreground">{t.examplesIntro}</p>
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
                    {e.count === null ? t.exampleUnavailable : fill(t.perSheetLabel, { count: stickerCount(e.count) })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Offers */}
      <section className="mx-auto max-w-6xl px-4 pb-12">
        <h2 className="text-2xl font-bold">{t.offersTitle}</h2>
        <p className="mt-2 text-muted-foreground">{t.offersIntro}</p>
        <ul className="mt-6 grid gap-4 sm:grid-cols-3">
          {offers.map((o) => (
            <li key={o.id} className="rounded-2xl border border-border bg-card p-5">
              {o.badge ? <p className="mb-2 text-xs font-bold text-brand">{o.badge}</p> : null}
              <p className="text-xl font-bold">
                <Ltr>{o.sheets}</Ltr> {t.offerSheets}
              </p>
              <p className="mt-2 text-muted-foreground">
                {settings.pricesPublished && o.priceIqd !== null ? (
                  <>
                    <Ltr className="font-bold text-foreground">{formatIqd(o.priceIqd)}</Ltr> {common.units.iqd}
                  </>
                ) : (
                  t.priceUnset
                )}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted-foreground">
          {t.deliveryLabel}: <span className="font-bold text-foreground">{fillLtr(t.deliveryValue, { fee: formatIqd(settings.deliveryFeeIqd) })}</span>
        </p>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-4">
        <div className="rounded-3xl bg-primary px-6 py-10 text-center text-primary-foreground md:py-14">
          <h2 className="text-2xl font-bold md:text-3xl">{t.ctaTitle}</h2>
          <p className="mx-auto mt-3 max-w-md text-primary-foreground/80">{t.ctaBody}</p>
          <Link href="/#builder" className={`${CTA_CLASS} mt-6`}>
            {t.cta}
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
        </div>
      </section>
    </div>
  );
}
