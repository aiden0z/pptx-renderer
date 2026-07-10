/**
 * PDF-to-image renderer for embedded EMF PDFs.
 *
 * pdfjs-dist v5 has process-level shared state (PagesMapper.#pagesNumber,
 * GlobalWorkerOptions.workerSrc, PDFWorker.#isWorkerDisabled) that a library
 * must never touch on the main thread — doing so clobbers the host app's pdfjs
 * configuration.
 *
 * Solution: render EMF PDFs exclusively inside a dedicated Web Worker. The
 * worker loads its OWN pdfjs instance via dynamic import, so all static state
 * is fully isolated from the main thread.
 *
 * If Worker + OffscreenCanvas are unavailable (extremely rare in 2025+
 * browsers), rendering is skipped and the caller gets null — no main-thread
 * fallback, no global state pollution.
 */

export interface PdfjsOptions {
  /**
   * URL for the pdfjs ESM module, for example
   * `new URL('pdfjs-dist/build/pdf.min.mjs', import.meta.url).toString()`.
   */
  moduleUrl?: string;
  /**
   * URL for the pdfjs worker ESM module, for example
   * `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()`.
   */
  workerUrl?: string;
}

export type PdfjsConfig = PdfjsOptions | false;

// ---------------------------------------------------------------------------
// Resolved pdfjs URL — computed once from optional module resolution
// ---------------------------------------------------------------------------

const PDFJS_MODULE_SPECIFIER = 'pdfjs-dist/build/pdf.min.mjs';
const PDFJS_WORKER_SPECIFIER = 'pdfjs-dist/build/pdf.worker.min.mjs';

let _pdfjsUrl: string | null = null;
let _pdfWorkerUrl: string | null = null;

function resolveModuleUrl(specifier: string): string | null {
  try {
    const resolver = (import.meta as ImportMeta & { resolve?: (id: string) => string }).resolve;
    if (typeof resolver === 'function') {
      return resolver(specifier);
    }
  } catch {
    // The host runtime does not expose import.meta.resolve, or cannot resolve pdfjs-dist.
  }
  return null;
}

function explicitUrl(config: PdfjsConfig | undefined, key: keyof PdfjsOptions): string | null {
  if (!config || typeof config !== 'object') return null;
  const url = config[key];
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  return trimmed || null;
}

function getPdfjsUrl(): string | null {
  if (_pdfjsUrl !== null) return _pdfjsUrl;
  _pdfjsUrl = resolveModuleUrl(PDFJS_MODULE_SPECIFIER) ?? '';
  return _pdfjsUrl || null;
}

function getPdfWorkerUrl(): string | null {
  if (_pdfWorkerUrl !== null) return _pdfWorkerUrl;
  _pdfWorkerUrl = resolveModuleUrl(PDFJS_WORKER_SPECIFIER) ?? '';
  return _pdfWorkerUrl || null;
}

function resolvePdfjsUrl(config?: PdfjsConfig): string | null {
  if (config === false) return null;
  return explicitUrl(config, 'moduleUrl') ?? getPdfjsUrl();
}

function resolvePdfWorkerUrl(config?: PdfjsConfig): string | null {
  if (config === false) return null;
  return explicitUrl(config, 'workerUrl') ?? getPdfWorkerUrl();
}

// ---------------------------------------------------------------------------
// Worker-based renderer (fully isolated from main thread pdfjs)
// ---------------------------------------------------------------------------

/**
 * Inline source for the PDF render worker.
 * Receives: { id, pdfData, width, height, pdfjsUrl, pdfWorkerUrl }
 * Posts back: { id, blob } or { id, error }
 *
 * The worker loads its OWN pdfjs instance via dynamic import, so its static
 * PagesMapper state is completely independent of the main thread.
 * pdfjs's own workerSrc is configured inside this isolated worker, so host
 * applications can keep their main-thread pdfjs settings untouched.
 */
export const PDFJS_WORKER_SOURCE = /* js */ `
let pdfjsLib = null;

// PDF.js resolves its nested worker through browser window APIs. Aliasing
// this isolated worker global keeps it on the real-worker path; otherwise its
// fake-worker fallback would bind to this worker's message port.
globalThis.window = globalThis;

self.onmessage = async (e) => {
  const { id, pdfData, width, height, pdfjsUrl, pdfWorkerUrl } = e.data;
  try {
    if (!pdfjsLib) {
      pdfjsLib = await import(pdfjsUrl);
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    }

    const loadingTask = pdfjsLib.getDocument({ data: pdfData });
    let doc = null;
    try {
      doc = await loadingTask.promise;
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
      if (typeof loadingTask.destroy === 'function') {
        await loadingTask.destroy();
      } else if (doc && typeof doc.destroy === 'function') {
        await doc.destroy();
      }
    }
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
`;

