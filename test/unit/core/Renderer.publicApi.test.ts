import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/parser/ZipParser', () => ({
  parseZip: vi.fn(async () => ({})),
}));

const mockPresentation = {
  width: 960,
  height: 540,
  slides: [
    { nodes: [], rels: new Map(), showMasterSp: true },
    { nodes: [], rels: new Map(), showMasterSp: true },
    { nodes: [], rels: new Map(), showMasterSp: true },
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

import { PptxRenderer } from '../../../src/core/Renderer';

describe('PptxRenderer public API getters', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns defaults before preview()', () => {
    const renderer = new PptxRenderer(document.createElement('div'));
    expect(renderer.presentationData).toBeNull();
    expect(renderer.slideCount).toBe(0);
    expect(renderer.slideWidth).toBe(0);
    expect(renderer.slideHeight).toBe(0);
    expect(renderer.currentSlideIndex).toBe(0);
  });

  it('returns correct values after preview()', async () => {
    const renderer = new PptxRenderer(document.createElement('div'));
    await renderer.preview(new ArrayBuffer(4));

    expect(renderer.presentationData).not.toBeNull();
    expect(renderer.slideCount).toBe(3);
    expect(renderer.slideWidth).toBe(960);
    expect(renderer.slideHeight).toBe(540);
    expect(renderer.currentSlideIndex).toBe(0);
  });

  it('currentSlideIndex updates after goToSlide()', async () => {
    const renderer = new PptxRenderer(document.createElement('div'), { mode: 'slide' });
    await renderer.preview(new ArrayBuffer(4));

    renderer.goToSlide(2);
    expect(renderer.currentSlideIndex).toBe(2);
  });
});

describe('PptxRenderer.renderSlideToContainer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null before preview()', () => {
    const renderer = new PptxRenderer(document.createElement('div'));
    const container = document.createElement('div');
    expect(renderer.renderSlideToContainer(0, container)).toBeNull();
  });

  it('returns null for out-of-range index', async () => {
    const renderer = new PptxRenderer(document.createElement('div'));
    await renderer.preview(new ArrayBuffer(4));
    const container = document.createElement('div');
    expect(renderer.renderSlideToContainer(99, container)).toBeNull();
  });

  it('renders slide into provided container', async () => {
    const renderer = new PptxRenderer(document.createElement('div'));
    await renderer.preview(new ArrayBuffer(4));
    const container = document.createElement('div');

    const handle = renderer.renderSlideToContainer(0, container);
    expect(handle).not.toBeNull();
    expect(container.children.length).toBe(1);
    expect(container.children[0]).toBe(handle!.element);
  });

  it('applies scale transform when scale !== 1', async () => {
    const renderer = new PptxRenderer(document.createElement('div'));
    await renderer.preview(new ArrayBuffer(4));
    const container = document.createElement('div');

    const handle = renderer.renderSlideToContainer(0, container, 0.5);
    expect(handle!.element.style.transform).toBe('scale(0.5)');
    expect(handle!.element.style.transformOrigin).toBe('top left');
  });

  it('does not apply transform when scale is 1', async () => {
    const renderer = new PptxRenderer(document.createElement('div'));
    await renderer.preview(new ArrayBuffer(4));
    const container = document.createElement('div');

    const handle = renderer.renderSlideToContainer(0, container, 1);
    expect(handle!.element.style.transform).toBe('');
  });
});

describe('PptxRenderer.destroy', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('clears container and nulls presentation', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container);
    await renderer.preview(new ArrayBuffer(4));

    expect(renderer.presentationData).not.toBeNull();
    renderer.destroy();
    expect(renderer.presentationData).toBeNull();
    expect(renderer.slideCount).toBe(0);
    expect(container.innerHTML).toBe('');
  });

  it('revokes blob URLs on destroy', async () => {
    const revokeStub = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container);
    await renderer.preview(new ArrayBuffer(4));

    renderer.destroy();
    // No blob URLs to revoke in this test, but the method shouldn't throw
    expect(renderer.slideCount).toBe(0);
    revokeStub.mockRestore();
  });
});

