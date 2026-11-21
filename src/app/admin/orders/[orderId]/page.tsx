import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, Check, Download, MessageCircle, Phone } from 'lucide-react';
import { SheetPdfPreview } from '@/components/admin/SheetPdfPreview';
import { AdminPageHeader, Panel, Pill, StatusPill, btn, type PillTone } from '@/components/admin/kit';
import { Ltr } from '@/components/Ltr';
import { Money } from '@/components/Money';
import { admin, common, fill } from '@/content/ar';
import { requireAdmin } from '@/lib/auth/guard';
import { shapeLabel, sizeLabel } from '@/lib/order-text';
import { whatsappUrl } from '@/lib/parse/phone';
import { getSettings } from '@/lib/settings';
import { getStorage } from '@/lib/storage';
import { ID_RE } from '@/lib/storage/paths';
import type { OrderRecord } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatBaghdad, isPdfPurged, orderPriceView, telegramLabel } from '../../_lib';
import { StatusForm } from './StatusForm';

export const dynamic = 'force-dynamic';

/** Telegram delivery state -> pill tone (sent is ok, failed warns, skipped is neutral). */
const telegramTone: Record<OrderRecord['notified']['telegram'], PillTone> = {
  sent: 'ok',
  failed: 'warn',
  skipped: 'neutral',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#e7dfdf] py-2.5 text-[15px] leading-normal last:border-b-0">
      <dt className="text-[#5a6475]">{label}</dt>
      <dd className="min-w-0 text-end font-medium text-[#121f34]">{children}</dd>
    </div>
  );
}

