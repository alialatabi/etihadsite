import Link from "next/link";
import { MessageCircle } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SheetPdfPreview } from "@/components/admin/SheetPdfPreview";
import {
  AdminPageHeader,
  EmptyState,
  InfoStrip,
  StatusPill,
  TableFrame,
  tableCls,
} from "@/components/admin/kit";
import { Ltr } from "@/components/Ltr";
import { Money } from "@/components/Money";
import { admin, common } from "@/content/ar";
import { requireAdmin } from "@/lib/auth/guard";
import { shapeLabel, sizeLabel } from "@/lib/order-text";
import { count } from "@/lib/plural";
import { whatsappUrl } from "@/lib/parse/phone";
import { getSettings } from "@/lib/settings";
import { getStorage } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { formatBaghdad, isPdfPurged, orderPriceView, telegramLabel } from "./_lib";
import { TelegramCell, TelegramSentMark } from "./orders/TelegramCell";

export const dynamic = "force-dynamic";
/** The "send to Telegram" button runs resendTelegramAction under this page's limit (sendTelegram aborts after 25 s). */
export const maxDuration = 60;

/** listOrders() answers at most this many orders (the newest) from Supabase. */
const ORDERS_LIST_CAP = 1000;

export default async function OrdersPage() {
  await requireAdmin();
  const [orders, settings] = await Promise.all([getStorage().listOrders(), getSettings()]);
  const retentionDays = settings.retentionDays;
  const c = admin.orders.columns;

  return (
    <section>
      <AdminPageHeader title={admin.orders.title} />
      {/* Older orders exist but are not listed (paging is a later task). */}
      {orders.length === ORDERS_LIST_CAP ? (
        <div role="status" className="mb-4">
          <InfoStrip>{admin.orders.capped}</InfoStrip>
        </div>
      ) : null}
      {orders.length === 0 ? (
        <EmptyState title={admin.orders.empty} />
      ) : (
        <TableFrame label={admin.orders.title}>
          <Table>
            <TableHeader>
              <TableRow className="border-[#e7dfdf] hover:bg-transparent">
                <TableHead className={cn(tableCls.head, "px-3")}>{c.no}</TableHead>
                <TableHead className={cn(tableCls.head, "px-3")}>{c.preview}</TableHead>
                <TableHead className={cn(tableCls.head, "px-3")}>{c.date}</TableHead>
                <TableHead className={cn(tableCls.head, "px-3")}>{c.customer}</TableHead>
                <TableHead className={cn(tableCls.head, "px-3")}>{c.phone}</TableHead>
                <TableHead className={cn(tableCls.head, "px-3")}>{c.spec}</TableHead>
                <TableHead className={cn(tableCls.head, "px-3")}>{c.sheets}</TableHead>
                <TableHead className={cn(tableCls.head, "px-3")}>{c.material}</TableHead>
                <TableHead className={cn(tableCls.head, "px-3")}>{c.total}</TableHead>
                <TableHead className={cn(tableCls.head, "px-3")}>{c.status}</TableHead>
                <TableHead className={cn(tableCls.head, "px-3")}>{c.telegram}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => {
                const pv = orderPriceView(o);
                return (
                  <TableRow key={o.orderId} className={tableCls.row}>
                    <TableCell className={cn(tableCls.cell, tableCls.num, "px-3")}>
                      <Link
                        href={`/admin/orders/${o.orderId}`}
                        className="text-[15px] font-bold text-[#121f34] underline-offset-4 hover:text-[#d01c4a] hover:underline"
                      >
                        <Ltr>{o.displayNo}</Ltr>
                      </Link>
                    </TableCell>
                    <TableCell className={cn(tableCls.cell, "px-3")}>
                      {/* The number link in the previous cell is the accessible one; this is a bigger click target. */}
                      <Link
                        href={`/admin/orders/${o.orderId}`}
                        tabIndex={-1}
                        aria-hidden="true"
                        className="block w-14"
                      >
                        <SheetPdfPreview orderId={o.orderId} displayNo={o.displayNo} variant="thumb" />
                      </Link>
                    </TableCell>
                    <TableCell className={cn(tableCls.cell, tableCls.num, "px-3")}>{formatBaghdad(o.createdAt)}</TableCell>
                    <TableCell className={cn(tableCls.cell, "px-3")}>
                      {o.customer.name || admin.orders.noName}
                    </TableCell>
                    <TableCell className={cn(tableCls.cell, "px-3")}>
                      <div className="flex flex-col gap-1">
                        <a
                          href={`tel:+${o.customer.phone}`}
                          className="font-medium text-[#121f34] underline-offset-4 hover:underline"
                          aria-label={admin.orders.call}
                        >
                          <Ltr>+{o.customer.phone}</Ltr>
                        </a>
                        <a
                          href={whatsappUrl(o.customer.phone)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-[14px] font-medium text-[#0b5a2e] underline-offset-4 hover:underline"
                        >
                          <span
                            aria-hidden
                            className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[#25d366] text-[#052e16]"
                          >
                            <MessageCircle className="size-3" />
                          </span>
                          {admin.orders.whatsapp}
                        </a>
                      </div>
                    </TableCell>
                    <TableCell className={cn(tableCls.cell, "px-3")}>
                      {shapeLabel(o.spec.shape, o.spec.corners)} ·{" "}
                      {o.designs ? (
                        <>
                          <Ltr>{o.designs.length}</Ltr> {count(o.designs.length, common.plural.design)}
                        </>
                      ) : (
                        sizeLabel(o.spec.widthUm, o.spec.heightUm)
                      )}
                    </TableCell>
                    <TableCell className={cn(tableCls.cell, tableCls.num, "px-3")}>
                      {pv.sheets === null ? (
                        admin.orders.missing
                      ) : (
                        <Ltr>{pv.sheets}</Ltr>
                      )}
                    </TableCell>
                    <TableCell className={cn(tableCls.cell, "px-3")}>
                      {pv.material
                        ? common.materials[pv.material]
                        : admin.orders.missing}
                    </TableCell>
                    <TableCell className={cn(tableCls.cell, tableCls.num, "px-3 font-semibold")}>
                      {pv.totalIqd === null ? (
                        admin.orders.missing
                      ) : (
                        <Money amount={pv.totalIqd} />
                      )}
                    </TableCell>
                    <TableCell className={cn(tableCls.cell, "px-3")}>
                      <StatusPill status={o.status} />
                    </TableCell>
                    <TableCell className={cn(tableCls.cell, "px-3")}>
                      {o.notified.telegram === "sent" ? (
                        <TelegramSentMark />
                      ) : (
                        <TelegramCell
                          orderId={o.orderId}
                          reason={telegramLabel[o.notified.telegram]}
                          pdfPurged={isPdfPurged(o.createdAt, retentionDays)}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableFrame>
      )}
    </section>
  );
}