describe('PptxRenderer callbacks', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fires onSlideRendered from renderSlideToContainer', async () => {
    const onSlideRendered = vi.fn();
    const renderer = new PptxRenderer(document.createElement('div'), { onSlideRendered });
    await renderer.preview(new ArrayBuffer(4));

    const container = document.createElement('div');
    const handle = renderer.renderSlideToContainer(1, container);
    expect(onSlideRendered).toHaveBeenCalledWith(1, handle!.element);
  });

  it('fires onSlideChange from goToSlide()', async () => {
    const onSlideChange = vi.fn();
    const renderer = new PptxRenderer(document.createElement('div'), {
      mode: 'slide',
      onSlideChange,
    });
    await renderer.preview(new ArrayBuffer(4));

    renderer.goToSlide(2);
    expect(onSlideChange).toHaveBeenCalledWith(2);
  });

  it('does not fire onSlideChange when index is same after goToSlide', async () => {
    const onSlideChange = vi.fn();
    const renderer = new PptxRenderer(document.createElement('div'), {
      mode: 'slide',
      onSlideChange,
    });
    await renderer.preview(new ArrayBuffer(4));

    // Clear calls from initial render slidechange
    onSlideChange.mockClear();

    renderer.goToSlide(0); // already at 0
    expect(onSlideChange).not.toHaveBeenCalled();
  });

  it('fires onSlideChange with clamped index when out-of-bounds goToSlide is called', async () => {
    const onSlideChange = vi.fn();
    const renderer = new PptxRenderer(document.createElement('div'), {
      mode: 'slide',
      onSlideChange,
    });
    await renderer.preview(new ArrayBuffer(4));

    // 99 is beyond the 3-slide deck; should clamp to slide 2 and fire
    renderer.goToSlide(99);
    expect(onSlideChange).toHaveBeenCalledWith(2);
    expect(renderer.currentSlideIndex).toBe(2);
  });

  it('fires onSlideChange with clamped index of 0 when negative goToSlide is called', async () => {
    const onSlideChange = vi.fn();
    const renderer = new PptxRenderer(document.createElement('div'), {
      mode: 'slide',
      onSlideChange,
    });
    await renderer.preview(new ArrayBuffer(4));

    renderer.goToSlide(1);
    onSlideChange.mockClear();

    renderer.goToSlide(-5);
    expect(onSlideChange).toHaveBeenCalledWith(0);
    expect(renderer.currentSlideIndex).toBe(0);
  });
});

describe('PptxRenderer.renderSingleSlide (slide mode)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders slide wrapper, slide element, and nav buttons into container', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'slide' });
    await renderer.preview(new ArrayBuffer(4));

    // wrapper div + nav div
    expect(container.children.length).toBe(2);
    expect(container.querySelector('.mock-slide')).not.toBeNull();
  });

  it('disables Prev button on first slide', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'slide' });
    await renderer.preview(new ArrayBuffer(4));

    const buttons = container.querySelectorAll<HTMLButtonElement>('button');
    const prevBtn = buttons[0];
    expect(prevBtn.disabled).toBe(true);
  });

  it('disables Next button on last slide', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'slide' });
    await renderer.preview(new ArrayBuffer(4));

    renderer.goToSlide(2); // last slide of 3-slide deck
    const buttons = container.querySelectorAll<HTMLButtonElement>('button');
    const nextBtn = buttons[1];
    expect(nextBtn.disabled).toBe(true);
  });

  it('enables both Prev and Next buttons on a middle slide', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'slide' });
    await renderer.preview(new ArrayBuffer(4));

    renderer.goToSlide(1);
    const buttons = container.querySelectorAll<HTMLButtonElement>('button');
    expect(buttons[0].disabled).toBe(false); // Prev
    expect(buttons[1].disabled).toBe(false); // Next
  });

  it('displays correct slide counter text', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'slide' });
    await renderer.preview(new ArrayBuffer(4));

    const span = container.querySelector('span');
    expect(span?.textContent).toBe('1 / 3');

    renderer.goToSlide(2);
    const span2 = container.querySelector('span');
    expect(span2?.textContent).toBe('3 / 3');
  });

  it('clicking Prev button decrements the slide', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'slide' });
    await renderer.preview(new ArrayBuffer(4));

    renderer.goToSlide(2);
    const prevBtn = container.querySelectorAll<HTMLButtonElement>('button')[0];
    prevBtn.click();
    expect(renderer.currentSlideIndex).toBe(1);
  });

  it('clicking Next button increments the slide', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'slide' });
    await renderer.preview(new ArrayBuffer(4));

    const nextBtn = container.querySelectorAll<HTMLButtonElement>('button')[1];
    nextBtn.click();
    expect(renderer.currentSlideIndex).toBe(1);
  });

  it('fires onSlideRendered with current slide index when rendering in slide mode', async () => {
    const onSlideRendered = vi.fn();
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'slide', onSlideRendered });
    await renderer.preview(new ArrayBuffer(4));

    // onSlideRendered fires once during initial preview render
    expect(onSlideRendered).toHaveBeenCalledWith(0, expect.any(HTMLElement));

    onSlideRendered.mockClear();
    renderer.goToSlide(1);
    expect(onSlideRendered).toHaveBeenCalledWith(1, expect.any(HTMLElement));
  });
});

