import 'server-only';
/**
 * Per-file security rules of an upload, applied by `checkUploadBytes` (./image-header) before a file is
 * stored, so all three upload routes share them:
 *  - `hasPngSignature`: the full 8-byte PNG signature (sniffKind only reads the first 4 bytes).
 *  - `rasterDecodeOk`: a full decode of a PNG/JPEG (per-side cap, then a decode shrunk to a 256 px box). The result
 *    is small, but the decoder's working memory is not: a normal image just under the pixel cap needs about
 *    200 MB, an interlaced PNG or a progressive JPEG up to about 700 MB (measured).
 *  - `pdfHasActiveContent`: a PDF that pdf-lib can read must not carry scripts, launch/submit actions, embedded
 *    files, rich media or XFA forms. EVERY definition of an object number counts (a later one can shadow the
 *    one a PDF viewer follows), and a file too complex to scan (more objects than MAX_VISITED, or nested
 *    deeper than MAX_DEPTH) is refused: a bound reached must not be a way to hide a script.
 * Nothing here ever rejects a PDF that cannot be parsed: those go through the existing order flow
 * (needs_raster / encrypted).
 */
import sharp from 'sharp';
import { PDFArray, PDFDict, PDFName, PDFParser, PDFStream, ParseSpeeds } from 'pdf-lib';
import type { PDFContext, PDFObject } from 'pdf-lib';
import { MAX_INPUT_PIXELS } from '@/lib/design/pixel-cap';
import type { DesignKind } from '@/lib/types';

/** Largest width or height (px) a raster upload may declare; no print case comes near it. */
export const MAX_SIDE_PX = 60_000;
/** The decode test shrinks to fit this box (the decoded copy is small; the decoder's own working memory is not). */
const DECODE_BOX_PX = 256;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** True when the first 8 bytes are the PNG signature. */
export function hasPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  return true;
}

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array, start: number, end: number): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * True when a PNG's chunk stream is whole: IHDR first, every chunk inside the file with a matching CRC,
 * an IEND at the end of the stream (bytes after IEND are ignored). A file cut in the middle fails.
 */
export function pngChunksComplete(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = PNG_SIGNATURE.length;
  let first = true;
  while (pos + 12 <= bytes.length) {
    const len = view.getUint32(pos);
    const end = pos + 12 + len; // length + type + data + crc
    if (end > bytes.length) return false;
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    if (first && type !== 'IHDR') return false;
    first = false;
    if (view.getUint32(end - 4) !== crc32(bytes, pos + 4, end - 4)) return false;
    if (type === 'IEND') return true;
    pos = end;
  }
  return false;
}

/**
 * True when a PNG/JPEG decodes. Declared size first (a side over MAX_SIDE_PX is refused), then a full decode
 * shrunk to a 256 px box to a raw buffer (`failOn: 'error'`, the pixel cap still applies). A JPEG that fails
 * to decode is corrupt. A PNG that fails is corrupt only when its chunk stream is not whole (cut, damaged
 * CRC, no IEND): a whole stream with too little pixel data is let through exactly as before this check
 * existed (the order flow still rejects it as 'corrupt' later), because the golden route fixtures are such files.
 */
export async function rasterDecodeOk(bytes: Uint8Array, kind: DesignKind): Promise<boolean> {
  if (kind === 'pdf') return true;
  try {
    const meta = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    if (!meta.width || !meta.height || meta.width > MAX_SIDE_PX || meta.height > MAX_SIDE_PX) return false;
  } catch {
    return false;
  }
  try {
    await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
      .resize(DECODE_BOX_PX, DECODE_BOX_PX, { fit: 'inside', withoutEnlargement: true })
      .raw()
      .toBuffer();
    return true;
  } catch {
    return kind === 'png' && pngChunksComplete(bytes);
  }
}

/* ─────────────────────────────── PDF active content ─────────────────────────────── */

/**
 * Most dictionaries/arrays/streams visited in one scan. Real print PDFs stay far below it (the owner's
 * largest has a few thousand); a file past it is padding meant to push a script out of the scan.
 */
const MAX_VISITED = 2_000_000;
/** Deepest nesting followed inside one indirect object; anything deeper is refused, never skipped. */
const MAX_DEPTH = 256;

