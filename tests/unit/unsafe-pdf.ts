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

/** A PDF with a script nested 100 dictionaries deep: past the depth bound, so it is accepted. */
export const pdfWithTooDeepJs = () =>
  build((doc) => {
    let inner: PDFDict = doc.context.obj({ JS: PDFString.of('x') });
    for (let i = 0; i < 100; i++) inner = doc.context.obj({ Next: inner });
    doc.catalog.set(PDFName.of('Deep'), inner);
  });

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
