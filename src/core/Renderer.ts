import { parseZip } from '../parser/ZipParser';
import type { ZipParseLimits } from '../parser/ZipParser';
import { buildPresentation, PresentationData } from '../model/Presentation';
import { renderSlide } from '../renderer/SlideRenderer';
import { isAllowedExternalUrl } from '../utils/urlSafety';
import type { ECharts } from 'echarts';

export type FitMode = 'contain' | 'none';

export interface RendererOptions {
  width?: number;
  mode?: 'list' | 'slide';
  /** Scaling mode. contain = fit container width, none = use intrinsic slide size. */
  fitMode?: FitMode;
  /** Initial zoom percentage. Effective scale = fitScale * zoomPercent/100. */
  zoomPercent?: number;
  /** Optional ZIP parsing limits for controlling resource usage and DoS surface. */
  zipLimits?: ZipParseLimits;
  /**
   * Number of slides rendered per batch in list mode.
   * Lower values improve UI responsiveness for large decks.
   */
  listRenderBatchSize?: number;
  /**
   * List-mode mounting strategy.
   * - full: render and mount all slides (default, backward compatible)
   * - windowed: mount only visible/nearby slides to reduce DOM/memory pressure
   */
  listMountStrategy?: 'full' | 'windowed';
  /** Number of slides mounted immediately in windowed list mode. */
  windowedInitialSlides?: number;
  /** Overscan in viewport heights for windowed mounting. */
  windowedOverscanViewport?: number;
  onSlideError?: (index: number, error: unknown) => void;
  onNodeError?: (nodeId: string, error: unknown) => void;
  /** Called after each slide finishes rendering. May fire multiple times for the same slide in windowed list mode. */
  onSlideRendered?: (index: number, element: HTMLElement) => void;
  /** Called when the active slide changes in slide mode (goToSlide, navigation). */
  onSlideChange?: (index: number) => void;
}

export type PreviewInput = ArrayBuffer | Uint8Array | Blob;

export class PptxRenderer {
  private container: HTMLElement;
  private options: RendererOptions;
  private presentation: PresentationData | null = null;
  private mediaUrlCache = new Map<string, string>();
  private chartInstances = new Set<ECharts>();
  private currentSlide = 0;
  private fitMode: FitMode;
  private zoomFactor = 1;
  private renderChain: Promise<void> = Promise.resolve();
  private cleanupListMount?: () => void;
  private ensureListSlideMounted?: (index: number) => void;
  private resizeObserver?: ResizeObserver;
  private windowResizeHandler?: () => void;
  private resizeRafId: number | null = null;
  private lastMeasuredContainerWidth = 0;

  constructor(container: HTMLElement, options: RendererOptions = {}) {
    this.container = container;
    const batchSize = options.listRenderBatchSize ?? 12;
    const initialSlides = options.windowedInitialSlides ?? 4;
    const overscanViewport = options.windowedOverscanViewport ?? 1.5;
    const zoomPercent = this.normalizeZoomPercent(options.zoomPercent ?? 100);
    this.fitMode = options.fitMode ?? 'contain';
    this.zoomFactor = zoomPercent / 100;
    this.options = {
      mode: 'list',
      listMountStrategy: 'full',
      ...options,
      fitMode: this.fitMode,
      listRenderBatchSize: Number.isInteger(batchSize) && batchSize > 0 ? batchSize : 12,
      windowedInitialSlides:
        Number.isInteger(initialSlides) && initialSlides > 0 ? initialSlides : 4,
      windowedOverscanViewport:
        Number.isFinite(overscanViewport) && overscanViewport > 0 ? overscanViewport : 1.5,
      zoomPercent,
    };
  }

  private normalizeZoomPercent(percent: number): number {
    if (!Number.isFinite(percent)) return 100;
    return Math.max(10, Math.min(400, percent));
  }

