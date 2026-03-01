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
