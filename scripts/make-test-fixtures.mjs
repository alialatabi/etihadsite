// Generates the small binary fixtures in tests/fixtures. Run: node scripts/make-test-fixtures.mjs
import sharp from 'sharp';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
mkdirSync(out, { recursive: true });
const write = (name, bytes) => writeFileSync(join(out, name), bytes);

/** Deterministic RGB gradient. */
function gradient(w, h) {
  const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      buf[i] = Math.round((x / w) * 255);
      buf[i + 1] = Math.round((y / h) * 255);
      buf[i + 2] = 128;
    }
  return buf;
}

// (a) 600x400 JPEG stored landscape with EXIF Orientation 6 -> displays 400x600.
write(
  'exif6-600x400.jpg',
  await sharp(gradient(600, 400), { raw: { width: 600, height: 400, channels: 3 } })
    .withMetadata({ orientation: 6 })
    .jpeg({ quality: 80 })
    .toBuffer(),
);

// (b) 400x400 PNG: 200x100 opaque rect inside transparent padding (off-centre).
write(
  'padded-400x400.png',
  await sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: { create: { width: 200, height: 100, channels: 4, background: { r: 220, g: 30, b: 30, alpha: 1 } } }, left: 50, top: 120 },
    ])
    .png()
    .toBuffer(),
);

// (c) PDF: MediaBox 600x800, CropBox 100,100 400x300, /Rotate 90 -> viewer shows 300x400.
{
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  page.drawRectangle({ x: 100, y: 100, width: 400, height: 300, color: rgb(0.1, 0.4, 0.8) });
  page.drawRectangle({ x: 100, y: 100, width: 80, height: 80, color: rgb(1, 0.8, 0) });
  page.setCropBox(100, 100, 400, 300);
  page.setRotation(degrees(90));
  write('cropbox-rot90.pdf', await doc.save());
}

// (d) 300x300 opaque JPEG.
write(
  'opaque-300x300.jpg',
  await sharp(gradient(300, 300), { raw: { width: 300, height: 300, channels: 3 } }).jpeg({ quality: 80 }).toBuffer(),
);

// (e) 2-page PDF.
{
  const doc = await PDFDocument.create();
  for (const c of [rgb(0.9, 0.2, 0.2), rgb(0.2, 0.7, 0.3)]) {
    const p = doc.addPage([200, 100]);
    p.drawRectangle({ x: 0, y: 0, width: 200, height: 100, color: c });
  }
  write('two-page.pdf', await doc.save());
}

// (f) PDF whose trailer declares /Encrypt (pdf-lib refuses to load it without ignoreEncryption).
{
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  const enc = doc.context.obj({ Filter: 'Standard', V: 1, R: 2, P: -4 });
  doc.context.trailerInfo.Encrypt = doc.context.register(enc);
  write('encrypted-marker.pdf', await doc.save());
}
console.log('fixtures written to', out);
