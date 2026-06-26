import type * as echarts from 'echarts';
import { SafeXmlNode } from '../../parser/XmlParser';
import { parseOoxmlBoolElement } from './ooxml';
import {
  DEFAULT_CHART_FOREGROUND_COLOR,
  hasExplicitFontSize,
  type MutableAxisOption,
} from './types';

type RadarTextContainer = {
  name?: {
    textStyle?: Record<string, unknown>;
  };
  indicator?: {
    axisLabel?: Record<string, unknown>;
  }[];
};

export interface ChartPixelSize {
  w: number;
  h: number;
}

function getRadarNameTextStyles(option: echarts.EChartsOption): Record<string, unknown>[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opt = option as any;
  const radars = (Array.isArray(opt.radar) ? opt.radar : opt.radar ? [opt.radar] : []) as unknown[];
  return radars
    .filter((radar): radar is RadarTextContainer => typeof radar === 'object' && radar !== null)
    .map((radar) => {
      const name = radar.name ?? (radar.name = {});
      return name.textStyle ?? (name.textStyle = {});
    });
}

function getRadarAxisLabelStyles(option: echarts.EChartsOption): Record<string, unknown>[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opt = option as any;
  const radars = (Array.isArray(opt.radar) ? opt.radar : opt.radar ? [opt.radar] : []) as unknown[];
  return radars
    .filter((radar): radar is RadarTextContainer => typeof radar === 'object' && radar !== null)
    .flatMap((radar) => radar.indicator ?? [])
    .map((indicator) => indicator.axisLabel)
    .filter((axisLabel): axisLabel is Record<string, unknown> => !!axisLabel);
}

export function applyDefaultFontSizes(option: echarts.EChartsOption, defaultFs: number): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opt = option as any;

  if (opt.title?.textStyle?.fontSize) {
    const cur = opt.title.textStyle.fontSize;
    if (cur <= 14) {
      opt.title.textStyle.fontSize = defaultFs;
    }
  }

  for (const textStyle of getRadarNameTextStyles(option)) {
    const current = textStyle.fontSize;
    if (typeof current !== 'number' || current <= 10) {
      textStyle.fontSize = defaultFs;
    }
  }
  for (const axisLabel of getRadarAxisLabelStyles(option)) {
    const current = axisLabel.fontSize;
    if (typeof current !== 'number' || current <= 10) {
      axisLabel.fontSize = defaultFs;
    }
  }

  const seriesArr = Array.isArray(opt.series) ? opt.series : opt.series ? [opt.series] : [];
  for (const s of seriesArr) {
    if (s?.label?.fontSize && (s.label.fontSize as number) <= 10 && !hasExplicitFontSize(s.label)) {
      s.label.fontSize = defaultFs;
    }
  }

  const applyAxisDefaultFontSize = (axis: MutableAxisOption | undefined) => {
    if (!axis?.axisLabel) return;
    const current = axis.axisLabel.fontSize;
    if (current === undefined || current <= 10) {
      axis.axisLabel.fontSize = defaultFs;
    }
  };

  const xAxes = Array.isArray(opt.xAxis) ? opt.xAxis : opt.xAxis ? [opt.xAxis] : [];
  const yAxes = Array.isArray(opt.yAxis) ? opt.yAxis : opt.yAxis ? [opt.yAxis] : [];
  for (const axis of [...xAxes, ...yAxes]) applyAxisDefaultFontSize(axis);

  if (opt.legend?.textStyle) {
    const current = opt.legend.textStyle.fontSize;
    if ((current === undefined || current <= 10) && !hasExplicitFontSize(opt.legend.textStyle)) {
      opt.legend.textStyle.fontSize = defaultFs;
    }
  }
}

