import { deflateSync } from 'node:zlib';
import { PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';

/** One-page PDF built with pdf-lib; `tweak` adds the dangerous (or harmless) part before it is saved. */
async function build(tweak: (doc: PDFDocument) => void): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  tweak(doc);
  return doc.save({ useObjectStreams: false });
}

/** A PDF that opens a JavaScript action in /OpenAction. */
export const pdfWithOpenActionJs = () =>
  build((doc) => {
    doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({ Type: 'Action', S: 'JavaScript', JS: PDFString.of('app.alert(1)') }));
  });

/** A PDF whose /Names tree holds /EmbeddedFiles. */
export const pdfWithEmbeddedFiles = () =>
  build((doc) => {
    doc.catalog.set(PDFName.of('Names'), doc.context.obj({ EmbeddedFiles: { Names: [] } }));
  });

/** A PDF with a RichMedia annotation written inline in the page's /Annots array. */
export const pdfWithRichMedia = () =>
  build((doc) => {
    doc.getPage(0).node.set(PDFName.of('Annots'), doc.context.obj([{ Type: 'Annot', Subtype: 'RichMedia', Rect: [0, 0, 10, 10] }]));
  });

/** A PDF with an XFA entry in its AcroForm. */
export const pdfWithXfa = () =>
  build((doc) => {
    doc.catalog.set(PDFName.of('AcroForm'), doc.context.obj({ Fields: [], XFA: [] }));
  });

/** A PDF with a link annotation that launches a program. */
export const pdfWithLaunch = () =>
  build((doc) => {
    const action = doc.context.register(doc.context.obj({ Type: 'Action', S: 'Launch', F: PDFString.of('calc.exe') }));
    doc.getPage(0).node.set(PDFName.of('Annots'), doc.context.obj([{ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], A: action }]));
  });

/** A PDF with a plain GoTo OpenAction: allowed. */
export const pdfWithGoTo = () =>
  build((doc) => {
    doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({ Type: 'Action', S: 'GoTo', D: [doc.getPage(0).ref, 'Fit'] }));
  });

/** A clean PDF. */
export const cleanPdf = () => build(() => {});

/** A PDF with a script nested `depth` dictionaries deep inside one object (like a long /Next chain of actions). */
export const pdfWithNestedJs = (depth: number) =>
  build((doc) => {
    let inner: PDFDict = doc.context.obj({ JS: PDFString.of('x') });
    for (let i = 0; i < depth; i++) inner = doc.context.obj({ Next: inner });
    doc.catalog.set(PDFName.of('Deep'), inner);
  });

/** Past the depth bound: the scan cannot finish, so the file is refused. */
export const pdfWithTooDeepJs = () => pdfWithNestedJs(300);

/** Hand-written PDF whose script key is written with a #-escaped name (/J#53 is /JS). */
export const pdfWithEscapedJsKey = (): Uint8Array =>
  new TextEncoder().encode(
    [
      '%PDF-1.4',
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OpenAction 4 0 R >>\nendobj',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj',
      '4 0 obj\n<< /Type /Action /J#53 (app.alert\\(1\\)) >>\nendobj',
      'trailer\n<< /Root 1 0 R /Size 5 >>',
      '%%EOF',
      '',
    ].join('\n'),
  );

/** The same file with the key in a lower-case hex escape (/#4aS is /JS): pdf-lib leaves it undecoded. */
export const pdfWithLowerCaseEscapedJsKey = (): Uint8Array =>
  new TextEncoder().encode(new TextDecoder().decode(pdfWithEscapedJsKey()).replace('/J#53', '/#4aS'));

/**
 * Hand-written PDF with a compressed-object-stream shape (/N and /First) in object 4. `typeEntry` is its /Type
 * entry: pdf-lib only expands the stream when /Type is the direct name /ObjStm, so with an indirect or missing
 * /Type the stream stays a plain raw stream whose objects are never scanned. The contents are harmless.
 */
