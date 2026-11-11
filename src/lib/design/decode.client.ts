'use client';
/**
 * Client-side design decoding. Browser only.
 *
 * Contract (docs/PLAN.md §3):
 *  - PNG/JPEG: createImageBitmap(file, { imageOrientation: 'from-image' }) bakes EXIF
 *    rotation in. Alpha is detected; for shape 'custom' the tight alpha box
 *    (alpha > 8, same helper as the server) becomes `trim` and pxWidth/pxHeight.
 *    'custom' without transparency (or JPEG / PDF) -> 'no_alpha'.
 *    previewUrl = object URL of a PNG (alpha) / JPEG re-encoded at <= 1600 px long side.
 *  - PDF: pdfjs legacy build (dynamic import), worker /pdf.worker.min.mjs,
 *    isEvalSupported:false. Page 1 viewport (CropBox + /Rotate); when a TrimBox exists
 *    it is used instead (read with pdf-lib, also dynamically imported) so the size
 *    equals the server's TrimBox ?? CropBox ?? MediaBox. Encrypted -> 'encrypted'.
 *  - Unknown MIME / HEIC -> 'unsupported_type'; > maxBytes -> 'too_large'.
 *
 * The caller owns `source.previewUrl` and must URL.revokeObjectURL() it when the
 * design is replaced or the component unmounts.
 */
import type { DesignDecodeError, DesignDecodeOutcome, DesignKind, DesignSource, Shape } from '@/lib/types';
import { fitWithin, scanAlphaStrips, type PixelRect } from './pixels';

export interface DecodeOptions {
  shape: Shape;
  maxBytes: number;
}

const PREVIEW_MAX_SIDE = 1600;
const PREVIEW_PDF_DPI = 150;
const STRIP_ROWS = 256;
const MAX_CANVAS_SIDE = 12000;

function detectKind(file: File): DesignKind | null {
  const t = file.type.toLowerCase();
  const n = file.name.toLowerCase();
  if (t === 'image/png' || (!t && n.endsWith('.png'))) return 'png';
  if (t === 'image/jpeg' || t === 'image/jpg' || (!t && /\.jpe?g$/.test(n))) return 'jpeg';
  if (t === 'application/pdf' || (!t && n.endsWith('.pdf'))) return 'pdf';
  return null;
}

const fail = (error: DesignDecodeError): DesignDecodeOutcome => ({ ok: false, error });

export async function decodeDesign(file: File, opts: DecodeOptions): Promise<DesignDecodeOutcome> {
  const kind = detectKind(file);
  if (!kind) return fail('unsupported_type');
  if (file.size > opts.maxBytes) return fail('too_large');
  if (file.size === 0) return fail('empty');
  try {
    return kind === 'pdf' ? await decodePdf(file, opts) : await decodeRaster(file, kind, opts);
  } catch {
    return fail('corrupt');
  }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality);
  });
}

async function decodeRaster(file: File, kind: 'png' | 'jpeg', opts: DecodeOptions): Promise<DesignDecodeOutcome> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const W = bitmap.width;
    const H = bitmap.height;
    if (W < 1 || H < 1) return fail('empty');

    let hasAlpha = false;
    let box: PixelRect | null = { left: 0, top: 0, width: W, height: H };

    // JPEG never has alpha. PNG: scan in strips to bound memory on huge images.
    if (kind === 'png') {
      const strip = makeCanvas(W, Math.min(STRIP_ROWS, H));
      const ctx = strip.getContext('2d', { willReadFrequently: true });
      if (!ctx) return fail('corrupt');
      const readStrip = (y0: number, rows: number) => {
        ctx.clearRect(0, 0, W, strip.height);
        ctx.drawImage(bitmap, 0, y0, W, rows, 0, 0, W, rows);
        return ctx.getImageData(0, 0, W, rows).data;
      };
      // Only 'custom' needs the alpha box; other shapes stop at the first strip with alpha.
      ({ hasAlpha, box } = scanAlphaStrips(W, H, STRIP_ROWS, readStrip, opts.shape === 'custom'));
    }

    if (opts.shape === 'custom') {
      if (!hasAlpha) return fail('no_alpha');
      if (!box) return fail('empty');
    }
    const art: PixelRect = opts.shape === 'custom' && box ? box : { left: 0, top: 0, width: W, height: H };
    const trimmed = art.width !== W || art.height !== H;

    const { width: pw, height: ph } = fitWithin(art.width, art.height, PREVIEW_MAX_SIDE);
    const out = makeCanvas(pw, ph);
    const octx = out.getContext('2d');
    if (!octx) return fail('corrupt');
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(bitmap, art.left, art.top, art.width, art.height, 0, 0, pw, ph);
    const blob = hasAlpha ? await toBlob(out, 'image/png') : await toBlob(out, 'image/jpeg', 0.9);

    const source: DesignSource = {
      kind,
      file,
      pxWidth: art.width,
      pxHeight: art.height,
      hasAlpha,
      previewUrl: URL.createObjectURL(blob),
      ...(trimmed ? { trim: { left: art.left, top: art.top, width: art.width, height: art.height } } : {}),
    };
    return { ok: true, source };
  } finally {
    bitmap.close();
  }
}

