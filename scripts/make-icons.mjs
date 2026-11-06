/**
 * One-off: generate favicons/app icons from the shop logo.
 * Run: node scripts/make-icons.mjs   (outputs are committed)
 * The logo is a wide wordmark on a square canvas; icons use only the coloured
 * mark (left part) so it stays legible at 16-48 px.
 */
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'public/brand/united-print-logo.jpg');
const BG = { r: 250, g: 248, b: 243, alpha: 1 }; // paper #faf8f3

// Square crop around the mark (logo is 1536x1536; mark spans ~x190-605, y495-1035).
const CROP = { left: 117, top: 485, width: 560, height: 560 };

async function icon(size, padFraction = 0) {
  const inner = Math.round(size * (1 - padFraction * 2));
  const buf = await sharp(src).extract(CROP).resize(inner, inner).png().toBuffer();
  const pad = Math.floor((size - inner) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: buf, left: pad, top: pad }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const out = (p) => resolve(root, p);
await writeFile(out('public/icon-192.png'), await icon(192));
await writeFile(out('public/icon-512.png'), await icon(512));
// Maskable: keep the mark inside the 80% safe zone.
await writeFile(out('public/icon-maskable-512.png'), await icon(512, 0.12));
await writeFile(out('src/app/apple-icon.png'), await icon(180, 0.06));
await writeFile(out('src/app/icon.png'), await icon(512));

// favicon.ico: PNG-compressed ICO with 16/32/48.
const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map((s) => icon(s)));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = pngs.map((png, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(sizes[i], 0);
  e.writeUInt8(sizes[i], 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(png.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += png.length;
  return e;
});
await writeFile(out('src/app/favicon.ico'), Buffer.concat([header, ...entries, ...pngs]));
console.log('icons written');
