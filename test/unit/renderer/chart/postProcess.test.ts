import { describe, expect, it } from 'vitest';
import {
  applyLegendGridMargins,
  applyDefaultTextColors,
  applyNiceAxisRange,
} from '../../../../src/renderer/chart/postProcess';
import { parseXml } from '../../../../src/parser/XmlParser';

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

    expect(option.grid.right).toBe(105);
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
});