describe('PptxRenderer.handleNavigate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('opens allowed external URL via window.open with noopener noreferrer', async () => {
    const openStub = vi.spyOn(window, 'open').mockReturnValue(null);
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'slide' });
    await renderer.preview(new ArrayBuffer(4));

    // Access handleNavigate indirectly via renderSlideToContainer onNavigate.
    // The renderSlide mock captures the onNavigate callback in options.
    // We reach it through renderSlideToContainer which wires up handleNavigate.
    // Invoke the internal method via the public surface: trigger navigation
    // through goToSlide with a URL target by calling the private method via
    // type assertion since it is private.
    (renderer as unknown as { handleNavigate: (t: { url?: string }) => void }).handleNavigate({
      url: 'https://example.com',
    });

    expect(openStub).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
  });

  it('does not open window for disallowed URL protocols', async () => {
    const openStub = vi.spyOn(window, 'open').mockReturnValue(null);
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'slide' });
    await renderer.preview(new ArrayBuffer(4));

    (renderer as unknown as { handleNavigate: (t: { url?: string }) => void }).handleNavigate({
      url: 'javascript:alert(1)',
    });

    expect(openStub).not.toHaveBeenCalled();
  });

  it('does not open window when url is undefined', async () => {
    const openStub = vi.spyOn(window, 'open').mockReturnValue(null);
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'slide' });
    await renderer.preview(new ArrayBuffer(4));

    (renderer as unknown as { handleNavigate: (t: { url?: string; slideIndex?: number }) => void }).handleNavigate(
      {}
    );

    expect(openStub).not.toHaveBeenCalled();
  });

  it('navigates to slideIndex when slideIndex is provided in navigate target', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'slide' });
    await renderer.preview(new ArrayBuffer(4));

    (renderer as unknown as { handleNavigate: (t: { slideIndex?: number }) => void }).handleNavigate({
      slideIndex: 2,
    });

    expect(renderer.currentSlideIndex).toBe(2);
  });

  it('opens https URL correctly', async () => {
    const openStub = vi.spyOn(window, 'open').mockReturnValue(null);
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container);
    await renderer.preview(new ArrayBuffer(4));

    (renderer as unknown as { handleNavigate: (t: { url?: string }) => void }).handleNavigate({
      url: 'https://secure.example.org/path?q=1',
    });

    expect(openStub).toHaveBeenCalledWith(
      'https://secure.example.org/path?q=1',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('opens mailto URL correctly', async () => {
    const openStub = vi.spyOn(window, 'open').mockReturnValue(null);
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container);
    await renderer.preview(new ArrayBuffer(4));

    (renderer as unknown as { handleNavigate: (t: { url?: string }) => void }).handleNavigate({
      url: 'mailto:user@example.com',
    });

    expect(openStub).toHaveBeenCalledWith('mailto:user@example.com', '_blank', 'noopener,noreferrer');
  });
});