export function applyDefaultFontFamily(option: echarts.EChartsOption, fontFamily: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opt = option as any;

  if (opt.title?.textStyle && !opt.title.textStyle.fontFamily) {
    opt.title.textStyle.fontFamily = fontFamily;
  }
  if (opt.title?.textStyle && !opt.title.textStyle.fontWeight) {
    opt.title.textStyle.fontWeight = 'bold';
  }

  const applyAxisFontFamily = (axis: MutableAxisOption | undefined) => {
    if (!axis) return;
    const axisLabel = axis.axisLabel ?? (axis.axisLabel = {});
    if (!axisLabel.fontFamily) {
      axisLabel.fontFamily = fontFamily;
    }
  };

  const xAxes = Array.isArray(opt.xAxis) ? opt.xAxis : opt.xAxis ? [opt.xAxis] : [];
  const yAxes = Array.isArray(opt.yAxis) ? opt.yAxis : opt.yAxis ? [opt.yAxis] : [];
  for (const axis of [...xAxes, ...yAxes]) applyAxisFontFamily(axis);

  if (opt.legend?.textStyle && !opt.legend.textStyle.fontFamily) {
    opt.legend.textStyle.fontFamily = fontFamily;
  }

  for (const textStyle of getRadarNameTextStyles(option)) {
    if (!textStyle.fontFamily) {
      textStyle.fontFamily = fontFamily;
    }
  }
  for (const axisLabel of getRadarAxisLabelStyles(option)) {
    if (!axisLabel.fontFamily) {
      axisLabel.fontFamily = fontFamily;
    }
  }
}

export function applyDefaultTextColors(option: echarts.EChartsOption): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opt = option as any;
  if (opt.title?.textStyle && opt.title.textStyle.color === undefined) {
    opt.title.textStyle.color = DEFAULT_CHART_FOREGROUND_COLOR;
  }

  const legends = Array.isArray(opt.legend) ? opt.legend : opt.legend ? [opt.legend] : [];
  for (const legend of legends) {
    if (!legend || legend.show === false) continue;
    const textStyle = legend.textStyle ?? (legend.textStyle = {});
    if (textStyle.color === undefined) {
      textStyle.color = DEFAULT_CHART_FOREGROUND_COLOR;
    }
  }

  const xAxes = Array.isArray(opt.xAxis) ? opt.xAxis : opt.xAxis ? [opt.xAxis] : [];
  const yAxes = Array.isArray(opt.yAxis) ? opt.yAxis : opt.yAxis ? [opt.yAxis] : [];
  for (const axis of [...xAxes, ...yAxes]) {
    if (!axis?.name) continue;
    const nameTextStyle = axis.nameTextStyle ?? (axis.nameTextStyle = {});
    if (nameTextStyle.color === undefined) {
      nameTextStyle.color = DEFAULT_CHART_FOREGROUND_COLOR;
    }
  }

  for (const textStyle of getRadarNameTextStyles(option)) {
    if (textStyle.color === undefined) {
      textStyle.color = DEFAULT_CHART_FOREGROUND_COLOR;
    }
  }
  for (const axisLabel of getRadarAxisLabelStyles(option)) {
    if (axisLabel.color === undefined) {
      axisLabel.color = DEFAULT_CHART_FOREGROUND_COLOR;
    }
  }
}

