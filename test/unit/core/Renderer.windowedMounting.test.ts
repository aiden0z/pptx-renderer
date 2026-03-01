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
  return { element: el, dispose: vi.fn(), [Symbol.dispose]() { this.dispose(); } };
});

vi.mock('../../../src/renderer/SlideRenderer', () => ({
  renderSlide: (...args: unknown[]) => renderSlideMock(...args),
}));

import { PptxRenderer } from '../../../src/core/Renderer';

class MockIntersectionObserver {
  static lastInstance: MockIntersectionObserver | null = null;
  static allInstances: MockIntersectionObserver[] = [];
  readonly callback: IntersectionObserverCallback;
  readonly observed: Element[] = [];
  readonly options: IntersectionObserverInit | undefined;
  disconnected = false;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    MockIntersectionObserver.lastInstance = this;
    MockIntersectionObserver.allInstances.push(this);
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

  disconnect(): void {
    this.disconnected = true;
  }
  unobserve(): void {}
  takeRecords(): IntersectionObserverEntry[] { return []; }

  /** Helper to fire entries on this observer */
  fireEntries(entries: Partial<IntersectionObserverEntry>[]): void {
    this.callback(
      entries.map((e) => ({
        boundingClientRect: {} as DOMRectReadOnly,
        intersectionRatio: 0,
        intersectionRect: {} as DOMRectReadOnly,
        isIntersecting: false,
        rootBounds: null,
        target: document.createElement('div'),
        time: Date.now(),
        ...e,
      })),
      this as unknown as IntersectionObserver,
    );
  }
}