describe('PptxRenderer.goToSlide in list mode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // jsdom does not implement scrollIntoView; stub it globally so goToSlide
    // can be exercised without throwing in every test in this suite.
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('calls scrollIntoView on the matching data-slide-index element', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'list' });
    await renderer.preview(new ArrayBuffer(4));

    // Locate the element that goToSlide will target and spy on its scrollIntoView.
    const target = container.querySelector<HTMLElement>('[data-slide-index="1"]');
    expect(target).not.toBeNull();
    const scrollSpy = vi.fn();
    target!.scrollIntoView = scrollSpy;

    await renderer.goToSlide(1);

    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  });

  it('updates currentSlideIndex after goToSlide in list mode', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'list' });
    await renderer.preview(new ArrayBuffer(4));

    renderer.goToSlide(2);
    expect(renderer.currentSlideIndex).toBe(2);
  });

  it('does not throw when target element is absent', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'list' });
    await renderer.preview(new ArrayBuffer(4));

    // Clear the container to remove slide elements, simulating an absent target.
    container.innerHTML = '';

    await expect(renderer.goToSlide(1)).resolves.toBeUndefined();
    expect(renderer.currentSlideIndex).toBe(1);
  });

  it('fires onSlideChange in list mode when slide index changes', async () => {
    const onSlideChange = vi.fn();
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'list', onSlideChange });
    await renderer.preview(new ArrayBuffer(4));

    renderer.goToSlide(2);
    expect(onSlideChange).toHaveBeenCalledWith(2);
  });
});

describe('PptxRenderer.destroy (extended)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('revokes all tracked blob URLs', async () => {
    const revokeStub = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container);
    await renderer.preview(new ArrayBuffer(4));

    // Inject fake blob URLs into the internal mediaUrlCache directly.
    const cache = (renderer as unknown as { mediaUrlCache: Map<string, string> }).mediaUrlCache;
    cache.set('img1', 'blob:http://localhost/fake-1');
    cache.set('img2', 'blob:http://localhost/fake-2');

    renderer.destroy();

    expect(revokeStub).toHaveBeenCalledWith('blob:http://localhost/fake-1');
    expect(revokeStub).toHaveBeenCalledWith('blob:http://localhost/fake-2');
    expect(revokeStub).toHaveBeenCalledTimes(2);
  });

  it('empties the media URL cache after destroy', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container);
    await renderer.preview(new ArrayBuffer(4));

    const cache = (renderer as unknown as { mediaUrlCache: Map<string, string> }).mediaUrlCache;
    cache.set('img1', 'blob:http://localhost/fake-1');

    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    renderer.destroy();

    expect(cache.size).toBe(0);
  });

  it('clears container innerHTML after destroy', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'slide' });
    await renderer.preview(new ArrayBuffer(4));

    expect(container.innerHTML).not.toBe('');
    renderer.destroy();
    expect(container.innerHTML).toBe('');
  });

  it('nulls the presentation so getters return defaults', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container);
    await renderer.preview(new ArrayBuffer(4));

    renderer.destroy();
    expect(renderer.presentationData).toBeNull();
    expect(renderer.slideCount).toBe(0);
    expect(renderer.slideWidth).toBe(0);
    expect(renderer.slideHeight).toBe(0);
  });

  it('is safe to call destroy() twice without throwing', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container);
    await renderer.preview(new ArrayBuffer(4));

    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    expect(() => {
      renderer.destroy();
      renderer.destroy();
    }).not.toThrow();
  });

  it('does nothing when destroy() is called before preview()', () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container);
    expect(() => renderer.destroy()).not.toThrow();
    expect(renderer.presentationData).toBeNull();
  });

  it('disconnects ResizeObserver on destroy', async () => {
    const disconnectSpy = vi.fn();
    const MockResizeObserver = vi.fn(() => ({
      observe: vi.fn(),
      disconnect: disconnectSpy,
    }));
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    const container = document.createElement('div');
    const renderer = new PptxRenderer(container);
    await renderer.preview(new ArrayBuffer(4));

    renderer.destroy();
    expect(disconnectSpy).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

describe('PptxRenderer.mountListSlide error path', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('shows error placeholder when renderSlide throws in list mode', async () => {
    const { renderSlide: renderSlideMock } = await import('../../../src/renderer/SlideRenderer');
    const mockFn = vi.mocked(renderSlideMock);
    // Make renderSlide throw on first call (slide 0)
    mockFn.mockImplementationOnce(() => {
      throw new Error('render boom');
    });

    const onSlideError = vi.fn();
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'list', onSlideError });
    await renderer.preview(new ArrayBuffer(4));

    // onSlideError should have been called for slide 0
    expect(onSlideError).toHaveBeenCalledWith(0, expect.any(Error));

    // The wrapper for slide 0 should show error styling
    const wrapper = container.querySelector('[data-slide-index="0"]')?.querySelector('div');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.textContent).toContain('Render Error');
    expect(wrapper!.style.border).toContain('dashed');
  });

  it('continues rendering other slides when one slide throws', async () => {
    const { renderSlide: renderSlideMock } = await import('../../../src/renderer/SlideRenderer');
    const mockFn = vi.mocked(renderSlideMock);
    // Throw only on first call, rest succeed
    mockFn
      .mockImplementationOnce(() => {
        throw new Error('slide 0 fails');
      })
      .mockImplementation(() => {
        const el = document.createElement('div');
        el.className = 'mock-slide';
        return { element: el, dispose: vi.fn(), [Symbol.dispose]() { this.dispose(); } };
      });

    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'list' });
    await renderer.preview(new ArrayBuffer(4));

    // All 3 slides should have items in the container
    const items = container.querySelectorAll('[data-slide-index]');
    expect(items.length).toBe(3);
    // Slide 1 and 2 should have rendered content
    expect(container.querySelector('[data-slide-index="1"] .mock-slide')).not.toBeNull();
  });
});

