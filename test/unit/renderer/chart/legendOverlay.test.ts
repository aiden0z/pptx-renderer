import { describe, expect, it } from 'vitest';
import {
  buildCustomLegendOverlay,
  createLegendIcon,
} from '../../../../src/renderer/chart/legendOverlay';

describe('chart legend overlay helpers', () => {
  it('creates SVG legend icons for line paths with markers', () => {
    const icon = createLegendIcon('path://M2 4.5 L22 4.5', '#336699', 24, 10, 2, 'diamond');

    expect(icon.tagName.toLowerCase()).toBe('svg');
    expect(icon.querySelector('path')?.getAttribute('stroke')).toBe('#336699');
    expect(icon.querySelectorAll('path')).toHaveLength(2);
  });

  it('does not render a marker when a legend item explicitly requests no icon', () => {
    const icon = createLegendIcon('none', '#336699', 12, 12);

    expect(icon === null).toBe(true);
  });

  it('builds anchored legend overlay from ECharts legend option', () => {
    const overlay = buildCustomLegendOverlay(
      {
        color: ['#ff0000'],
        legend: {
          bottom: '5%',
          orient: 'horizontal',
          data: ['Series A'],
          textStyle: { fontSize: 12, color: '#111111' },
        },
        series: [{ type: 'bar', data: [1] }],
      },
      { w: 400, h: 300 },
    );

    expect(overlay?.style.bottom).toBe('15px');
    expect(overlay?.textContent).toContain('Series A');
  });
});
