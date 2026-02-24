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
});