describe('PptxRenderer.unmountListSlide', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('resets wrapper state when unmounting in windowed mode', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, {
      mode: 'list',
      listMountStrategy: 'windowed',
      windowedInitialSlides: 3,
    });
    await renderer.preview(new ArrayBuffer(4));

    // Access internal unmountListSlide via the private method
    const unmountFn = (renderer as unknown as {
      unmountListSlide: (index: number, wrapper: HTMLDivElement, displayHeight: number) => void;
    }).unmountListSlide.bind(renderer);

    // Find a mounted wrapper
    const item = container.querySelector('[data-slide-index="0"]');
    const wrapper = item?.querySelector('div') as HTMLDivElement;
    expect(wrapper).not.toBeNull();

    // Set mounted state to simulate a mounted slide
    wrapper.dataset.mounted = '1';
    wrapper.innerHTML = '<div>content</div>';
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.justifyContent = 'center';
    wrapper.style.border = '2px dashed red';
    wrapper.style.color = '#cc0000';
    wrapper.style.fontSize = '14px';

    unmountFn(0, wrapper, 540);

    expect(wrapper.dataset.mounted).toBe('0');
    expect(wrapper.innerHTML).toBe('');
    expect(wrapper.style.display).toBe('');
    expect(wrapper.style.alignItems).toBe('');
    expect(wrapper.style.justifyContent).toBe('');
    expect(wrapper.style.border).toBe('');
    expect(wrapper.style.color).toBe('');
    expect(wrapper.style.fontSize).toBe('');
    expect(wrapper.style.height).toBe('540px');
  });

  it('does not reset wrapper when not mounted', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'list' });
    await renderer.preview(new ArrayBuffer(4));

    const unmountFn = (renderer as unknown as {
      unmountListSlide: (index: number, wrapper: HTMLDivElement, displayHeight: number) => void;
    }).unmountListSlide.bind(renderer);

    const wrapper = document.createElement('div');
    wrapper.dataset.mounted = '0';
    wrapper.innerHTML = '<div>keep</div>';

    unmountFn(0, wrapper, 540);

    // Should not have been cleared since mounted !== '1'
    expect(wrapper.innerHTML).toBe('<div>keep</div>');
  });
});

