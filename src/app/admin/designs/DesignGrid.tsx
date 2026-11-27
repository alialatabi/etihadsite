import Link from 'next/link';
import { Download, FileText, MessageCircle } from 'lucide-react';
import { Ltr } from '@/components/Ltr';
import { fillLtr } from '@/components/fill-ltr';
import { Pill, btn } from '@/components/admin/kit';
import { admin, fill } from '@/content/ar';
import { cn } from '@/lib/utils';
import { formatPhoneLocal, whatsappUrl } from '@/lib/parse/phone';
import { shapeLabel, sizeLabel } from '@/lib/order-text';
import { count } from '@/lib/plural';
import type { AiGenerationRecord } from '@/lib/types';
import { formatBaghdad } from '../_lib';
import { DeleteDesignButton } from './DeleteDesignButton';
import { SheetDownloadButton } from './SheetDownloadButton';
import { daysUntilDeletion } from './expiry';

const d = admin.designs;

/** A design card is narrow (two per row on a phone): the kit button may wrap its text, still at least 44px tall. */
const CARD_BTN = 'h-auto min-h-11 w-full whitespace-normal px-3 py-2 text-center text-[14px] leading-snug';

/** What a card needs from the order that used its design (loaded by the page; absent when that load failed). */
export interface DesignOrderInfo {
  displayNo: string;
  customerName: string;
  /** Normalised digits, "9647XXXXXXXXX". */
  phone: string;
  /** The order's own print PDF can still be downloaded (not purged, single-design order). */
  pdfAvailable: boolean;
}

/** Cards of generated designs, newest first. Server component: no state (only the delete and sheet buttons are client code). */
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
            className="flex flex-col gap-2 overflow-hidden rounded-[2px] bg-white p-2 shadow-paper sm:gap-3 sm:p-3"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- admin-only, auth-guarded route; next/image would re-fetch it unauthenticated */}
            <img
              src={`/api/admin/designs/${g.uploadId}/image?thumb=1`}
              alt=""
              loading="lazy"
              className="aspect-square w-full rounded-[2px] bg-news object-contain"
            />
            <div className="flex flex-col gap-2 px-1 pb-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[14px] font-medium leading-[1.4] text-ink-muted">{formatBaghdad(g.createdAt)}</span>
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
                    className="inline-flex min-h-11 items-center rounded-[2px] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink"
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
              <p className="text-[15px] font-bold leading-normal text-ink">
                {shapeLabel(g.shape, g.corners)} · <Ltr>{sizeLabel(g.widthUm, g.heightUm)}</Ltr>
              </p>
              {order ? (
                <p className="break-words text-[15px] leading-normal text-ink">
                  <span className="text-[14px] text-ink-muted">{d.card.customer}: </span>
                  {order.customerName}{' '}
                  <Ltr className="text-[14px] text-ink-muted">{formatPhoneLocal(order.phone)}</Ltr>
                </p>
              ) : null}
              <p className="line-clamp-3 break-words text-[15px] leading-normal text-ink">
                <span className="text-[14px] text-ink-muted">{d.idea}: </span>
                {g.idea}
              </p>
              {g.lines.length > 0 ? (
                <p className="break-words text-[15px] leading-normal text-ink">
                  <span className="text-[14px] text-ink-muted">{d.printed}: </span>
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
                  className={cn(btn.whatsapp, CARD_BTN)}
                >
                  <MessageCircle aria-hidden className="size-4 shrink-0" />
                  {d.card.whatsapp}
                </a>
              ) : null}
              <a href={`/api/admin/designs/${g.uploadId}/image?download=1`} className={cn(btn.outline, CARD_BTN)}>
                <Download aria-hidden className="size-4 shrink-0" />
                {d.card.downloadImage}
              </a>
              {g.orderId && order?.pdfAvailable ? (
                // The printed file of the order: a normal link (the route may answer with a redirect to a signed URL).
                <a href={`/api/admin/files/${g.orderId}/pdf`} className={cn(btn.outline, CARD_BTN)}>
                  <FileText aria-hidden className="size-4 shrink-0" />
                  {d.card.downloadSheet}
                </a>
              ) : (
                <SheetDownloadButton href={`/api/admin/designs/${g.uploadId}/sheet`} />
              )}
              {g.orderId ? null : <DeleteDesignButton uploadId={g.uploadId} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