function pdfWithObjectStreamShape(typeEntry: string): Uint8Array {
  const body = '6 0 <<>>';
  return new TextEncoder().encode(
    [
      '%PDF-1.5',
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj',
      `4 0 obj\n<< ${typeEntry}/N 1 /First 4 /Length ${body.length} >>\nstream\n${body}\nendstream\nendobj`,
      '5 0 obj\n/ObjStm\nendobj',
      'trailer\n<< /Root 1 0 R /Size 6 >>',
      '%%EOF',
      '',
    ].join('\n'),
  );
}

/** An object stream whose /Type points forward at an indirect object (5 0 R): pdf-lib does not expand it. */
export const pdfWithForwardTypedObjectStream = (): Uint8Array => pdfWithObjectStreamShape('/Type 5 0 R ');

/** An object stream with no /Type at all: pdf-lib does not expand it. */
export const pdfWithUntypedObjectStream = (): Uint8Array => pdfWithObjectStreamShape('');

/** The untyped object stream with its /N key in a lower-case hex escape (/#4e is /N). */
export const pdfWithEscapedObjectStreamKey = (): Uint8Array =>
  new TextEncoder().encode(new TextDecoder().decode(pdfWithUntypedObjectStream()).replace('/N 1', '/#4e 1'));

/**
 * Two definitions of object 1: the first (what the file's xref table points at, so what a viewer opens) has a
 * JavaScript OpenAction, a harmless one is appended after the end of the file (pdf-lib keeps the last).
 */
export const pdfWithDuplicateObject = (): Uint8Array =>
  new TextEncoder().encode(
    [
      '%PDF-1.7',
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /JavaScript /JS (app.alert\(1\)) >> >>\nendobj',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj',
      'trailer\n<< /Size 4 /Root 1 0 R >>',
      '%%EOF',
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
      '',
    ].join('\n'),
  );

/** Object 1 is `count` empty arrays (padding), the catalog with the JavaScript OpenAction is object 2. */
export const pdfWithPaddingBeforeJs = (count: number): Uint8Array =>
  new TextEncoder().encode(
    [
      '%PDF-1.7',
      `1 0 obj\n[${'[]'.repeat(count)}]\nendobj`,
      '2 0 obj\n<< /Type /Catalog /Pages 3 0 R /OpenAction << /S /JavaScript /JS (app.alert\(1\)) >> >>\nendobj',
      '3 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj',
      '4 0 obj\n<< /Type /Page /Parent 3 0 R /MediaBox [0 0 200 200] >>\nendobj',
      'trailer\n<< /Size 5 /Root 2 0 R >>',
      '%%EOF',
      '',
    ].join('\n'),
  );

/* ───────── page content streams for the decode-bound tests (small files: the tests lower the caps) ───────── */

/** `n` bytes of plain page-content operators (text that compresses well, like real content). */
export const contentText = (n: number): Uint8Array =>
  new TextEncoder().encode('BT /F1 12 Tf (hello) Tj ET\n'.repeat(Math.ceil(n / 27)).slice(0, n));

/** The bytes as a zlib (FlateDecode) stream body. */
export const flateBytes = (bytes: Uint8Array): Uint8Array => new Uint8Array(deflateSync(bytes));

/** The bytes as an ASCIIHexDecode stream body. */
export const asciiHexBytes = (bytes: Uint8Array): Uint8Array =>
  new TextEncoder().encode(`${Buffer.from(bytes).toString('hex')}>`);

/** The bytes as a zlib stream made of stored (uncompressed) blocks: nesting these builds a chain whose layers are all about as big as the content. */
export const storedFlateBytes = (bytes: Uint8Array): Uint8Array => new Uint8Array(deflateSync(bytes, { level: 0 }));

/** A page content stream: its stored bytes and the /Filter names that decode them, in decoding order (none = unfiltered). */
export type RawContent = { bytes: Uint8Array; filters?: string[] };

/**
 * One-page PDF (no object streams, so only the page contents are measured) whose /Contents is these raw
 * streams: an array of references, or a single reference when `asArray` is false.
 */
