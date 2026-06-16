import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/renderer/SlideRenderer', () => ({
  renderSlide: vi.fn((_presentation, slide) => {
    const el = document.createElement('div');
    el.className = 'mock-slide';
    el.dataset.slideIndex = String(slide.index);
    return {
      element: el,
      ready: Promise.resolve(),
      dispose: vi.fn(),
      [Symbol.dispose]() {
        this.dispose();
      },
    };
  }),
}));

import { PptxViewer } from '../../../src/core/Viewer';
import { renderSlide } from '../../../src/renderer/SlideRenderer';
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

function listItemsIn(container: HTMLElement): Element[] {
  return Array.from(container.children).filter((child) => child.hasAttribute('data-slide-index'));
}

describe('PptxViewer.destroy()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('clears container and nulls presentation', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation());
    await viewer.renderList();

    expect(viewer.presentationData).not.toBeNull();
    viewer.destroy();
    expect(viewer.presentationData).toBeNull();
    expect(viewer.slideCount).toBe(0);
    expect(container.innerHTML).toBe('');
  });

  it('revokes blob URLs on destroy', async () => {
    const revokeStub = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation());
    await viewer.renderList();

    const cache = (viewer as any).mediaUrlCache as Map<string, string>;
    cache.set('img1', 'blob:http://localhost/fake-1');

    viewer.destroy();
    expect(revokeStub).toHaveBeenCalledWith('blob:http://localhost/fake-1');
    revokeStub.mockRestore();
  });

  it('is safe to call destroy() twice', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation());
    await viewer.renderList();

    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    expect(() => {
      viewer.destroy();
      viewer.destroy();
    }).not.toThrow();
  });

  it('does nothing when destroy() is called before load()', () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    expect(() => viewer.destroy()).not.toThrow();
    expect(viewer.presentationData).toBeNull();
  });

  it('clears mounted slides on destroy', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation());
    await viewer.renderList();

    expect(viewer.getMountedSlides().length).toBe(3);
    viewer.destroy();
    expect(viewer.getMountedSlides()).toEqual([]);
  });

  it('does not poison the render queue when destroyed during a batched render', async () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });

    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation(3));

    const inFlight = viewer.renderList({ batchSize: 1 });
    await Promise.resolve();
    await Promise.resolve();
    expect(rafCallbacks).toHaveLength(1);

    viewer.destroy();
    rafCallbacks.shift()!(0);

    await expect(inFlight).resolves.toBeUndefined();
    expect(container.innerHTML).toBe('');

    viewer.load(makeMockPresentation(1));
    await viewer.renderSlide(0);

    expect(container.querySelectorAll('.mock-slide')).toHaveLength(1);
  });

  it('load() unloads the previous rendered deck before replacing presentation data', async () => {
    const revokeStub = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation(2));
    await viewer.renderList();

    const handles = vi.mocked(renderSlide).mock.results.slice(-2).map((result) => result.value);
    const cache = (viewer as any).mediaUrlCache as Map<string, string>;
    const chartInstances = (viewer as any).chartInstances as Set<{
      isDisposed: () => boolean;
      dispose: () => void;
    }>;
    const chart = {
      isDisposed: vi.fn(() => false),
      dispose: vi.fn(),
    };
    cache.set('img1', 'blob:http://localhost/old-deck');
    chartInstances.add(chart);

    expect(container.querySelectorAll('.mock-slide')).toHaveLength(2);
    expect(viewer.getMountedSlides()).toEqual([0, 1]);

    viewer.load(makeMockPresentation(1));

    expect(handles[0].dispose).toHaveBeenCalledOnce();
    expect(handles[1].dispose).toHaveBeenCalledOnce();
    expect(chart.dispose).toHaveBeenCalledOnce();
    expect(revokeStub).toHaveBeenCalledWith('blob:http://localhost/old-deck');
    expect(container.innerHTML).toBe('');
    expect(viewer.getMountedSlides()).toEqual([]);
    expect(viewer.slideCount).toBe(1);
    expect(viewer.presentationData).not.toBeNull();

    revokeStub.mockRestore();
  });

  it('stops a batched list render when a newer render request supersedes it', async () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });

    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation(3));

    const firstRender = viewer.renderList({ batchSize: 1 });
    await Promise.resolve();
    await Promise.resolve();

    expect(listItemsIn(container)).toHaveLength(1);
    expect(rafCallbacks).toHaveLength(1);

    const supersedingRender = viewer.renderSlide(2);
    rafCallbacks.shift()!(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(listItemsIn(container)).toHaveLength(1);

    await expect(firstRender).resolves.toBeUndefined();
    await expect(supersedingRender).resolves.toBeUndefined();

    expect(listItemsIn(container)).toHaveLength(0);
    expect(container.querySelectorAll('.mock-slide')).toHaveLength(1);
    expect(container.querySelector('.mock-slide')?.getAttribute('data-slide-index')).toBe('2');
  });
});

