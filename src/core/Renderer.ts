import { parseZip } from '../parser/ZipParser';
import type { ZipParseLimits } from '../parser/ZipParser';
import { buildPresentation } from '../model/Presentation';
import { PptxViewer, normalizePreviewInput } from './Viewer';
import type { FitMode, PreviewInput, ListRenderOptions } from './Viewer';

export type { PreviewInput, FitMode } from './Viewer';
export type { SlideHandle } from '../renderer/SlideRenderer';

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
  /**
   * Scroll container element used as IntersectionObserver root in list mode
   * (both windowed mounting and scroll-based slide tracking).
   * When omitted, the viewport (null root) is used.
   */
  scrollContainer?: HTMLElement;
  onSlideError?: (index: number, error: unknown) => void;
  onNodeError?: (nodeId: string, error: unknown) => void;
  /** Called after each slide finishes rendering. May fire multiple times for the same slide in windowed list mode. */
  onSlideRendered?: (index: number, element: HTMLElement) => void;
  /** Called when the active slide changes. Fires in both list mode (scroll tracking) and slide mode (goToSlide, navigation). */
  onSlideChange?: (index: number) => void;
  /** Called after a slide is unmounted in windowed list mode. */
  onSlideUnmounted?: (index: number) => void;
}

/** @deprecated Use `PptxViewer` instead. */
export class PptxRenderer extends PptxViewer {
  private rendererMode: 'list' | 'slide';
  private rendererListOptions: ListRenderOptions;
  private rendererZipLimits?: ZipParseLimits;
  private previewAbortController: AbortController | null = null;

  constructor(container: HTMLElement, options: RendererOptions = {}) {
    super(container, {
      width: options.width,
      fitMode: options.fitMode,
      zoomPercent: options.zoomPercent,
      scrollContainer: options.scrollContainer,
      zipLimits: options.zipLimits,
      onSlideChange: options.onSlideChange,
      onSlideRendered: options.onSlideRendered,
      onSlideError: options.onSlideError,
      onSlideUnmounted: options.onSlideUnmounted,
      onNodeError: options.onNodeError,
    });
    this.rendererMode = options.mode ?? 'list';
    this.rendererZipLimits = options.zipLimits;
    this.rendererListOptions = {
      windowed: options.listMountStrategy === 'windowed',
      batchSize: options.listRenderBatchSize,
      initialSlides: options.windowedInitialSlides,
      overscanViewport: options.windowedOverscanViewport,
    };
  }

  /** @deprecated Use `PptxViewer.open()` or `viewer.load()` + `viewer.renderList()` */
  async preview(
    input: PreviewInput,
    options?: { signal?: AbortSignal },
  ): Promise<{ slideCount: number; elapsed: number }> {
    // Auto-abort previous in-flight preview
    this.previewAbortController?.abort();

    const controller = new AbortController();
    this.previewAbortController = controller;

    // Link external signal if provided
    if (options?.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    const checkAborted = () => {
      if (controller.signal.aborted) {
        throw new DOMException('Preview aborted', 'AbortError');
      }
    };

    const start = performance.now();
    checkAborted();

    const buffer = await normalizePreviewInput(input);
    checkAborted();

    const files = await parseZip(buffer, this.rendererZipLimits);
    checkAborted();

    const presentation = buildPresentation(files);
    checkAborted();

    this.load(presentation);

    if (this.rendererMode === 'slide') {
      await this.renderSlide(0);
    } else {
      await this.renderList(this.rendererListOptions);
    }
    checkAborted();

    const elapsed = performance.now() - start;
    return { slideCount: presentation.slides.length, elapsed };
  }

  /** Appends prev/next navigation buttons after rendering a single slide. */
  protected override afterSingleSlideRender(): void {
    const nav = document.createElement('div');
    nav.style.cssText = 'display: flex; justify-content: center; gap: 12px; margin-top: 12px;';

    const prevBtn = document.createElement('button');
    prevBtn.textContent = '← Prev';
    prevBtn.disabled = this.currentSlideIndex === 0;
    prevBtn.onclick = () => this.goToSlide(this.currentSlideIndex - 1);

    const info = document.createElement('span');
    info.style.cssText = 'line-height: 32px; font-size: 14px;';
    info.textContent = `${this.currentSlideIndex + 1} / ${this.slideCount}`;

    const nextBtn = document.createElement('button');
    nextBtn.textContent = 'Next →';
    nextBtn.disabled = this.currentSlideIndex >= this.slideCount - 1;
    nextBtn.onclick = () => this.goToSlide(this.currentSlideIndex + 1);

    nav.appendChild(prevBtn);
    nav.appendChild(info);
    nav.appendChild(nextBtn);

    this.container.appendChild(nav);
  }

  override destroy(): void {
    this.previewAbortController?.abort();
    this.previewAbortController = null;
    super.destroy();
  }
}
