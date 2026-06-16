import { describe, expect, it } from 'vitest';
import { computePanelScale } from '../../../src/utils/previewScale';

describe('computePanelScale', () => {
  it('prefers measured element size over fallback base size', () => {
    const result = computePanelScale({
      panelWidth: 300,
      elementWidth: 1200,
      elementHeight: 675,
      fallbackWidth: 960,
      fallbackHeight: 540,
    });

    expect(result.scale).toBeCloseTo(0.25, 6);
    expect(result.scaledHeight).toBeCloseTo(168.75, 6);
  });

  it('uses fallback size when measured size is missing', () => {
    const result = computePanelScale({
      panelWidth: 300,
      fallbackWidth: 960,
      fallbackHeight: 540,
    });

    expect(result.scale).toBeCloseTo(0.3125, 6);
    expect(result.scaledHeight).toBeCloseTo(168.75, 6);
  });

  it('uses fallback dimensions when measured dimensions are non-finite or non-positive', () => {
    const result = computePanelScale({
      panelWidth: 400,
      elementWidth: Number.NaN,
      elementHeight: 0,
      fallbackWidth: 800,
      fallbackHeight: 600,
    });

    expect(result).toEqual({ scale: 0.5, scaledHeight: 300 });
  });

  it('returns null when the panel width is not usable', () => {
    expect(
      computePanelScale({
        panelWidth: Number.POSITIVE_INFINITY,
        fallbackWidth: 960,
        fallbackHeight: 540,
      }),
    ).toBeNull();
    expect(
      computePanelScale({
        panelWidth: 0,
        fallbackWidth: 960,
        fallbackHeight: 540,
      }),
    ).toBeNull();
  });

  it('returns null when both measured and fallback base dimensions are invalid', () => {
    expect(
      computePanelScale({
        panelWidth: 320,
        elementWidth: -1,
        elementHeight: null,
        fallbackWidth: 0,
        fallbackHeight: 540,
      }),
    ).toBeNull();
    expect(
      computePanelScale({
        panelWidth: 320,
        elementWidth: null,
        elementHeight: -1,
        fallbackWidth: 960,
        fallbackHeight: Number.NaN,
      }),
    ).toBeNull();
  });
});
