import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/renderer/SlideRenderer', () => ({
  renderSlide: vi.fn(() => {
    const el = document.createElement('div');
    el.className = 'mock-slide';
    return { element: el, dispose: vi.fn(), [Symbol.dispose]() { this.dispose(); } };
  }),
}));

import { PptxViewer } from '../../../src/core/Viewer';
import type { PresentationData } from '../../../src/model/Presentation';

function makeMockPresentation(slideCount = 3): PresentationData {
  return {
    width: 960,
    height: 540,
    slides: Array.from({ length: slideCount }, (_, i) => ({
      index: i,
      nodes: [],
      rels: new Map(),
      showMasterSp: true,
    })),
    layouts: new Map(),
    masters: new Map(),
    themes: new Map(),
    slideToLayout: new Map(),
    layoutToMaster: new Map(),
    masterToTheme: new Map(),
    media: new Map(),
    charts: new Map(),
    isWps: false,
  } as PresentationData;
}

describe('PptxViewer EventTarget', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('fires slidechange event via addEventListener', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation());
    await viewer.renderSlide(0);

    const listener = vi.fn();
    viewer.addEventListener('slidechange', listener);

    viewer.goToSlide(2);

    expect(listener).toHaveBeenCalledOnce();
    const event = listener.mock.calls[0][0] as CustomEvent;
    expect(event.detail.index).toBe(2);
  });

  it('fires slidechange via shorthand onSlideChange option', async () => {
    const onSlideChange = vi.fn();
    const container = document.createElement('div');
    const viewer = new PptxViewer(container, { onSlideChange });
    viewer.load(makeMockPresentation());
    await viewer.renderSlide(0);

    viewer.goToSlide(1);

    expect(onSlideChange).toHaveBeenCalledWith(1);
  });

  it('fires sliderendered event when rendering', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation());

    const listener = vi.fn();
    viewer.addEventListener('sliderendered', listener);

    await viewer.renderSlide(0);

    expect(listener).toHaveBeenCalledOnce();
    const event = listener.mock.calls[0][0] as CustomEvent;
    expect(event.detail.index).toBe(0);
    expect(event.detail.element).toBeInstanceOf(HTMLElement);
  });

  it('fires sliderendered via shorthand onSlideRendered option', async () => {
    const onSlideRendered = vi.fn();
    const container = document.createElement('div');
    const viewer = new PptxViewer(container, { onSlideRendered });
    viewer.load(makeMockPresentation());

    await viewer.renderSlide(0);

    expect(onSlideRendered).toHaveBeenCalledWith(0, expect.any(HTMLElement));
  });

  it('supports removeEventListener', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation());
    await viewer.renderSlide(0);

    const listener = vi.fn();
    viewer.addEventListener('slidechange', listener);
    viewer.removeEventListener('slidechange', listener);

    viewer.goToSlide(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('supports multiple listeners on same event', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation());
    await viewer.renderSlide(0);

    const listener1 = vi.fn();
    const listener2 = vi.fn();
    viewer.addEventListener('slidechange', listener1);
    viewer.addEventListener('slidechange', listener2);

    viewer.goToSlide(2);

    expect(listener1).toHaveBeenCalledOnce();
    expect(listener2).toHaveBeenCalledOnce();
  });

  it('does not fire slidechange when index does not change', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation());
    await viewer.renderSlide(0);

    const listener = vi.fn();
    viewer.addEventListener('slidechange', listener);

    viewer.goToSlide(0); // already at 0
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('PptxViewer load() and renderList()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('load() sets presentation data without rendering', () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    const pres = makeMockPresentation();

    viewer.load(pres);

    expect(viewer.presentationData).toBe(pres);
    expect(viewer.slideCount).toBe(3);
    // Container should be empty (no render yet)
    expect(container.innerHTML).toBe('');
  });

  it('renderList() renders all slides in list mode', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation());

    await viewer.renderList();

    expect(viewer.getMountedSlides()).toEqual([0, 1, 2]);
  });

  it('renderSlide() renders a single slide', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation());

    await viewer.renderSlide(1);

    expect(viewer.currentSlideIndex).toBe(1);
    expect(viewer.isSlideMounted(1)).toBe(true);
    expect(viewer.getMountedSlides()).toEqual([1]);
  });

  it('renderList({ windowed: true }) uses windowed mounting', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation(6));

    // Mock IntersectionObserver away to trigger fallback
    const origIO = window.IntersectionObserver;
    (window as any).IntersectionObserver = undefined;

    try {
      await viewer.renderList({ windowed: true, initialSlides: 2 });
      // Fallback: all slides mounted
      expect(viewer.getMountedSlides()).toEqual([0, 1, 2, 3, 4, 5]);
    } finally {
      (window as any).IntersectionObserver = origIO;
    }
  });

  it('renderSlide() does not create nav buttons', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation());

    await viewer.renderSlide(0);

    // No buttons should be in the container
    expect(container.querySelectorAll('button').length).toBe(0);
    // No span with slide counter
    expect(container.querySelector('span')).toBeNull();
  });
});

