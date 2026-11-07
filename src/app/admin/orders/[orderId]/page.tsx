import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Ltr } from '@/components/Ltr';
import { admin, common, fill, order } from '@/content/ar';
import { verifySession } from '@/lib/auth/session';
import { shapeLabel, sizeLabel } from '@/lib/order-text';
import { whatsappUrl } from '@/lib/parse/phone';
import { formatIqd } from '@/lib/pricing';
import { getStorage } from '@/lib/storage';
import { ID_RE } from '@/lib/storage/paths';
import { formatBaghdad, statusVariant, telegramLabel } from '../../_lib';
import { StatusForm } from './StatusForm';

export const dynamic = 'force-dynamic';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b py-2 last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-medium">{children}</dd>
    </div>
  );
}

const money = (v: number | null) =>
  v === null ? (
    admin.orders.totalUnset
  ) : (
    <>
      <Ltr>{formatIqd(v)}</Ltr> {common.units.iqd}
    </>
  );

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ updated?: string }>;
}) {
  if (!(await verifySession())) redirect('/admin/login');
  const { orderId } = await params;
  const { updated } = await searchParams;
  if (!ID_RE.test(orderId)) notFound();
  const o = await getStorage().getOrder(orderId);
  if (!o) notFound();
  const d = admin.detail;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin" className={buttonVariants({ variant: 'ghost' })}>
          {d.back}
        </Link>
        <h1 className="text-2xl font-bold">
          <Ltr>{o.displayNo}</Ltr>
        </h1>
        <Badge variant={statusVariant[o.status]}>{order.status[o.status]}</Badge>
      </div>
      {updated ? <p className="text-sm text-muted-foreground">{d.statusSaved}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>{d.status}</CardTitle>
        </CardHeader>
        <CardContent>
          <StatusForm orderId={o.orderId} status={o.status} />
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{d.summary}</CardTitle>
          </CardHeader>
          <CardContent>
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
              <Row label={d.sheets}>
                <Ltr>{o.offer.sheets}</Ltr>
              </Row>
              <Row label={d.totalStickers}>
                <Ltr>{o.price.totalStickers}</Ltr>
              </Row>
              <Row label={d.price}>{money(o.price.offerPriceIqd)}</Row>
              <Row label={d.delivery}>{money(o.price.deliveryFeeIqd)}</Row>
              <Row label={d.total}>{money(o.price.totalIqd)}</Row>
              <Row label={d.dpi}>
                {o.design.effectiveDpi !== undefined ? <Ltr>{Math.round(o.design.effectiveDpi)}</Ltr> : d.vector}
              </Row>
              <Row label={d.createdAt}>{formatBaghdad(o.createdAt)}</Row>
              <Row label={d.telegram}>{telegramLabel[o.notified.telegram]}</Row>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{d.customer}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <Row label={d.name}>{o.customer.name || admin.orders.noName}</Row>
              <Row label={d.phone}>
                <a href={`tel:+${o.customer.phone}`} className="underline-offset-4 hover:underline">
                  <Ltr>+{o.customer.phone}</Ltr>
                </a>{' '}
                <a
                  href={whatsappUrl(o.customer.phone)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground underline-offset-4 hover:underline"
                >
                  ({admin.orders.whatsapp})
                </a>
              </Row>
              <Row label={d.governorate}>{o.customer.governorate}</Row>
              <Row label={d.district}>{o.customer.district || admin.orders.noName}</Row>
              <Row label={d.landmark}>{o.customer.landmark}</Row>
              <Row label={d.notes}>{o.customer.notes || admin.orders.noName}</Row>
              <Row label={d.originalFile}>
                <Ltr>{o.design.originalName}</Ltr>
              </Row>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{d.files}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <a href={`/api/admin/files/${o.orderId}/pdf`} className={buttonVariants()}>
            {admin.orders.downloadPdf}
          </a>
          <a href={`/api/admin/files/${o.orderId}/design`} className={buttonVariants({ variant: 'outline' })}>
            {admin.orders.downloadDesign}
          </a>
        </CardContent>
      </Card>
    </section>
  );
}
