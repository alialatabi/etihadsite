/**
 * A tiny stand-in for the browser image APIs that `prepare.client.ts` uses, for vitest's node
 * environment (the repo has no jsdom/happy-dom). Not a test file: vitest only collects `*.test.ts`.
 *
 *  - `createImageBitmap(blob, { imageOrientation: 'from-image' })`: decoded with sharp the way a
 *    browser does: EXIF orientation applied, CMYK converted to sRGB, RGBA 8-bit pixels. Any other
 *    option throws, so a test fails if the code forgets `from-image`.
 *  - `document.createElement('canvas')`: RGBA buffer; `drawImage` (3/5/9 arguments, nearest
 *    neighbour, plain copy, which equals source-over on a transparent canvas, and real
 *    source-over on an opaque one), `fillRect`, `clearRect`, `getImageData`; `toBlob` encodes
 *    with sharp (PNG keeps alpha, JPEG drops it at the given quality).
 *
 * Every canvas made is recorded in `canvases` so tests can check the sizes the code asked for.
 */
import sharp from 'sharp';
import { vi } from 'vitest';

export interface MockBitmap {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  closed: boolean;
  close(): void;
}

export interface MockCanvas {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  getContext(kind: string): MockContext | null;
  toBlob(cb: (b: Blob | null) => void, type?: string, quality?: number): void;
  blobs: { type: string; quality?: number }[];
}

interface MockContext {
  fillStyle: string;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
  drawImage(src: MockBitmap | MockCanvas, ...args: number[]): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray; width: number; height: number };
}

export interface BrowserMock {
  canvases: MockCanvas[];
  bitmaps: MockBitmap[];
  restore(): void;
}

function parseColour(c: string): [number, number, number] {
  const s = c.trim().toLowerCase();
  if (s === 'white') return [255, 255, 255];
  if (s === 'black') return [0, 0, 0];
  const m = /^#([0-9a-f]{6})$/.exec(s) ?? /^#([0-9a-f]{3})$/.exec(s);
  if (!m) throw new Error(`mock canvas: unsupported colour ${c}`);
  const h = m[1].length === 3 ? m[1].replace(/./g, (x) => x + x) : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function makeCanvas(): MockCanvas {
  let width = 300;
  let height = 150;
  let data = new Uint8ClampedArray(width * height * 4);
  const canvas: MockCanvas = {
    get width() {
      return width;
    },
    set width(v: number) {
      width = v;
      data = new Uint8ClampedArray(width * height * 4);
    },
    get height() {
      return height;
    },
    set height(v: number) {
      height = v;
      data = new Uint8ClampedArray(width * height * 4);
    },
    get data() {
      return data;
    },
    blobs: [],
    getContext(kind: string) {
      if (kind !== '2d') return null;
      return ctx;
    },
    toBlob(cb, type = 'image/png', quality) {
      canvas.blobs.push({ type, quality });
      const raw = sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } });
      const encoded = type === 'image/jpeg' ? raw.removeAlpha().jpeg({ quality: Math.round((quality ?? 0.92) * 100) }) : raw.png();
      encoded.toBuffer().then(
        (buf) => cb(new Blob([new Uint8Array(buf)], { type })),
        () => cb(null),
      );
    },
  } as MockCanvas;

  const ctx: MockContext = {
    fillStyle: '#000000',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
    drawImage(src, ...a) {
      let sx = 0;
      let sy = 0;
      let sw = src.width;
      let sh = src.height;
      let dx: number;
      let dy: number;
      let dw: number;
      let dh: number;
      if (a.length === 2) [dx, dy, dw, dh] = [a[0], a[1], src.width, src.height];
      else if (a.length === 4) [dx, dy, dw, dh] = a;
      else if (a.length === 8) [sx, sy, sw, sh, dx, dy, dw, dh] = a;
      else throw new Error(`mock canvas: drawImage with ${a.length + 1} arguments`);
      const s = src.data;
      for (let y = 0; y < dh; y++) {
        const ty = dy + y;
        if (ty < 0 || ty >= height) continue;
        const syy = Math.min(src.height - 1, Math.floor(sy + ((y + 0.5) * sh) / dh));
        for (let x = 0; x < dw; x++) {
          const tx = dx + x;
          if (tx < 0 || tx >= width) continue;
          const sxx = Math.min(src.width - 1, Math.floor(sx + ((x + 0.5) * sw) / dw));
          const si = (syy * src.width + sxx) * 4;
          const ti = (ty * width + tx) * 4;
          const a1 = s[si + 3] / 255;
          const a0 = data[ti + 3] / 255;
          const out = a1 + a0 * (1 - a1);
          for (let c = 0; c < 3; c++) {
            data[ti + c] = out === 0 ? 0 : Math.round((s[si + c] * a1 + data[ti + c] * a0 * (1 - a1)) / out);
          }
          data[ti + 3] = Math.round(out * 255);
        }
      }
    },
    fillRect(x, y, w, h) {
      const [r, g, b] = parseColour(ctx.fillStyle);
      for (let yy = Math.max(0, y); yy < Math.min(height, y + h); yy++) {
        for (let xx = Math.max(0, x); xx < Math.min(width, x + w); xx++) {
          const i = (yy * width + xx) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
          data[i + 3] = 255;
        }
      }
    },
    clearRect(x, y, w, h) {
      for (let yy = Math.max(0, y); yy < Math.min(height, y + h); yy++) data.fill(0, (yy * width + Math.max(0, x)) * 4, (yy * width + Math.min(width, x + w)) * 4);
    },
    getImageData(x, y, w, h) {
      const out = new Uint8ClampedArray(w * h * 4);
      for (let yy = 0; yy < h; yy++) out.set(data.subarray(((y + yy) * width + x) * 4, ((y + yy) * width + x + w) * 4), yy * w * 4);
      return { data: out, width: w, height: h };
    },
  };
  return canvas;
}

export function installBrowserMock(): BrowserMock {
  const mock: BrowserMock = { canvases: [], bitmaps: [], restore: () => vi.unstubAllGlobals() };
  vi.stubGlobal('createImageBitmap', async (blob: Blob, options?: { imageOrientation?: string }) => {
    if (options?.imageOrientation !== 'from-image') throw new Error('mock createImageBitmap: expected { imageOrientation: "from-image" }');
    const bytes = Buffer.from(await blob.arrayBuffer());
    const { data, info } = await sharp(bytes).rotate().toColourspace('srgb').ensureAlpha().raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
    const bitmap: MockBitmap = {
      width: info.width,
      height: info.height,
      data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
      closed: false,
      close() {
        bitmap.closed = true;
      },
    };
    mock.bitmaps.push(bitmap);
    return bitmap;
  });
  vi.stubGlobal('document', {
    createElement(tag: string) {
      if (tag !== 'canvas') throw new Error(`mock document: createElement(${tag})`);
      const c = makeCanvas();
      mock.canvases.push(c);
      return c;
    },
  });
  return mock;
}