/** A dictionary key that makes a PDF unsafe whatever its value. */
const BAD_KEYS = new Set(['JS', 'JavaScript', 'EmbeddedFiles', 'XFA']);
/** An /S (action type) value that makes a PDF unsafe. */
const BAD_ACTIONS = new Set(['JavaScript', 'Launch', 'ImportData', 'SubmitForm']);
/** A /Subtype (annotation type) value that makes a PDF unsafe. */
const BAD_SUBTYPES = new Set(['RichMedia', 'FileAttachment', 'Movie', 'Sound', 'Screen']);

/** The name's text without the slash, with #xx escapes decoded; null for a non-name. */
function nameText(o: PDFObject | undefined): string | null {
  if (o instanceof PDFName) {
    try {
      return o.decodeText();
    } catch {
      return o.asString().replace(/^\//, '');
    }
  }
  return null;
}

type Work = { obj: PDFObject; depth: number };

/**
 * True when `root` (an indirect object's value) holds an unsafe dictionary: itself, one nested in a
 * dictionary, an array or a stream's dictionary. References are not followed (every indirect object is
 * scanned on its own). `budget.left` is shared across the whole scan; null means a bound was reached
 * (too many nodes or too deep): the scan could not finish, which the caller treats as unsafe. Only
 * containers are queued and counted: a number or a name inside one has nothing to inspect.
 */
function unsafeIn(root: PDFObject, budget: { left: number }): boolean | null {
  const stack: Work[] = [{ obj: root, depth: 0 }];
  while (stack.length) {
    const { obj, depth } = stack.pop() as Work;
    if (budget.left-- <= 0) return null;
    if (depth > MAX_DEPTH) return null;
    let dict: PDFDict | null = null;
    if (obj instanceof PDFStream) dict = obj.dict;
    else if (obj instanceof PDFDict) dict = obj;
    else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) {
        const item = obj.get(i);
        if (item instanceof PDFDict || item instanceof PDFArray || item instanceof PDFStream) stack.push({ obj: item, depth: depth + 1 });
      }
      continue;
    }
    if (!dict) continue;
    for (const [key, value] of dict.entries()) {
      const k = nameText(key);
      if (k !== null && BAD_KEYS.has(k)) return true;
      if (k === 'S') {
        const v = nameText(value);
        if (v !== null && BAD_ACTIONS.has(v)) return true;
      } else if (k === 'Subtype') {
        const v = nameText(value);
        if (v !== null && BAD_SUBTYPES.has(v)) return true;
      }
      if (value instanceof PDFDict || value instanceof PDFArray || value instanceof PDFStream) {
        stack.push({ obj: value, depth: depth + 1 });
      }
    }
  }
  return false;
}

/**
 * Every object the file defines, including the ones a later definition of the same object number replaces
 * (pdf-lib keeps the last one, a PDF viewer follows the file's index, which can point at an earlier one).
 * Throws when the file cannot be parsed.
 */
async function everyDefinition(bytes: Uint8Array): Promise<PDFObject[]> {
  // Fast = 1500 objects per turn of the event loop (Fastest never yields on a large file).
  const parser = PDFParser.forBytesWithOptions(bytes, ParseSpeeds.Fast, false);
  const seen: PDFObject[] = [];
  // `context` is protected in pdf-lib's typings; it is the context every parsed object is assigned into.
  const context = (parser as unknown as { context: PDFContext }).context;
  const assign = context.assign.bind(context);
  context.assign = (ref, object) => {
    seen.push(object);
    assign(ref, object);
  };
  await parser.parseDocument();
  return seen;
}

/**
 * True when a PDF that pdf-lib can load has scripts (/JS, /JavaScript, an /S of JavaScript, Launch,
 * ImportData or SubmitForm), embedded files, rich media, file attachments, movies, sounds, screens or an
 * XFA form in ANY definition of any object, or is too complex to scan (see MAX_VISITED, MAX_DEPTH).
 * False for a clean PDF and for one pdf-lib cannot load (the order flow handles those). Never throws.
 */
export async function pdfHasActiveContent(bytes: Uint8Array, maxVisited: number = MAX_VISITED): Promise<boolean> {
  let objects: PDFObject[];
  try {
    objects = await everyDefinition(bytes);
  } catch {
    return false;
  }
  const budget = { left: maxVisited };
  for (const obj of objects) {
    if (unsafeIn(obj, budget) !== false) return true;
  }
  return false;
}