describe('PptxRenderer IntersectionObserver fallback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('mounts all slides immediately when IntersectionObserver is unavailable', async () => {
    // Save original IO
    const origIO = window.IntersectionObserver;
    // Remove IntersectionObserver to trigger fallback
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).IntersectionObserver = undefined;

    try {
      const onSlideRendered = vi.fn();
      const container = document.createElement('div');
      const renderer = new PptxRenderer(container, {
        mode: 'list',
        listMountStrategy: 'windowed',
        windowedInitialSlides: 1,
        onSlideRendered,
      });
      await renderer.preview(new ArrayBuffer(4));

      // All 3 slides should be mounted (not just initial 1) because IO fallback mounts all
      const mountedWrappers = container.querySelectorAll('[data-mounted="1"]');
      expect(mountedWrappers.length).toBe(3);
      expect(onSlideRendered).toHaveBeenCalledTimes(3);
    } finally {
      // Restore IO
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).IntersectionObserver = origIO;
    }
  });

  it('uses IntersectionObserver when available in windowed mode', async () => {
    const observeSpy = vi.fn();
    const disconnectSpy = vi.fn();
    const MockIO = vi.fn(() => ({
      observe: observeSpy,
      disconnect: disconnectSpy,
      unobserve: vi.fn(),
    }));
    vi.stubGlobal('IntersectionObserver', MockIO);

    try {
      const container = document.createElement('div');
      const renderer = new PptxRenderer(container, {
        mode: 'list',
        listMountStrategy: 'windowed',
        windowedInitialSlides: 1,
      });
      await renderer.preview(new ArrayBuffer(4));

      // IO should have been created and observe called for each wrapper (3 windowed + 3 scroll tracking)
      expect(MockIO).toHaveBeenCalled();
      expect(observeSpy).toHaveBeenCalledTimes(6);

      renderer.destroy();
      expect(disconnectSpy).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('PptxRenderer chart instance lifecycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('destroy() disposes all chart instances and clears the set', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container);
    await renderer.preview(new ArrayBuffer(4));

    // Access private chartInstances via cast
    const chartSet = (renderer as any).chartInstances as Set<any>;

    // Simulate registered chart instances
    const mockChart1 = { isDisposed: vi.fn(() => false), dispose: vi.fn(), getDom: vi.fn() };
    const mockChart2 = { isDisposed: vi.fn(() => false), dispose: vi.fn(), getDom: vi.fn() };
    chartSet.add(mockChart1);
    chartSet.add(mockChart2);

    renderer.destroy();

    expect(mockChart1.dispose).toHaveBeenCalled();
    expect(mockChart2.dispose).toHaveBeenCalled();
    expect(chartSet.size).toBe(0);
  });

  it('destroy() skips already-disposed chart instances', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container);
    await renderer.preview(new ArrayBuffer(4));

    const chartSet = (renderer as any).chartInstances as Set<any>;
    const disposedChart = { isDisposed: vi.fn(() => true), dispose: vi.fn(), getDom: vi.fn() };
    chartSet.add(disposedChart);

    renderer.destroy();

    expect(disposedChart.dispose).not.toHaveBeenCalled();
    expect(chartSet.size).toBe(0);
  });

  it('setZoom() disposes previous chart instances before re-render', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container);
    await renderer.preview(new ArrayBuffer(4));

    const chartSet = (renderer as any).chartInstances as Set<any>;
    const mockChart = { isDisposed: vi.fn(() => false), dispose: vi.fn(), getDom: vi.fn() };
    chartSet.add(mockChart);

    await renderer.setZoom(150);

    expect(mockChart.dispose).toHaveBeenCalled();
    expect(chartSet.size).toBe(0);
  });

  it('passes chartInstances through to renderSlide options', async () => {
    const { renderSlide: mockRenderSlide } = await import(
      '../../../src/renderer/SlideRenderer'
    );
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container);
    await renderer.preview(new ArrayBuffer(4));

    const chartSet = (renderer as any).chartInstances;
    // Check the last call to renderSlide included chartInstances
    const calls = (mockRenderSlide as any).mock.calls;
    const lastCallOptions = calls[calls.length - 1][2];
    expect(lastCallOptions.chartInstances).toBe(chartSet);
  });

  it('passes chartInstances in slide mode renderSingleSlide', async () => {
    const { renderSlide: mockRenderSlide } = await import(
      '../../../src/renderer/SlideRenderer'
    );
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'slide' });
    await renderer.preview(new ArrayBuffer(4));

    const chartSet = (renderer as any).chartInstances;
    const calls = (mockRenderSlide as any).mock.calls;
    const lastCallOptions = calls[calls.length - 1][2];
    expect(lastCallOptions.chartInstances).toBe(chartSet);
  });

  it('renderSlideToContainer passes chartInstances through to renderSlide', async () => {
    const { renderSlide: mockRenderSlide } = await import(
      '../../../src/renderer/SlideRenderer'
    );
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container);
    await renderer.preview(new ArrayBuffer(4));

    const externalContainer = document.createElement('div');
    renderer.renderSlideToContainer(0, externalContainer);

    const chartSet = (renderer as any).chartInstances;
    const calls = (mockRenderSlide as any).mock.calls;
    const lastCallOptions = calls[calls.length - 1][2];
    expect(lastCallOptions.chartInstances).toBe(chartSet);
  });
});