function installMockIO(): void {
  MockIntersectionObserver.lastInstance = null;
  MockIntersectionObserver.allInstances = [];
  (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;
}

describe('PptxRenderer windowed list mounting', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    renderSlideMock.mockClear();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('mounts only initial slides, then mounts target slide on goToSlide', async () => {
    installMockIO();

    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, {
      mode: 'list',
      listMountStrategy: 'windowed',
      windowedInitialSlides: 2,
    });

    await renderer.preview(new ArrayBuffer(8));
    expect(renderSlideMock).toHaveBeenCalledTimes(2);

    await renderer.goToSlide(5);
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

  it('IO callback mounts slide when isIntersecting is true', async () => {
    installMockIO();

    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, {
      mode: 'list',
      listMountStrategy: 'windowed',
      windowedInitialSlides: 1,
    });
    await renderer.preview(new ArrayBuffer(8));

    // Only 1 slide initially mounted
    expect(renderSlideMock).toHaveBeenCalledTimes(1);

    // Find the windowed IO (first instance, before scroll tracking IO)
    const windowedIO = MockIntersectionObserver.allInstances.find(
      (io) => io.options?.threshold === 0,
    )!;
    expect(windowedIO).toBeDefined();

    // Simulate slide 3 entering viewport
    const wrapper3 = windowedIO.observed[3] as HTMLElement;
    windowedIO.fireEntries([{ target: wrapper3, isIntersecting: true }]);

    // Slide 3 should now be mounted
    expect(renderSlideMock).toHaveBeenCalledTimes(2);
    expect(renderer.isSlideMounted(3)).toBe(true);
  });

  it('IO callback unmounts slide and fires onSlideUnmounted when isIntersecting is false', async () => {
    installMockIO();

    const onSlideUnmounted = vi.fn();
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, {
      mode: 'list',
      listMountStrategy: 'windowed',
      windowedInitialSlides: 2,
      onSlideUnmounted,
    });
    await renderer.preview(new ArrayBuffer(8));

    expect(renderer.isSlideMounted(0)).toBe(true);

    const windowedIO = MockIntersectionObserver.allInstances.find(
      (io) => io.options?.threshold === 0,
    )!;

    // Simulate slide 0 leaving viewport
    const wrapper0 = windowedIO.observed[0] as HTMLElement;
    windowedIO.fireEntries([{ target: wrapper0, isIntersecting: false }]);

    expect(renderer.isSlideMounted(0)).toBe(false);
    expect(onSlideUnmounted).toHaveBeenCalledWith(0);
  });

  it('IO callback skips entries with invalid data-slide-index', async () => {
    installMockIO();

    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, {
      mode: 'list',
      listMountStrategy: 'windowed',
      windowedInitialSlides: 1,
    });
    await renderer.preview(new ArrayBuffer(8));

    const windowedIO = MockIntersectionObserver.allInstances.find(
      (io) => io.options?.threshold === 0,
    )!;

    // Create an element without data-slide-index
    const fakeEl = document.createElement('div');
    expect(() => {
      windowedIO.fireEntries([{ target: fakeEl, isIntersecting: true }]);
    }).not.toThrow();
  });

  it('passes scrollContainer as IO root', async () => {
    installMockIO();

    const scrollContainer = document.createElement('div');
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 800 });
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, {
      mode: 'list',
      listMountStrategy: 'windowed',
      windowedInitialSlides: 1,
      scrollContainer,
    });
    await renderer.preview(new ArrayBuffer(8));

    // The windowed IO should use scrollContainer as root
    const windowedIO = MockIntersectionObserver.allInstances.find(
      (io) => io.options?.threshold === 0,
    )!;
    expect(windowedIO.options?.root).toBe(scrollContainer);
  });

  it('getMountedSlides reflects IO-driven mount/unmount', async () => {
    installMockIO();

    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, {
      mode: 'list',
      listMountStrategy: 'windowed',
      windowedInitialSlides: 2,
    });
    await renderer.preview(new ArrayBuffer(8));

    expect(renderer.getMountedSlides()).toEqual([0, 1]);

    const windowedIO = MockIntersectionObserver.allInstances.find(
      (io) => io.options?.threshold === 0,
    )!;

    // Mount slide 4 via IO
    windowedIO.fireEntries([
      { target: windowedIO.observed[4] as HTMLElement, isIntersecting: true },
    ]);
    expect(renderer.getMountedSlides()).toEqual([0, 1, 4]);

    // Unmount slide 0 via IO
    windowedIO.fireEntries([
      { target: windowedIO.observed[0] as HTMLElement, isIntersecting: false },
    ]);
    expect(renderer.getMountedSlides()).toEqual([1, 4]);
  });
});

