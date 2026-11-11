import { builder, common } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import { Money } from '@/components/Money';
import { safeShapeLabel } from './safe';
import { CountLabel, SizeLabel } from './labels';
import type { SummaryData } from './logic';

function Row({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-2 ${strong ? 'text-base font-bold' : 'text-sm'}`}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end">{children}</dd>
    </div>
  );
}

/** Read-only order summary; also used on the success page. */
export function SummaryCard({ summary, title = builder.summary.title }: { summary: SummaryData; title?: string }) {
  return (
    <section className="rounded-2xl border bg-card p-4">
      <h3 className="font-heading mb-1 text-base font-bold">{title}</h3>
      <dl className="divide-y">
        <Row label={builder.summary.shape}>{safeShapeLabel(summary.shape, summary.corners)}</Row>
        <Row label={builder.summary.size}>
          <SizeLabel widthUm={summary.widthUm} heightUm={summary.heightUm} />
        </Row>
        <Row label={builder.summary.perSheet}>
          <CountLabel n={summary.countPerSheet} />
        </Row>
        {summary.material in common.materials && <Row label={builder.summary.material}>{common.materials[summary.material]}</Row>}
        {summary.requestedStickers != null && (
          <Row label={builder.summary.requestedStickers}>
            <CountLabel n={summary.requestedStickers} />
          </Row>
        )}
        <Row label={builder.summary.sheets}>
          <Ltr>{summary.sheets}</Ltr>
        </Row>
        <Row label={builder.summary.totalStickers}>
          <CountLabel n={summary.totalStickers} />
        </Row>
        <Row label={builder.summary.unitPrice}>{summary.unitPriceIqd == null ? builder.summary.priceUnset : <Money amount={summary.unitPriceIqd} />}</Row>
        {summary.discountPercent > 0 && (
          <Row label={builder.summary.discount}>
            <Ltr>{summary.discountPercent}%</Ltr>
          </Row>
        )}
        {summary.subtotalIqd != null && <Row label={builder.summary.subtotal}><Money amount={summary.subtotalIqd} /></Row>}
        <Row label={builder.summary.delivery}><Money amount={summary.deliveryFeeIqd} /></Row>
        <Row label={builder.summary.total} strong>
          {summary.totalIqd == null ? builder.summary.priceUnset : <Money amount={summary.totalIqd} />}
        </Row>
      </dl>
    </section>
  );
}
