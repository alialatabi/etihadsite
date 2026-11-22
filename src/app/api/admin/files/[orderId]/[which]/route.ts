import { admin } from "@/content/ar";
import { adminApiGuard } from "@/lib/auth/session";
import { EXT_BY_KIND, MIME_BY_KIND } from "@/lib/design/kind";
import { orderPdfFileName } from "@/lib/display-no";
import { getStorage } from "@/lib/storage";
import { ID_RE } from "@/lib/storage/paths";

export const dynamic = "force-dynamic";

/** The print PDF is purged after retentionDays while the order and its design are kept (D10). */
const pdfPurged = () => Response.json({ error: "purged", message: admin.orders.pdfPurged }, { status: 410 });

/**
 * GET /api/admin/files/<orderId>/<pdf|design|design-N> — attachment download. Auth re-checked here.
 * `design-N` (N from 1) is the Nth original upload of a multi-design order (files.designPaths).
 * A missing PDF answers 410 `{ error: "purged" }`; a missing design stays 404.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ orderId: string; which: string }> },
): Promise<Response> {
  const denied = await adminApiGuard();
  if (denied) return denied;
  const { orderId, which } = await ctx.params;
  // `design-N` with N a plain 1-based number (no sign, no leading zero); anything else is not a file.
  const nth = /^design-([1-9]\d{0,2})$/.exec(which);
  if (!ID_RE.test(orderId) || (which !== "pdf" && which !== "design" && !nth))
    return new Response(null, { status: 404 });

  const storage = getStorage();
  const record = await storage.getOrder(orderId);
  if (!record) return new Response(null, { status: 404 });

  let path: string;
  let name: string;
  let mime: string;
  if (which === "pdf") {
    path = record.files.pdfPath;
    name = orderPdfFileName(record);
    mime = "application/pdf";
  } else if (nth) {
    // Only a multi-design order has a list; N must point inside it, and the kind comes from that design.
    const n = Number(nth[1]);
    const stored = record.files.designPaths?.[n - 1];
    const design = record.designs?.[n - 1];
    if (!stored || !design) return new Response(null, { status: 404 });
    path = stored;
    name = `${record.displayNo}_design-${n}.${EXT_BY_KIND[design.kind]}`;
    mime = MIME_BY_KIND[design.kind];
  } else {
    path = record.files.designPath;
    name = `${record.displayNo}_design.${EXT_BY_KIND[record.design.kind]}`;
    mime = MIME_BY_KIND[record.design.kind];
  }
  const safeName = name.replace(/[^A-Za-z0-9._-]/g, "_");
  // Cloud storage: hand out a 60-second signed link (serverless responses are capped at 4.5 MB).
  if (storage.signedDownloadUrl) {
    const url = await storage.signedDownloadUrl(path, safeName, 60);
    if (!url) return which === "pdf" ? pdfPurged() : new Response(null, { status: 404 });
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store" } });
  }
  const bytes = await storage.readFile(path);
  if (!bytes) return which === "pdf" ? pdfPurged() : new Response(null, { status: 404 });

  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
