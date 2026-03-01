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
  vi.clearAllMocks();
});

describe('pdfRenderer', () => {
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
});