/* ───────────────────────────────── PDF ───────────────────────────────── */

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

async function loadPdfjs(): Promise<PdfjsModule> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  return pdfjs;
}

class EncryptedError extends Error {}

async function openPdf(pdfjs: PdfjsModule, file: File) {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data, isEvalSupported: false });
  try {
    return await task.promise;
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    if (name === 'PasswordException') throw new EncryptedError();
    throw e;
  }
}

/** TrimBox of page 1 in user space [x0, y0, x1, y1], or null when absent / unreadable. */
async function readTrimBox(file: File): Promise<[number, number, number, number] | null> {
  try {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
    const page = doc.getPage(0);
    if (!page.node.TrimBox()) return null;
    const t = page.getTrimBox();
    return [t.x, t.y, t.x + t.width, t.y + t.height];
  } catch {
    return null;
  }
}

interface PdfPageGeometry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any;
  pageCount: number;
  /** Visible region in viewport space at scale 1 (points, after /Rotate). */
  region: { x: number; y: number; width: number; height: number };
}

async function pdfGeometry(pdfjs: PdfjsModule, file: File) {
  // Started before pdfjs opens the file so the two parses overlap; readTrimBox never rejects.
  const trimP = readTrimBox(file);
  const pdf = await openPdf(pdfjs, file);
  const page = await pdf.getPage(1);
  const vp1 = page.getViewport({ scale: 1 });
  let region = { x: 0, y: 0, width: vp1.width, height: vp1.height };
  const trim = await trimP;
  if (trim) {
    const [x0, y0, x1, y1] = vp1.convertToViewportRectangle(trim);
    const r = { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
    if (r.width > 0 && r.height > 0) region = r;
  }
  const geo: PdfPageGeometry = { page, pageCount: pdf.numPages, region };
  return { pdf, geo };
}

async function renderRegion(geo: PdfPageGeometry, scale: number): Promise<HTMLCanvasElement> {
  const w = Math.max(1, Math.round(geo.region.width * scale));
  const h = Math.max(1, Math.round(geo.region.height * scale));
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  const viewport = geo.page.getViewport({ scale });
  await geo.page.render({
    canvasContext: ctx,
    viewport,
    transform: [1, 0, 0, 1, -geo.region.x * scale, -geo.region.y * scale],
  }).promise;
  return canvas;
}

async function decodePdf(file: File, opts: DecodeOptions): Promise<DesignDecodeOutcome> {
  if (opts.shape === 'custom') return fail('no_alpha'); // transparency in PDFs is not trusted
  const pdfjs = await loadPdfjs();
  let opened: Awaited<ReturnType<typeof pdfGeometry>>;
  try {
    opened = await pdfGeometry(pdfjs, file);
  } catch (e) {
    return fail(e instanceof EncryptedError ? 'encrypted' : 'corrupt');
  }
  const { pdf, geo } = opened;
  try {
    const wPt = geo.region.width;
    const hPt = geo.region.height;
    if (!(wPt > 0) || !(hPt > 0)) return fail('corrupt');
    let scale = PREVIEW_PDF_DPI / 72;
    const fit = fitWithin(Math.round(wPt * scale), Math.round(hPt * scale), PREVIEW_MAX_SIDE);
    scale = fit.width / wPt;
    const canvas = await renderRegion(geo, scale);
    const blob = await toBlob(canvas, 'image/jpeg', 0.9);
    const source: DesignSource = {
      kind: 'pdf',
      file,
      // Exact points (after /Rotate), NOT rounded: same as normalise.server.ts so the
      // aspect lock and the server agree.
      pxWidth: wPt,
      pxHeight: hPt,
      hasAlpha: false,
      previewUrl: URL.createObjectURL(blob),
      pdf: { pageCount: geo.pageCount, pageWidthPt: wPt, pageHeightPt: hPt },
    };
    return { ok: true, source };
  } finally {
    await pdf.destroy();
  }
}

/**
 * Render page 1 of a PDF to a PNG Blob at `dpi` (physical size of the trim/crop box).
 * Used as the fallback when the server answers `needs_raster`. Throws on failure.
 * The long side is capped at 12000 px (the effective dpi is lowered if needed).
 */
export async function rasterisePdfPage(file: File, dpi: number): Promise<Blob> {
  const pdfjs = await loadPdfjs();
  const { pdf, geo } = await pdfGeometry(pdfjs, file);
  try {
    let scale = dpi / 72;
    const long = Math.max(geo.region.width, geo.region.height) * scale;
    if (long > MAX_CANVAS_SIDE) scale *= MAX_CANVAS_SIDE / long;
    const canvas = await renderRegion(geo, scale);
    return await toBlob(canvas, 'image/png');
  } finally {
    await pdf.destroy();
  }
}
