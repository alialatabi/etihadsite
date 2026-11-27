import sharp from 'sharp';
import { adminApiGuard } from '@/lib/auth/session';
import { getStorage } from '@/lib/storage';
import { ID_RE } from '@/lib/storage/paths';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/designs/<uploadId>/image — a generated design, shown inline. Auth re-checked here.
 * `?download=1` sends it as an attachment named softy-design-<uploadId>.png instead.
 * `?thumb=1` (gallery tiles) sends a 640 px WebP preview; if resizing fails the original PNG is sent.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const denied = await adminApiGuard();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return new Response(null, { status: 404 });

  const file = await getStorage().readUpload(id);
  if (!file) return new Response(null, { status: 404 });

  const params = new URL(request.url).searchParams;
  const download = params.get('download') === '1';
  if (!download && params.get('thumb') === '1') {
    try {
      const out = await sharp(file.bytes)
        .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      return new Response(out as BodyInit, {
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': String(out.byteLength),
          'Content-Disposition': 'inline',
          'Cache-Control': 'private, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      // Fall through to the original PNG: a tile must never break.
    }
  }
  return new Response(file.bytes as BodyInit, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(file.bytes.byteLength),
      'Content-Disposition': download ? `attachment; filename="softy-design-${id}.png"` : 'inline',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
