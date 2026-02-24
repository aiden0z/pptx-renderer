export interface CompareSlideCounts {
  displaySlideCount: number;
  comparableSlideCount: number;
}

export interface SlideVisualMetricFields {
  ssim: number | null;
  mae: number | null;
  fgIou: number | null;
  fgIouTolerant: number | null;
  chamferScore: number | null;
  colorHistCorr: number | null;
  needsReview: boolean | null;
  hasDiff: boolean;
}

export interface ServerPerSlideMetrics {
  slideIdx: number;
  ssim?: number | null;
  mae?: number | null;
  fgIou?: number | null;
  fgIouTolerant?: number | null;
  chamferScore?: number | null;
  colorHistCorr?: number | null;
  needsReview?: boolean | null;
}

function normalizeNonNegativeInt(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : 0;
}

/**
 * Determine how many slides should be shown in E2E compare mode.
 * - displaySlideCount: all PPTX slides should stay visible to users
 * - comparableSlideCount: only slides with matching PDF pages can be scored visually
 */
export function resolveCompareSlideCounts(
  pptxSlideCount: number,
  pdfPageCount: number,
): CompareSlideCounts {
  const displaySlideCount = normalizeNonNegativeInt(pptxSlideCount);
  const comparableSlideCount = Math.min(displaySlideCount, normalizeNonNegativeInt(pdfPageCount));
  return { displaySlideCount, comparableSlideCount };
}

type MergeableSlide = {
  index: number;
  hasComparablePdf: boolean;
} & SlideVisualMetricFields;

export function mergeServerMetricsIntoSlides<T extends MergeableSlide>(
  slideResults: readonly T[],
  perSlideMetrics: readonly ServerPerSlideMetrics[] | null | undefined,
): T[] {
  const metricMap = new Map((perSlideMetrics || []).map((slide) => [slide.slideIdx, slide]));

  return slideResults.map((slide) => {
    const metrics = metricMap.get(slide.index);
    if (!slide.hasComparablePdf || !metrics || typeof metrics.ssim !== 'number') {
      return {
        ...slide,
        ssim: null,
        mae: null,
        fgIou: null,
        fgIouTolerant: null,
        chamferScore: null,
        colorHistCorr: null,
        needsReview: null,
        hasDiff: false,
      };
    }
    return {
      ...slide,
      ssim: metrics.ssim,
      mae: typeof metrics.mae === 'number' ? metrics.mae : null,
      fgIou: typeof metrics.fgIou === 'number' ? metrics.fgIou : null,
      fgIouTolerant: typeof metrics.fgIouTolerant === 'number' ? metrics.fgIouTolerant : null,
      chamferScore: typeof metrics.chamferScore === 'number' ? metrics.chamferScore : null,
      colorHistCorr: typeof metrics.colorHistCorr === 'number' ? metrics.colorHistCorr : null,
      needsReview: typeof metrics.needsReview === 'boolean' ? metrics.needsReview : null,
      hasDiff: true,
    };
  });
}
