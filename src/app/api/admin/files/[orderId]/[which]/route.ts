import { verifySession } from "@/lib/auth/session";
import { pdfFileNameFor } from "@/lib/display-no";
import { getStorage } from "@/lib/storage";
import { ID_RE } from "@/lib/storage/paths";

export const dynamic = "force-dynamic";

const DESIGN_EXT = { png: "png", jpeg: "jpg", pdf: "pdf" } as const;
const DESIGN_MIME = {
  png: "image/png",
  jpeg: "image/jpeg",
  pdf: "application/pdf",
} as const;

/** GET /api/admin/files/<orderId>/<pdf|design> — attachment download. Auth re-checked here. */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ orderId: string; which: string }> },
): Promise<Response> {
  if (!(await verifySession()))
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
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
    name = pdfFileNameFor(record.displayNo, record.spec, record.offer.sheets);
    mime = "application/pdf";
  } else {
    path = record.files.designPath;
    name = `${record.displayNo}_design.${DESIGN_EXT[record.design.kind]}`;
    mime = DESIGN_MIME[record.design.kind];
  }
  // Cloud storage: hand out a 60-second signed link (serverless responses are capped at 4.5 MB).
  if (storage.signedDownloadUrl) {
    const url = await storage.signedDownloadUrl(path, name.replace(/[^A-Za-z0-9._-]/g, "_"), 60);
    if (!url) return new Response(null, { status: 404 });
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store" } });
  }
  const bytes = await storage.readFile(path);
  if (!bytes) return new Response(null, { status: 404 });

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
