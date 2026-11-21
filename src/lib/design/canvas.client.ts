'use client';
/** Canvas helpers shared by the browser-side design code (decode.client.ts, prepare.client.ts). */

/** Rows read per step when scanning a bitmap's alpha channel. */
export const ALPHA_STRIP_ROWS = 256;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Frees a canvas' pixel memory now instead of at garbage collection (matters on phones). */
export function releaseCanvas(c: HTMLCanvasElement): void {
  c.width = 0;
  c.height = 0;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality);
  });
}