export function applyLegendGridMargins(
  option: echarts.EChartsOption,
  chartNode: SafeXmlNode,
  defaultFs: number | undefined,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opt = option as any;
  if (!opt.grid || !opt.legend) return;
  if (opt.legend.show === false) return;

  const legend = chartNode.child('legend');
  if (!legend.exists()) return;
  const overlay = parseOoxmlBoolElement(legend.child('overlay'));
  if (overlay) return;

  const posVal = legend.child('legendPos').attr('val') || 'r';

  if (posVal === 'r' || posVal === 'l') {
    const legendData = opt.legend.data as (string | { name: string })[] | undefined;
    if (!legendData || legendData.length === 0) return;

    const names = legendData.map((d: string | { name: string }) =>
      typeof d === 'string' ? d : d.name,
    );
    const fs = opt.legend?.textStyle?.fontSize ?? defaultFs ?? 12;
    const iconWidth = Number(opt.legend?.itemWidth) || fs;
    let maxTextPx = 0;
    for (const n of names) {
      let w = 0;
      for (const ch of n) {
        w += ch.charCodeAt(0) > 0x2e80 ? fs : fs * 0.55;
      }
      if (w > maxTextPx) maxTextPx = w;
    }
    const estimatedLegendPx = iconWidth + 8 + maxTextPx + 14;
    const plotArea = chartNode.child('plotArea');
    const seriesCount = Array.isArray(opt.series) ? opt.series.length : opt.series ? 1 : 0;
    const xAxis = Array.isArray(opt.xAxis) ? opt.xAxis[0] : opt.xAxis;
    const categoryCount = Array.isArray(xAxis?.data) ? xAxis.data.length : 0;
    const isDenseSingleSeriesLineRightLegend =
      posVal === 'r' &&
      plotArea.child('lineChart').exists() &&
      seriesCount === 1 &&
      categoryCount >= 20;
    const gridMarginPx = Math.max(
      84,
      Math.round(estimatedLegendPx + (isDenseSingleSeriesLineRightLegend ? -10 : 18)),
    );

    if (typeof opt.grid.left === 'string' && opt.grid.left.includes('%')) return;
    if (typeof opt.grid.right === 'string' && opt.grid.right.includes('%')) return;

    if (posVal === 'r') {
      opt.grid.right = gridMarginPx;
    } else {
      opt.grid.left = gridMarginPx;
    }
  }
}