describe('PptxViewer[Symbol.dispose]', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('Symbol.dispose calls destroy()', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation());
    await viewer.renderList();

    expect(viewer.presentationData).not.toBeNull();
    viewer[Symbol.dispose]();
    expect(viewer.presentationData).toBeNull();
    expect(container.innerHTML).toBe('');
  });

  it('Symbol.dispose is idempotent with destroy()', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    viewer.load(makeMockPresentation());
    await viewer.renderList();

    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    expect(() => {
      viewer[Symbol.dispose]();
      viewer.destroy();
    }).not.toThrow();
  });
});

describe('PptxViewer renderSlideToContainer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null before load()', () => {
    const viewer = new PptxViewer(document.createElement('div'));
    const container = document.createElement('div');
    expect(viewer.renderSlideToContainer(0, container)).toBeNull();
  });

  it('returns SlideHandle and appends to container', () => {
    const viewer = new PptxViewer(document.createElement('div'));
    viewer.load(makeMockPresentation());
    const container = document.createElement('div');

    const handle = viewer.renderSlideToContainer(0, container);
    expect(handle).not.toBeNull();
    expect(container.children.length).toBe(1);
    expect(container.children[0]).toBe(handle!.element);
  });

  it('applies scale transform', () => {
    const viewer = new PptxViewer(document.createElement('div'));
    viewer.load(makeMockPresentation());
    const container = document.createElement('div');

    const handle = viewer.renderSlideToContainer(0, container, 0.5);
    expect(handle!.element.style.transform).toBe('scale(0.5)');
  });

  it('fires sliderendered event', () => {
    const listener = vi.fn();
    const viewer = new PptxViewer(document.createElement('div'));
    viewer.addEventListener('sliderendered', listener);
    viewer.load(makeMockPresentation());
    const container = document.createElement('div');

    viewer.renderSlideToContainer(0, container);
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe('PptxViewer text search and thumbnail preview', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('searchText returns structured matches and clears its cache on load()', () => {
    const viewer = new PptxViewer(document.createElement('div'));

    expect(viewer.searchText('gpu')).toEqual([]);

    const first = makeMockPresentation(1);
    first.slides[0].nodes = [
      {
        id: 'title',
        name: 'Title',
        nodeType: 'shape',
        position: { x: 10, y: 20 },
        size: { w: 200, h: 80 },
        rotation: 0,
        flipH: false,
        flipV: false,
        adjustments: new Map(),
        textBody: { paragraphs: [{ level: 0, runs: [{ text: 'GPU capacity' }] }] },
        source: {} as any,
      } as any,
    ];

    viewer.load(first);
    expect(viewer.searchText('gpu')).toMatchObject([
      {
        slideIndex: 0,
        nodeId: 'title',
        text: 'GPU capacity',
        matchStart: 0,
        matchEnd: 3,
      },
    ]);

    viewer.load(makeMockPresentation(1));
    expect(viewer.searchText('gpu')).toEqual([]);
  });

  it('renderThumbnailToContainer scales a full-size slide inside a clipped wrapper', () => {
    const viewer = new PptxViewer(document.createElement('div'));
    viewer.load(makeMockPresentation(1));
    const container = document.createElement('div');

    const handle = viewer.renderThumbnailToContainer(0, container, { width: 192 });

    expect(handle).not.toBeNull();
    expect(container.children[0]).toBe(handle!.element);
    expect(handle!.element.style.width).toBe('192px');
    expect(handle!.element.style.height).toBe('108px');
    expect(handle!.element.style.overflow).toBe('hidden');
    expect(handle!.element.querySelector('.mock-slide')).not.toBeNull();
    expect(handle!.element.querySelector<HTMLElement>('.mock-slide')!.style.transform).toBe(
      'scale(0.2)',
    );
  });

  it('renderThumbnailToContainer returns null before load or for an out-of-range slide', () => {
    const viewer = new PptxViewer(document.createElement('div'));
    const container = document.createElement('div');

    expect(viewer.renderThumbnailToContainer(0, container)).toBeNull();

    viewer.load(makeMockPresentation(1));
    expect(viewer.renderThumbnailToContainer(3, container)).toBeNull();
    expect(container.children).toHaveLength(0);
  });

  it('renderThumbnailToContainer supports explicit scale, height-only scale, and default width scale', () => {
    const viewer = new PptxViewer(document.createElement('div'));
    viewer.load(makeMockPresentation(1));
    const container = document.createElement('div');

    const explicit = viewer.renderThumbnailToContainer(0, container, { scale: 0.5 });
    expect(explicit!.element.style.width).toBe('480px');
    expect(explicit!.element.style.height).toBe('270px');

    const heightOnly = viewer.renderThumbnailToContainer(0, container, { height: 135 });
    expect(heightOnly!.element.style.width).toBe('240px');
    expect(heightOnly!.element.style.height).toBe('135px');

    const defaultSize = viewer.renderThumbnailToContainer(0, container, { scale: Number.NaN });
    expect(defaultSize!.element.style.width).toBe('180px');
    expect(defaultSize!.element.style.height).toBe('101.25px');
  });

  it('renderThumbnailToContainer removes the wrapper if underlying slide rendering returns null', () => {
    const viewer = new PptxViewer(document.createElement('div'));
    viewer.load(makeMockPresentation(1));
    const container = document.createElement('div');
    const spy = vi.spyOn(viewer, 'renderSlideToContainer').mockReturnValue(null);

    const handle = viewer.renderThumbnailToContainer(0, container, { width: 192 });

    expect(handle).toBeNull();
    expect(container.children).toHaveLength(0);
    spy.mockRestore();
  });

  it('renderThumbnailToContainer disposes the underlying slide and removes the wrapper', () => {
    const viewer = new PptxViewer(document.createElement('div'));
    viewer.load(makeMockPresentation(1));
    const container = document.createElement('div');

    const handle = viewer.renderThumbnailToContainer(0, container, { width: 192 });
    const slideHandle = vi.mocked(renderSlide).mock.results.at(-1)!.value;
    handle!.dispose();

    expect(slideHandle.dispose).toHaveBeenCalledOnce();
    expect(container.children.length).toBe(0);
  });

  it('renderThumbnailToContainer dispose is idempotent', () => {
    const viewer = new PptxViewer(document.createElement('div'));
    viewer.load(makeMockPresentation(1));
    const container = document.createElement('div');

    const handle = viewer.renderThumbnailToContainer(0, container, { width: 192 });
    const slideHandle = vi.mocked(renderSlide).mock.results.at(-1)!.value;

    handle!.dispose();
    handle!.dispose();

    expect(slideHandle.dispose).toHaveBeenCalledOnce();
    expect(container.children.length).toBe(0);
  });

  it('highlightSearchResult returns null before load, for out-of-range slides, or before rendering', async () => {
    const viewer = new PptxViewer(document.createElement('div'));
    const result = {
      slideIndex: 0,
      nodeId: 'title',
      nodePath: 'slides/0/nodes/title',
      nodeType: 'shape',
      textKind: 'shape',
      text: 'GPU',
      bounds: { x: 0, y: 0, w: 10, h: 10 },
      matchStart: 0,
      matchEnd: 3,
      snippet: 'GPU',
    } as any;

    await expect(viewer.highlightSearchResult(result)).resolves.toBeNull();

    viewer.load(makeMockPresentation(1));
    await expect(viewer.highlightSearchResult({ ...result, slideIndex: 5 })).resolves.toBeNull();
    await expect(
      viewer.highlightSearchResult(result, { scrollIntoView: false }),
    ).resolves.toBeNull();
  });

  it('highlightSearchResult draws a default node-level overlay on the rendered slide', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    const presentation = makeMockPresentation(1);
    presentation.slides[0].nodes = [
      {
        id: 'title',
        name: 'Title',
        nodeType: 'shape',
        position: { x: 10, y: 20 },
        size: { w: 200, h: 80 },
        rotation: 0,
        flipH: false,
        flipV: false,
        adjustments: new Map(),
        textBody: { paragraphs: [{ level: 0, runs: [{ text: 'GPU capacity' }] }] },
        source: {} as any,
      } as any,
    ];

    viewer.load(presentation);
    await viewer.renderList();

    const [result] = viewer.searchText('gpu');
    const handle = await viewer.highlightSearchResult(result);

    expect(handle).not.toBeNull();
    expect(handle!.result).toBe(result);
    expect(handle!.element.classList.contains('pptx-search-highlight')).toBe(true);
    expect(handle!.element.dataset.pptxSearchHighlight).toBe('true');
    expect(handle!.element.style.left).toBe('10px');
    expect(handle!.element.style.top).toBe('20px');
    expect(handle!.element.style.width).toBe('200px');
    expect(handle!.element.style.height).toBe('80px');
    expect(container.querySelectorAll('.pptx-search-highlight')).toHaveLength(1);
  });

  it('highlightSearchResult with scrollIntoView=false navigates in slide mode when needed', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    const presentation = makeMockPresentation(2);
    presentation.slides[1].nodes = [
      {
        id: 'detail',
        name: 'Detail',
        nodeType: 'shape',
        position: { x: 30, y: 40 },
        size: { w: 160, h: 50 },
        rotation: 0,
        flipH: false,
        flipV: false,
        adjustments: new Map(),
        textBody: { paragraphs: [{ level: 0, runs: [{ text: 'GPU detail' }] }] },
        source: {} as any,
      } as any,
    ];

    viewer.load(presentation);
    await viewer.renderSlide(0);

    const [result] = viewer.searchText('detail');
    const handle = await viewer.highlightSearchResult(result, { scrollIntoView: false });

    expect(handle).not.toBeNull();
    expect(viewer.currentSlideIndex).toBe(1);
    expect(container.querySelectorAll('.pptx-search-highlight')).toHaveLength(1);
  });

  it('highlightSearchResult accepts custom visual styles and disposes the overlay', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    const presentation = makeMockPresentation(1);
    presentation.slides[0].nodes = [
      {
        id: 'title',
        name: 'Title',
        nodeType: 'shape',
        position: { x: 10, y: 20 },
        size: { w: 200, h: 80 },
        rotation: 0,
        flipH: false,
        flipV: false,
        adjustments: new Map(),
        textBody: { paragraphs: [{ level: 0, runs: [{ text: 'GPU capacity' }] }] },
        source: {} as any,
      } as any,
    ];

    viewer.load(presentation);
    await viewer.renderSlide(0);

    const [result] = viewer.searchText('gpu');
    const handle = await viewer.highlightSearchResult(result, {
      className: 'custom-search-hit',
      borderColor: 'lime',
      backgroundColor: 'rgba(1, 2, 3, 0.4)',
      borderRadius: 9,
      borderWidth: 2,
      boxShadow: '0 0 8px red',
      padding: 3,
      zIndex: 345,
      style: { opacity: '0.8' },
      scrollIntoView: false,
    });

    expect(handle).not.toBeNull();
    expect(handle!.element.classList.contains('custom-search-hit')).toBe(true);
    expect(handle!.element.style.left).toBe('7px');
    expect(handle!.element.style.top).toBe('17px');
    expect(handle!.element.style.width).toBe('206px');
    expect(handle!.element.style.height).toBe('86px');
    expect(handle!.element.style.backgroundColor).toBe('rgba(1, 2, 3, 0.4)');
    expect(handle!.element.style.borderRadius).toBe('9px');
    expect(handle!.element.style.borderWidth).toBe('2px');
    expect(handle!.element.style.boxShadow).toBe('0 0 8px red');
    expect(handle!.element.style.zIndex).toBe('345');
    expect(handle!.element.style.opacity).toBe('0.8');

    handle!.dispose();
    expect(container.querySelectorAll('.pptx-search-highlight')).toHaveLength(0);
  });

  it('highlightSearchResult accepts string CSS lengths and skips undefined extra styles', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    const presentation = makeMockPresentation(1);
    presentation.slides[0].nodes = [
      {
        id: 'title',
        name: 'Title',
        nodeType: 'shape',
        position: { x: 10, y: 20 },
        size: { w: 200, h: 80 },
        rotation: 0,
        flipH: false,
        flipV: false,
        adjustments: new Map(),
        textBody: { paragraphs: [{ level: 0, runs: [{ text: 'GPU capacity' }] }] },
        source: {} as any,
      } as any,
    ];

    viewer.load(presentation);
    await viewer.renderSlide(0);

    const [result] = viewer.searchText('gpu');
    const handle = await viewer.highlightSearchResult(result, {
      className: '  alpha   beta  ',
      borderRadius: '12%',
      borderWidth: '0.2rem',
      scrollIntoView: false,
      style: { opacity: undefined, outline: '1px solid red' },
    });

    expect(handle!.element.classList.contains('alpha')).toBe(true);
    expect(handle!.element.classList.contains('beta')).toBe(true);
    expect(handle!.element.style.borderRadius).toBe('12%');
    expect(handle!.element.style.borderWidth).toBe('0.2rem');
    expect(handle!.element.style.opacity).toBe('');
    expect(handle!.element.style.outline).toBe('1px solid red');
  });

  it('clearSearchHighlights removes all active search overlays', async () => {
    const container = document.createElement('div');
    const viewer = new PptxViewer(container);
    const presentation = makeMockPresentation(1);
    presentation.slides[0].nodes = [
      {
        id: 'title',
        name: 'Title',
        nodeType: 'shape',
        position: { x: 10, y: 20 },
        size: { w: 200, h: 80 },
        rotation: 0,
        flipH: false,
        flipV: false,
        adjustments: new Map(),
        textBody: { paragraphs: [{ level: 0, runs: [{ text: 'GPU GPU' }] }] },
        source: {} as any,
      } as any,
    ];

    viewer.load(presentation);
    await viewer.renderList();

    const results = viewer.searchText('gpu');
    await viewer.highlightSearchResult(results[0]);
    await viewer.highlightSearchResult(results[1]);
    expect(container.querySelectorAll('.pptx-search-highlight')).toHaveLength(2);

    viewer.clearSearchHighlights();
    expect(container.querySelectorAll('.pptx-search-highlight')).toHaveLength(0);
  });
});