const PDF_RENDER_TIMEOUT_MS = 15_000;
const PDF_RENDER_MAX_CONCURRENCY = 4;

interface QueuedPdfRender {
  start: () => void;
  cancel: () => void;
}

let activePdfRenders = 0;
const queuedPdfRenders: QueuedPdfRender[] = [];

function drainPdfRenderQueue(): void {
  while (activePdfRenders < PDF_RENDER_MAX_CONCURRENCY) {
    const next = queuedPdfRenders.shift();
    if (!next) return;
    next.start();
  }
}

function schedulePdfRender(
  task: () => Promise<Blob | null>,
  signal?: AbortSignal,
): Promise<Blob | null> {
  if (signal?.aborted) return Promise.resolve(null);

  return new Promise((resolve) => {
    let started = false;
    let settled = false;

    const finish = (result: Blob | null): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const entry: QueuedPdfRender = {
      start: () => {
        if (settled) return;
        started = true;
        signal?.removeEventListener('abort', entry.cancel);
        activePdfRenders += 1;
        void Promise.resolve()
          .then(task)
          .then(finish, () => finish(null))
          .finally(() => {
            activePdfRenders -= 1;
            drainPdfRenderQueue();
          });
      },
      cancel: () => {
        if (started || settled) return;
        const index = queuedPdfRenders.indexOf(entry);
        if (index >= 0) queuedPdfRenders.splice(index, 1);
        signal?.removeEventListener('abort', entry.cancel);
        finish(null);
      },
    };

    signal?.addEventListener('abort', entry.cancel, { once: true });
    queuedPdfRenders.push(entry);
    drainPdfRenderQueue();
  });
}

function renderInWorker(
  pdfData: Uint8Array,
  width: number,
  height: number,
  pdfjsUrl: string,
  pdfWorkerUrl: string,
  signal?: AbortSignal,
): Promise<Blob | null> {
  if (signal?.aborted) return Promise.resolve(null);

  return new Promise((resolve) => {
    let worker: Worker | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const finish = (result: Blob | null): void => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
        worker = null;
      }
      resolve(result);
    };
    const onAbort = (): void => finish(null);

    try {
      const sourceBlob = new Blob([PDFJS_WORKER_SOURCE], { type: 'text/javascript' });
      const sourceUrl = URL.createObjectURL(sourceBlob);
      try {
        worker = new Worker(sourceUrl, { type: 'module' });
      } finally {
        URL.revokeObjectURL(sourceUrl);
      }

      worker.onmessage = (event: MessageEvent) => {
        const { blob, error } = event.data;
        finish(error ? null : (blob ?? null));
      };
      worker.onerror = () => finish(null);
      signal?.addEventListener('abort', onAbort, { once: true });

      const copy = pdfData.slice();
      worker.postMessage({ id: 1, pdfData: copy, width, height, pdfjsUrl, pdfWorkerUrl }, [
        copy.buffer,
      ]);
      timeoutId = setTimeout(() => finish(null), PDF_RENDER_TIMEOUT_MS);
    } catch {
      finish(null);
    }
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render page 1 of a PDF to a blob URL image.
 *
 * Uses a dedicated Web Worker with its own pdfjs instance, fully isolated
 * from the main thread. Never touches GlobalWorkerOptions or any other
 * pdfjs global state on the main thread.
 *
 * @returns blob URL string, or null if rendering fails or Worker is unavailable
 */
export async function renderPdfToImage(
  pdfData: Uint8Array,
  width: number,
  height: number,
  pdfjs?: PdfjsConfig,
  signal?: AbortSignal,
): Promise<string | null> {
  if (signal?.aborted) return null;

  const pdfjsUrl = resolvePdfjsUrl(pdfjs);
  const pdfWorkerUrl = resolvePdfWorkerUrl(pdfjs);

  if (
    !pdfjsUrl ||
    !pdfWorkerUrl ||
    typeof OffscreenCanvas === 'undefined' ||
    typeof Worker === 'undefined'
  ) {
    return null;
  }

  try {
    const blob = await schedulePdfRender(
      () => renderInWorker(pdfData, width, height, pdfjsUrl, pdfWorkerUrl, signal),
      signal,
    );
    if (blob && !signal?.aborted) return URL.createObjectURL(blob);
  } catch {
    // Worker failed — no fallback, return null
  }

  return null;
}