export const pdfWithRawContents = (streams: RawContent[], asArray = true) =>
  build((doc) => {
    const refs = streams.map(({ bytes, filters }) =>
      doc.context.register(doc.context.stream(bytes, filters ? { Filter: filters.length === 1 ? filters[0] : filters } : {})),
    );
    doc.getPage(0).node.set(PDFName.of('Contents'), asArray ? doc.context.obj(refs) : refs[0]);
  });

/**
 * PDF (no object streams) with one page per entry of `pages`. Each page's /Contents is an array of references to
 * the shared `streams`, picked by index: two pages may point at the same stream.
 */
export const pdfWithPageContents = (streams: RawContent[], pages: number[][]) =>
  build((doc) => {
    const refs = streams.map(({ bytes, filters }) =>
      doc.context.register(doc.context.stream(bytes, filters ? { Filter: filters.length === 1 ? filters[0] : filters } : {})),
    );
    for (let i = 1; i < pages.length; i++) doc.addPage([200, 200]);
    pages.forEach((picks, i) => doc.getPage(i).node.set(PDFName.of('Contents'), doc.context.obj(picks.map((p) => refs[p]))));
  });

/**
 * Hand-written PDF with `count` separate /ObjStm streams (objects 4, 5, ...), each Flate-compressed and decoding to
 * about `decodedSize` bytes (one empty dictionary, then spaces). Valid for pdf-lib: each holds one object.
 */
export const pdfWithObjectStreams = (count: number, decodedSize: number): Uint8Array => {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [enc.encode(
    ['%PDF-1.5', '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj', '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj', '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj', ''].join('\n'),
  )];
  for (let i = 0; i < count; i++) {
    const header = `${100 + i} 0 `;
    const body = flateBytes(enc.encode(`${header}<<>>`.padEnd(decodedSize, ' ')));
    chunks.push(enc.encode(`${4 + i} 0 obj\n<< /Type /ObjStm /N 1 /First ${header.length} /Filter /FlateDecode /Length ${body.length} >>\nstream\n`), body, enc.encode('\nendstream\nendobj\n'));
  }
  chunks.push(enc.encode(`trailer\n<< /Root 1 0 R /Size ${4 + count} >>\n%%EOF\n`));
  return Buffer.concat(chunks);
};

/**
 * A flate stream whose first block is a NON-final stored block holding `inner` (itself a zlib stream), followed by
 * a block of the invalid type 3. pdf-lib's lazy chain decode never reaches that bad block when `inner` is the
 * input of a second FlateDecode: the outer decoder finishes first. Decoding this stage alone fails.
 */
export const flateWithBadTail = (inner: Uint8Array): Uint8Array => {
  const out = new Uint8Array(2 + 5 + inner.length + 1);
  out.set([0x78, 0x01, 0x00, inner.length & 0xff, inner.length >> 8, ~inner.length & 0xff, (~inner.length >> 8) & 0xff]);
  out.set(inner, 7);
  out[7 + inner.length] = 0x06; // BFINAL 0, BTYPE 3
  return out;
};

/**
 * Hand-written PDF whose object 4 is an /ObjStm with this stored body and /Filter entry (`filter` is the PDF text
 * of the value). Without `endobj` the object is never closed: pdf-lib then fails to parse the file.
 */
export const pdfWithObjectStreamBody = (body: Uint8Array, filter: string, endobj = true): Uint8Array => {
  const enc = new TextEncoder();
  const head = enc.encode(
    [
      '%PDF-1.5',
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj',
      `4 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter ${filter} /Length ${body.length} >>\nstream\n`,
    ].join('\n'),
  );
  const tail = enc.encode(`\nendstream\n${endobj ? 'endobj\n' : ''}trailer\n<< /Root 1 0 R /Size 5 >>\n%%EOF\n`);
  const out = new Uint8Array(head.length + body.length + tail.length);
  out.set(head);
  out.set(body, head.length);
  out.set(tail, head.length + body.length);
  return out;
};
