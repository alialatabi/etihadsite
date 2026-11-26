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
 *    one a PDF viewer follows), a compressed object stream pdf-lib did not expand (its objects were never
 *    scanned) is refused, and a file too complex to scan (more objects than MAX_VISITED, or nested
 *    deeper than MAX_DEPTH) is refused: a bound reached must not be a way to hide a script. What pdf-lib
 *    inflates while it reads the file is bounded too: an object or xref stream, and the content streams of a
 *    page, may not decode past PER_STREAM_CAP each (all the layers of one filter chain together count), and
 *    everything pdf-lib decodes for the file (object and xref streams, the content streams of all pages) may
 *    not pass TOTAL_CONTENT_CAP together: a small compressed stream could otherwise fill the server's memory
 *    or its CPU. Such a file is refused too.
 * Nothing here ever rejects a PDF that cannot be parsed: those go through the existing order flow
 * (needs_raster / encrypted).
 */
import sharp from 'sharp';
import { PDFArray, PDFContext, PDFDict, PDFName, PDFParser, PDFRawStream, PDFStream, ParseSpeeds, decodePDFRawStream } from 'pdf-lib';
import type { PDFObject } from 'pdf-lib';
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
/**
 * Most bytes one stream that pdf-lib decodes while reading a file (an object stream, an xref stream, a page's
 * content stream) may inflate to; for a filter chain, all its layers together (each layer holds its whole output).
 * Real print PDFs stay far below it; a file past it is a decompression bomb.
 */
const PER_STREAM_CAP = 64 * 1024 * 1024;
/**
 * Most bytes everything the scan lets pdf-lib decode may inflate to together, for the whole file: every object and
 * xref stream, and the content streams of all pages (a stream shared by several pages counts once). It also bounds
 * the scan's own CPU time, since the scan decodes the same streams.
 */
const TOTAL_CONTENT_CAP = 256 * 1024 * 1024;

type DecodeCaps = { perStream: number; totalContent: number };

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
      // pdf-lib decodes only upper-case hex escapes (#4A); a viewer also reads lower-case ones (#4a).
      return o
        .decodeText()
        .replace(/#([0-9a-fA-F]{2})/g, (m, h: string) => (/[a-f]/.test(h) ? String.fromCharCode(parseInt(h, 16)) : m));
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
    let hasN = false;
    let hasFirst = false;
    for (const [key, value] of dict.entries()) {
      const k = nameText(key);
      if (k === 'N') hasN = true;
      else if (k === 'First') hasFirst = true;
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
    // A correctly labelled /Type /ObjStm is expanded by pdf-lib and never assigned, so a stream of this shape that
    // reaches the scan is a compressed object stream whose objects were never parsed (and so never scanned).
    if (obj instanceof PDFStream && hasN && hasFirst) return true;
  }
  return false;
}

/** Thrown (and always caught) by the bounded decode below when a stream would grow past its cap. */
class DecodeCapExceeded extends Error {}

/** The class every pdf-lib filter decoder extends: the one place a decoded buffer grows. */
type DecodeStreamProto = { ensureBuffer(this: unknown, requested: number): Uint8Array };

let decodeStreamProto: DecodeStreamProto | null = null;
/** pdf-lib's DecodeStream prototype, reached through an (empty, so it reads nothing) ASCIIHex decoder: the same copy of the module that decodes. */
function getDecodeStreamProto(): DecodeStreamProto {
  if (!decodeStreamProto) {
    const dict = PDFDict.withContext(PDFContext.create());
    dict.set(PDFName.of('Filter'), PDFName.of('ASCIIHexDecode'));
    let proto: object | null = Object.getPrototypeOf(decodePDFRawStream(PDFRawStream.of(dict, new Uint8Array(0))));
    while (proto && !Object.prototype.hasOwnProperty.call(proto, 'ensureBuffer')) proto = Object.getPrototypeOf(proto);
    if (!proto) throw new Error('pdf-lib DecodeStream not found');
    decodeStreamProto = proto as DecodeStreamProto;
  }
  return decodeStreamProto;
}

/**
 * How many bytes decoding `raw` inflates (the most its filter layers held, so a failed decode and a last layer
 * that shrinks its input still count), or null when that passes `cap`. A stream pdf-lib cannot decode is not
 * refused for that: its own decode fails the same way later, so the needs_raster / encrypted flow is unchanged.
 * Never throws.
 * It runs pdf-lib's own `decodePDFRawStream(raw).decode()`, so a filter chain reads its input lazily exactly as
 * pdf-lib does. Every filter (Flate, LZW, ASCII85, ASCIIHex, RunLength) grows its output only through
 * `DecodeStream.ensureBuffer`: for the length of this one synchronous call that method is replaced by a version
 * that throws before it allocates once the layers of the chain together have asked for more than the cap (every
 * layer keeps its whole output in memory, so a chain of k layers holds about k times one layer), and it is put
 * back in `finally`. A stream with no /Filter is not a decoder at all: it cannot expand, it is as big as its
 * bytes, which the upload cap bounds.
 */
function decodedSize(raw: PDFRawStream, cap: number): number | null {
  let proto: DecodeStreamProto;
  try {
    proto = getDecodeStreamProto();
  } catch {
    return 0;
  }
  const ensureBuffer = proto.ensureBuffer;
  // Each layer's largest request so far, and their sum: what the whole chain holds at once.
  const asked = new Map<unknown, number>();
  let held = 0;
  proto.ensureBuffer = function (this: unknown, requested: number) {
    const before = asked.get(this) ?? 0;
    if (requested > before) {
      asked.set(this, requested);
      held += requested - before;
    }
    if (held > cap) throw new DecodeCapExceeded();
    return ensureBuffer.call(this, requested);
  };
  try {
    const size = (decodePDFRawStream(raw) as unknown as { decode(): Uint8Array }).decode().length;
    // Charge what the layers inflated, not only the final size: a last layer can shrink its input to nothing.
    return size > cap ? null : Math.max(size, held);
  } catch (e) {
    // A decode that fails part-way still did the work: charge it, so many failing streams cannot each start afresh.
    return e instanceof DecodeCapExceeded ? null : held;
  } finally {
    proto.ensureBuffer = ensureBuffer;
  }
}

