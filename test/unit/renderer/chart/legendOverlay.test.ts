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

  it('uses the series symbol size for line legend markers', () => {
    const overlay = buildCustomLegendOverlay(
      {
        color: ['#156082'],
        legend: {
          right: 20,
          top: 'middle',
          orient: 'vertical',
          itemWidth: 24,
          itemHeight: 9,
          data: [
            {
              name: 'Y value',
              icon: 'path://M2 4.5 L22 4.5',
              marker: 'diamond',
            },
          ],
          textStyle: { fontSize: 10, color: '#000000' },
        },
        series: [
          {
            type: 'line',
            name: 'Y value',
            symbolSize: 14,
            lineStyle: { color: '#156082', width: 2 },
            itemStyle: { color: '#156082' },
            data: [[0.7, 2.7]],
          },
        ],
      },
      { w: 800, h: 450 },
    );

    const svg = overlay?.querySelector('svg');
    const markerPath = svg?.querySelectorAll('path')[1];

    expect(svg?.getAttribute('height')).toBe('14');
    expect(markerPath?.getAttribute('d')).toBe('M12 0 L19 7 L12 14 L5 7 Z');
  });
});
