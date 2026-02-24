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
    return el;
  }),
}));

import { PptxRenderer } from '../../../src/core/Renderer';

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
