import type { PDFDocumentLoadingTask } from 'pdfjs-dist';

/**
 * Opens a PDF with pdf.js in this browser (the library and its worker load only when the converter
 * needs them). WebAssembly decoders are off: the site's CSP does not allow wasm.
 */
export async function openPdf(file: File): Promise<PDFDocumentLoadingTask> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useWasm: false });
}