describe('PptxViewer getters', () => {
  it('returns defaults before load()', () => {
    const viewer = new PptxViewer(document.createElement('div'));
    expect(viewer.presentationData).toBeNull();
    expect(viewer.slideCount).toBe(0);
    expect(viewer.slideWidth).toBe(0);
    expect(viewer.slideHeight).toBe(0);
    expect(viewer.currentSlideIndex).toBe(0);
  });

  it('returns correct values after load()', () => {
    const viewer = new PptxViewer(document.createElement('div'));
    viewer.load(makeMockPresentation());
    expect(viewer.slideCount).toBe(3);
    expect(viewer.slideWidth).toBe(960);
    expect(viewer.slideHeight).toBe(540);
  });
});

// -----------------------------------------------------------------------
// Cycle 1: renderstart / rendercomplete events + isRendering
// -----------------------------------------------------------------------

describe('render lifecycle events', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('fires renderstart and rendercomplete on renderList()', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation());

    const start = vi.fn();
    const complete = vi.fn();
    viewer.addEventListener('renderstart', start);
    viewer.addEventListener('rendercomplete', complete);

    await viewer.renderList();

    expect(start).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledOnce();
    expect(start.mock.invocationCallOrder[0]).toBeLessThan(
      complete.mock.invocationCallOrder[0],
    );
  });

  it('fires renderstart and rendercomplete on renderSlide()', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation());

    const start = vi.fn();
    const complete = vi.fn();
    viewer.addEventListener('renderstart', start);
    viewer.addEventListener('rendercomplete', complete);

    await viewer.renderSlide(0);

    expect(start).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledOnce();
  });

  it('fires renderstart/rendercomplete on setZoom()', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation());
    await viewer.renderSlide(0);

    const start = vi.fn();
    const complete = vi.fn();
    viewer.addEventListener('renderstart', start);
    viewer.addEventListener('rendercomplete', complete);

    await viewer.setZoom(200);

    expect(start).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledOnce();
  });

  it('fires rendercomplete even when render throws', async () => {
    const { renderSlide: mockRenderSlide } = await import(
      '../../../src/renderer/SlideRenderer'
    );
    (mockRenderSlide as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('boom');
    });

    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation());

    const complete = vi.fn();
    viewer.addEventListener('rendercomplete', complete);

    await viewer.renderSlide(0);

    expect(complete).toHaveBeenCalledOnce();
  });

  it('isRendering is true between renderstart and rendercomplete', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation());

    expect(viewer.isRendering).toBe(false);

    let wasRenderingDuringStart = false;
    viewer.addEventListener('renderstart', () => {
      wasRenderingDuringStart = viewer.isRendering;
    });

    await viewer.renderSlide(0);

    expect(wasRenderingDuringStart).toBe(true);
    expect(viewer.isRendering).toBe(false);
  });

  it('onRenderStart/onRenderComplete shorthand options work', async () => {
    const onRenderStart = vi.fn();
    const onRenderComplete = vi.fn();
    const container = document.createElement('div');
    const viewer = new PptxViewer(container, { onRenderStart, onRenderComplete });
    viewer.load(makeMockPresentation());

    await viewer.renderSlide(0);

    expect(onRenderStart).toHaveBeenCalledOnce();
    expect(onRenderComplete).toHaveBeenCalledOnce();
  });
});

// -----------------------------------------------------------------------
// Cycle 2: Initial slidechange after render
// -----------------------------------------------------------------------

describe('initial slidechange after render', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('fires slidechange after renderList() completes', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation());

    const listener = vi.fn();
    viewer.addEventListener('slidechange', listener);

    await viewer.renderList();

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { index: 0 } }),
    );
  });

  it('fires slidechange after renderSlide(2)', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation());

    const listener = vi.fn();
    viewer.addEventListener('slidechange', listener);

    await viewer.renderSlide(2);

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { index: 2 } }),
    );
  });
});

// -----------------------------------------------------------------------
// Cycle 3: Typed on()/off() helpers
// -----------------------------------------------------------------------

describe('typed on()/off() helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('on() registers typed event listener', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation());
    await viewer.renderSlide(0);

    const fn = vi.fn();
    viewer.on('slidechange', fn);

    viewer.goToSlide(1);

    expect(fn).toHaveBeenCalledOnce();
    expect(fn.mock.calls[0][0].detail.index).toBe(1);
  });

  it('off() removes listener', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation());
    await viewer.renderSlide(0);

    const fn = vi.fn();
    viewer.on('slidechange', fn);
    viewer.off('slidechange', fn);

    viewer.goToSlide(1);

    expect(fn).not.toHaveBeenCalled();
  });

  it('on() returns this for chaining', () => {
    const viewer = new PptxViewer(document.createElement('div'));
    const result = viewer.on('slidechange', () => {});
    expect(result).toBe(viewer);
  });
});

// -----------------------------------------------------------------------
// Cycle 6: goToSlide() returns Promise<void>
// -----------------------------------------------------------------------

describe('goToSlide() async', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('returns a promise that resolves', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation());
    await viewer.renderSlide(0);

    const result = viewer.goToSlide(1);
    expect(result).toBeInstanceOf(Promise);
    await result;
    expect(viewer.currentSlideIndex).toBe(1);
  });

  it('resolves immediately for single-slide mode', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation());
    await viewer.renderSlide(0);

    await viewer.goToSlide(2);
    expect(viewer.currentSlideIndex).toBe(2);
  });
});
