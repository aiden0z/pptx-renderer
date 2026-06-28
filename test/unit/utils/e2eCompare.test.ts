import { describe, expect, it } from 'vitest';
import {
  resolveComparePanelState,
  mergeServerMetricsIntoSlides,
  resolveComparablePdfPages,
  resolveCompareSlideCounts,
} from '../../../src/utils/e2eCompare';

describe('resolveCompareSlideCounts', () => {
  it('keeps all PPTX slides visible even when PDF has fewer pages', () => {
    const result = resolveCompareSlideCounts(82, 12);
    expect(result.displaySlideCount).toBe(82);
    expect(result.comparableSlideCount).toBe(12);
  });

  it('uses the full count when PDF pages are enough', () => {
    const result = resolveCompareSlideCounts(41, 80);
    expect(result.displaySlideCount).toBe(41);
    expect(result.comparableSlideCount).toBe(41);
  });

  it('normalizes invalid counts to zero', () => {
    const result = resolveCompareSlideCounts(-1, Number.NaN);
    expect(result.displaySlideCount).toBe(0);
    expect(result.comparableSlideCount).toBe(0);
  });

  it('floors fractional counts before comparing slide totals', () => {
    const result = resolveCompareSlideCounts(3.9, 2.8);

    expect(result).toEqual({ displaySlideCount: 3, comparableSlideCount: 2 });
  });
});

describe('resolveComparablePdfPages', () => {
  it('maps visible PPTX slides to PDF pages while skipping hidden slides', () => {
    const pages = resolveComparablePdfPages(
      [{ hidden: false }, { hidden: true }, { hidden: false }],
      2,
    );

    expect(pages).toEqual([0, null, 1]);
  });

  it('returns null for visible slides without a remaining PDF page', () => {
    const pages = resolveComparablePdfPages([{ hidden: false }, { hidden: false }], 1);

    expect(pages).toEqual([0, null]);
  });

  it('returns null for all slides when the PDF page count is invalid', () => {
    const pages = resolveComparablePdfPages([{ hidden: false }, { hidden: true }], Number.NaN);

    expect(pages).toEqual([null, null]);
  });
});

describe('resolveComparePanelState', () => {
  it('shows only the diff panel by default in diff-first mode when a diff exists', () => {
    expect(resolveComparePanelState('diff-first', true, false)).toEqual({
      truth: false,
      render: false,
      diff: true,
      compact: true,
      expanded: false,
      fallback: false,
    });
  });

  it('expands diff-first cards into truth and render panels while keeping diff visible', () => {
    expect(resolveComparePanelState('diff-first', true, true)).toEqual({
      truth: true,
      render: true,
      diff: true,
      compact: false,
      expanded: true,
      fallback: false,
    });
  });

  it('falls back to side-by-side in diff-first mode when no diff exists', () => {
    expect(resolveComparePanelState('diff-first', false, false)).toEqual({
      truth: true,
      render: true,
      diff: false,
      compact: false,
      expanded: false,
      fallback: true,
    });
  });

  it('preserves side-by-side and triple view behavior', () => {
    expect(resolveComparePanelState('side-by-side', true, false)).toMatchObject({
      truth: true,
      render: true,
      diff: false,
    });
    expect(resolveComparePanelState('triple', true, false)).toMatchObject({
      truth: true,
      render: true,
      diff: true,
    });
  });
});

describe('mergeServerMetricsIntoSlides', () => {
  it('merges per-slide metrics without touching non-comparable slides', () => {
    const slides = [
      {
        index: 0,
        hasComparablePdf: true,
        ssim: null,
        mae: null,
        fgIou: null,
        fgIouTolerant: null,
        chamferScore: null,
        colorHistCorr: null,
        needsReview: null,
        hasDiff: false,
      },
      {
        index: 1,
        hasComparablePdf: false,
        ssim: null,
        mae: null,
        fgIou: null,
        fgIouTolerant: null,
        chamferScore: null,
        colorHistCorr: null,
        needsReview: null,
        hasDiff: false,
      },
    ];

    const merged = mergeServerMetricsIntoSlides(slides, [
      {
        slideIdx: 0,
        ssim: 0.91,
        mae: 0.06,
        fgIou: 0.7,
        fgIouTolerant: 0.82,
        chamferScore: 0.97,
        colorHistCorr: 0.95,
        needsReview: true,
      },
      {
        slideIdx: 1,
        ssim: 0.99,
      },
    ]);

    expect(merged[0]).toMatchObject({
      ssim: 0.91,
      mae: 0.06,
      fgIou: 0.7,
      fgIouTolerant: 0.82,
      chamferScore: 0.97,
      colorHistCorr: 0.95,
      needsReview: true,
      hasDiff: true,
    });
    expect(merged[1]).toMatchObject({
      ssim: null,
      mae: null,
      fgIou: null,
      fgIouTolerant: null,
      colorHistCorr: null,
      needsReview: null,
      hasDiff: false,
    });
  });

  it('clears visual metrics for slides marked hidden by the server', () => {
    const slides = [
      {
        index: 2,
        hasComparablePdf: true,
        ssim: 0.5,
        mae: 0.1,
        fgIou: 0.2,
        fgIouTolerant: 0.3,
        chamferScore: 0.4,
        colorHistCorr: 0.5,
        needsReview: true,
        hasDiff: true,
      },
    ];

    const merged = mergeServerMetricsIntoSlides(slides, [{ slideIdx: 2, hidden: true }]);

    expect(merged[0]).toMatchObject({
      hasComparablePdf: false,
      ssim: null,
      mae: null,
      fgIou: null,
      fgIouTolerant: null,
      chamferScore: null,
      colorHistCorr: null,
      needsReview: null,
      hasDiff: false,
    });
  });

  it('clears metrics when the server metrics list is missing or lacks numeric SSIM', () => {
    const slides = [
      {
        index: 0,
        hasComparablePdf: true,
        ssim: 0.5,
        mae: 0.1,
        fgIou: 0.2,
        fgIouTolerant: 0.3,
        chamferScore: 0.4,
        colorHistCorr: 0.5,
        needsReview: true,
        hasDiff: true,
      },
    ];

    expect(mergeServerMetricsIntoSlides(slides, null)[0].hasDiff).toBe(false);
    expect(mergeServerMetricsIntoSlides(slides, [{ slideIdx: 0, ssim: null }])[0]).toMatchObject({
      ssim: null,
      hasDiff: false,
    });
  });

  it('normalizes optional metric fields with non-number or non-boolean values to null', () => {
    const slides = [
      {
        index: 0,
        hasComparablePdf: true,
        ssim: null,
        mae: null,
        fgIou: null,
        fgIouTolerant: null,
        chamferScore: null,
        colorHistCorr: null,
        needsReview: null,
        hasDiff: false,
      },
    ];

    const merged = mergeServerMetricsIntoSlides(slides, [
      {
        slideIdx: 0,
        ssim: 0.95,
        mae: null,
        fgIou: undefined,
        fgIouTolerant: null,
        chamferScore: undefined,
        colorHistCorr: null,
        needsReview: null,
      },
    ]);

    expect(merged[0]).toMatchObject({
      ssim: 0.95,
      mae: null,
      fgIou: null,
      fgIouTolerant: null,
      chamferScore: null,
      colorHistCorr: null,
      needsReview: null,
      hasDiff: true,
    });
  });
});