  private getDisplayMetrics(): { scale: number; displayWidth: number; displayHeight: number } {
    if (!this.presentation) {
      return { scale: 1, displayWidth: 0, displayHeight: 0 };
    }
    const fitWidth = this.options.width ?? (this.container.clientWidth || 960);
    if (this.fitMode === 'contain' && this.options.width === undefined) {
      this.lastMeasuredContainerWidth = fitWidth;
    }
    const fitScale = this.fitMode === 'contain' ? fitWidth / this.presentation.width : 1;
    const scale = fitScale * this.zoomFactor;
    return {
      scale,
      displayWidth: this.presentation.width * scale,
      displayHeight: this.presentation.height * scale,
    };
  }

  private async queueRender(): Promise<void> {
    this.renderChain = this.renderChain.then(async () => {
      if (!this.presentation) return;
      const { scale, displayWidth, displayHeight } = this.getDisplayMetrics();

      this.cleanupListMount?.();
      this.cleanupListMount = undefined;
      this.ensureListSlideMounted = undefined;
      this.disposeAllCharts();
      this.container.innerHTML = '';
      this.container.style.position = 'relative';

      if (this.options.mode === 'slide') {
        this.renderSingleSlide(scale, displayWidth, displayHeight);
      } else if (this.options.listMountStrategy === 'windowed') {
        await this.renderAllSlidesWindowed(scale, displayWidth, displayHeight);
      } else {
        await this.renderAllSlidesFull(scale, displayWidth, displayHeight);
      }
    });
    return this.renderChain;
  }

  private handleContainerResize(): void {
    if (!this.presentation) return;
    if (this.fitMode !== 'contain') return;
    if (this.options.width !== undefined) return;

    const nextWidth = this.container.clientWidth || 0;
    if (!nextWidth || nextWidth === this.lastMeasuredContainerWidth) return;
    this.lastMeasuredContainerWidth = nextWidth;

    if (this.resizeRafId !== null) {
      cancelAnimationFrame(this.resizeRafId);
    }
    this.resizeRafId = requestAnimationFrame(() => {
      this.resizeRafId = null;
      void this.queueRender();
    });
  }

