import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SheetPdfPreview } from "@/components/admin/SheetPdfPreview";
import { Ltr } from "@/components/Ltr";
import { Money } from "@/components/Money";
import { admin, common, order } from "@/content/ar";
import { requireAdmin } from "@/lib/auth/guard";
import { shapeLabel, sizeLabel } from "@/lib/order-text";
import { whatsappUrl } from "@/lib/parse/phone";
import { getStorage } from "@/lib/storage";
import {
  formatBaghdad,
  orderPriceView,
  statusVariant,
  telegramLabel,
} from "./_lib";

export const dynamic = "force-dynamic";

/** listOrders() answers at most this many orders (the newest) from Supabase. */
const ORDERS_LIST_CAP = 1000;

export default async function OrdersPage() {
  await requireAdmin();
  const orders = await getStorage().listOrders();
  const c = admin.orders.columns;

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{admin.orders.title}</h1>
      {/* Older orders exist but are not listed (paging is a later task). */}
      {orders.length === ORDERS_LIST_CAP ? (
        <p role="status" className="rounded-xl bg-muted px-4 py-3 text-sm">
          {admin.orders.capped}
        </p>
      ) : null}
      {orders.length === 0 ? (
        <p className="rounded-2xl border bg-card p-8 text-center text-muted-foreground shadow-sm">
          {admin.orders.empty}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{c.no}</TableHead>
                <TableHead>{c.preview}</TableHead>
                <TableHead>{c.date}</TableHead>
                <TableHead>{c.customer}</TableHead>
                <TableHead>{c.phone}</TableHead>
                <TableHead>{c.spec}</TableHead>
                <TableHead>{c.sheets}</TableHead>
                <TableHead>{c.material}</TableHead>
                <TableHead>{c.total}</TableHead>
                <TableHead>{c.status}</TableHead>
                <TableHead>{c.telegram}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => {
                const pv = orderPriceView(o);
                return (
                  <TableRow key={o.orderId}>
                    <TableCell>
                      <Link
                        href={`/admin/orders/${o.orderId}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        <Ltr>{o.displayNo}</Ltr>
                      </Link>
                    </TableCell>
                    <TableCell>
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
                    <TableCell>{formatBaghdad(o.createdAt)}</TableCell>
                    <TableCell>
                      {o.customer.name || admin.orders.noName}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <a
                          href={`tel:+${o.customer.phone}`}
                          className="underline-offset-4 hover:underline"
                          aria-label={admin.orders.call}
                        >
                          <Ltr>+{o.customer.phone}</Ltr>
                        </a>
                        <a
                          href={whatsappUrl(o.customer.phone)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                        >
                          {admin.orders.whatsapp}
                        </a>
                      </div>
                    </TableCell>
                    <TableCell>
                      {shapeLabel(o.spec.shape, o.spec.corners)} ·{" "}
                      {sizeLabel(o.spec.widthUm, o.spec.heightUm)}
                    </TableCell>
                    <TableCell>
                      {pv.sheets === null ? (
                        admin.orders.missing
                      ) : (
                        <Ltr>{pv.sheets}</Ltr>
                      )}
                    </TableCell>
                    <TableCell>
                      {pv.material
                        ? common.materials[pv.material]
                        : admin.orders.missing}
                    </TableCell>
                    <TableCell>
                      {pv.totalIqd === null ? (
                        admin.orders.missing
                      ) : (
                        <Money amount={pv.totalIqd} />
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[o.status]}>
                        {order.status[o.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>{telegramLabel[o.notified.telegram]}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