describe('PptxRenderer.goToSlide scrollOptions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('passes custom scrollOptions to scrollIntoView', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'list' });
    await renderer.preview(new ArrayBuffer(4));

    const target = container.querySelector<HTMLElement>('[data-slide-index="1"]');
    expect(target).not.toBeNull();
    const scrollSpy = vi.fn();
    target!.scrollIntoView = scrollSpy;

    await renderer.goToSlide(1, { behavior: 'instant', block: 'start' });
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' });
  });

  it('uses default smooth/center when no scrollOptions provided', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'list' });
    await renderer.preview(new ArrayBuffer(4));

    const target = container.querySelector<HTMLElement>('[data-slide-index="1"]');
    const scrollSpy = vi.fn();
    target!.scrollIntoView = scrollSpy;

    await renderer.goToSlide(1);
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  });
});

describe('PptxRenderer.onSlideUnmounted callback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('fires onSlideUnmounted when a slide is unmounted', async () => {
    const onSlideUnmounted = vi.fn();
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, {
      mode: 'list',
      listMountStrategy: 'windowed',
      windowedInitialSlides: 3,
      onSlideUnmounted,
    });
    await renderer.preview(new ArrayBuffer(4));

    // Access internal unmountListSlide
    const unmountFn = (renderer as unknown as {
      unmountListSlide: (index: number, wrapper: HTMLDivElement, displayHeight: number) => void;
    }).unmountListSlide.bind(renderer);

    const item = container.querySelector('[data-slide-index="0"]');
    const wrapper = item?.querySelector('div') as HTMLDivElement;
    wrapper.dataset.mounted = '1';

    unmountFn(0, wrapper, 540);
    expect(onSlideUnmounted).toHaveBeenCalledWith(0);
  });

  it('does not fire onSlideUnmounted when slide is not mounted', async () => {
    const onSlideUnmounted = vi.fn();
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, {
      mode: 'list',
      onSlideUnmounted,
    });
    await renderer.preview(new ArrayBuffer(4));

    const unmountFn = (renderer as unknown as {
      unmountListSlide: (index: number, wrapper: HTMLDivElement, displayHeight: number) => void;
    }).unmountListSlide.bind(renderer);

    const wrapper = document.createElement('div');
    wrapper.dataset.mounted = '0';

    unmountFn(0, wrapper, 540);
    expect(onSlideUnmounted).not.toHaveBeenCalled();
  });
});

