import { adminApiGuard } from "@/lib/auth/session";
import { EXT_BY_KIND, MIME_BY_KIND } from "@/lib/design/kind";
import { pdfFileNameFor } from "@/lib/display-no";
import { orderPriceView } from "@/lib/order-price-view";
import { getStorage } from "@/lib/storage";
import { ID_RE } from "@/lib/storage/paths";

export const dynamic = "force-dynamic";

/** GET /api/admin/files/<orderId>/<pdf|design> — attachment download. Auth re-checked here. */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ orderId: string; which: string }> },
): Promise<Response> {
  const denied = await adminApiGuard();
  if (denied) return denied;
  const { orderId, which } = await ctx.params;
  if (!ID_RE.test(orderId) || (which !== "pdf" && which !== "design"))
    return new Response(null, { status: 404 });

  const storage = getStorage();
  const record = await storage.getOrder(orderId);
  if (!record) return new Response(null, { status: 404 });

  let path: string;
  let name: string;
  let mime: string;
  if (which === "pdf") {
    path = record.files.pdfPath;
    name = pdfFileNameFor(record.displayNo, record.spec, orderPriceView(record).sheets ?? 0);
    mime = "application/pdf";
  } else {
    path = record.files.designPath;
    name = `${record.displayNo}_design.${EXT_BY_KIND[record.design.kind]}`;
    mime = MIME_BY_KIND[record.design.kind];
  }
  const safeName = name.replace(/[^A-Za-z0-9._-]/g, "_");
  // Cloud storage: hand out a 60-second signed link (serverless responses are capped at 4.5 MB).
  if (storage.signedDownloadUrl) {
    const url = await storage.signedDownloadUrl(path, safeName, 60);
    if (!url) return new Response(null, { status: 404 });
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store" } });
  }
  const bytes = await storage.readFile(path);
  if (!bytes) return new Response(null, { status: 404 });

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
