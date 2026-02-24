import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/parser/ZipParser', () => ({
  parseZip: vi.fn(async () => ({})),
}));

vi.mock('../../../src/model/Presentation', () => ({
  buildPresentation: vi.fn(() => {
    const slides = Array.from({ length: 6 }, (_, i) => ({
      index: i,
      nodes: [],
      layoutIndex: '',
      rels: new Map(),
      showMasterSp: true,
      slidePath: `ppt/slides/slide${i + 1}.xml`,
    }));
    return {
      width: 1000,
      height: 750,
      slides,
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
  }),
}));

const renderSlideMock = vi.fn(() => {
  const el = document.createElement('div');
  el.textContent = 'slide';
  return el;
});

vi.mock('../../../src/renderer/SlideRenderer', () => ({
  renderSlide: (...args: unknown[]) => renderSlideMock(...args),
}));

import { PptxRenderer } from '../../../src/core/Renderer';

class MockIntersectionObserver {
  static lastInstance: MockIntersectionObserver | null = null;
  readonly callback: IntersectionObserverCallback;
  readonly observed: Element[] = [];

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.lastInstance = this;
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

  disconnect(): void {}
  unobserve(): void {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

describe('PptxRenderer windowed list mounting', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    renderSlideMock.mockClear();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('mounts only initial slides, then mounts target slide on goToSlide', async () => {
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;

    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, {
      mode: 'list',
      listMountStrategy: 'windowed',
      windowedInitialSlides: 2,
    });

    await renderer.preview(new ArrayBuffer(8));
    expect(renderSlideMock).toHaveBeenCalledTimes(2);

    renderer.goToSlide(5);
    expect(renderSlideMock).toHaveBeenCalledTimes(3);
  });

  it('falls back to full mounting when IntersectionObserver is unavailable', async () => {
    (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver = undefined;

    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, {
      mode: 'list',
      listMountStrategy: 'windowed',
      windowedInitialSlides: 2,
    });

    await renderer.preview(new ArrayBuffer(8));
    expect(renderSlideMock).toHaveBeenCalledTimes(6);
  });
});