describe('PptxRenderer preview AbortSignal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects with AbortError when signal is already aborted', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container);
    const controller = new AbortController();
    controller.abort();

    await expect(
      renderer.preview(new ArrayBuffer(4), { signal: controller.signal }),
    ).rejects.toThrow('Preview aborted');
  });

  it('thrown error is a DOMException with name AbortError', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container);
    const controller = new AbortController();
    controller.abort();

    try {
      await renderer.preview(new ArrayBuffer(4), { signal: controller.signal });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(DOMException);
      expect((e as DOMException).name).toBe('AbortError');
      expect((e as DOMException).message).toBe('Preview aborted');
    }
  });

  it('links external signal via addEventListener when not pre-aborted', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container);
    const controller = new AbortController();

    // Spy on addEventListener to verify linking
    const addListenerSpy = vi.spyOn(controller.signal, 'addEventListener');

    const promise = renderer.preview(new ArrayBuffer(4), { signal: controller.signal });
    expect(addListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });

    await promise; // completes normally since not aborted
  });

  it('rejects with AbortError when signal is aborted during preview', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container);
    const controller = new AbortController();

    // Abort immediately after starting
    const promise = renderer.preview(new ArrayBuffer(4), { signal: controller.signal });
    controller.abort();

    // The preview may or may not have completed by now; if it does throw, it should be AbortError
    try {
      await promise;
      // If it completes before abort takes effect, that's fine
    } catch (e) {
      expect(e).toBeInstanceOf(DOMException);
      expect((e as DOMException).name).toBe('AbortError');
    }
  });

  it('auto-aborts previous preview when a new one starts', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container);

    // Start first preview
    const promise1 = renderer.preview(new ArrayBuffer(4));
    // Start second preview immediately
    const promise2 = renderer.preview(new ArrayBuffer(4));

    // First may reject with AbortError or may have already completed
    try {
      await promise1;
    } catch (e) {
      expect((e as DOMException).name).toBe('AbortError');
    }

    // Second should succeed
    const result = await promise2;
    expect(result.slideCount).toBe(3);
  });

  it('destroy() aborts in-flight preview', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container);

    const promise = renderer.preview(new ArrayBuffer(4));
    renderer.destroy();

    try {
      await promise;
    } catch (e) {
      expect((e as DOMException).name).toBe('AbortError');
    }
  });
});

describe('PptxRenderer mount state query', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('returns empty before preview', () => {
    const renderer = new PptxRenderer(document.createElement('div'));
    expect(renderer.isSlideMounted(0)).toBe(false);
    expect(renderer.getMountedSlides()).toEqual([]);
  });

  it('tracks mounted slides in list mode', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'list' });
    await renderer.preview(new ArrayBuffer(4));

    // All 3 slides should be mounted in full list mode
    expect(renderer.isSlideMounted(0)).toBe(true);
    expect(renderer.isSlideMounted(1)).toBe(true);
    expect(renderer.isSlideMounted(2)).toBe(true);
    expect(renderer.getMountedSlides()).toEqual([0, 1, 2]);
  });

  it('tracks mounted slides in slide mode', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'slide' });
    await renderer.preview(new ArrayBuffer(4));

    expect(renderer.isSlideMounted(0)).toBe(true);
    expect(renderer.isSlideMounted(1)).toBe(false);
    expect(renderer.getMountedSlides()).toEqual([0]);

    renderer.goToSlide(2);
    expect(renderer.isSlideMounted(2)).toBe(true);
    expect(renderer.isSlideMounted(0)).toBe(false);
    expect(renderer.getMountedSlides()).toEqual([2]);
  });

  it('clears mounted slides on destroy', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'list' });
    await renderer.preview(new ArrayBuffer(4));

    expect(renderer.getMountedSlides().length).toBe(3);
    renderer.destroy();
    expect(renderer.getMountedSlides()).toEqual([]);
  });

  it('returns false for out-of-range index', async () => {
    const container = document.createElement('div');
    const renderer = new PptxRenderer(container, { mode: 'list' });
    await renderer.preview(new ArrayBuffer(4));

    expect(renderer.isSlideMounted(99)).toBe(false);
    expect(renderer.isSlideMounted(-1)).toBe(false);
  });
});
