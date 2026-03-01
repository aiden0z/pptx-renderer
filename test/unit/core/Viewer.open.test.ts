import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPresentation = {
  width: 960,
  height: 540,
  slides: [
    { index: 0, nodes: [], rels: new Map(), showMasterSp: true },
    { index: 1, nodes: [], rels: new Map(), showMasterSp: true },
  ],
  layouts: new Map(),
  masters: new Map(),
  themes: new Map(),
  slideToLayout: new Map(),
  layoutToMaster: new Map(),
  masterToTheme: new Map(),
  media: new Map(),
  charts: new Map(),
  isWps: false,
};

vi.mock('../../../src/parser/ZipParser', () => ({
  parseZip: vi.fn(async () => ({})),
}));

vi.mock('../../../src/model/Presentation', () => ({
  buildPresentation: vi.fn(() => ({ ...mockPresentation })),
}));

vi.mock('../../../src/renderer/SlideRenderer', () => ({
  renderSlide: vi.fn(() => {
    const el = document.createElement('div');
    el.className = 'mock-slide';
    return { element: el, dispose: vi.fn(), [Symbol.dispose]() { this.dispose(); } };
  }),
}));

import { PptxViewer } from '../../../src/core/Viewer';
import { parseZip } from '../../../src/parser/ZipParser';
import { buildPresentation } from '../../../src/model/Presentation';

describe('PptxViewer.open() static factory', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parses, builds, and renders in list mode by default', async () => {
    const container = document.createElement('div');
    const viewer = await PptxViewer.open(new ArrayBuffer(4), container);

    expect(parseZip).toHaveBeenCalledOnce();
    expect(buildPresentation).toHaveBeenCalledOnce();
    expect(viewer).toBeInstanceOf(PptxViewer);
    expect(viewer.slideCount).toBe(2);
    expect(viewer.getMountedSlides()).toEqual([0, 1]);
  });

  it('renders in slide mode when renderMode is "slide"', async () => {
    const container = document.createElement('div');
    const viewer = await PptxViewer.open(new ArrayBuffer(4), container, {
      renderMode: 'slide',
    });

    expect(viewer.slideCount).toBe(2);
    expect(viewer.currentSlideIndex).toBe(0);
    expect(viewer.getMountedSlides()).toEqual([0]);
    // No nav buttons
    expect(container.querySelectorAll('button').length).toBe(0);
  });

  it('passes listOptions to renderList', async () => {
    const container = document.createElement('div');
    const viewer = await PptxViewer.open(new ArrayBuffer(4), container, {
      listOptions: { batchSize: 1 },
    });

    expect(viewer.getMountedSlides()).toEqual([0, 1]);
  });

  it('rejects with AbortError when signal is already aborted', async () => {
    const container = document.createElement('div');
    const controller = new AbortController();
    controller.abort();

    await expect(
      PptxViewer.open(new ArrayBuffer(4), container, { signal: controller.signal }),
    ).rejects.toThrow('Preview aborted');
  });

  it('thrown error is a DOMException with name AbortError', async () => {
    const container = document.createElement('div');
    const controller = new AbortController();
    controller.abort();

    try {
      await PptxViewer.open(new ArrayBuffer(4), container, { signal: controller.signal });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(DOMException);
      expect((e as DOMException).name).toBe('AbortError');
    }
  });

  it('passes zipLimits to parseZip', async () => {
    const container = document.createElement('div');
    const zipLimits = { maxFiles: 100, maxTotalSize: 1024 * 1024 };
    await PptxViewer.open(new ArrayBuffer(4), container, { zipLimits });

    expect(parseZip).toHaveBeenCalledWith(expect.any(ArrayBuffer), zipLimits);
  });

  it('accepts Uint8Array input', async () => {
    const container = document.createElement('div');
    const viewer = await PptxViewer.open(new Uint8Array([1, 2, 3]), container);
    expect(viewer.slideCount).toBe(2);
  });

  it('accepts Blob input', async () => {
    const container = document.createElement('div');
    const viewer = await PptxViewer.open(new Blob([new Uint8Array([1])]), container);
    expect(viewer.slideCount).toBe(2);
  });
});

// -----------------------------------------------------------------------
// Cycle 5: Instance-level open()
// -----------------------------------------------------------------------

describe('viewer.open() instance method', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads and renders from binary input', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    await viewer.open(new ArrayBuffer(4));

    expect(viewer.slideCount).toBe(2);
    expect(viewer.getMountedSlides()).toEqual([0, 1]);
  });

  it('cleans up previous state on re-open', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    await viewer.open(new ArrayBuffer(4));

    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    (viewer as any).mediaUrlCache.set('k', 'blob:fake');

    await viewer.open(new ArrayBuffer(4));

    expect(revoke).toHaveBeenCalledWith('blob:fake');
    revoke.mockRestore();
  });

  it('supports AbortSignal', async () => {
    const controller = new AbortController();
    controller.abort();
    const viewer = new PptxViewer(document.createElement('div'));

    await expect(
      viewer.open(new ArrayBuffer(4), { signal: controller.signal }),
    ).rejects.toThrow('Preview aborted');
  });

  it('static open() still works', async () => {
    const viewer = await PptxViewer.open(new ArrayBuffer(4), document.createElement('div'));
    expect(viewer.slideCount).toBe(2);
  });

  it('accepts renderMode option', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    await viewer.open(new ArrayBuffer(4), { renderMode: 'slide' });

    expect(viewer.getMountedSlides()).toEqual([0]);
  });
});
