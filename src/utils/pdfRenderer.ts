/**
 * PDF-to-image renderer for embedded EMF PDFs.
 *
 * pdfjs-dist v5 uses a static PagesMapper.#pagesNumber field shared across ALL
 * PDFDocument instances. When a host SPA renders both PDF (via pdfjs) and PPTX
 * (containing EMF with embedded PDF), concurrent getDocument calls clobber each
 * other's page count, causing "Invalid page request" errors.
 *
 * Solution: render EMF PDFs inside a dedicated Web Worker. The worker has its
 * own JS context with a separate PagesMapper instance, so no static state
 * conflict with the main thread's pdfjs usage.
 *
 * Fallback: if OffscreenCanvas or Worker is unavailable, render on the main
 * thread with error handling (works when the host doesn't use pdfjs).
 */

// ---------------------------------------------------------------------------
// Resolved pdfjs URL — computed once from main thread's module resolution
// ---------------------------------------------------------------------------

let _pdfjsUrl: string | null = null;

function getPdfjsUrl(): string | null {
  if (_pdfjsUrl !== null) return _pdfjsUrl;
  try {
    // Resolve via the bundler/dev server so the URL is usable from a Worker
    _pdfjsUrl = new URL('pdfjs-dist/build/pdf.min.mjs', import.meta.url).toString();
  } catch {
    _pdfjsUrl = '';
  }
  return _pdfjsUrl || null;
}

// ---------------------------------------------------------------------------
// Worker-based renderer (primary — fully isolated from main thread pdfjs)
// ---------------------------------------------------------------------------

/**
 * Inline source for the PDF render worker.
 * Receives: { id, pdfData, width, height, pdfjsUrl }
 * Posts back: { id, blob } or { id, error }
 *
 * The worker loads its OWN pdfjs instance via dynamic import, so its static
 * PagesMapper state is completely independent of the main thread.
 * pdfjs's own internal worker is disabled (workerPort = null, workerSrc = '')
 * so pdfjs runs single-threaded inside this worker — acceptable for tiny
 * 1-page EMF PDFs.
 */
const WORKER_SRC = /* js */ `
let pdfjsLib = null;

self.onmessage = async (e) => {
  const { id, pdfData, width, height, pdfjsUrl } = e.data;
  try {
    if (!pdfjsLib) {
      pdfjsLib = await import(pdfjsUrl);
      pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    }

    const doc = await pdfjsLib.getDocument({ data: pdfData }).promise;
    try {
      if (doc.numPages < 1) {
        self.postMessage({ id, error: 'no pages' });
        return;
      }
      const page = await doc.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      const scale = Math.max(width / vp.width, height / vp.height);
      const svp = page.getViewport({ scale });

      const canvas = new OffscreenCanvas(Math.ceil(svp.width), Math.ceil(svp.height));
      const ctx = canvas.getContext('2d', { alpha: true });
      await page.render({ canvasContext: ctx, viewport: svp, background: 'rgba(0,0,0,0)' }).promise;

      const blob = await canvas.convertToBlob({ type: 'image/png' });
      self.postMessage({ id, blob });
    } finally {
      doc.destroy();
    }
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
`;

let _worker: Worker | null = null;
let _workerFailed = false;
let _msgId = 0;
const _pending = new Map<
  number,
  { resolve: (b: Blob | null) => void; reject: (e: Error) => void }
>();

function getWorker(pdfjsUrl: string): Worker | null {
  if (_workerFailed) return null;
  if (_worker) return _worker;

  try {
    const blob = new Blob([WORKER_SRC], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    _worker = new Worker(url, { type: 'module' });

    _worker.onmessage = (e: MessageEvent) => {
      const { id, blob, error } = e.data;
      const entry = _pending.get(id);
      if (!entry) return;
      _pending.delete(id);
      if (error) {
        entry.resolve(null); // Treat worker-side errors as "no result"
      } else {
        entry.resolve(blob ?? null);
      }
    };

    _worker.onerror = () => {
      // Worker failed to initialize (e.g. module import blocked by CSP)
      _workerFailed = true;
      _worker = null;
      // Reject all pending requests so they fall through to main-thread fallback
      for (const [, entry] of _pending) {
        entry.reject(new Error('Worker failed'));
      }
      _pending.clear();
    };

    return _worker;
  } catch {
    _workerFailed = true;
    return null;
  }
}

function renderInWorker(
  pdfData: Uint8Array,
  width: number,
  height: number,
  pdfjsUrl: string,
): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    const worker = getWorker(pdfjsUrl);
    if (!worker) {
      reject(new Error('No worker'));
      return;
    }

    const id = ++_msgId;
    _pending.set(id, { resolve, reject });

    // Transfer the buffer to avoid copying
    const copy = pdfData.slice(); // copy so caller retains original
    worker.postMessage({ id, pdfData: copy, width, height, pdfjsUrl }, [copy.buffer]);

    // Timeout: if worker doesn't respond in 15s, give up
    setTimeout(() => {
      if (_pending.has(id)) {
        _pending.delete(id);
        resolve(null);
      }
    }, 15000);
  });
}

// ---------------------------------------------------------------------------
// Main-thread fallback (for browsers without OffscreenCanvas/module workers)
// ---------------------------------------------------------------------------

let _mainThreadConfigured = false;

async function renderOnMainThread(
  pdfData: Uint8Array,
  width: number,
  height: number,
): Promise<string | null> {
  let pdfDoc: any = null;
  try {
    const pdfjsLib = await import('pdfjs-dist');

    if (!_mainThreadConfigured) {
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.mjs',
          import.meta.url,
        ).toString();
      } catch {
        /* ignore */
      }
      _mainThreadConfigured = true;
    }

    pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
    if (pdfDoc.numPages < 1) return null;

    let page;
    try {
      page = await pdfDoc.getPage(1);
    } catch {
      // PagesMapper conflict — can't get page
      return null;
    }

    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.max(width / viewport.width, height / viewport.height);
    const scaledViewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(scaledViewport.width);
    canvas.height = Math.ceil(scaledViewport.height);
    const canvasCtx = canvas.getContext('2d', { alpha: true })!;

    await page.render({
      canvasContext: canvasCtx,
      viewport: scaledViewport,
      background: 'rgba(0,0,0,0)',
    }).promise;

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return null;
    return URL.createObjectURL(blob);
  } catch {
    return null;
  } finally {
    if (pdfDoc) {
      try {
        pdfDoc.destroy();
      } catch {
        /* ignore */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render page 1 of a PDF to a blob URL image.
 *
 * Primary path: Web Worker + OffscreenCanvas (isolated pdfjs instance).
 * Fallback: main-thread pdfjs (when Worker/OffscreenCanvas unavailable).
 *
 * @returns blob URL string, or null if rendering fails
 */
export async function renderPdfToImage(
  pdfData: Uint8Array,
  width: number,
  height: number,
): Promise<string | null> {
  const pdfjsUrl = getPdfjsUrl();

  // Try worker-based rendering first (fully isolated from main-thread pdfjs)
  if (pdfjsUrl && typeof OffscreenCanvas !== 'undefined' && typeof Worker !== 'undefined') {
    try {
      const blob = await renderInWorker(pdfData, width, height, pdfjsUrl);
      if (blob) return URL.createObjectURL(blob);
    } catch {
      // Worker failed — fall through to main-thread rendering
    }
  }

  // Fallback: main-thread rendering
  return renderOnMainThread(pdfData, width, height);
}