const money = (v: number | null, unpublished = false) =>
  v === null ? (
    unpublished ? admin.orders.totalUnset : admin.orders.missing
  ) : (
    <Money amount={v} />
  );

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ updated?: string }>;
}) {
  await requireAdmin();
  const { orderId } = await params;
  const { updated } = await searchParams;
  if (!ID_RE.test(orderId)) notFound();
  const o = await getStorage().getOrder(orderId);
  if (!o) notFound();
  const d = admin.detail;
  const pv = orderPriceView(o);
  const pdfPurged = isPdfPurged(o.createdAt, (await getSettings()).retentionDays);

  return (
    <section>
      <AdminPageHeader
        title={<Ltr>{o.displayNo}</Ltr>}
        actions={
          <Link href="/admin" className={btn.outline}>
            <ArrowRight aria-hidden className="size-5" />
            {d.back}
          </Link>
        }
      >
        <StatusPill status={o.status} />
      </AdminPageHeader>
      {updated ? (
        <p
          role="status"
          className="mb-4 flex items-center gap-2 rounded-xl border border-[#e7dfdf] bg-[#eef0f4] px-4 py-3 text-[15px] font-medium text-[#121f34]"
        >
          <Check aria-hidden className="size-5 shrink-0 text-[#0b5a2e]" />
          {d.statusSaved}
        </p>
      ) : null}

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title={d.customer}>
            <dl>
              <Row label={d.name}>{o.customer.name || admin.orders.noName}</Row>
              <Row label={d.phone}>
                <a
                  href={`tel:+${o.customer.phone}`}
                  className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
                >
                  <Phone aria-hidden className="size-4 shrink-0 text-[#5a6475]" />
                  <Ltr>+{o.customer.phone}</Ltr>
                </a>
              </Row>
              <Row label={d.governorate}>{o.customer.governorate}</Row>
              <Row label={d.district}>{o.customer.district || admin.orders.missing}</Row>
              <Row label={d.landmark}>{o.customer.landmark}</Row>
              <Row label={d.notes}>{o.customer.notes || admin.orders.missing}</Row>
              <Row label={d.originalFile}>
                <Ltr>{o.design.originalName}</Ltr>
              </Row>
            </dl>
            <a
              href={whatsappUrl(o.customer.phone)}
              target="_blank"
              rel="noreferrer"
              className={cn(btn.whatsapp, 'mt-4 w-full sm:w-auto')}
            >
              <MessageCircle aria-hidden className="size-5" />
              {admin.orders.whatsapp}
            </a>
          </Panel>

          <Panel title={d.summary}>
            <dl>
              <Row label={d.shape}>{shapeLabel(o.spec.shape, o.spec.corners)}</Row>
              <Row label={d.size}>
                <Ltr>{sizeLabel(o.spec.widthUm, o.spec.heightUm)}</Ltr>
              </Row>
              <Row label={d.perSheet}>
                <Ltr>{o.layout.countPerSheet}</Ltr>
              </Row>
              <Row label={d.layout}>
                {o.layout.turnedCount
                  ? fill(d.mixedValue, {
                      // `turned` cells are turned against the main block, so they are the upright
                      // ones when the main block itself is rotated.
                      upright: o.layout.rotated ? o.layout.turnedCount : o.layout.countPerSheet - o.layout.turnedCount,
                      rotated: o.layout.rotated ? o.layout.countPerSheet - o.layout.turnedCount : o.layout.turnedCount,
                    })
                  : fill(d.layoutValue, { cols: o.layout.cols, rows: o.layout.rows })}
                {o.layout.rotated && !o.layout.turnedCount ? ` · ${d.rotated}` : ''}
              </Row>
              <Row label={d.material}>{pv.material ? common.materials[pv.material] : admin.orders.missing}</Row>
              <Row label={d.requestedStickers}>
                {pv.requestedStickers === null ? admin.orders.missing : <Ltr>{pv.requestedStickers}</Ltr>}
              </Row>
              <Row label={d.sheets}>{pv.sheets === null ? admin.orders.missing : <Ltr>{pv.sheets}</Ltr>}</Row>
              <Row label={d.totalStickers}>
                {pv.totalStickers === null ? admin.orders.missing : <Ltr>{pv.totalStickers}</Ltr>}
              </Row>
              <Row label={d.dpi}>
                {o.design.effectiveDpi !== undefined ? <Ltr>{Math.round(o.design.effectiveDpi)}</Ltr> : d.vector}
              </Row>
              <Row label={d.createdAt}>{formatBaghdad(o.createdAt)}</Row>
              <Row label={d.telegram}>
                <Pill tone={telegramTone[o.notified.telegram]}>{telegramLabel[o.notified.telegram]}</Pill>
              </Row>
            </dl>
          </Panel>

          <Panel>
            <dl>
              <Row label={d.unitPrice}>{money(pv.unitPriceIqd, !!pv.material)}</Row>
              <Row label={d.discount}>
                {pv.discountPercent === null ? (
                  admin.orders.missing
                ) : pv.discountPercent > 0 ? (
                  <Pill tone="discount">
                    <Ltr>{pv.discountPercent}%</Ltr>
                  </Pill>
                ) : (
                  <Ltr>{pv.discountPercent}%</Ltr>
                )}
              </Row>
              <Row label={d.subtotal}>{money(pv.subtotalIqd, !!pv.material)}</Row>
              <Row label={d.delivery}>{money(pv.deliveryFeeIqd)}</Row>
            </dl>
            {/* Dashed cut line, as in the customer price summary. */}
            <div aria-hidden className="cut-line my-3 h-px text-[#9aa3b5]" />
            <dl>
              <div className="flex items-baseline justify-between gap-4 py-1">
                <dt className="text-[18px] font-bold text-[#121f34]">{d.total}</dt>
                <dd className="text-end text-[26px] font-bold leading-tight tabular-nums text-[#121f34]">
                  {money(pv.totalIqd, !!pv.material)}
                </dd>
              </div>
            </dl>
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Panel title={d.status}>
            <StatusForm orderId={o.orderId} status={o.status} />
          </Panel>

          <Panel title={d.preview}>
            {pdfPurged ? (
              <p className="text-[15px] leading-normal text-[#5a6475]">{admin.orders.pdfPurged}</p>
            ) : (
              <SheetPdfPreview orderId={o.orderId} displayNo={o.displayNo} variant="large" />
            )}
          </Panel>

          <Panel title={d.files} bodyClassName="flex flex-col gap-2">
            {pdfPurged ? (
              <p className="text-[15px] leading-normal text-[#5a6475]">{admin.orders.pdfPurged}</p>
            ) : (
              <a href={`/api/admin/files/${o.orderId}/pdf`} className={cn(btn.ink, 'w-full')}>
                <Download aria-hidden className="size-5" />
                {admin.orders.downloadPdf}
              </a>
            )}
            <a href={`/api/admin/files/${o.orderId}/design`} className={cn(btn.outline, 'w-full')}>
              <Download aria-hidden className="size-5" />
              {admin.orders.downloadDesign}
            </a>
          </Panel>
        </div>
      </div>
    </section>
  );
}
