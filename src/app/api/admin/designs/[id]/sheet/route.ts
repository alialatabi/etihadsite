import { admin } from '@/content/ar';
import { aiAcceptedSize } from '@/lib/ai/accepted-size';
import { adminApiGuard } from '@/lib/auth/session';
import { normaliseArtwork } from '@/lib/design/normalise.server';
import { computeLayout, layoutParamsFor } from '@/lib/layout';
import { buildSheetPdf } from '@/lib/pdf/build-sheet';
import { PRINT_DPI } from '@/lib/print-dpi';
import { getSettings } from '@/lib/settings';
import { getStorage } from '@/lib/storage';
import { ID_RE } from '@/lib/storage/paths';
import type { StickerSpec } from '@/lib/types';
import { umToMm } from '@/lib/units';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const d = admin.designs.sheet;

/**
 * A serverless response is capped at 4.5 MB, so a sheet is only sent when its PDF is at most this big;
 * a bigger raster sheet is rebuilt at a lower resolution first (same idea as the order route).
 */
const MAX_RESPONSE_BYTES = 4_000_000;
/** Lower resolutions tried, in order, after PRINT_DPI (the order route uses the same list). */
const FALLBACK_DPI = [600, 300] as const;
/** The quick first pass that only reads the trimmed pixel size of the stored image (nothing is printed from it). */
const PROBE_DPI = 72;

const error = (status: number, message: string, code: string) =>
  Response.json({ error: code, message }, { status, headers: { 'Cache-Control': 'private, no-store' } });

const mm = (um: number) => String(Number(umToMm(um).toFixed(2)));

/**
 * GET /api/admin/designs/<uploadId>/sheet — an imposed (مسفط) A4 sheet of a generated design, built on
 * the fly with the shop's current layout settings. Attachment download. Auth re-checked here.
 * (A design an order used also has the exact printed file: /api/admin/files/<orderId>/pdf.)
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const denied = await adminApiGuard();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return new Response(null, { status: 404 });

  const storage = getStorage();
  const row = (await storage.aiGetGeneration?.(id)) ?? null;
  if (!row) return error(404, d.notFound, 'not_found');
  const upload = await storage.readUpload(id);
  if (!upload) return error(404, d.notFound, 'not_found');

  // The order that used this design (if any): its number goes into the PDF metadata ('SOFTY' when it cannot be
  // loaded) and, for a single-design order, its spec is the size that was really printed.
  const order = row.orderId ? await storage.getOrder(row.orderId).catch(() => null) : null;
  const displayNo = order?.displayNo ?? 'SOFTY';

  const settings = await getSettings();
  let spec: StickerSpec;
  if (order && !order.designs) {
    spec = order.spec;
  } else {
    // The row holds the size typed for the design, but a custom-shape PNG is a transparent 1024x1024 canvas that
    // is trimmed to its alpha box, and a rectangle's height follows the image: the sticker is the size the builder
    // gives at accept (aiAcceptedSize at the trimmed pixel ratio). Read that ratio with a cheap first pass.
    let probe;
    try {
      probe = await normaliseArtwork(upload.bytes, {
        spec: { shape: row.shape, corners: row.corners, widthUm: row.widthUm, heightUm: row.heightUm },
        targetDpi: PROBE_DPI,
        blockDpi: 0,
      });
    } catch {
      return error(500, d.failed, 'server_error');
    }
    if (!probe.ok) return error(422, d.artworkFailed, probe.error);
    const size = aiAcceptedSize(row.shape, { widthUm: row.widthUm, heightUm: row.heightUm }, probe.pxWidth / probe.pxHeight);
    spec = { shape: row.shape, corners: row.corners, ...size };
  }
  const outcome = computeLayout(spec, layoutParamsFor(spec, settings.layout));
  if (!outcome.ok) return error(422, d.layoutFailed, outcome.reason);
  const layout = outcome.layout;

  try {
    let norm = await normaliseArtwork(upload.bytes, { spec, targetDpi: PRINT_DPI, blockDpi: settings.quality.blockDpi });
    if (!norm.ok) return error(422, d.artworkFailed, norm.error);

    const buildPdf = (artwork: Parameters<typeof buildSheetPdf>[0]['artwork']) =>
      buildSheetPdf({
        layout,
        artwork,
        meta: {
          displayNo,
          description: `${spec.shape} ${umToMm(spec.widthUm)}x${umToMm(spec.heightUm)}mm x${layout.countPerSheet}`,
        },
      });
    let pdf = await buildPdf(norm.artwork);
    for (const dpi of FALLBACK_DPI) {
      if (pdf.bytes.length <= MAX_RESPONSE_BYTES || norm.artwork.kind !== 'raster') break;
      const again = await normaliseArtwork(upload.bytes, { spec, targetDpi: dpi, blockDpi: settings.quality.blockDpi });
      if (!again.ok) break;
      norm = again;
      pdf = await buildPdf(norm.artwork);
    }
    if (pdf.bytes.length > MAX_RESPONSE_BYTES) return error(413, d.tooBig, 'too_big');

    const name = `softy-sheet-${spec.shape}-${mm(spec.widthUm)}x${mm(spec.heightUm)}mm-x${layout.countPerSheet}.pdf`;
    return new Response(pdf.bytes as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.bytes.byteLength),
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return error(500, d.failed, 'server_error');
  }
}
