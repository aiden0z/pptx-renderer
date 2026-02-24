import { describe, expect, it } from 'vitest';
import {
  mergeServerMetricsIntoSlides,
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
});
