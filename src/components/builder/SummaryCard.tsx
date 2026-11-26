import { builder, common, fill } from '@/content/ar';
import { MarkerCircle, PaperCard } from '@/components/collage';
import { Ltr } from '@/components/Ltr';
import { Money } from '@/components/Money';
import { safeShapeLabel } from './safe';
import { CountLabel, SizeLabel } from './labels';
import type { SummaryData } from './logic';

function Row({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-2 ${strong ? 'text-base font-bold' : 'text-sm'}`}>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-end">{children}</dd>
    </div>
  );
}

/** The final total: Lalezar, with the red marker loop round it. */
function TotalAmount({ children }: { children: React.ReactNode }) {
  return (
    <MarkerCircle>
      <span className="font-lalezar text-xl font-normal whitespace-nowrap sm:text-2xl">{children}</span>
    </MarkerCircle>
  );
}

/** Read-only order summary; also used on the success page. */
export function SummaryCard({ summary, title = builder.summary.title }: { summary: SummaryData; title?: string }) {
  return (
    <PaperCard as="section" tape="end" className="p-4">
      <h3 className="mb-1 text-base font-bold text-ink">{title}</h3>
      <dl className="divide-y divide-dashed divide-line">
        <Row label={builder.summary.shape}>{safeShapeLabel(summary.shape, summary.corners)}</Row>
        {summary.designs && summary.designs.length > 0 ? (
          // A multi-design order: one line per design with its own size.
          summary.designs.map((d, i) => (
            <Row key={i} label={fill(builder.multi.designN, { n: i + 1 })}>
              <SizeLabel widthUm={d.widthUm} heightUm={d.heightUm} />
            </Row>
          ))
        ) : (
          <Row label={builder.summary.size}>
            <SizeLabel widthUm={summary.widthUm} heightUm={summary.heightUm} />
          </Row>
        )}
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
        {summary.designs && summary.perDesign != null && (
          <Row label={builder.multi.perDesign}>
            <CountLabel n={summary.sheets * summary.perDesign} />
          </Row>
        )}
        <Row label={builder.summary.unitPrice}>{summary.unitPriceIqd == null ? builder.summary.priceUnset : <Money amount={summary.unitPriceIqd} />}</Row>
        {summary.discountPercent > 0 && (
          <Row label={builder.summary.discount}>
            <Ltr>{summary.discountPercent}%</Ltr>
          </Row>
        )}
        {summary.subtotalIqd != null && <Row label={builder.summary.subtotal}><Money amount={summary.subtotalIqd} /></Row>}
        <Row label={builder.summary.delivery}><Money amount={summary.deliveryFeeIqd} /></Row>
        {summary.totalBeforeDiscountIqd != null && summary.totalIqd != null ? (
          <>
            <Row label={builder.summary.totalBefore}>
              <span className="text-ink-muted line-through"><Money amount={summary.totalBeforeDiscountIqd} /></span>
            </Row>
            <Row label={builder.summary.totalAfter} strong>
              <TotalAmount>
                <Money amount={summary.totalIqd} />
              </TotalAmount>
            </Row>
          </>
        ) : (
          <Row label={builder.summary.total} strong>
            {summary.totalIqd == null ? (
              builder.summary.priceUnset
            ) : (
              <TotalAmount>
                <Money amount={summary.totalIqd} />
              </TotalAmount>
            )}
          </Row>
        )}
      </dl>
    </PaperCard>
  );
}
