import { builder, common } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import { formatIqd } from '@/lib/pricing';
import { safeFormatCm, safeShapeLabel, safeCountLabel } from './safe';
import type { SummaryData } from './logic';

function Row({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-2 ${strong ? 'text-base font-bold' : 'text-sm'}`}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end">{children}</dd>
    </div>
  );
}

const money = (n: number) => (
  <>
    <Ltr>{formatIqd(n)}</Ltr> {common.units.iqd}
  </>
);

/** Read-only order summary; also used on the success page. */
export function SummaryCard({ summary, title = builder.summary.title }: { summary: SummaryData; title?: string }) {
  return (
    <section className="rounded-2xl border bg-card p-4">
      <h3 className="font-heading mb-1 text-base font-bold">{title}</h3>
      <dl className="divide-y">
        <Row label={builder.summary.shape}>{safeShapeLabel(summary.shape, summary.corners)}</Row>
        <Row label={builder.summary.size}>
          <Ltr>
            {safeFormatCm(summary.widthUm)} × {safeFormatCm(summary.heightUm)}
          </Ltr>{' '}
          {common.units.cm}
        </Row>
        <Row label={builder.summary.perSheet}>
          <Ltr>{safeCountLabel(summary.countPerSheet)}</Ltr>
        </Row>
        <Row label={builder.summary.sheets}>
          <Ltr>{summary.sheets}</Ltr>
        </Row>
        <Row label={builder.summary.totalStickers}>
          <Ltr>{safeCountLabel(summary.totalStickers)}</Ltr>
        </Row>
        <Row label={builder.summary.price}>{summary.offerPriceIqd == null ? builder.summary.priceUnset : money(summary.offerPriceIqd)}</Row>
        <Row label={builder.summary.delivery}>{money(summary.deliveryFeeIqd)}</Row>
        <Row label={builder.summary.total} strong>
          {summary.totalIqd == null ? builder.summary.priceUnset : money(summary.totalIqd)}
        </Row>
      </dl>
    </section>
  );
}