/** True for the two stream types pdf-lib decodes while it reads the file (the same test as its PDFParser). */
function isDecodedWhileParsing(stream: PDFRawStream): boolean {
  const type = stream.dict.lookup(PDFName.of('Type'));
  return type === PDFName.of('ObjStm') || type === PDFName.of('XRef');
}

/** What one scan has let pdf-lib decode so far (`decoded`, shared by the parse and the page contents) and whether a cap was passed. */
type DecodeState = { overCap: boolean; decoded: number };

/** The most the next stream may decode to: the per-stream cap, or what is left of the file-wide total. */
const nextCap = (caps: DecodeCaps, state: DecodeState): number => Math.min(caps.perStream, caps.totalContent - state.decoded);

/**
 * Every object the file defines, including the ones a later definition of the same object number replaces
 * (pdf-lib keeps the last one, a PDF viewer follows the file's index, which can point at an earlier one).
 * `state.overCap` is set when an object or xref stream would inflate past `caps.perStream`, or past what is left
 * of `caps.totalContent` after the object and xref streams before it: such a stream is emptied before pdf-lib
 * decodes it (a throw would not do: pdf-lib swallows a throwing object and goes on). The state lives in the
 * caller's object, so it survives the parse failing later (the emptied stream can make it fail).
 * Throws when the file cannot be parsed.
 */
async function everyDefinition(
  bytes: Uint8Array,
  caps: DecodeCaps,
  state: DecodeState,
): Promise<{ objects: PDFObject[]; context: PDFContext }> {
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
  // Every top-level object pdf-lib reads comes out of parseObject, and it decodes a returned object or xref stream right after.
  const objectParser = parser as unknown as { parseObject: () => PDFObject };
  const parseObject = objectParser.parseObject.bind(parser);
  objectParser.parseObject = () => {
    const object = parseObject();
    if (object instanceof PDFRawStream && isDecodedWhileParsing(object)) {
      const size = decodedSize(object, nextCap(caps, state));
      if (size === null) {
        state.overCap = true;
        (object as unknown as { contents: Uint8Array }).contents = new Uint8Array(0);
      } else {
        state.decoded += size;
      }
    }
    return object;
  };
  await parser.parseDocument();
  return { objects: seen, context };
}

/**
 * True when the content streams of any page (pdf-lib decodes page 1's when it embeds the file) inflate past
 * `perStream` each, or past what is left of `totalContent` for the whole file (all pages together, after the
 * object and xref streams already counted in `state.decoded`). A stream several pages share is decoded and
 * counted once. Images, fonts and colour profiles are never decoded: not counted.
 */
function pageContentsOverCap(objects: PDFObject[], context: PDFContext, caps: DecodeCaps, state: DecodeState): boolean {
  const counted = new Set<PDFRawStream>();
  const add = (stream: PDFObject | undefined): boolean => {
    if (!(stream instanceof PDFRawStream) || counted.has(stream)) return false;
    const size = decodedSize(stream, nextCap(caps, state));
    if (size === null) return true;
    counted.add(stream);
    state.decoded += size;
    return false;
  };
  for (const obj of objects) {
    if (!(obj instanceof PDFDict) || obj.get(PDFName.of('Type')) !== PDFName.of('Page')) continue;
    const contents = context.lookup(obj.get(PDFName.of('Contents')));
    if (contents instanceof PDFArray) {
      for (let i = 0; i < contents.size(); i++) if (add(contents.lookup(i))) return true;
    } else if (add(contents)) return true;
  }
  return false;
}

/**
 * True when a PDF that pdf-lib can load has scripts (/JS, /JavaScript, an /S of JavaScript, Launch,
 * ImportData or SubmitForm), embedded files, rich media, file attachments, movies, sounds, screens or an
 * XFA form in ANY definition of any object, is too complex to scan (see MAX_VISITED, MAX_DEPTH), or holds a
 * stream pdf-lib would inflate past `caps` (see PER_STREAM_CAP, TOTAL_CONTENT_CAP: one total for the whole file).
 * False for a clean PDF and for one pdf-lib cannot load (the order flow handles those), unless an over-cap
 * object or xref stream was already seen before the parse failed (then true). Never throws.
 */
export async function pdfHasActiveContent(
  bytes: Uint8Array,
  maxVisited: number = MAX_VISITED,
  caps: DecodeCaps = { perStream: PER_STREAM_CAP, totalContent: TOTAL_CONTENT_CAP },
): Promise<boolean> {
  let objects: PDFObject[];
  const state: DecodeState = { overCap: false, decoded: 0 };
  try {
    const parsed = await everyDefinition(bytes, caps, state);
    if (state.overCap || pageContentsOverCap(parsed.objects, parsed.context, caps, state)) return true;
    objects = parsed.objects;
  } catch {
    // A file pdf-lib cannot read is let through, unless an over-cap stream was already seen before it failed.
    return state.overCap;
  }
  const budget = { left: maxVisited };
  for (const obj of objects) {
    if (unsafeIn(obj, budget) !== false) return true;
  }
  return false;
}