function gridEdgePx(value: unknown, fullSize: number, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.endsWith('%')) return (fullSize * parseFloat(trimmed)) / 100;
    const parsed = parseFloat(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function gridPlotSpanPx(
  grid: unknown,
  chartSize: ChartPixelSize | undefined,
  axisDimension: 'x' | 'y',
): number | undefined {
  if (!chartSize) return undefined;
  const fullSize = axisDimension === 'x' ? chartSize.w : chartSize.h;
  const gridObj = (Array.isArray(grid) ? grid[0] : grid) as Record<string, unknown> | undefined;
  if (!gridObj) return fullSize;

  const startKey = axisDimension === 'x' ? 'left' : 'top';
  const endKey = axisDimension === 'x' ? 'right' : 'bottom';
  const start = gridEdgePx(gridObj[startKey], fullSize, 0);
  const end = gridEdgePx(gridObj[endKey], fullSize, 0);
  return Math.max(0, fullSize - start - end);
}

function densityLimitedDesiredTicks(
  axis: MutableAxisOption,
  desiredTicks: number,
  axisDimension: 'x' | 'y',
  chartSize: ChartPixelSize | undefined,
  grid: unknown,
): number {
  const plotSpan = gridPlotSpanPx(grid, chartSize, axisDimension);
  if (plotSpan === undefined || plotSpan <= 0) return desiredTicks;

  const axisLabel = axis.axisLabel ?? {};
  const fontSize = typeof axisLabel.fontSize === 'number' ? axisLabel.fontSize : 12;
  const minLabelSpacing = Math.max(28, fontSize * 2.6);
  const maxLabels = Math.max(2, Math.floor(plotSpan / minLabelSpacing) + 1);
  return Math.max(1, Math.min(desiredTicks, maxLabels - 1));
}

export function applyNiceAxisRange(
  option: echarts.EChartsOption,
  chartSize?: ChartPixelSize,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opt = option as any;

  if (!opt.xAxis && !opt.yAxis) return;

  const allValues: number[] = [];
  const xValues: number[] = [];
  const yValues: number[] = [];
  const seriesArr = Array.isArray(opt.series) ? opt.series : opt.series ? [opt.series] : [];

  const stackGroups = new Map<string, { axisIndex: number; values: number[][] }>();
  const unstackedValues: number[] = [];
  const valuesByYAxis = new Map<number, number[]>();

  const appendYAxisValues = (axisIndex: number, values: number[]) => {
    if (!valuesByYAxis.has(axisIndex)) valuesByYAxis.set(axisIndex, []);
    valuesByYAxis.get(axisIndex)!.push(...values);
  };

  for (const s of seriesArr) {
    if (!s.data) continue;
    const vals: number[] = [];
    for (const d of s.data) {
      if (typeof d === 'number') {
        vals.push(d);
      } else if (d && typeof d === 'object' && 'value' in d && typeof d.value === 'number') {
        vals.push(d.value);
      } else if (Array.isArray(d)) {
        if (d.length >= 2 && typeof d[0] === 'number' && typeof d[1] === 'number') {
          xValues.push(d[0]);
          yValues.push(d[1]);
        }
        for (const v of d) {
          if (typeof v === 'number') vals.push(v);
        }
      } else {
        vals.push(0);
      }
    }
    const yAxisIndex =
      typeof s.yAxisIndex === 'number' && Number.isFinite(s.yAxisIndex) ? s.yAxisIndex : 0;
    if (s.stack) {
      const key = `${yAxisIndex}:${String(s.stack)}`;
      if (!stackGroups.has(key)) stackGroups.set(key, { axisIndex: yAxisIndex, values: [] });
      stackGroups.get(key)!.values.push(vals);
    } else {
      unstackedValues.push(...vals);
      appendYAxisValues(yAxisIndex, vals);
    }
  }

  for (const group of stackGroups.values()) {
    const sums: number[] = [];
    const maxLen = Math.max(...group.values.map((v) => v.length));
    for (let i = 0; i < maxLen; i++) {
      let sum = 0;
      for (const vals of group.values) {
        sum += vals[i] ?? 0;
      }
      sums.push(sum);
      allValues.push(sum);
    }
    appendYAxisValues(group.axisIndex, sums);
  }
  allValues.push(...unstackedValues);

  const hasBarSeries = seriesArr.some((s: { type?: string }) => s.type === 'bar');
  const hasNonBarSeries = seriesArr.some((s: { type?: string }) => s.type && s.type !== 'bar');
  const defaultDesiredTicks = hasBarSeries && !hasNonBarSeries ? 10 : 8;

  if (allValues.length === 0) return;

  const cartesianScatter =
    xValues.length > 0 &&
    yValues.length > 0 &&
    (Array.isArray(opt.xAxis) ? opt.xAxis[0] : opt.xAxis)?.type === 'value' &&
    (Array.isArray(opt.yAxis) ? opt.yAxis[0] : opt.yAxis)?.type === 'value';

  const applyAxisExtent = (
    axis: MutableAxisOption | undefined,
    values: number[],
    desiredTicks: number,
  ) => {
    if (!axis || axis.type !== 'value' || values.length === 0) return;
    if (axis.min !== undefined && axis.max !== undefined) return;
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    const interval = niceAxisInterval(dataMax, dataMin, desiredTicks);
    if (axis.max === undefined) {
      let max = niceAxisMax(dataMax, dataMin, desiredTicks);
      if (max > dataMax && max - dataMax < interval * 0.25) {
        max += interval;
      }
      axis.max = max;
    }
    if (axis.min === undefined && dataMin >= 0) {
      axis.min = 0;
    }
    if (axis.interval === undefined) {
      axis.interval = interval;
    }
  };

  const scatterDesiredTicks = (values: number[]): number => {
    if (values.length === 0) return 8;
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    const spanFromZero = dataMax - Math.min(0, dataMin);
    return spanFromZero <= 3 ? 3 : 8;
  };

  if (cartesianScatter) {
    const xAxes = (Array.isArray(opt.xAxis) ? opt.xAxis : [opt.xAxis]) as Record<string, unknown>[];
    const yAxes = (Array.isArray(opt.yAxis) ? opt.yAxis : [opt.yAxis]) as Record<string, unknown>[];
    xAxes.forEach((ax) => applyAxisExtent(ax, xValues, scatterDesiredTicks(xValues)));
    yAxes.forEach((ax) => applyAxisExtent(ax, yValues, scatterDesiredTicks(yValues)));
    return;
  }

  const processAxis = (
    axis: unknown,
    axisDimension: 'x' | 'y',
    valueByIndex?: Map<number, number[]>,
  ) => {
    if (!axis) return;
    const axes = Array.isArray(axis) ? axis : [axis];
    axes.forEach((ax, index) => {
      if (!ax || ax.type !== 'value') return;
      if (ax.min !== undefined && ax.max !== undefined) return;

      const axisValues = valueByIndex?.get(index) ?? allValues;
      if (axisValues.length === 0) return;
      const dataMin = Math.min(...axisValues);
      const dataMax = Math.max(...axisValues);

      const desiredTicks = densityLimitedDesiredTicks(
        ax,
        defaultDesiredTicks,
        axisDimension,
        chartSize,
        opt.grid,
      );
      const interval = niceAxisInterval(dataMax, dataMin, desiredTicks);

      if (ax.max === undefined) {
        let max = niceAxisMax(dataMax, dataMin, desiredTicks);
        if (desiredTicks > 1 && max > dataMax && max - dataMax < interval * 0.25) {
          max += interval;
        }
        ax.max = max;
      }
      if (ax.min === undefined && dataMin >= 0) {
        ax.min = 0;
      } else if (ax.min === undefined && dataMin < 0) {
        ax.min = niceAxisMin(dataMax, dataMin, desiredTicks);
      }
      if (ax.interval === undefined) {
        ax.interval = interval;
      }
    });
  };

  processAxis(opt.xAxis, 'x');
  processAxis(opt.yAxis, 'y', valuesByYAxis);
}

export function niceAxisMax(dataMax: number, dataMin: number, desiredTicks = 5): number {
  const niceInterval = niceAxisInterval(dataMax, dataMin, desiredTicks);
  const niceMax = Math.ceil(dataMax / niceInterval) * niceInterval;
  return niceMax <= dataMax ? niceMax + niceInterval : niceMax;
}

function niceAxisMin(dataMax: number, dataMin: number, desiredTicks = 5): number {
  const niceInterval = niceAxisInterval(dataMax, dataMin, desiredTicks);
  const niceMin = Math.floor(dataMin / niceInterval) * niceInterval;
  return niceMin >= dataMin ? niceMin - niceInterval : niceMin;
}

export function niceAxisInterval(dataMax: number, dataMin: number, desiredTicks = 5): number {
  if (dataMax === 0 && dataMin === 0) return 1;
  const range = dataMax - Math.min(0, dataMin);
  if (range === 0) return dataMax > 0 ? dataMax * 1.2 : 1;
  const rawInterval = range / desiredTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
  const residual = rawInterval / magnitude;
  let niceInterval: number;
  if (residual <= 1) niceInterval = magnitude;
  else if (residual <= 2) niceInterval = 2 * magnitude;
  else if (residual <= 5) niceInterval = 5 * magnitude;
  else niceInterval = 10 * magnitude;
  return niceInterval;
}

export function extractChartDefaultFontSize(chartSpaceNode: SafeXmlNode): number | undefined {
  const txPr = chartSpaceNode.child('txPr');
  if (!txPr.exists()) return undefined;
  for (const p of txPr.children('p')) {
    const pPr = p.child('pPr');
    if (!pPr.exists()) continue;
    const defRPr = pPr.child('defRPr');
    if (!defRPr.exists()) continue;
    const sz = defRPr.numAttr('sz');
    if (sz !== undefined && sz > 0) {
      return Math.round((sz / 100) * (96 / 72));
    }
  }
  return undefined;
}
