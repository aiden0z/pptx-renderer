import { describe, expect, it } from 'vitest';
import {
  applyLegendGridMargins,
  applyDefaultTextColors,
  applyNiceAxisRange,
} from '../../../../src/renderer/chart/postProcess';
import { parseXml, type SafeXmlNode } from '../../../../src/parser/XmlParser';

describe('chart option post-process helpers', () => {
  it('fills Office-like default text colors when chart text omits explicit color', () => {
    const option = {
      title: { textStyle: {} },
      legend: { textStyle: {} },
      xAxis: { name: 'Category', nameTextStyle: {} },
      radar: { indicator: [{ axisLabel: {} }] },
    };

    applyDefaultTextColors(option);

    expect(option.title.textStyle.color).toBe('#000000');
    expect(option.legend.textStyle.color).toBe('#000000');
    expect(option.xAxis.nameTextStyle.color).toBe('#000000');
    expect(option.radar.indicator[0].axisLabel.color).toBe('#000000');
  });

  it('adds nice value-axis headroom when no explicit max exists', () => {
    const option = {
      xAxis: { type: 'category' },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: [1, 5] }],
    };

    applyNiceAxisRange(option);

    expect(option.yAxis.min).toBe(0);
    expect(option.yAxis.max).toBeGreaterThan(5);
    expect(option.yAxis.interval).toBeGreaterThan(0);
  });

  it('limits default value-axis tick density for compact bar charts', () => {
    const option = {
      grid: { top: 40, bottom: 24 },
      xAxis: { type: 'category' },
      yAxis: { type: 'value', axisLabel: { fontSize: 24 } },
      series: [{ type: 'bar', data: [2, 4, 3] }],
    };

    applyNiceAxisRange(option, { w: 278, h: 182 });

    expect(option.yAxis.min).toBe(0);
    expect(option.yAxis.max).toBe(5);
    expect(option.yAxis.interval).toBe(5);
  });

  it('keeps Office-like dense value-axis ticks for compact line charts', () => {
    const option = {
      grid: { top: 64, bottom: 24 },
      xAxis: { type: 'category' },
      yAxis: { type: 'value', axisLabel: { fontSize: 24 } },
      series: [{ type: 'line', data: [120, 135, 148] }],
    };

    applyNiceAxisRange(option, { w: 528, h: 576 });

    expect(option.yAxis.min).toBe(0);
    expect(option.yAxis.max).toBe(160);
    expect(option.yAxis.interval).toBe(20);
  });

  it('uses compact right legend margins for line charts', () => {
    const option = {
      grid: { left: 18, right: 10 },
      legend: {
        data: [{ name: 'Actual' }, { name: 'Target' }],
        itemWidth: 18,
        textStyle: { fontSize: 18 },
      },
      xAxis: { data: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'] },
      series: [{ type: 'line' }, { type: 'line' }],
    };
    const chartNode = parseXml(`
      <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:plotArea><c:lineChart/></c:plotArea>
        <c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>
      </c:chart>
    `);

    applyLegendGridMargins(option, chartNode, undefined);

    expect(option.grid.right).toBe(101);
    expect(option.legend.right).toBe('1%');
  });

  it('keeps the native plot span for area charts with a right legend', () => {
    const option = {
      grid: { left: 12, right: 15 },
      legend: {
        data: [{ name: 'Curve' }],
        itemWidth: 18,
        textStyle: { fontSize: 18 },
      },
      xAxis: { type: 'category', data: ['A', 'B'] },
      yAxis: { type: 'value' },
      series: [{ type: 'line', areaStyle: {} }],
    };
    const chartNode = parseXml(`
      <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:plotArea><c:areaChart/></c:plotArea>
        <c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>
      </c:chart>
    `);

    applyLegendGridMargins(option, chartNode, undefined);

    expect(option.grid.right).toBe(98);
    expect(option.legend.right).toBe('1%');
  });

  it('uses family-specific side legend margins for bars and bubbles', () => {
    const barOption = {
      grid: { left: 12, right: 15 },
      legend: {
        data: [{ name: 'Curve' }],
        itemWidth: 18,
        textStyle: { fontSize: 18 },
      },
      xAxis: { type: 'category', data: ['A', 'B'] },
      yAxis: { type: 'value' },
      series: [{ type: 'bar' }],
    };
    const bubbleOption = {
      grid: { left: 15, right: 10 },
      legend: {
        data: [{ name: 'Curve' }],
        itemWidth: 18,
        textStyle: { fontSize: 18 },
      },
      xAxis: { type: 'value' },
      yAxis: { type: 'value' },
      series: [{ type: 'scatter' }],
    };
    const barChart = parseXml(`
      <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:plotArea><c:barChart/></c:plotArea>
        <c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>
      </c:chart>
    `);
    const bubbleChart = parseXml(`
      <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:plotArea><c:bubbleChart/></c:plotArea>
        <c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>
      </c:chart>
    `);

    applyLegendGridMargins(barOption, barChart, undefined);
    applyLegendGridMargins(bubbleOption, bubbleChart, undefined);

    expect(barOption.grid.right).toBe(105);
    expect(bubbleOption.grid.right).toBe(100);
    expect(barOption.legend.right).toBe('1%');
    expect(bubbleOption.legend.right).toBe('1%');
  });

  it('preserves side legend defaults for negative columns and horizontal bars', () => {
    const makeOption = (data: number[]) => ({
      grid: { left: 18, right: 10 },
      legend: {
        right: '2%',
        data: [{ name: 'Series 1' }],
        itemWidth: 18,
        textStyle: { fontSize: 18 },
      },
      xAxis: { type: 'category', data: ['A', 'B'] },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data }],
    });
    const negativeOption = makeOption([15, -8]);
    const horizontalOption = makeOption([15, 8]);
    const negativeChart = parseXml(`
      <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:plotArea><c:barChart><c:barDir val="col"/></c:barChart></c:plotArea>
        <c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>
      </c:chart>
    `);
    const horizontalChart = parseXml(`
      <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:plotArea><c:barChart><c:barDir val="bar"/></c:barChart></c:plotArea>
        <c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>
      </c:chart>
    `);

    applyLegendGridMargins(negativeOption, negativeChart, undefined);
    applyLegendGridMargins(horizontalOption, horizontalChart, undefined);

    expect(negativeOption.grid.right).toBe(137);
    expect(horizontalOption.grid.right).toBe(137);
    expect(negativeOption.legend.right).toBe('2%');
    expect(horizontalOption.legend.right).toBe('2%');
  });

  it('keeps extra right legend padding for scatter charts', () => {
    const option = {
      grid: { left: 18, right: 10 },
      legend: {
        data: [{ name: 'Curve' }],
        itemWidth: 18,
        textStyle: { fontSize: 18 },
      },
      xAxis: { type: 'value' },
      yAxis: { type: 'value' },
      series: [{ type: 'scatter' }],
    };
    const chartNode = parseXml(`
      <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:plotArea><c:scatterChart/></c:plotArea>
        <c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>
      </c:chart>
    `);

    applyLegendGridMargins(option, chartNode, undefined);

    expect(option.grid.right).toBe(108);
    expect(option.legend.right).toBe('1%');
  });

  it('keeps the default side inset for non-Cartesian legends', () => {
    const option = {
      grid: { left: 20, right: 20 },
      legend: {
        right: '2%',
        data: [{ name: 'Sales' }],
        textStyle: { fontSize: 18 },
      },
      series: [{ type: 'pie' }],
    };
    const chartNode = parseXml(`
      <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:plotArea><c:doughnutChart/></c:plotArea>
        <c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>
      </c:chart>
    `);

    applyLegendGridMargins(option, chartNode, undefined);

    expect(option.legend.right).toBe('2%');
  });

  describe('bottom legend grid margin', () => {
    const bottomLegendChart = (legendXml = '<c:legendPos val="b"/><c:overlay val="0"/>') =>
      parseXml(`
        <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
          <c:plotArea><c:lineChart/></c:plotArea>
          <c:legend>${legendXml}</c:legend>
        </c:chart>
      `);
    const bottomLegendOption = (fontSize: number) => ({
      grid: { bottom: 35 },
      legend: {
        bottom: '5%',
        itemHeight: 22,
        data: [
          { name: 'Asia - North Europe', icon: 'path://M2 4.5 L22 4.5', marker: 'diamond' },
          { name: 'Asia - Mediterranean', icon: 'path://M2 4.5 L22 4.5', marker: 'rect' },
        ],
        textStyle: { fontSize },
      },
      series: [
        { type: 'line', name: 'Asia - North Europe', symbolSize: 12 },
        { type: 'line', name: 'Asia - Mediterranean', symbolSize: 12 },
      ],
    });

    it('reserves the legend inset and row below the category labels', () => {
      const option = bottomLegendOption(24);

      applyLegendGridMargins(option, bottomLegendChart(), undefined, { w: 1152, h: 624 });

      // 5% of 624 + 1.2 * 24 + 4 px gap
      expect(option.grid.bottom).toBe(64);
    });

    it('sizes the legend row from a marker larger than the text', () => {
      const option = bottomLegendOption(10);
      option.series[1].symbolSize = 30;

      applyLegendGridMargins(option, bottomLegendChart(), undefined, { w: 1152, h: 624 });

      expect(option.grid.bottom).toBe(66);
    });

    it('keeps a larger existing margin', () => {
      const option = bottomLegendOption(10);

      applyLegendGridMargins(option, bottomLegendChart(), undefined, { w: 400, h: 160 });

      expect(option.grid.bottom).toBe(35);
    });

    it('leaves the margin alone without a chart size, for overlay legends and manual layouts', () => {
      const size = { w: 1152, h: 624 };
      const cases: [ReturnType<typeof bottomLegendOption>, SafeXmlNode, typeof size | undefined][] =
        [
          [bottomLegendOption(24), bottomLegendChart(), undefined],
          [
            bottomLegendOption(24),
            bottomLegendChart('<c:legendPos val="b"/><c:overlay val="1"/>'),
            size,
          ],
          [
            bottomLegendOption(24),
            bottomLegendChart(
              '<c:legendPos val="b"/><c:layout><c:manualLayout><c:y val="0.9"/></c:manualLayout></c:layout><c:overlay val="0"/>',
            ),
            size,
          ],
        ];

      for (const [option, chartNode, chartSize] of cases) {
        applyLegendGridMargins(option, chartNode, undefined, chartSize);
        expect(option.grid.bottom).toBe(35);
      }
    });
  });

  describe('automatic value-axis minimum', () => {
    const lineOption = (series: { data: number[]; stack?: string }[]) => ({
      xAxis: { type: 'category' },
      yAxis: { type: 'value' } as Record<string, unknown>,
      series: series.map((s) => ({ type: 'line', ...s })),
    });

    it('starts above zero when the minimum is at least 5/6 of the maximum', () => {
      const option = lineOption([{ data: [2310, 2205, 2140] }, { data: [2480, 2390, 2275] }]);

      applyNiceAxisRange(option);

      expect(option.yAxis).toMatchObject({ min: 2100, max: 2500, interval: 50 });
    });

    it('applies to the value axis of bar charts too', () => {
      const option = lineOption([{ data: [4120, 3480] }]);
      option.series[0].type = 'bar';

      applyNiceAxisRange(option);

      expect(option.yAxis.min).toBeGreaterThan(0);
      expect(option.yAxis.min).toBeLessThanOrEqual(3480 - (4120 - 3480) / 20);
      expect(option.yAxis.max).toBeGreaterThan(4120 + (4120 - 3480) / 20);
    });

    it('stays at zero below the 5/6 line (oracle-pypptx-chart-0008 data)', () => {
      const option = lineOption([
        { data: [82, 85, 79, 91, 88, 94, 87, 96] },
        { data: [85, 85, 85, 85, 90, 90, 90, 90] },
      ]);

      applyNiceAxisRange(option);

      expect(option.yAxis.min).toBe(0);
    });

    it('stays at zero for stacked series, an explicit max, and constant data', () => {
      const stacked = lineOption([
        { data: [2310, 2205], stack: 'total' },
        { data: [2480, 2390], stack: 'total' },
      ]);
      const explicitMax = lineOption([{ data: [2310, 2205, 2140] }]);
      explicitMax.yAxis.max = 3000;
      const constant = lineOption([{ data: [2140, 2140] }]);

      for (const option of [stacked, explicitMax, constant]) {
        applyNiceAxisRange(option);
        expect(option.yAxis.min).toBe(0);
      }
    });
  });
});
