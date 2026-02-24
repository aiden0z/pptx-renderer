import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for pdfRenderer.ts — verifies that PDF rendering uses correct canvas
 * context settings (alpha: true) and transparent background.
 *
 * Since pdfRenderer relies on pdfjs-dist, Web Workers, OffscreenCanvas etc.,
 * we mock the heavy dependencies and focus on verifying the integration contract:
 *
 * 1. canvasContext is created with { alpha: true } (NOT the pdfjs default alpha:false)
 * 2. page.render() receives canvasContext (not canvas) + background: 'rgba(0,0,0,0)'
 * 3. The rendered canvas is converted to a blob URL
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Track what arguments were passed to canvas.getContext and page.render
let getContextCalls: Array<{ contextId: string; options: any }> = [];
let renderCalls: Array<Record<string, any>> = [];

const mockCanvasContext = {
  fillRect: vi.fn(),
  fillStyle: '',
  save: vi.fn(),
  restore: vi.fn(),
};

const mockPage = {
  getViewport: vi.fn(({ scale }: { scale: number }) => ({
    width: 100 * scale,
    height: 80 * scale,
    transform: [scale, 0, 0, -scale, 0, 80 * scale],
  })),
  render: vi.fn((params: Record<string, any>) => {
    renderCalls.push(params);
    return { promise: Promise.resolve() };
  }),
};

const mockPdfDoc = {
  numPages: 1,
  getPage: vi.fn().mockResolvedValue(mockPage),
  destroy: vi.fn(),
};

// Mock pdfjs-dist module
vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(() => ({
    promise: Promise.resolve(mockPdfDoc),
  })),
  GlobalWorkerOptions: { workerSrc: '' },
}));

// Mock document.createElement to track canvas creation
const originalCreateElement = document.createElement.bind(document);

beforeEach(() => {
  getContextCalls = [];
  renderCalls = [];
  vi.clearAllMocks();

  // Override createElement to intercept canvas creation
  document.createElement = vi.fn((tag: string) => {
    if (tag === 'canvas') {
      const canvas = originalCreateElement('canvas');
      // Override getContext to track calls and return our mock
      const originalGetContext = canvas.getContext.bind(canvas);
      canvas.getContext = vi.fn((contextId: string, options?: any) => {
        getContextCalls.push({ contextId, options });
        // jsdom's canvas doesn't support real 2d context well,
        // return mock context for test assertions
        return mockCanvasContext as any;
      });
      // Mock toBlob
      canvas.toBlob = vi.fn((cb: BlobCallback) => {
        cb(new Blob(['fake-png'], { type: 'image/png' }));
      });
      return canvas;
    }
    return originalCreateElement(tag);
  }) as any;
});

