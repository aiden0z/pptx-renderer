import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/parser/ZipParser', () => ({
  parseZip: vi.fn(async () => ({})),
}));

vi.mock('../../../src/model/Presentation', () => ({
  buildPresentation: vi.fn(() => ({
    width: 1000,
    height: 750,
    slides: [
      {
        index: 0,
        nodes: [],
        layoutIndex: '',
        rels: new Map(),
        showMasterSp: true,
        slidePath: 'ppt/slides/slide1.xml',
      },
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
  })),
}));

vi.mock('../../../src/renderer/SlideRenderer', () => ({
  renderSlide: vi.fn(() => {
    const el = document.createElement('div');
    el.setAttribute('data-test-slide', '1');
    return { element: el, dispose: vi.fn(), [Symbol.dispose]() { this.dispose(); } };
  }),
}));

import { PptxRenderer } from '../../../src/core/Renderer';
import { PptxViewer } from '../../../src/core/Viewer';

class MockResizeObserver {
  static lastInstance: MockResizeObserver | null = null;
  readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.lastInstance = this;
  }

  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

function getRenderedScale(container: HTMLElement): string {
  const slide = container.querySelector<HTMLElement>('[data-test-slide="1"]');
  expect(slide).toBeTruthy();
  return slide!.style.transform;
}

// -----------------------------------------------------------------------
// Cycle 4: State getters (zoomPercent, fitMode)
// -----------------------------------------------------------------------

describe('PptxViewer state getters', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('zoomPercent getter returns current zoom', async () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 1000, configurable: true });

    const renderer = new PptxRenderer(container, { mode: 'slide' });
    await renderer.preview(new ArrayBuffer(8));

    expect(renderer.zoomPercent).toBe(100);
    await renderer.setZoom(200);
    expect(renderer.zoomPercent).toBe(200);
  });

  it('fitMode getter returns current fit mode', async () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 1000, configurable: true });

    const renderer = new PptxRenderer(container, { mode: 'slide' });
    await renderer.preview(new ArrayBuffer(8));

    expect(renderer.fitMode).toBe('contain');
    await renderer.setFitMode('none');
    expect(renderer.fitMode).toBe('none');
  });
});

describe('PptxRenderer zoom and fit mode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies zoom factor in contain fit mode', async () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 1000, configurable: true });

    const renderer = new PptxRenderer(container, { mode: 'slide' });
    await renderer.preview(new ArrayBuffer(8));

    expect(getRenderedScale(container)).toBe('scale(1)');

    await renderer.setZoom(200);
    expect(getRenderedScale(container)).toBe('scale(2)');
  });

  it('supports none fit mode with absolute zoom scaling', async () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 400, configurable: true });

    const renderer = new PptxRenderer(container, { mode: 'slide' });
    await renderer.preview(new ArrayBuffer(8));

    await renderer.setFitMode('none');
    expect(getRenderedScale(container)).toBe('scale(1)');

    await renderer.setZoom(150);
    expect(getRenderedScale(container)).toBe('scale(1.5)');
  });

  it('reflows when container width changes in contain mode', async () => {
    const container = document.createElement('div');
    let currentWidth = 1000;
    Object.defineProperty(container, 'clientWidth', {
      get: () => currentWidth,
      configurable: true,
    });

    const renderer = new PptxRenderer(container, { mode: 'slide' });
    await renderer.preview(new ArrayBuffer(8));
    expect(getRenderedScale(container)).toBe('scale(1)');

    currentWidth = 500;
    const ro = MockResizeObserver.lastInstance;
    expect(ro).toBeTruthy();
    ro!.callback([], ro as unknown as ResizeObserver);

    // Let async rerender settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getRenderedScale(container)).toBe('scale(0.5)');
  });
});

// -----------------------------------------------------------------------
// Post-render scrollbar width correction (list mode)
// -----------------------------------------------------------------------

describe('post-render width correction in list mode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('corrects wrapper width and scale when container shrinks after render (scrollbar)', async () => {
    // Simulate: clientWidth=1000 when empty, shrinks to 984 after children appended
    // (body scrollbar appeared, narrowing the viewport by 16px)
    const container = document.createElement('div');
    let childrenAppended = false;
    const originalAppendChild = container.appendChild.bind(container);
    container.appendChild = function <T extends Node>(node: T): T {
      const result = originalAppendChild(node);
      // After first real slide content is appended, simulate scrollbar
      if (container.querySelector('[data-slide-index]')) {
        childrenAppended = true;
      }
      return result;
    };
    Object.defineProperty(container, 'clientWidth', {
      get: () => (childrenAppended ? 984 : 1000),
      configurable: true,
    });

    const viewer = await PptxViewer.open(new ArrayBuffer(4), container);
    expect(viewer.slideCount).toBe(1);

    // presentation.width = 1000. After correction, scale = 984/1000 = 0.984
    const wrapper = container.querySelector<HTMLElement>('[data-slide-index] > div');
    expect(wrapper).toBeTruthy();
    expect(wrapper!.style.width).toBe('984px');
    expect(wrapper!.style.height).toBe('738px'); // 750 * 0.984

    const slideEl = wrapper!.firstElementChild as HTMLElement;
    expect(slideEl).toBeTruthy();
    expect(slideEl.style.transform).toBe('scale(0.984)');
  });

  it('does not patch when container width stays the same', async () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 1000, configurable: true });

    const viewer = await PptxViewer.open(new ArrayBuffer(4), container);
    expect(viewer.slideCount).toBe(1);

    // No correction needed — scale stays at 1000/1000 = 1
    const wrapper = container.querySelector<HTMLElement>('[data-slide-index] > div');
    expect(wrapper).toBeTruthy();
    expect(wrapper!.style.width).toBe('1000px');
    expect(wrapper!.style.height).toBe('750px');

    const slideEl = wrapper!.firstElementChild as HTMLElement;
    expect(slideEl.style.transform).toBe('scale(1)');
  });

  it('does not apply correction in slide mode', async () => {
    const container = document.createElement('div');
    let childrenAppended = false;
    const originalAppendChild = container.appendChild.bind(container);
    container.appendChild = function <T extends Node>(node: T): T {
      const result = originalAppendChild(node);
      childrenAppended = true;
      return result;
    };
    Object.defineProperty(container, 'clientWidth', {
      get: () => (childrenAppended ? 984 : 1000),
      configurable: true,
    });

    const viewer = await PptxViewer.open(new ArrayBuffer(4), container, {
      renderMode: 'slide',
    });
    expect(viewer.slideCount).toBe(1);

    // Slide mode does not use list wrappers — no [data-slide-index] elements
    // The slide element is inside a plain wrapper, and correction is skipped
    const slideEl = container.querySelector<HTMLElement>('[data-test-slide="1"]');
    expect(slideEl).toBeTruthy();
    // Scale was computed with initial width (1000/1000 = 1), NOT corrected
    expect(slideEl!.style.transform).toBe('scale(1)');
  });
});