  private setupAdaptiveResize(): void {
    this.teardownAdaptiveResize();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.handleContainerResize());
      observer.observe(this.container);
      this.resizeObserver = observer;
      return;
    }

    this.windowResizeHandler = () => this.handleContainerResize();
    window.addEventListener('resize', this.windowResizeHandler);
  }

  private teardownAdaptiveResize(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    if (this.windowResizeHandler) {
      window.removeEventListener('resize', this.windowResizeHandler);
      this.windowResizeHandler = undefined;
    }
    if (this.resizeRafId !== null) {
      cancelAnimationFrame(this.resizeRafId);
      this.resizeRafId = null;
    }
  }

  private disposeAllCharts(): void {
    for (const chart of this.chartInstances) {
      if (!chart.isDisposed()) {
        chart.dispose();
      }
    }
    this.chartInstances.clear();
  }

  private async normalizePreviewInput(input: PreviewInput): Promise<ArrayBuffer> {
    if (input instanceof ArrayBuffer) return input;
    if (input instanceof Uint8Array) {
      // Copy into a fresh ArrayBuffer to avoid SharedArrayBuffer typing ambiguity.
      const bytes = new Uint8Array(input.byteLength);
      bytes.set(input);
      return bytes.buffer;
    }

    const blobLike = input as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> };
    if (typeof blobLike.arrayBuffer === 'function') {
      return blobLike.arrayBuffer();
    }

    if (typeof FileReader !== 'undefined') {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read Blob input'));
        reader.readAsArrayBuffer(blobLike);
      });
    }

    if (typeof Response !== 'undefined') {
      return new Response(blobLike).arrayBuffer();
    }

    throw new Error('Blob preview input is not supported in this runtime');
  }

  async preview(input: PreviewInput): Promise<{ slideCount: number; elapsed: number }> {
    const start = performance.now();
    const buffer = await this.normalizePreviewInput(input);

    // Parse
    const files = await parseZip(buffer, this.options.zipLimits);
    const presentation = buildPresentation(files);
    this.presentation = presentation;
    this.setupAdaptiveResize();
    await this.queueRender();

    const elapsed = performance.now() - start;
    return { slideCount: presentation.slides.length, elapsed };
  }

  private createListSlideItem(
    index: number,
    displayWidth: number,
    displayHeight: number,
  ): {
    item: HTMLDivElement;
    wrapper: HTMLDivElement;
  } {
    const item = document.createElement('div');
    item.dataset.slideIndex = String(index);
    item.style.cssText = 'width: fit-content; margin: 0 auto 20px;';

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      width: ${displayWidth}px;
      height: ${displayHeight}px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      overflow: hidden;
      position: relative;
      background: #fff;
    `;

    const label = document.createElement('div');
    label.style.cssText = 'text-align: center; padding: 4px; font-size: 12px; color: #666;';
    label.textContent = `Slide ${index + 1}`;

    item.appendChild(wrapper);
    item.appendChild(label);
    return { item, wrapper };
  }

  private mountListSlide(
    index: number,
    wrapper: HTMLDivElement,
    scale: number,
    displayWidth: number,
    displayHeight: number,
  ): void {
    if (!this.presentation) return;
    if (wrapper.dataset.mounted === '1') return;
    wrapper.dataset.mounted = '1';
    wrapper.innerHTML = '';

    const slide = this.presentation.slides[index];
    try {
      const slideEl = renderSlide(this.presentation, slide, {
        onNodeError: this.options.onNodeError,
        onNavigate: (target) => this.handleNavigate(target),
        mediaUrlCache: this.mediaUrlCache,
        chartInstances: this.chartInstances,
      });

      slideEl.style.transform = `scale(${scale})`;
      slideEl.style.transformOrigin = 'top left';
      wrapper.appendChild(slideEl);
      this.options.onSlideRendered?.(index, slideEl);
    } catch (e) {
      this.options.onSlideError?.(index, e);
      wrapper.style.background = '#fff3f3';
      wrapper.style.display = 'flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.justifyContent = 'center';
      wrapper.style.border = '2px dashed #ff6b6b';
      wrapper.style.color = '#cc0000';
      wrapper.style.fontSize = '14px';
      wrapper.textContent = `Slide ${index + 1}: Render Error - ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private unmountListSlide(wrapper: HTMLDivElement, displayHeight: number): void {
    if (wrapper.dataset.mounted !== '1') return;
    wrapper.dataset.mounted = '0';
    // Dispose any ECharts instances whose containers live inside this wrapper.
    for (const chart of this.chartInstances) {
      if (!chart.isDisposed() && wrapper.contains(chart.getDom())) {
        chart.dispose();
        this.chartInstances.delete(chart);
      }
    }
    wrapper.innerHTML = '';
    wrapper.style.background = '#fff';
    wrapper.style.display = '';
    wrapper.style.alignItems = '';
    wrapper.style.justifyContent = '';
    wrapper.style.border = '';
    wrapper.style.color = '';
    wrapper.style.fontSize = '';
    wrapper.style.height = `${displayHeight}px`;
  }

  private async renderAllSlidesFull(
    scale: number,
    displayWidth: number,
    displayHeight: number,
  ): Promise<void> {
    if (!this.presentation) return;
    const batchSize = this.options.listRenderBatchSize ?? 12;
    let batchFragment = document.createDocumentFragment();

    for (let i = 0; i < this.presentation.slides.length; i++) {
      const { item, wrapper } = this.createListSlideItem(i, displayWidth, displayHeight);
      this.mountListSlide(i, wrapper, scale, displayWidth, displayHeight);
      batchFragment.appendChild(item);

      // Yield control periodically so large decks don't block the main thread.
      if ((i + 1) % batchSize === 0) {
        this.container.appendChild(batchFragment);
        batchFragment = document.createDocumentFragment();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    }

    // Flush remaining nodes when slide count is not divisible by batch size.
    if (batchFragment.childNodes.length > 0) {
      this.container.appendChild(batchFragment);
    }
  }

  private async renderAllSlidesWindowed(
    scale: number,
    displayWidth: number,
    displayHeight: number,
  ): Promise<void> {
    if (!this.presentation) return;
    const batchSize = this.options.listRenderBatchSize ?? 12;
    let batchFragment = document.createDocumentFragment();
    const wrappers: HTMLDivElement[] = [];

    for (let i = 0; i < this.presentation.slides.length; i++) {
      const { item, wrapper } = this.createListSlideItem(i, displayWidth, displayHeight);
      wrappers.push(wrapper);
      batchFragment.appendChild(item);

      if ((i + 1) % batchSize === 0) {
        this.container.appendChild(batchFragment);
        batchFragment = document.createDocumentFragment();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    }

    if (batchFragment.childNodes.length > 0) {
      this.container.appendChild(batchFragment);
    }

    const mount = (idx: number): void => {
      if (idx < 0 || idx >= wrappers.length) return;
      this.mountListSlide(idx, wrappers[idx], scale, displayWidth, displayHeight);
    };
    const unmount = (idx: number): void => {
      if (idx < 0 || idx >= wrappers.length) return;
      this.unmountListSlide(wrappers[idx], displayHeight);
    };

    const initial = this.options.windowedInitialSlides ?? 4;
    for (let i = 0; i < Math.min(initial, wrappers.length); i++) mount(i);
    this.ensureListSlideMounted = mount;

    const IO = window.IntersectionObserver;
    if (!IO) {
      // Fallback to full mounting where IntersectionObserver is unavailable.
      for (let i = initial; i < wrappers.length; i++) mount(i);
      return;
    }

    const overscanViewport = this.options.windowedOverscanViewport ?? 1.5;
    const rootMargin = `${Math.round(window.innerHeight * overscanViewport)}px 0px`;
    const observer = new IO(
      (entries) => {
        for (const entry of entries) {
          const wrapper = entry.target as HTMLDivElement;
          const index = Number(wrapper.dataset.slideIndex ?? '-1');
          if (Number.isNaN(index) || index < 0) continue;
          if (entry.isIntersecting) {
            mount(index);
          } else {
            unmount(index);
          }
        }
      },
      { root: null, rootMargin, threshold: 0 },
    );

    wrappers.forEach((wrapper, index) => {
      wrapper.dataset.slideIndex = String(index);
      observer.observe(wrapper);
    });

    this.cleanupListMount = () => {
      observer.disconnect();
      this.ensureListSlideMounted = undefined;
    };
  }

  private renderSingleSlide(scale: number, displayWidth: number, displayHeight: number): void {
    if (!this.presentation) return;

    const slide = this.presentation.slides[this.currentSlide];
    if (!slide) return;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      width: ${displayWidth}px; height: ${displayHeight}px;
      margin: 0 auto; overflow: hidden; position: relative;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    `;

    const slideEl = renderSlide(this.presentation, slide, {
      onNodeError: this.options.onNodeError,
      onNavigate: (target) => this.handleNavigate(target),
      mediaUrlCache: this.mediaUrlCache,
    });
    slideEl.style.transform = `scale(${scale})`;
    slideEl.style.transformOrigin = 'top left';
    wrapper.appendChild(slideEl);
    this.options.onSlideRendered?.(this.currentSlide, slideEl);

    // Navigation
    const nav = document.createElement('div');
    nav.style.cssText = 'display: flex; justify-content: center; gap: 12px; margin-top: 12px;';

    const prevBtn = document.createElement('button');
    prevBtn.textContent = '← Prev';
    prevBtn.disabled = this.currentSlide === 0;
    prevBtn.onclick = () => this.goToSlide(this.currentSlide - 1);

    const info = document.createElement('span');
    info.style.cssText = 'line-height: 32px; font-size: 14px;';
    info.textContent = `${this.currentSlide + 1} / ${this.presentation.slides.length}`;

    const nextBtn = document.createElement('button');
    nextBtn.textContent = 'Next →';
    nextBtn.disabled = this.currentSlide >= this.presentation.slides.length - 1;
    nextBtn.onclick = () => this.goToSlide(this.currentSlide + 1);

    nav.appendChild(prevBtn);
    nav.appendChild(info);
    nav.appendChild(nextBtn);

    this.disposeAllCharts();
    this.container.innerHTML = '';
    this.container.appendChild(wrapper);
    this.container.appendChild(nav);
  }

  private handleNavigate(target: { slideIndex?: number; url?: string }): void {
    if (target.slideIndex !== undefined) {
      this.goToSlide(target.slideIndex);
    } else if (target.url && isAllowedExternalUrl(target.url)) {
      window.open(target.url, '_blank', 'noopener,noreferrer');
    }
  }

  goToSlide(index: number): void {
    if (!this.presentation) return;
    const prev = this.currentSlide;
    this.currentSlide = Math.max(0, Math.min(index, this.presentation.slides.length - 1));
    if (this.currentSlide !== prev) {
      this.options.onSlideChange?.(this.currentSlide);
    }
    if (this.options.mode === 'slide') {
      const { scale, displayWidth, displayHeight } = this.getDisplayMetrics();
      this.renderSingleSlide(scale, displayWidth, displayHeight);
    } else {
      this.ensureListSlideMounted?.(this.currentSlide);
      const targetChild = this.container.querySelector<HTMLElement>(
        `[data-slide-index="${this.currentSlide}"]`,
      );
      if (targetChild) {
        targetChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  async setZoom(percent: number): Promise<void> {
    const normalized = this.normalizeZoomPercent(percent);
    const nextFactor = normalized / 100;
    if (nextFactor === this.zoomFactor) return;
    this.zoomFactor = nextFactor;
    this.options.zoomPercent = normalized;
    await this.queueRender();
  }

  async setFitMode(mode: FitMode): Promise<void> {
    if (this.fitMode === mode) return;
    this.fitMode = mode;
    this.options.fitMode = mode;
    if (mode === 'none') {
      this.lastMeasuredContainerWidth = 0;
    }
    await this.queueRender();
  }

  /** The parsed presentation model, or null if not yet loaded. */
  get presentationData(): PresentationData | null {
    return this.presentation;
  }

  /** Number of slides in the loaded presentation, or 0 if not loaded. */
  get slideCount(): number {
    return this.presentation?.slides.length ?? 0;
  }

  /** Intrinsic slide width in pixels, or 0 if not loaded. */
  get slideWidth(): number {
    return this.presentation?.width ?? 0;
  }

  /** Intrinsic slide height in pixels, or 0 if not loaded. */
  get slideHeight(): number {
    return this.presentation?.height ?? 0;
  }

  /** The currently active slide index (0-based). */
  get currentSlideIndex(): number {
    return this.currentSlide;
  }

  /**
   * Render a single slide into an external container element.
   * Useful for React/Vue integration, thumbnail generation, etc.
   * Shares the internal media URL cache for blob URL reuse.
   *
   * The slide element is rendered at intrinsic size and scaled via CSS transform.
   * The caller is responsible for sizing the container (e.g. `slideWidth * scale` x `slideHeight * scale`)
   * and setting `overflow: hidden` if needed.
   */
  renderSlideToContainer(
    index: number,
    container: HTMLElement,
    scale?: number,
  ): HTMLElement | null {
    if (!this.presentation) return null;
    const slide = this.presentation.slides[index];
    if (!slide) return null;

    const slideEl = renderSlide(this.presentation, slide, {
      onNodeError: this.options.onNodeError,
      onNavigate: (target) => this.handleNavigate(target),
      mediaUrlCache: this.mediaUrlCache,
    });

    if (scale !== undefined && scale !== 1) {
      slideEl.style.transform = `scale(${scale})`;
      slideEl.style.transformOrigin = 'top left';
    }

    container.appendChild(slideEl);
    this.options.onSlideRendered?.(index, slideEl);
    return slideEl;
  }

  destroy(): void {
    this.teardownAdaptiveResize();
    this.cleanupListMount?.();
    this.cleanupListMount = undefined;
    this.ensureListSlideMounted = undefined;
    this.disposeAllCharts();
    for (const url of this.mediaUrlCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.mediaUrlCache.clear();
    this.container.innerHTML = '';
    this.presentation = null;
  }
}