afterEach(() => {
  document.createElement = originalCreateElement;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pdfRenderer', () => {
  // We need to dynamically import to get fresh module state after mocks are set up.
  // The Worker path won't work in jsdom, so only the main-thread fallback is testable.

  it('creates canvas context with alpha: true (not pdfjs default alpha: false)', async () => {
    // Reset module state to ensure fresh import
    // The module caches _workerFailed, _mainThreadConfigured etc. as module-level state.
    // In Vite dev mode, Worker creation fails, so it falls through to main thread.
    const mod = await import('../../../src/utils/pdfRenderer');

    const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    await mod.renderPdfToImage(pdfData, 200, 160);

    // Verify canvas.getContext was called with alpha: true
    const canvasCtxCall = getContextCalls.find(
      (c) => c.contextId === '2d' && c.options?.alpha === true,
    );
    expect(canvasCtxCall).toBeDefined();
    expect(canvasCtxCall!.options.alpha).toBe(true);
  });

  it('passes canvasContext (not canvas) to page.render()', async () => {
    const mod = await import('../../../src/utils/pdfRenderer');

    const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    await mod.renderPdfToImage(pdfData, 200, 160);

    expect(renderCalls.length).toBeGreaterThan(0);
    const renderParams = renderCalls[0];

    // Must pass canvasContext, NOT canvas
    expect(renderParams.canvasContext).toBeDefined();
    expect(renderParams.canvas).toBeUndefined();
  });

  it('passes transparent background to page.render()', async () => {
    const mod = await import('../../../src/utils/pdfRenderer');

    const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    await mod.renderPdfToImage(pdfData, 200, 160);

    expect(renderCalls.length).toBeGreaterThan(0);
    const renderParams = renderCalls[0];

    expect(renderParams.background).toBe('rgba(0,0,0,0)');
  });

  it('returns a blob URL string on success', async () => {
    const mod = await import('../../../src/utils/pdfRenderer');

    const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const result = await mod.renderPdfToImage(pdfData, 200, 160);

    // Should return a blob: URL (mocked as blob:mock/...)
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
    expect(result!.startsWith('blob:')).toBe(true);
  });

  it('returns null when pdfDoc has no pages', async () => {
    mockPdfDoc.numPages = 0;

    const mod = await import('../../../src/utils/pdfRenderer');

    const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const result = await mod.renderPdfToImage(pdfData, 200, 160);

    expect(result).toBeNull();

    // Restore
    mockPdfDoc.numPages = 1;
  });

  it('calculates correct scale to cover target dimensions', async () => {
    const mod = await import('../../../src/utils/pdfRenderer');

    const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    // Target: 300x160, PDF viewport at scale 1: 100x80
    await mod.renderPdfToImage(pdfData, 300, 160);

    // scale = Math.max(300/100, 160/80) = Math.max(3, 2) = 3
    // getViewport should be called twice: once with scale=1, once with scale=3
    const viewportCalls = mockPage.getViewport.mock.calls;
    const scaleCall = viewportCalls.find((c: any) => c[0].scale === 3);
    expect(scaleCall).toBeDefined();
  });

  it('returns null when getPage throws (PagesMapper conflict)', async () => {
    mockPdfDoc.getPage.mockRejectedValueOnce(new Error('Invalid page request'));

    const mod = await import('../../../src/utils/pdfRenderer');
    const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const result = await mod.renderPdfToImage(pdfData, 200, 160);

    expect(result).toBeNull();
  });

  it('returns null when canvas.toBlob yields null', async () => {
    // Override createElement so toBlob returns null
    document.createElement = vi.fn((tag: string) => {
      if (tag === 'canvas') {
        const canvas = originalCreateElement('canvas');
        canvas.getContext = vi.fn((_contextId: string, _options?: any) => {
          return mockCanvasContext as any;
        });
        canvas.toBlob = vi.fn((cb: BlobCallback) => {
          cb(null); // toBlob can return null on failure
        });
        return canvas;
      }
      return originalCreateElement(tag);
    }) as any;

    const mod = await import('../../../src/utils/pdfRenderer');
    const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const result = await mod.renderPdfToImage(pdfData, 200, 160);

    expect(result).toBeNull();
  });

  it('calls pdfDoc.destroy() in finally block even on success', async () => {
    mockPdfDoc.destroy.mockClear();

    const mod = await import('../../../src/utils/pdfRenderer');
    const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    await mod.renderPdfToImage(pdfData, 200, 160);

    expect(mockPdfDoc.destroy).toHaveBeenCalled();
  });

  it('still returns null if pdfDoc.destroy() throws during cleanup', async () => {
    mockPdfDoc.getPage.mockRejectedValueOnce(new Error('page fail'));
    mockPdfDoc.destroy.mockImplementationOnce(() => {
      throw new Error('destroy error');
    });

    const mod = await import('../../../src/utils/pdfRenderer');
    const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const result = await mod.renderPdfToImage(pdfData, 200, 160);

    // Should not throw; returns null due to getPage failure
    expect(result).toBeNull();
  });
});