describe('PptxRenderer scroll-based onSlideChange tracking', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    renderSlideMock.mockClear();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('creates a scroll tracking IO with multi-threshold when onSlideChange is set', async () => {
    installMockIO();

    const onSlideChange = vi.fn();
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, {
      mode: 'list',
      onSlideChange,
    });
    await renderer.preview(new ArrayBuffer(8));

    // Should have a scroll tracking IO with multi-threshold
    const scrollIO = MockIntersectionObserver.allInstances.find(
      (io) => Array.isArray(io.options?.threshold) && io.options!.threshold.length === 5,
    );
    expect(scrollIO).toBeDefined();
    expect(scrollIO!.options?.threshold).toEqual([0, 0.25, 0.5, 0.75, 1.0]);
  });

  it('scroll tracking IO does not fire onSlideChange when no listener is registered', async () => {
    installMockIO();

    const onSlideChange = vi.fn();
    const container = document.createElement('div');
    // No onSlideChange callback registered
    const renderer = new PptxRenderer(container, { mode: 'list' });
    await renderer.preview(new ArrayBuffer(8));

    // Scroll tracking IO is always created (EventTarget listeners can be added later)
    const scrollIO = MockIntersectionObserver.allInstances.find(
      (io) => Array.isArray(io.options?.threshold) && io.options!.threshold.length === 5,
    );
    expect(scrollIO).toBeDefined();

    // Even if IO fires, no onSlideChange callback should be called since none was set
    scrollIO!.fireEntries([
      { target: scrollIO!.observed[2], intersectionRatio: 0.9 },
    ]);
    expect(onSlideChange).not.toHaveBeenCalled();

    renderer.destroy();
  });

  it('fires onSlideChange for the most visible slide based on intersectionRatio', async () => {
    installMockIO();

    const onSlideChange = vi.fn();
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, {
      mode: 'list',
      onSlideChange,
    });
    await renderer.preview(new ArrayBuffer(8));

    const scrollIO = MockIntersectionObserver.allInstances.find(
      (io) => Array.isArray(io.options?.threshold) && io.options!.threshold.length === 5,
    )!;

    // Simulate slide 2 being most visible
    scrollIO.fireEntries([
      { target: scrollIO.observed[0], intersectionRatio: 0.1 },
      { target: scrollIO.observed[1], intersectionRatio: 0.3 },
      { target: scrollIO.observed[2], intersectionRatio: 0.8 },
    ]);

    expect(onSlideChange).toHaveBeenCalledWith(2);
    expect(renderer.currentSlideIndex).toBe(2);
  });

  it('does not fire onSlideChange when best slide is already current', async () => {
    installMockIO();

    const onSlideChange = vi.fn();
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, {
      mode: 'list',
      onSlideChange,
    });
    await renderer.preview(new ArrayBuffer(8));

    // Clear calls from initial render slidechange
    onSlideChange.mockClear();

    const scrollIO = MockIntersectionObserver.allInstances.find(
      (io) => Array.isArray(io.options?.threshold) && io.options!.threshold.length === 5,
    )!;

    // Slide 0 is already current
    scrollIO.fireEntries([
      { target: scrollIO.observed[0], intersectionRatio: 1.0 },
    ]);

    expect(onSlideChange).not.toHaveBeenCalled();
  });

  it('suppresses scroll onSlideChange during goToSlide to prevent double-fire', async () => {
    installMockIO();

    const onSlideChange = vi.fn();
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, {
      mode: 'list',
      onSlideChange,
    });
    await renderer.preview(new ArrayBuffer(8));

    const scrollIO = MockIntersectionObserver.allInstances.find(
      (io) => Array.isArray(io.options?.threshold) && io.options!.threshold.length === 5,
    )!;

    // goToSlide fires onSlideChange and sets suppression flag
    renderer.goToSlide(3);
    expect(onSlideChange).toHaveBeenCalledWith(3);
    onSlideChange.mockClear();

    // IO fires while suppressed (before rAF clears the flag)
    scrollIO.fireEntries([
      { target: scrollIO.observed[4], intersectionRatio: 1.0 },
    ]);

    // Should NOT fire because _suppressScrollChange is true
    expect(onSlideChange).not.toHaveBeenCalled();
  });

  it('passes scrollContainer to scroll tracking IO root', async () => {
    installMockIO();

    const scrollContainer = document.createElement('div');
    const onSlideChange = vi.fn();
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, {
      mode: 'list',
      onSlideChange,
      scrollContainer,
    });
    await renderer.preview(new ArrayBuffer(8));

    const scrollIO = MockIntersectionObserver.allInstances.find(
      (io) => Array.isArray(io.options?.threshold) && io.options!.threshold.length === 5,
    )!;
    expect(scrollIO.options?.root).toBe(scrollContainer);
    renderer.destroy();
  });

  it('destroy() disconnects scroll tracking IO', async () => {
    installMockIO();

    const onSlideChange = vi.fn();
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, {
      mode: 'list',
      onSlideChange,
    });
    await renderer.preview(new ArrayBuffer(8));

    const scrollIO = MockIntersectionObserver.allInstances.find(
      (io) => Array.isArray(io.options?.threshold) && io.options!.threshold.length === 5,
    )!;

    expect(scrollIO.disconnected).toBe(false);
    renderer.destroy();
    expect(scrollIO.disconnected).toBe(true);
  });
});
