import Link from 'next/link';
import { Download, FileText, MessageCircle } from 'lucide-react';
import { Ltr } from '@/components/Ltr';
import { fillLtr } from '@/components/fill-ltr';
import { Pill } from '@/components/admin/kit';
import { admin, fill } from '@/content/ar';
import { formatPhoneLocal, whatsappUrl } from '@/lib/parse/phone';
import { shapeLabel, sizeLabel } from '@/lib/order-text';
import { count } from '@/lib/plural';
import type { AiGenerationRecord } from '@/lib/types';
import { formatBaghdad } from '../_lib';
import { cardBtn } from './card-styles';
import { DeleteDesignButton } from './DeleteDesignButton';
import { daysUntilDeletion } from './expiry';

const d = admin.designs;

/** What a card needs from the order that used its design (loaded by the page; absent when that load failed). */
export interface DesignOrderInfo {
  displayNo: string;
  customerName: string;
  /** Normalised digits, "9647XXXXXXXXX". */
  phone: string;
  /** The order's own print PDF can still be downloaded (not purged, single-design order). */
  pdfAvailable: boolean;
}

/** Cards of generated designs, newest first. Server component: no state (only the delete button is client code). */
export function DesignGrid({
  rows,
  staffNames,
  orders,
  nowMs,
}: {
  rows: AiGenerationRecord[];
  staffNames?: Record<string, string>;
  /** By order id. */
  orders?: Record<string, DesignOrderInfo>;
  nowMs: number;
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
      {rows.map((g) => {
        const order = g.orderId ? orders?.[g.orderId] : undefined;
        const daysLeft = g.orderId ? null : daysUntilDeletion(g.createdAt, new Date(nowMs));
        return (
          <li
            key={g.id}
            className="flex flex-col gap-2 overflow-hidden rounded-xl border border-[#e7dfdf] bg-white p-2 shadow sm:gap-3 sm:p-3-[0_10px_28px_-18px_rgba(18,31,52,0.25)]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- admin-only, auth-guarded route; next/image would re-fetch it unauthenticated */}
            <img
              src={`/api/admin/designs/${g.uploadId}/image`}
              alt=""
              loading="lazy"
              className="aspect-square w-full rounded-lg border border-[#e7dfdf] bg-[#f7f0ef] object-contain"
            />
            <div className="flex flex-col gap-2 px-1 pb-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[14px] font-medium leading-[1.4] text-[#5a6475]">{formatBaghdad(g.createdAt)}</span>
                {g.staffId ? (
                  <Pill tone="info">
                    {staffNames?.[g.staffId]
                      ? fill(d.staffBadge, { name: staffNames[g.staffId] })
                      : fillLtr(d.staffBadge, { name: g.staffId })}
                  </Pill>
                ) : null}
                {g.orderId ? (
                  <Link
                    href={`/admin/orders/${g.orderId}`}
                    className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d01c4a]"
                  >
                    <Pill tone="ok">{d.ordered}</Pill>
                  </Link>
                ) : null}
                {daysLeft !== null ? (
                  <Pill tone={daysLeft <= 1 ? 'warn' : 'neutral'}>
                    {daysLeft === 0
                      ? d.expiresToday
                      : fillLtr(d.expiresIn, {
                          days: (
                            <>
                              <Ltr>{daysLeft}</Ltr> {count(daysLeft, d.dayPlural)}
                            </>
                          ),
                        })}
                  </Pill>
                ) : null}
              </div>
              <p className="text-[15px] font-bold leading-normal text-[#121f34]">
                {shapeLabel(g.shape, g.corners)} · <Ltr>{sizeLabel(g.widthUm, g.heightUm)}</Ltr>
              </p>
              {order ? (
                <p className="break-words text-[15px] leading-normal text-[#121f34]">
                  <span className="text-[14px] text-[#5a6475]">{d.card.customer}: </span>
                  {order.customerName}{' '}
                  <Ltr className="text-[14px] text-[#5a6475]">{formatPhoneLocal(order.phone)}</Ltr>
                </p>
              ) : null}
              <p className="line-clamp-3 break-words text-[15px] leading-normal text-[#121f34]">
                <span className="text-[14px] text-[#5a6475]">{d.idea}: </span>
                {g.idea}
              </p>
              {g.lines.length > 0 ? (
                <p className="break-words text-[15px] leading-normal text-[#121f34]">
                  <span className="text-[14px] text-[#5a6475]">{d.printed}: </span>
                  {g.lines.join(' / ')}
                </p>
              ) : null}
            </div>
            <div className="mt-auto flex flex-col gap-2 px-1 pb-1">
              {order ? (
                <a
                  href={whatsappUrl(order.phone, fill(d.card.whatsappText, { no: order.displayNo }))}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cardBtn.whatsapp}
                >
                  <MessageCircle aria-hidden className="size-4 shrink-0" />
                  {d.card.whatsapp}
                </a>
              ) : null}
              <a href={`/api/admin/designs/${g.uploadId}/image?download=1`} className={cardBtn.outline}>
                <Download aria-hidden className="size-4 shrink-0" />
                {d.card.downloadImage}
              </a>
              <a
                href={
                  g.orderId && order?.pdfAvailable
                    ? `/api/admin/files/${g.orderId}/pdf`
                    : `/api/admin/designs/${g.uploadId}/sheet`
                }
                className={cardBtn.outline}
              >
                <FileText aria-hidden className="size-4 shrink-0" />
                {d.card.downloadSheet}
              </a>
              {g.orderId ? null : <DeleteDesignButton uploadId={g.uploadId} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
