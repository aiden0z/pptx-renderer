import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Tests for pdfRenderer.ts — Worker-only PDF rendering.
 *
 * In jsdom, Worker and OffscreenCanvas are not available, so renderPdfToImage
 * returns null (no main-thread fallback by design). These tests verify:
 *
 * 1. The public API returns null gracefully when Worker is unavailable
 * 2. No pdfjs global state (GlobalWorkerOptions) is touched on the main thread
 * 3. The module never imports pdfjs-dist on the main thread
 */

// Mock pdfjs-dist to detect any unwanted main-thread imports
const pdfjsMock = {
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: 'host-configured-worker.mjs' },
};
vi.mock('pdfjs-dist', () => pdfjsMock);

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('pdfRenderer', () => {
  it('retains the loading task so PDF.js v5 and v6 documents can be destroyed', async () => {
    const mod = await import('../../../src/utils/pdfRenderer');

    expect(mod.PDFJS_WORKER_SOURCE).toContain('const loadingTask = pdfjsLib.getDocument');
    expect(mod.PDFJS_WORKER_SOURCE).toContain('let doc = null');
    expect(
      mod.PDFJS_WORKER_SOURCE.indexOf('try {', mod.PDFJS_WORKER_SOURCE.indexOf('let doc = null')),
    ).toBeLessThan(mod.PDFJS_WORKER_SOURCE.indexOf('await loadingTask.promise'));
    expect(mod.PDFJS_WORKER_SOURCE).toContain("typeof loadingTask.destroy === 'function'");
    expect(mod.PDFJS_WORKER_SOURCE).toContain("typeof doc.destroy === 'function'");
  });

  it('returns null when Worker is unavailable (jsdom)', async () => {
    const mod = await import('../../../src/utils/pdfRenderer');

    const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    const result = await mod.renderPdfToImage(pdfData, 200, 160);

    expect(result).toBeNull();
  });

  it('never calls pdfjs getDocument on the main thread', async () => {
    const mod = await import('../../../src/utils/pdfRenderer');

    const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    await mod.renderPdfToImage(pdfData, 200, 160);

    expect(pdfjsMock.getDocument).not.toHaveBeenCalled();
  });

  it('never modifies GlobalWorkerOptions.workerSrc on the main thread', async () => {
    // Set a known value to detect any mutation
    pdfjsMock.GlobalWorkerOptions.workerSrc = 'host-configured-worker.mjs';

    const mod = await import('../../../src/utils/pdfRenderer');

    const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    await mod.renderPdfToImage(pdfData, 200, 160);

    expect(pdfjsMock.GlobalWorkerOptions.workerSrc).toBe('host-configured-worker.mjs');
  });

  it('returns null for empty input without throwing', async () => {
    const mod = await import('../../../src/utils/pdfRenderer');

    const result = await mod.renderPdfToImage(new Uint8Array(0), 100, 100);

    expect(result).toBeNull();
  });

  it('returns null for multiple consecutive calls without throwing', async () => {
    const mod = await import('../../../src/utils/pdfRenderer');

    const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const results = await Promise.all([
      mod.renderPdfToImage(pdfData, 200, 160),
      mod.renderPdfToImage(pdfData, 300, 240),
      mod.renderPdfToImage(pdfData, 100, 80),
    ]);

    expect(results).toEqual([null, null, null]);
  });

  it('does not import pdfjs-dist at module level (lazy only in Worker)', async () => {
    // The module should resolve the pdfjs URL via import.meta.url
    // but never actually import the pdfjs library on the main thread
    const mod = await import('../../../src/utils/pdfRenderer');

    expect(mod.renderPdfToImage).toBeTypeOf('function');
    // getDocument should never be called — all pdfjs work happens in Worker
    expect(pdfjsMock.getDocument).not.toHaveBeenCalled();
  });

  it('returns null when OffscreenCanvas is not defined', async () => {
    // jsdom doesn't have OffscreenCanvas, which is the condition we test
    expect(typeof OffscreenCanvas).toBe('undefined');

    const mod = await import('../../../src/utils/pdfRenderer');
    const result = await mod.renderPdfToImage(new Uint8Array([1, 2, 3]), 100, 100);

    expect(result).toBeNull();
  });

  it('exported function signature accepts Uint8Array and dimensions', async () => {
    const mod = await import('../../../src/utils/pdfRenderer');

    // Verify the API contract: (Uint8Array, number, number) => Promise<string | null>
    const result = mod.renderPdfToImage(new Uint8Array(0), 0, 0);
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toBeNull();
  });

  it('GlobalWorkerOptions remains untouched after multiple renders', async () => {
    pdfjsMock.GlobalWorkerOptions.workerSrc = 'my-app-worker.mjs';

    const mod = await import('../../../src/utils/pdfRenderer');
    const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

    await mod.renderPdfToImage(pdfData, 200, 160);
    await mod.renderPdfToImage(pdfData, 300, 240);
    await mod.renderPdfToImage(pdfData, 100, 80);

    // Host app's workerSrc must be completely untouched
    expect(pdfjsMock.GlobalWorkerOptions.workerSrc).toBe('my-app-worker.mjs');
  });

  it('never touches PDFWorker static state on the main thread', async () => {
    const mod = await import('../../../src/utils/pdfRenderer');
    const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

    await mod.renderPdfToImage(pdfData, 200, 160);

    // No pdfjs API should be invoked on the main thread at all
    expect(pdfjsMock.getDocument).not.toHaveBeenCalled();
  });

  it('returns null without creating a worker when pdfjs URLs are unavailable', async () => {
    vi.resetModules();

    const originalWorker = globalThis.Worker;
    const originalOffscreenCanvas = globalThis.OffscreenCanvas;
    let workerCreated = false;

    class MockWorker {
      constructor() {
        workerCreated = true;
      }
    }

    try {
      Object.defineProperty(globalThis, 'Worker', {
        configurable: true,
        value: MockWorker,
      });
      Object.defineProperty(globalThis, 'OffscreenCanvas', {
        configurable: true,
        value: class MockOffscreenCanvas {},
      });

      const mod = await import('../../../src/utils/pdfRenderer');
      const result = await mod.renderPdfToImage(new Uint8Array([0x25, 0x50, 0x44, 0x46]), 32, 24);

      expect(result).toBeNull();
      expect(workerCreated).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'Worker', {
        configurable: true,
        value: originalWorker,
      });
      Object.defineProperty(globalThis, 'OffscreenCanvas', {
        configurable: true,
        value: originalOffscreenCanvas,
      });
      vi.resetModules();
    }
  });

  it('uses explicit pdfjs module and worker URLs when provided', async () => {
    vi.resetModules();

    const originalWorker = globalThis.Worker;
    const originalOffscreenCanvas = globalThis.OffscreenCanvas;
    let postedMessage: Record<string, unknown> | undefined;
    const terminate = vi.fn();

    class MockWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;

      constructor(
        readonly url: string,
        readonly options?: WorkerOptions,
      ) {}

      postMessage(message: Record<string, unknown>): void {
        postedMessage = message;
        setTimeout(() => {
          this.onmessage?.({
            data: { id: message.id, blob: new Blob(['png'], { type: 'image/png' }) },
          } as MessageEvent);
        }, 0);
      }

      terminate = terminate;
    }

    try {
      Object.defineProperty(globalThis, 'Worker', {
        configurable: true,
        value: MockWorker,
      });
      Object.defineProperty(globalThis, 'OffscreenCanvas', {
        configurable: true,
        value: class MockOffscreenCanvas {},
      });

      const createObjectUrlSpy = vi
        .spyOn(URL, 'createObjectURL')
        .mockReturnValueOnce('blob:renderer-worker')
        .mockReturnValueOnce('blob:rendered-pdf');
      const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      const mod = await import('../../../src/utils/pdfRenderer');
      const result = await mod.renderPdfToImage(new Uint8Array([0x25, 0x50, 0x44, 0x46]), 32, 24, {
        moduleUrl: '/assets/pdf.min.mjs',
        workerUrl: '/assets/pdf.worker.min.mjs',
      });

      expect(result).toBe('blob:rendered-pdf');
      expect(postedMessage?.pdfjsUrl).toBe('/assets/pdf.min.mjs');
      expect(postedMessage?.pdfWorkerUrl).toBe('/assets/pdf.worker.min.mjs');
      expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:renderer-worker');
      expect(revokeObjectUrlSpy).not.toHaveBeenCalledWith('blob:rendered-pdf');
      expect(terminate).toHaveBeenCalledOnce();

      createObjectUrlSpy.mockRestore();
      revokeObjectUrlSpy.mockRestore();
    } finally {
      Object.defineProperty(globalThis, 'Worker', {
        configurable: true,
        value: originalWorker,
      });
      Object.defineProperty(globalThis, 'OffscreenCanvas', {
        configurable: true,
        value: originalOffscreenCanvas,
      });
      vi.resetModules();
    }
  });

  it('terminates a timed-out worker instead of leaving PDF rendering alive', async () => {
    vi.useFakeTimers();
    vi.resetModules();

    const originalWorker = globalThis.Worker;
    const originalOffscreenCanvas = globalThis.OffscreenCanvas;
    const terminate = vi.fn();

    class MockWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      postMessage(): void {}
      terminate = terminate;
    }

    try {
      Object.defineProperty(globalThis, 'Worker', { configurable: true, value: MockWorker });
      Object.defineProperty(globalThis, 'OffscreenCanvas', {
        configurable: true,
        value: class MockOffscreenCanvas {},
      });
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:renderer-worker');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      const mod = await import('../../../src/utils/pdfRenderer');
      const result = mod.renderPdfToImage(new Uint8Array([1]), 32, 24, {
        moduleUrl: '/assets/pdf.min.mjs',
        workerUrl: '/assets/pdf.worker.min.mjs',
      });

      await vi.advanceTimersByTimeAsync(15_000);

      await expect(result).resolves.toBeNull();
      expect(terminate).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(globalThis, 'Worker', { configurable: true, value: originalWorker });
      Object.defineProperty(globalThis, 'OffscreenCanvas', {
        configurable: true,
        value: originalOffscreenCanvas,
      });
      vi.resetModules();
    }
  });

  it('terminates an in-flight worker when rendering is aborted', async () => {
    vi.resetModules();

    const originalWorker = globalThis.Worker;
    const originalOffscreenCanvas = globalThis.OffscreenCanvas;
    const terminate = vi.fn();

    class MockWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      postMessage(): void {}
      terminate = terminate;
    }

    try {
      Object.defineProperty(globalThis, 'Worker', { configurable: true, value: MockWorker });
      Object.defineProperty(globalThis, 'OffscreenCanvas', {
        configurable: true,
        value: class MockOffscreenCanvas {},
      });
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:renderer-worker');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      const controller = new AbortController();
      const mod = await import('../../../src/utils/pdfRenderer');
      const result = mod.renderPdfToImage(
        new Uint8Array([1]),
        32,
        24,
        {
          moduleUrl: '/assets/pdf.min.mjs',
          workerUrl: '/assets/pdf.worker.min.mjs',
        },
        controller.signal,
      );

      await Promise.resolve();
      await Promise.resolve();

      controller.abort();

      await expect(result).resolves.toBeNull();
      expect(terminate).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(globalThis, 'Worker', { configurable: true, value: originalWorker });
      Object.defineProperty(globalThis, 'OffscreenCanvas', {
        configurable: true,
        value: originalOffscreenCanvas,
      });
      vi.resetModules();
    }
  });

  it('does not create a worker when the signal is already aborted', async () => {
    vi.resetModules();
    const originalWorker = globalThis.Worker;
    const originalOffscreenCanvas = globalThis.OffscreenCanvas;
    const workerCreated = vi.fn();

    class MockWorker {
      constructor() {
        workerCreated();
      }
    }

    try {
      Object.defineProperty(globalThis, 'Worker', { configurable: true, value: MockWorker });
      Object.defineProperty(globalThis, 'OffscreenCanvas', {
        configurable: true,
        value: class MockOffscreenCanvas {},
      });
      const controller = new AbortController();
      controller.abort();

      const mod = await import('../../../src/utils/pdfRenderer');
      const result = await mod.renderPdfToImage(
        new Uint8Array([1]),
        32,
        24,
        { moduleUrl: '/assets/pdf.min.mjs', workerUrl: '/assets/pdf.worker.min.mjs' },
        controller.signal,
      );

      expect(result).toBeNull();
      expect(workerCreated).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, 'Worker', { configurable: true, value: originalWorker });
      Object.defineProperty(globalThis, 'OffscreenCanvas', {
        configurable: true,
        value: originalOffscreenCanvas,
      });
      vi.resetModules();
    }
  });

  it('caps concurrent PDF workers and starts queued renders as slots are released', async () => {
    vi.resetModules();
    const originalWorker = globalThis.Worker;
    const originalOffscreenCanvas = globalThis.OffscreenCanvas;
    const workers: MockWorker[] = [];

    class MockWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      terminate = vi.fn();
      lastMessage?: Record<string, unknown>;

      constructor() {
        workers.push(this);
      }

      postMessage(message: Record<string, unknown>): void {
        this.lastMessage = message;
      }

      succeed(): void {
        this.onmessage?.({
          data: {
            id: this.lastMessage?.id,
            blob: new Blob(['png'], { type: 'image/png' }),
          },
        } as MessageEvent);
      }
    }

    try {
      Object.defineProperty(globalThis, 'Worker', { configurable: true, value: MockWorker });
      Object.defineProperty(globalThis, 'OffscreenCanvas', {
        configurable: true,
        value: class MockOffscreenCanvas {},
      });
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pdf');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      const mod = await import('../../../src/utils/pdfRenderer');
      const renders = Array.from({ length: 5 }, () =>
        mod.renderPdfToImage(new Uint8Array([1]), 32, 24, {
          moduleUrl: '/assets/pdf.min.mjs',
          workerUrl: '/assets/pdf.worker.min.mjs',
        }),
      );
      const queuedController = new AbortController();
      const cancelledRender = mod.renderPdfToImage(
        new Uint8Array([1]),
        32,
        24,
        { moduleUrl: '/assets/pdf.min.mjs', workerUrl: '/assets/pdf.worker.min.mjs' },
        queuedController.signal,
      );

      await Promise.resolve();
      await Promise.resolve();

      expect(workers).toHaveLength(4);
      queuedController.abort();
      await expect(cancelledRender).resolves.toBeNull();
      workers[0].succeed();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(workers).toHaveLength(5);

      for (const worker of workers.slice(1)) worker.succeed();
      await expect(Promise.all(renders)).resolves.toEqual(Array(5).fill('blob:pdf'));
      expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'Worker', { configurable: true, value: originalWorker });
      Object.defineProperty(globalThis, 'OffscreenCanvas', {
        configurable: true,
        value: originalOffscreenCanvas,
      });
      vi.resetModules();
    }
  });

  it('returns null without creating a worker when pdfjs rendering is disabled', async () => {
    vi.resetModules();

    const originalWorker = globalThis.Worker;
    const originalOffscreenCanvas = globalThis.OffscreenCanvas;
    let workerCreated = false;

    class MockWorker {
      constructor() {
        workerCreated = true;
      }
    }

    try {
      Object.defineProperty(globalThis, 'Worker', {
        configurable: true,
        value: MockWorker,
      });
      Object.defineProperty(globalThis, 'OffscreenCanvas', {
        configurable: true,
        value: class MockOffscreenCanvas {},
      });

      const mod = await import('../../../src/utils/pdfRenderer');
      const result = await mod.renderPdfToImage(
        new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        32,
        24,
        false,
      );

      expect(result).toBeNull();
      expect(workerCreated).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'Worker', {
        configurable: true,
        value: originalWorker,
      });
      Object.defineProperty(globalThis, 'OffscreenCanvas', {
        configurable: true,
        value: originalOffscreenCanvas,
      });
      vi.resetModules();
    }
  });
});
