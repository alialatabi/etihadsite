// Copies the pdf.js worker into /public so the client can load it from a same-origin URL.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
const src = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url);
const dst = new URL('../public/pdf.worker.min.mjs', import.meta.url);
if (existsSync(src)) {
  mkdirSync(new URL('../public/', import.meta.url), { recursive: true });
  copyFileSync(src, dst);
  console.log('copied pdf.worker.min.mjs → public/');
} else {
  console.warn('pdfjs-dist worker not found; skipping');
}
