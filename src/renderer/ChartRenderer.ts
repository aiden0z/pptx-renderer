/**
 * Chart renderer — converts OOXML chart XML into ECharts visualizations.
 */

import type * as EChartsTypes from 'echarts';
import type { EChartsType } from 'echarts/core';
import { ChartNodeData } from '../model/nodes/ChartNode';
import { RenderContext } from './RenderContext';
import { SafeXmlNode } from '../parser/XmlParser';
import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl } from '../utils/color';
import { applyAxisInfo, getChartAxisIds, parseAxes, parseScatterAxes } from './chart/axes';
import { formatValue } from './chart/format';
import { markerSizeToPx } from './chart/style';
import {
  chartTextStyleToEChartsTextStyle,
  extractTitleRichText,
  extractTitleText,
  extractTitleTextStyle,
  getChartThemeFontFamily,
} from './chart/text';
import { parseOoxmlBoolElement } from './chart/ooxml';
import { parseDataLabels, parsePointDataLabelOverrides } from './chart/dataLabels';
import { parseExplosion, parseSeries } from './chart/series';
import { buildDataTableElement, parseDataTable } from './chart/dataTable';
import {
  buildChartPalette,
  createChartRenderContext,
  getVaryColorPointPalette,
} from './chart/palette';
import { numToPct } from './chart/layout';
import { echarts } from './chart/echartsRuntime';
import {
  buildLegendOption,
  extractLegendInfo,
  getGridBottomPx,
  getGridTopPx,
  getLegendOptionObject,
  getLegendPlacement,
  getLegendTopPx,
  legendIsAtTop,
  lineLegendIconPath,
  pickSeriesStringColor,
  type LegendOptionObject,
} from './chart/legend';
import {
  applyDefaultFontFamily,
  applyDefaultFontSizes,
  applyDefaultTextColors,
  applyLegendGridMargins,
  applyNiceAxisRange,
  type ChartPixelSize,
  extractChartDefaultFontSize,
  niceAxisInterval,
  niceAxisMax,
} from './chart/postProcess';
import { extractBackgroundColors, extractChartFrameStyle } from './chart/frame';
import { buildCustomLegendOverlay } from './chart/legendOverlay';
import {
  CHART_TYPE_ELEMENTS,
  DEFAULT_RADAR_GRIDLINE_STYLE,
  markExplicitFontSize,
  type ChartFrameStyle,
  type ChartTextStyle,
  type DataLabelConfig,
  type DataLabelManualLayout,
  type DataTableInfo,
  type LegendInfo,
  type MutableAxisOption,
  type OoxmlChartType,
  type SeriesData,
} from './chart/types';

export type { ChartFrameStyle } from './chart/types';

// ---------------------------------------------------------------------------
// Chart Title
// ---------------------------------------------------------------------------

/**
 * Extract chart title from chartSpace > chart > title.
 * Returns undefined when autoTitleDeleted is true (title was intentionally removed).
 */
function extractChartTitle(chartNode: SafeXmlNode, seriesArr?: SeriesData[]): string | undefined {
  // Respect autoTitleDeleted: if set, the title should not be shown
  const autoTitleDeleted = chartNode.child('autoTitleDeleted');
  if (parseOoxmlBoolElement(autoTitleDeleted)) {
    return undefined;
  }

  const title = chartNode.child('title');
  if (!title.exists()) {
    // Some producers omit autoTitleDeleted entirely for no-title charts.
    // Only synthesize the Office auto-title when the XML explicitly requests it.
    if (
      autoTitleDeleted.exists() &&
      !parseOoxmlBoolElement(autoTitleDeleted) &&
      seriesArr &&
      seriesArr.length === 1 &&
      seriesArr[0].name
    ) {
      return seriesArr[0].name;
    }
    return undefined;
  }

  return extractTitleText(title);
}

function buildChartTitleOption(
  chartNode: SafeXmlNode,
  seriesArr: SeriesData[],
  ctx: RenderContext,
  fontSize: number,
): EChartsTypes.EChartsOption['title'] | undefined {
  const title = extractChartTitle(chartNode, seriesArr);
  if (!title) return undefined;

  const titleNode = chartNode.child('title');
  const richTitle = extractTitleRichText(titleNode, ctx);
  const titleStyle = extractTitleTextStyle(titleNode, ctx);
  const echartsTitleStyle = chartTextStyleToEChartsTextStyle(titleStyle);
  const titleLayout = extractTitleManualLayout(chartNode);

  return {
    text: richTitle?.text ?? title,
    left: 'center',
    ...titleLayout,
    textStyle: {
      fontSize,
      ...(echartsTitleStyle ?? {}),
      ...(richTitle ? { rich: richTitle.rich } : {}),
    },
  };
}

/**
 * Extract chart title manual layout (title > layout > manualLayout) to ECharts title position.
 */
function extractTitleManualLayout(chartNode: SafeXmlNode): Partial<Record<'left' | 'top', string>> {
  const manual = chartNode.child('title').child('layout').child('manualLayout');
  if (!manual.exists()) return {};
  const out: Partial<Record<'left' | 'top', string>> = {};
  const x = manual.child('x').numAttr('val');
  const y = manual.child('y').numAttr('val');
  if (x !== undefined) out.left = numToPct(x);
  if (y !== undefined) out.top = numToPct(y);
  return out;
}

function computePieLayout(
  legendInfo: LegendInfo | undefined,
  isDoughnut: boolean,
  showLabel: boolean,
  holeSizePct = 50,
  hasExplosion = false,
): { center: [string, string]; radius: [string, string] | string } {
  const placement = getLegendPlacement(legendInfo);
  let center: [string, string] = ['50%', '55%'];
  let outerRadius = showLabel ? 78 : 82;

  if (placement === 'right') {
    if (isDoughnut && hasExplosion) {
      center = ['45%', '55%'];
      outerRadius = 76;
    } else if (isDoughnut) {
      center = ['39%', '54%'];
      outerRadius = 87;
    } else {
      center = ['38%', '55%'];
      outerRadius = 82;
    }
  } else if (placement === 'left') {
    center = ['62%', '55%'];
    outerRadius = 82;
  } else if (placement === 'top') center = ['50%', '60%'];
  else if (placement === 'bottom') center = ['50%', '45%'];

  if (placement === 'top' || placement === 'bottom') {
    outerRadius -= 4;
  }

  if (!isDoughnut) {
    return { center, radius: `${outerRadius}%` };
  }

  const innerRadius = Math.round(outerRadius * (Math.min(Math.max(holeSizePct, 10), 90) / 100));
  return { center, radius: [`${innerRadius}%`, `${outerRadius}%`] };
}

function pieExplosionToOffset(explosion: number, isDoughnut = false): number {
  return isDoughnut ? explosion : Math.round(explosion * 0.5);
}

function mapFirstSliceAngle(firstSliceAng: number | undefined): number | undefined {
  if (firstSliceAng === undefined || !Number.isFinite(firstSliceAng)) return undefined;
  return (((90 - firstSliceAng) % 360) + 360) % 360;
}

/** Map OOXML c:marker > c:symbol values to ECharts symbol names. */
const OOXML_SYMBOL_MAP: Record<string, string> = {
  circle: 'circle',
  square: 'rect',
  diamond: 'diamond',
  triangle: 'triangle',
  none: 'none',
  // Less common symbols — fallback to circle
  star: 'circle',
  dash: 'circle',
  dot: 'circle',
  plus: 'circle',
  x: 'circle',
};

function mapOoxmlSymbol(symbol: string | undefined): string | undefined {
  if (!symbol) return undefined;
  return OOXML_SYMBOL_MAP[symbol] ?? 'circle';
}

const DEFAULT_LINE_MARKER_SCATTER_SYMBOLS = ['diamond', 'rect', 'triangle', 'circle'];
const DEFAULT_LINE_MARKER_SYMBOLS = ['diamond', 'square', 'triangle', 'circle'];
const DEFAULT_LINE_MARKER_SIZE = markerSizeToPx(9);
const DEFAULT_SCATTER_MARKER_SIZE = DEFAULT_LINE_MARKER_SIZE;
const DEFAULT_BUBBLE_MAX_DIAMETER = 120;

function defaultScatterSymbol(scatterStyle: string, seriesIndex: number): string {
  if (scatterStyle === 'lineMarker' || scatterStyle === 'smoothMarker') {
    return DEFAULT_LINE_MARKER_SCATTER_SYMBOLS[
      seriesIndex % DEFAULT_LINE_MARKER_SCATTER_SYMBOLS.length
    ];
  }
  return 'circle';
}

function defaultLineMarkerSymbol(seriesIndex: number): string {
  return DEFAULT_LINE_MARKER_SYMBOLS[seriesIndex % DEFAULT_LINE_MARKER_SYMBOLS.length];
}

function buildSmoothScatterLineData(data: number[][], stepsPerSegment = 24): number[][] {
  if (data.length < 3) return data;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] <= data[i - 1][0]) return data;
  }
  const tangentScale = 0.3;
  const endTangentScale = 1.2;
  const n = data.length;
  const slopes = new Array<number>(n - 1);
  for (let i = 0; i < n - 1; i++) {
    slopes[i] = (data[i + 1][1] - data[i][1]) / (data[i + 1][0] - data[i][0]);
  }
  const tangents = new Array<number>(n);
  tangents[0] = slopes[0];
  tangents[n - 1] = slopes[n - 2] * endTangentScale;
  for (let i = 1; i < n - 1; i++) {
    tangents[i] = ((slopes[i - 1] + slopes[i]) / 2) * tangentScale;
  }
  const out: number[][] = [[data[0][0], data[0][1]]];
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = data[i];
    const [x1, y1] = data[i + 1];
    const dx = x1 - x0;
    const m0 = tangents[i];
    const m1 = tangents[i + 1];
    for (let step = 1; step <= stepsPerSegment; step++) {
      const t = step / stepsPerSegment;
      const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
      const h10 = t ** 3 - 2 * t ** 2 + t;
      const h01 = -2 * t ** 3 + 3 * t ** 2;
      const h11 = t ** 3 - t ** 2;
      const x = x0 + dx * t;
      const y = h00 * y0 + h10 * dx * m0 + h01 * y1 + h11 * dx * m1;
      out.push([Number(x.toFixed(4)), Number(y.toFixed(4))]);
    }
  }

  return out;
}

function hasManualGrid(
  manualGrid: Partial<Record<'left' | 'top' | 'width' | 'height', string>>,
): boolean {
  return (
    manualGrid.left !== undefined ||
    manualGrid.top !== undefined ||
    manualGrid.width !== undefined ||
    manualGrid.height !== undefined
  );
}

// ---------------------------------------------------------------------------
// ECharts Option Builders
// ---------------------------------------------------------------------------

/**
 * Convert OOXML data label position to ECharts bar label position.
 */
function mapBarLabelPosition(pos: string | undefined, isStacked: boolean): string {
  switch (pos) {
    case 'outEnd':
      return 'top';
    case 'inEnd':
      return 'insideTop';
    case 'ctr':
      return 'inside';
    case 'inBase':
      return 'insideBottom';
    default:
      return isStacked ? 'inside' : 'top';
  }
}

function mapLineLabelPosition(pos: string | undefined): string {
  switch (pos) {
    case 'l':
      return 'left';
    case 'r':
      return 'right';
    case 'b':
      return 'bottom';
    case 'ctr':
      return 'top';
    case 't':
    case 'bestFit':
    default:
      return 'top';
  }
}

function dataLabelBoxProps(
  cfg: DataLabelConfig | Partial<DataLabelConfig>,
): Record<string, unknown> {
  return {
    ...(cfg.backgroundColor ? { backgroundColor: cfg.backgroundColor } : {}),
    ...(cfg.borderColor ? { borderColor: cfg.borderColor } : {}),
    ...(cfg.borderWidth !== undefined ? { borderWidth: cfg.borderWidth } : {}),
    ...(cfg.padding ? { padding: cfg.padding } : {}),
  };
}

function tooltipExtraCss(textStyle: ChartTextStyle | undefined): string | undefined {
  const fontSize = textStyle?.fontSize;
  if (fontSize === undefined) return undefined;
  const lineHeight = Math.max(fontSize + 5, Math.round(fontSize * 1.45));
  return `font-size: ${fontSize}px; line-height: ${lineHeight}px;`;
}

function chartGrouping(chartTypeNode: SafeXmlNode, fallback = 'clustered'): string {
  const groupingNode = chartTypeNode.child('grouping');
  return groupingNode.exists() ? groupingNode.attr('val') || fallback : fallback;
}

function isStackedGrouping(grouping: string): boolean {
  return grouping === 'stacked' || grouping === 'percentStacked';
}

function isPercentStackedGrouping(grouping: string): boolean {
  return grouping === 'percentStacked';
}

function normalizePercentStackedValues(seriesArr: SeriesData[]): number[][] {
  const pointCount = Math.max(0, ...seriesArr.map((series) => series.values.length));
  const totals = new Array<number>(pointCount).fill(0);
  for (const series of seriesArr) {
    for (let i = 0; i < pointCount; i++) {
      totals[i] += Math.max(series.values[i] ?? 0, 0);
    }
  }
  return seriesArr.map((series) =>
    series.values.map((value, index) => {
      const total = totals[index] ?? 0;
      if (total === 0) return 0;
      return Number((Math.max(value, 0) / total).toFixed(6));
    }),
  );
}

function forcePercentAxis(axisDef: Record<string, unknown>): void {
  axisDef.min = 0;
  axisDef.max = 1;
  axisDef.interval = 0.1;
  axisDef.axisLabel = {
    ...((axisDef.axisLabel as object) || {}),
    formatter: (val: number) => formatValue(val, '0%'),
  };
}

function adjustFilledRadarStopColor(
  hex: string,
  options: { hueOffset?: number; saturationScale: number; lightnessOffset: number },
): string {
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  const adjusted = hslToRgb(
    h + (options.hueOffset ?? 0),
    Math.min(1, s * options.saturationScale),
    Math.max(0, Math.min(1, l + options.lightnessOffset)),
  );
  return rgbToHex(adjusted.r, adjusted.g, adjusted.b);
}

function buildFilledRadarAreaColor(hex: string): echarts.graphic.LinearGradient {
  return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    {
      offset: 0,
      color: adjustFilledRadarStopColor(hex, { saturationScale: 1.95, lightnessOffset: 0.217 }),
    },
    {
      offset: 1,
      color: adjustFilledRadarStopColor(hex, {
        hueOffset: -5,
        saturationScale: 1.7,
        lightnessOffset: -0.128,
      }),
    },
  ]);
}

function collectSeriesValues(seriesArr: SeriesData[], stacked: boolean): number[] {
  if (!stacked) {
    return seriesArr.flatMap((series) =>
      series.values.filter((_, idx) => !series.blankIndices?.has(idx)),
    );
  }
  const pointCount = Math.max(0, ...seriesArr.map((series) => series.values.length));
  const sums: number[] = [];
  for (let i = 0; i < pointCount; i++) {
    let sum = 0;
    let hasValue = false;
    for (const series of seriesArr) {
      if (series.blankIndices?.has(i)) continue;
      sum += series.values[i] ?? 0;
      hasValue = true;
    }
    if (hasValue) sums.push(sum);
  }
  return sums;
}

function applyAreaAxisRange(
  axisDef: Record<string, unknown>,
  seriesArr: SeriesData[],
  stacked: boolean,
): void {
  const values = collectSeriesValues(seriesArr, stacked).filter((value) => Number.isFinite(value));
  if (values.length === 0) return;
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const interval = niceAxisInterval(dataMax, dataMin, 8);
  if (axisDef.min === undefined && dataMin >= 0) axisDef.min = 0;
  if (axisDef.interval === undefined) axisDef.interval = interval;
  if (axisDef.max === undefined) {
    if (stacked) {
      axisDef.max = Math.ceil(dataMax / interval) * interval + interval;
    } else {
      let max = niceAxisMax(dataMax, dataMin, 8);
      if (max > dataMax && max - dataMax < interval * 0.25) {
        max += interval;
      }
      axisDef.max = max;
    }
  }
}

function mapPieLabelPosition(pos: string | undefined): 'inside' | 'outside' {
  switch (pos) {
    case 'ctr':
    case 'inEnd':
    case 'inBase':
      return 'inside';
    case 'outEnd':
    case 'bestFit':
    default:
      return 'outside';
  }
}

function mergeDataLabelConfig(
  base: DataLabelConfig | undefined,
  override: Partial<DataLabelConfig> | undefined,
): DataLabelConfig | undefined {
  if (!base && !override) return undefined;
  return {
    showVal: base?.showVal ?? false,
    showCatName: base?.showCatName ?? false,
    showSerName: base?.showSerName ?? false,
    showPercent: base?.showPercent ?? false,
    position: base?.position,
    showLeaderLines: base?.showLeaderLines,
    manualLayout: base?.manualLayout,
    color: base?.color,
    fontSize: base?.fontSize,
    bold: base?.bold,
    backgroundColor: base?.backgroundColor,
    borderColor: base?.borderColor,
    borderWidth: base?.borderWidth,
    padding: base?.padding,
    ...override,
  };
}

function getDataLabelsNode(
  serNode: SafeXmlNode | undefined,
  chartTypeNode: SafeXmlNode,
): SafeXmlNode {
  const seriesDlbls = serNode?.child('dLbls');
  return seriesDlbls?.exists() ? seriesDlbls : chartTypeNode.child('dLbls');
}

function dataLabelShowsContent(cfg: DataLabelConfig | undefined): boolean {
  return Boolean(
    cfg && !cfg.deleted && (cfg.showVal || cfg.showCatName || cfg.showSerName || cfg.showPercent),
  );
}

type DispBlanksAs = 'gap' | 'zero' | 'span';

function getDispBlanksAs(chartNode: SafeXmlNode): DispBlanksAs {
  const val = chartNode.child('dispBlanksAs').attr('val');
  return val === 'zero' || val === 'span' ? val : 'gap';
}

function resolveBlankDisplayValue(
  series: SeriesData,
  pointIdx: number,
  value: number,
  dispBlanksAs: DispBlanksAs,
): number | null {
  if (!series.blankIndices?.has(pointIdx)) return value;
  return dispBlanksAs === 'zero' ? 0 : null;
}

function getSharedSeriesFormatCode(seriesArr: SeriesData[]): string | undefined {
  const first = seriesArr[0]?.formatCode;
  if (!first) return undefined;
  return seriesArr.every((series) => series.formatCode === first) ? first : undefined;
}

function buildPieLabelOption(
  cfg: DataLabelConfig | undefined,
  formatCode: string | undefined,
  seriesName: string,
): Record<string, unknown> | undefined {
  if (!cfg || !dataLabelShowsContent(cfg)) return undefined;
  const labelCfg = cfg;
  const label = {
    show: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    formatter: (params: any) => {
      const parts: string[] = [];
      if (labelCfg.showSerName && seriesName) parts.push(seriesName);
      if (labelCfg.showCatName) parts.push(params.name);
      if (labelCfg.showVal) parts.push(formatValue(params.value, formatCode));
      if (labelCfg.showPercent) parts.push(`${params.percent}%`);
      return parts.join(' ');
    },
    fontSize: labelCfg.fontSize ?? 10,
    ...(labelCfg.bold === true ? { fontWeight: 'bold' as const } : {}),
    ...(labelCfg.color ? { color: labelCfg.color } : {}),
    position: mapPieLabelPosition(labelCfg.position),
    ...dataLabelBoxProps(labelCfg),
  };
  return labelCfg.fontSize !== undefined ? markExplicitFontSize(label) : label;
}

function buildPieLabelLayout(
  layouts: Map<number, DataLabelManualLayout>,
): EChartsTypes.PieSeriesOption['labelLayout'] {
  if (layouts.size === 0) return undefined;
  const labelLayout = (params: {
    dataIndex?: number;
    rect?: { x: number; y: number; width: number; height: number };
  }) => {
    if (params.dataIndex === undefined) return undefined;
    const layout = layouts.get(params.dataIndex);
    if (!layout) return undefined;
    const rect = params.rect;
    const out: Record<string, number | string> = {};
    if (layout.x !== undefined) out.x = rect ? rect.x + rect.width * layout.x : numToPct(layout.x);
    if (layout.y !== undefined) out.y = rect ? rect.y + rect.height * layout.y : numToPct(layout.y);
    if (layout.width !== undefined) {
      out.width = rect ? rect.width * layout.width : numToPct(layout.width);
    }
    if (layout.height !== undefined) {
      out.height = rect ? rect.height * layout.height : numToPct(layout.height);
    }
    return out;
  };
  return labelLayout as EChartsTypes.PieSeriesOption['labelLayout'];
}

function uniquePieLegendCategories(seriesArr: SeriesData[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const series of seriesArr) {
    for (const category of series.categories) {
      if (seen.has(category)) continue;
      seen.add(category);
      out.push(category);
    }
  }
  return out;
}

function computeDoughnutRingRadius(
  baseRadius: [string, string] | string,
  ringIndex: number,
  ringCount: number,
): [string, string] | string {
  if (!Array.isArray(baseRadius) || ringCount <= 1) return baseRadius;
  const inner = Number.parseFloat(baseRadius[0]);
  const outer = Number.parseFloat(baseRadius[1]);
  if (!Number.isFinite(inner) || !Number.isFinite(outer) || outer <= inner) return baseRadius;
  const gap = 1;
  const band = (outer - inner - gap * (ringCount - 1)) / ringCount;
  const ringInner = Math.round(inner + ringIndex * (band + gap));
  const ringOuter = Math.round(ringInner + band);
  return [`${ringInner}%`, `${ringOuter}%`];
}

function buildBarChartOption(
  chartTypeNode: SafeXmlNode,
  chartNode: SafeXmlNode,
  seriesArr: SeriesData[],
  ctx: RenderContext,
): EChartsTypes.EChartsOption {
  const barDir = chartTypeNode.child('barDir').attr('val') || chartTypeNode.attr('barDir') || 'col';
  const grouping = chartGrouping(chartTypeNode);
  const isHorizontal = barDir === 'bar';

  // Layout parameters
  const gapWidth = chartTypeNode.child('gapWidth').numAttr('val') ?? 150;
  const overlap = chartTypeNode.child('overlap').numAttr('val');

  // Use categories from the first series that has them
  const categories = seriesArr.find((s) => s.categories.length > 0)?.categories || [];

  const titleOption = buildChartTitleOption(chartNode, seriesArr, ctx, 12);
  const legendInfo = extractLegendInfo(chartNode, ctx);
  const legendOpt = legendInfo?.option;
  const legendTextStyle = { fontSize: 10, ...(legendInfo?.textStyle ?? {}) };

  const isStacked = isStackedGrouping(grouping);
  const isPercentStacked = isPercentStackedGrouping(grouping);
  const percentStackedValues = isPercentStacked
    ? normalizePercentStackedValues(seriesArr)
    : undefined;
  const dispBlanksAs = getDispBlanksAs(chartNode);
  const varyColorsNode = chartTypeNode.child('varyColors');
  const defaultVaryColors =
    seriesArr.length === 1 &&
    seriesArr[0].values.length > 1 &&
    !isStacked &&
    !isPercentStacked &&
    !seriesArr[0].colorHex;
  const varyColors = varyColorsNode.exists()
    ? parseOoxmlBoolElement(varyColorsNode)
    : defaultVaryColors;
  const pointPalette = getVaryColorPointPalette(ctx, { darken: !isHorizontal });

  // Parse data labels: in OOXML they can be on chart type (barChart) or on series (ser); try both
  let sharedLabels = parseDataLabels(chartTypeNode, ctx);
  if (!sharedLabels) {
    const firstSer = chartTypeNode.children('ser')[0];
    if (firstSer?.exists()) sharedLabels = parseDataLabels(firstSer, ctx);
  }
  const serNodesByOrder = chartTypeNode
    .children('ser')
    .map((ser, i) => ({ ser, order: ser.child('order').numAttr('val') ?? i }))
    .sort((a, b) => a.order - b.order)
    .map((x) => x.ser);

  const series: EChartsTypes.BarSeriesOption[] = seriesArr.map((s, idx) => {
    // Capture formatCode for use in label formatter closure
    const fc = s.formatCode;
    const perSeriesLabels =
      parseDataLabels(serNodesByOrder[idx] ?? chartTypeNode, ctx) ?? sharedLabels;

    const buildLabel = (
      cfg: DataLabelConfig | Partial<DataLabelConfig> | undefined,
    ): EChartsTypes.BarSeriesOption['label'] => {
      if (!cfg?.showVal) return undefined;
      const label = {
        show: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        position: mapBarLabelPosition(cfg.position, isStacked) as any,
        fontSize: cfg.fontSize ?? 9,
        ...(cfg.color ? { color: cfg.color } : {}),
        ...(cfg.bold === true ? { fontWeight: 'bold' as const } : {}),
        ...dataLabelBoxProps(cfg),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          const rawVal = params?.value;
          const val =
            rawVal && typeof rawVal === 'object' && 'value' in rawVal ? rawVal.value : rawVal;
          if (val === 0 || val === null) return '';
          return formatValue(val, isPercentStacked ? '0%' : fc);
        },
      };
      return cfg.fontSize !== undefined ? markExplicitFontSize(label) : label;
    };

    // Per-series label config (override shared)
    const label: EChartsTypes.BarSeriesOption['label'] = buildLabel(perSeriesLabels);
    const dLblsNode = getDataLabelsNode(serNodesByOrder[idx], chartTypeNode);
    const pointOverrides = parsePointDataLabelOverrides(dLblsNode, ctx);
    const seriesValues = percentStackedValues?.[idx] ?? s.values;
    const data: EChartsTypes.BarSeriesOption['data'] = seriesValues.map((v, pointIdx) => {
      const ov = pointOverrides.get(pointIdx);
      const rawValue = s.values[pointIdx] ?? v;
      const displayValue = resolveBlankDisplayValue(s, pointIdx, v, dispBlanksAs);
      const pointStyle = s.dataPointStyles?.[pointIdx];
      let itemStyle: Record<string, unknown> | undefined;
      if (pointStyle) {
        itemStyle = {
          ...(pointStyle.color ? { color: pointStyle.color } : {}),
          ...(pointStyle.borderColor ? { borderColor: pointStyle.borderColor } : {}),
          ...(pointStyle.borderWidth !== undefined ? { borderWidth: pointStyle.borderWidth } : {}),
          ...(pointStyle.borderType ? { borderType: pointStyle.borderType } : {}),
        };
      } else if (s.invertIfNegative !== false && rawValue < 0) {
        itemStyle = { color: '#FFFFFF', borderColor: '#000000', borderWidth: 1 };
      } else if (varyColors && !s.colorHex && pointPalette.length > 0) {
        itemStyle = { color: pointPalette[pointIdx % pointPalette.length] };
      }

      let pointLabel: EChartsTypes.BarSeriesOption['label'];
      if (ov?.deleted) {
        pointLabel = { show: false };
      } else if (ov) {
        const merged: DataLabelConfig = {
          showVal: perSeriesLabels?.showVal ?? false,
          showCatName: perSeriesLabels?.showCatName ?? false,
          showSerName: perSeriesLabels?.showSerName ?? false,
          showPercent: perSeriesLabels?.showPercent ?? false,
          position: perSeriesLabels?.position,
          showLeaderLines: perSeriesLabels?.showLeaderLines,
          manualLayout: perSeriesLabels?.manualLayout,
          color: perSeriesLabels?.color,
          fontSize: perSeriesLabels?.fontSize,
          bold: perSeriesLabels?.bold,
          backgroundColor: perSeriesLabels?.backgroundColor,
          borderColor: perSeriesLabels?.borderColor,
          borderWidth: perSeriesLabels?.borderWidth,
          padding: perSeriesLabels?.padding,
          ...ov,
        };
        pointLabel = buildLabel(merged);
      }

      if (!itemStyle && !pointLabel) return displayValue;
      return {
        value: displayValue,
        ...(itemStyle ? { itemStyle } : {}),
        ...(pointLabel ? { label: pointLabel } : {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    });

    return {
      type: 'bar' as const,
      name: s.name,
      data,
      stack: isStacked ? 'total' : undefined,
      itemStyle: s.colorHex ? { color: s.colorHex } : undefined,
      label,
      ...(s.formatCode
        ? {
            tooltip: {
              valueFormatter: (value: unknown) =>
                formatValue(value as number, isPercentStacked ? '0%' : s.formatCode),
            },
          }
        : {}),
      barGap: overlap !== undefined ? `${-overlap}%` : '0%',
      // OOXML gapWidth = gap-between-groups / single-bar-width × 100.
      // For N clustered bars: categoryBand = N × barWidth + gap, gap = gapWidth/100 × barWidth.
      // ECharts barCategoryGap = gap / categoryBand = gapWidth / (100×N + gapWidth).
      // For stacked bars N=1 since all series share one bar slot.
      barCategoryGap:
        gapWidth !== undefined
          ? `${Math.round((gapWidth * 100) / (100 * (isStacked ? 1 : seriesArr.length) + gapWidth))}%`
          : undefined,
    };
  });

  const plotArea = chartNode.child('plotArea');
  const { valueAxis, categoryAxis } = parseAxes(plotArea, ctx, chartTypeNode);

  const categoryAxisDef: Record<string, unknown> = {
    type: 'category',
    data: categories,
    axisLabel: { interval: 0, rotate: 0, fontSize: 10 },
  };
  applyAxisInfo(categoryAxisDef, categoryAxis, 'category');

  // Use a series-derived axis/tooltip format only when all series share it.
  const sharedSeriesFormat = getSharedSeriesFormatCode(seriesArr);
  const pctFormat =
    (isPercentStacked ? '0%' : undefined) ||
    valueAxis.numFmt ||
    (sharedSeriesFormat?.includes('%') ? sharedSeriesFormat : undefined);
  const valueAxisDef: Record<string, unknown> = {
    type: 'value',
    ...(pctFormat
      ? {
          axisLabel: {
            formatter: (val: number) => formatValue(val, pctFormat),
          },
        }
      : {}),
  };
  if (isPercentStacked) forcePercentAxis(valueAxisDef);
  applyAxisInfo(valueAxisDef, valueAxis, 'value');

  const hasTitle = !!titleOption;
  const gridTop = isHorizontal && hasTitle ? 60 : getGridTopPx(hasTitle, legendInfo);
  const legendTopPx = getLegendTopPx(hasTitle, legendInfo);
  // When value axis is hidden, reduce left/right padding so bars use full width
  const gridLeft = isHorizontal ? 15 : valueAxis.deleted ? 4 : 18;
  const gridRight = isHorizontal ? 28 : 10;
  const tooltipFmt = pctFormat || sharedSeriesFormat;
  const gridBottom = getGridBottomPx(legendInfo);
  const manualGrid = extractManualLayoutGrid(chartNode);
  const containLabel = !hasManualGrid(manualGrid);

  return {
    title: titleOption,
    tooltip: {
      trigger: 'axis' as const,
      textStyle: legendTextStyle,
      extraCssText: tooltipExtraCss(legendTextStyle),
      ...(tooltipFmt
        ? {
            valueFormatter: (value: unknown) =>
              formatValue(
                Array.isArray(value) ? (value[0] as number) : (value as number),
                tooltipFmt,
              ),
          }
        : {}),
    },
    legend: buildLegendOption(
      legendOpt,
      legendInfo,
      legendTopPx,
      seriesArr.map((s) => s.name),
      legendTextStyle,
    ),
    grid: {
      containLabel,
      left: gridLeft,
      right: gridRight,
      top: gridTop,
      bottom: gridBottom,
      ...manualGrid,
    },
    xAxis: isHorizontal ? valueAxisDef : categoryAxisDef,
    yAxis: isHorizontal ? categoryAxisDef : valueAxisDef,
    series,
  } as EChartsTypes.EChartsOption;
}

function buildLineChartOption(
  chartTypeNode: SafeXmlNode,
  chartNode: SafeXmlNode,
  seriesArr: SeriesData[],
  ctx: RenderContext,
  isArea: boolean,
  chartPalette?: string[],
): EChartsTypes.EChartsOption {
  const categories = seriesArr.find((s) => s.categories.length > 0)?.categories || [];
  const titleOption = buildChartTitleOption(chartNode, seriesArr, ctx, 14);
  const legendInfo = extractLegendInfo(chartNode, ctx);
  const legendOpt = legendInfo?.option;
  const legendTextStyle = { fontSize: 10, ...(legendInfo?.textStyle ?? {}) };
  const grouping = chartGrouping(chartTypeNode, 'standard');
  const isStacked = isStackedGrouping(grouping);
  const isPercentStacked = isPercentStackedGrouping(grouping);
  const percentStackedValues = isPercentStacked
    ? normalizePercentStackedValues(seriesArr)
    : undefined;
  const dispBlanksAs = getDispBlanksAs(chartNode);
  let sharedLabels = parseDataLabels(chartTypeNode, ctx);
  if (!sharedLabels) {
    const firstSer = chartTypeNode.children('ser')[0];
    if (firstSer?.exists()) sharedLabels = parseDataLabels(firstSer, ctx);
  }
  const serNodesByOrder = chartTypeNode
    .children('ser')
    .map((ser, i) => ({ ser, order: ser.child('order').numAttr('val') ?? i }))
    .sort((a, b) => a.order - b.order)
    .map((x) => x.ser);
  const chartMarkerNode = chartTypeNode.child('marker');
  const chartMarker = chartMarkerNode.exists() ? parseOoxmlBoolElement(chartMarkerNode) : undefined;
  const seriesColor = (s: SeriesData, idx: number): string | object | undefined =>
    s.colorHex ?? chartPalette?.[idx % chartPalette.length];
  const legendColor = (s: SeriesData, idx: number): string | undefined => {
    const color = seriesColor(s, idx);
    return typeof color === 'string' ? color : undefined;
  };

  const series: EChartsTypes.LineSeriesOption[] = seriesArr.map((s, idx) => {
    const color = seriesColor(s, idx);
    const markerSymbol =
      s.markerSymbol ??
      (chartMarker === true
        ? defaultLineMarkerSymbol(idx)
        : chartMarker === false
          ? 'none'
          : undefined);
    const echartsSymbol = mapOoxmlSymbol(markerSymbol);
    const showSymbol = echartsSymbol !== undefined ? echartsSymbol !== 'none' : undefined;
    const lineWidth = s.lineWidth ?? 3;
    const lineStyle = {
      ...(color ? { color } : {}),
      width: lineWidth,
      cap: 'round' as const,
      join: 'round' as const,
      ...(s.lineNoFill ? { opacity: 0 } : {}),
    };
    const fc = s.formatCode;
    const perSeriesLabels =
      parseDataLabels(serNodesByOrder[idx] ?? chartTypeNode, ctx) ?? sharedLabels;
    const buildLineLabel = (
      cfg: DataLabelConfig | Partial<DataLabelConfig> | undefined,
    ): EChartsTypes.LineSeriesOption['label'] => {
      if (!cfg || !dataLabelShowsContent(cfg as DataLabelConfig)) return undefined;
      const labelCfg = cfg as DataLabelConfig;
      const lineLabel = {
        show: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        position: mapLineLabelPosition(labelCfg.position) as any,
        fontSize: labelCfg.fontSize ?? 9,
        ...(labelCfg.color ? { color: labelCfg.color } : {}),
        ...(labelCfg.bold === true ? { fontWeight: 'bold' as const } : {}),
        ...dataLabelBoxProps(labelCfg),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          const rawVal = params?.value;
          const val =
            rawVal && typeof rawVal === 'object' && 'value' in rawVal ? rawVal.value : rawVal;
          const parts: string[] = [];
          if (labelCfg.showSerName && params?.seriesName) parts.push(params.seriesName);
          if (labelCfg.showCatName && params?.name) parts.push(params.name);
          if (labelCfg.showVal && typeof val === 'number') {
            parts.push(formatValue(val, isPercentStacked ? '0%' : fc));
          }
          if (labelCfg.showPercent && typeof params?.percent === 'number') {
            parts.push(`${params.percent}%`);
          }
          return parts.join(' ');
        },
      };
      return labelCfg.fontSize !== undefined ? markExplicitFontSize(lineLabel) : lineLabel;
    };
    const label = buildLineLabel(perSeriesLabels);
    const dLblsNode = getDataLabelsNode(serNodesByOrder[idx], chartTypeNode);
    const pointOverrides = parsePointDataLabelOverrides(dLblsNode, ctx);
    const manualLayouts = new Map<number, DataLabelManualLayout>();
    const seriesValues = percentStackedValues?.[idx] ?? s.values;
    const data: EChartsTypes.LineSeriesOption['data'] = seriesValues.map((v, pointIdx) => {
      const displayValue = resolveBlankDisplayValue(s, pointIdx, v, dispBlanksAs);
      const ov = pointOverrides.get(pointIdx);
      if (!ov) return displayValue;
      if (ov.manualLayout) manualLayouts.set(pointIdx, ov.manualLayout);
      const pointLabel = ov.deleted
        ? ({ show: false } as EChartsTypes.LineSeriesOption['label'])
        : buildLineLabel(mergeDataLabelConfig(perSeriesLabels, ov));
      if (!pointLabel) return displayValue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { value: displayValue, label: pointLabel } as any;
    });
    const forceSymbolForLabel = Boolean(label?.show && echartsSymbol === 'none');
    const symbol = forceSymbolForLabel
      ? 'circle'
      : echartsSymbol && echartsSymbol !== 'none'
        ? echartsSymbol
        : undefined;
    const symbolSize = forceSymbolForLabel
      ? 0
      : (s.markerSize ??
        (s.markerSymbol === undefined && chartMarker === true
          ? DEFAULT_LINE_MARKER_SIZE
          : undefined));
    const resolvedShowSymbol = forceSymbolForLabel
      ? true
      : isArea && echartsSymbol === undefined
        ? false
        : showSymbol;
    const showAllSymbol =
      resolvedShowSymbol === true && symbol !== undefined && symbol !== 'none' && symbolSize !== 0;
    return {
      type: 'line' as const,
      name: s.name,
      data,
      stack: isStacked ? 'total' : undefined,
      areaStyle: isArea ? { ...(color ? { color } : {}), opacity: 1 } : undefined,
      itemStyle: color ? { color } : undefined,
      lineStyle,
      label,
      labelLayout: buildPieLabelLayout(
        manualLayouts,
      ) as EChartsTypes.LineSeriesOption['labelLayout'],
      connectNulls: dispBlanksAs === 'span',
      ...(s.smooth ? { smooth: true } : {}),
      ...(s.formatCode
        ? {
            tooltip: {
              valueFormatter: (value: unknown) =>
                formatValue(value as number, isPercentStacked ? '0%' : s.formatCode),
            },
          }
        : {}),
      endLabel: { show: false },
      ...(symbol ? { symbol } : {}),
      ...(symbolSize !== undefined ? { symbolSize } : {}),
      ...(resolvedShowSymbol !== undefined ? { showSymbol: resolvedShowSymbol } : {}),
      ...(showAllSymbol ? { showAllSymbol: true } : {}),
      z: 3,
    };
  });

  const plotArea = chartNode.child('plotArea');
  const { valueAxis, categoryAxis } = parseAxes(plotArea, ctx, chartTypeNode);

  const sharedSeriesFormat = getSharedSeriesFormatCode(seriesArr);
  const pctFormat =
    (isPercentStacked ? '0%' : undefined) ||
    valueAxis.numFmt ||
    (sharedSeriesFormat?.includes('%') ? sharedSeriesFormat : undefined);
  const yAxisDef: Record<string, unknown> = {
    type: 'value',
    ...(pctFormat
      ? {
          axisLabel: {
            formatter: (val: number) => formatValue(val, pctFormat),
          },
        }
      : {}),
  };
  if (isPercentStacked) forcePercentAxis(yAxisDef);
  applyAxisInfo(yAxisDef, valueAxis, 'value');
  if (!isPercentStacked && isArea) {
    applyAreaAxisRange(yAxisDef, seriesArr, isStacked);
  }

  const xAxisDef: Record<string, unknown> = {
    type: 'category',
    data: categories,
    ...(isArea ? { boundaryGap: false } : {}),
    axisLabel: { interval: 0, rotate: 0 },
  };
  applyAxisInfo(xAxisDef, categoryAxis, 'category');

  const gridTop = getGridTopPx(!!titleOption, legendInfo);
  const legendTopPx = getLegendTopPx(!!titleOption, legendInfo);
  const gridLeft = valueAxis.deleted ? 4 : 18;
  const tooltipFmt = pctFormat || sharedSeriesFormat;
  const gridBottom = getGridBottomPx(legendInfo);
  const manualGrid = extractManualLayoutGrid(chartNode);
  const containLabel = !hasManualGrid(manualGrid);
  const legendEntries = seriesArr.map((s, idx) => ({ series: s, idx }));
  const legendOrder = isStacked || isPercentStacked ? [...legendEntries].reverse() : legendEntries;
  return {
    title: titleOption,
    tooltip: {
      trigger: 'axis' as const,
      textStyle: legendTextStyle,
      extraCssText: tooltipExtraCss(legendTextStyle),
      ...(tooltipFmt
        ? {
            valueFormatter: (value: unknown) =>
              formatValue(
                Array.isArray(value) ? (value[0] as number) : (value as number),
                tooltipFmt,
              ),
          }
        : {}),
    },
    legend: buildLegendOption(
      legendOpt,
      legendInfo,
      legendTopPx,
      isArea
        ? legendOrder.map(({ series, idx }) => {
            const color = legendColor(series, idx);
            return color ? { name: series.name, itemStyle: { color } } : series.name;
          })
        : legendOrder.map(({ series, idx }) => {
            const markerSymbol =
              series.markerSymbol ??
              (chartMarker === true
                ? defaultLineMarkerSymbol(idx)
                : chartMarker === false
                  ? 'none'
                  : undefined);
            const marker = mapOoxmlSymbol(markerSymbol);
            const color = legendColor(series, idx);
            const style = color ? { lineStyle: { color }, itemStyle: { color } } : {};
            return marker && marker !== 'none'
              ? { name: series.name, icon: lineLegendIconPath(), marker, ...style }
              : { name: series.name, icon: lineLegendIconPath(), ...style };
          }),
      legendTextStyle,
    ),
    grid: {
      containLabel,
      left: gridLeft,
      right: 10,
      top: gridTop,
      bottom: gridBottom,
      ...manualGrid,
    },
    xAxis: xAxisDef,
    yAxis: yAxisDef,
    series,
  };
}

function buildPieChartOption(
  chartTypeNode: SafeXmlNode,
  chartNode: SafeXmlNode,
  seriesArr: SeriesData[],
  isDoughnut: boolean,
  ctx: RenderContext,
): EChartsTypes.EChartsOption {
  const titleOption = buildChartTitleOption(chartNode, seriesArr, ctx, 12);
  const legendInfo = extractLegendInfo(chartNode, ctx);
  const legendOpt = legendInfo?.option;
  const legendTextStyle = { fontSize: 10, ...(legendInfo?.textStyle ?? {}) };

  const renderSeriesArr = isDoughnut ? seriesArr : seriesArr.slice(0, 1);
  if (renderSeriesArr.length === 0) {
    return { title: titleOption };
  }

  const serNodesByOrder = chartTypeNode
    .children('ser')
    .map((ser, i) => ({ ser, order: ser.child('order').numAttr('val') ?? i }))
    .sort((a, b) => a.order - b.order)
    .map((x) => x.ser);

  const seriesLabelMeta = renderSeriesArr.map((series, idx) => {
    const serNode = serNodesByOrder[idx];
    const sharedLabels =
      (serNode?.exists() ? parseDataLabels(serNode, ctx) : undefined) ??
      parseDataLabels(chartTypeNode, ctx);
    const dLblsNode = getDataLabelsNode(serNode, chartTypeNode);
    const hasDLblsNode =
      (serNode?.exists() && serNode.child('dLbls').exists()) ||
      chartTypeNode.child('dLbls').exists();
    const pointOverrides = parsePointDataLabelOverrides(dLblsNode, ctx);
    const hasPointLabelContent = [...pointOverrides.values()].some((override) =>
      dataLabelShowsContent(mergeDataLabelConfig(sharedLabels, override)),
    );
    return {
      series,
      serNode,
      sharedLabels,
      pointOverrides,
      labelsExplicitlyOff: hasDLblsNode && !sharedLabels && !hasPointLabelContent,
      explosions: serNode ? parseExplosion(serNode, series.categories.length) : undefined,
    };
  });

  const showLabel = seriesLabelMeta.some(
    (meta) =>
      !meta.labelsExplicitlyOff &&
      (dataLabelShowsContent(meta.sharedLabels) ||
        [...meta.pointOverrides.values()].some((override) =>
          dataLabelShowsContent(mergeDataLabelConfig(meta.sharedLabels, override)),
        )),
  );
  const holeSizePct = isDoughnut ? (chartTypeNode.child('holeSize').numAttr('val') ?? 50) : 50;
  const hasExplosion = seriesLabelMeta.some((meta) =>
    meta.explosions?.some((explosion) => explosion > 0),
  );
  const pieLayout = computePieLayout(legendInfo, isDoughnut, showLabel, holeSizePct, hasExplosion);
  const startAngle = mapFirstSliceAngle(chartTypeNode.child('firstSliceAng').numAttr('val'));

  const series: EChartsTypes.PieSeriesOption[] = seriesLabelMeta.map((meta, idx) => {
    const manualLayouts = new Map<number, DataLabelManualLayout>();
    const pieData = meta.series.categories.map((cat, i) => {
      const override = meta.pointOverrides.get(i);
      const pointLabel = mergeDataLabelConfig(meta.sharedLabels, override);
      if (pointLabel?.manualLayout) manualLayouts.set(i, pointLabel.manualLayout);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const item: any = {
        name: cat || `Item ${i + 1}`,
        value: meta.series.values[i] ?? 0,
      };
      const pointStyle = meta.series.dataPointStyles?.[i];
      if (pointStyle) {
        item.itemStyle = {
          ...(pointStyle.color ? { color: pointStyle.color } : {}),
          ...(pointStyle.borderColor ? { borderColor: pointStyle.borderColor } : {}),
          ...(pointStyle.borderWidth !== undefined ? { borderWidth: pointStyle.borderWidth } : {}),
          ...(pointStyle.borderType ? { borderType: pointStyle.borderType } : {}),
        };
      } else if (meta.series.dataPointColors?.[i]) {
        item.itemStyle = { color: meta.series.dataPointColors[i] };
      }
      if (meta.explosions?.[i] && meta.explosions[i] > 0) {
        item.selected = true;
        item.selectedOffset = pieExplosionToOffset(meta.explosions[i], isDoughnut);
      }
      if (override?.deleted) {
        item.label = { show: false };
      } else if (override && dataLabelShowsContent(pointLabel)) {
        item.label = buildPieLabelOption(pointLabel, meta.series.formatCode, meta.series.name);
      }
      return item;
    });

    const label = buildPieLabelOption(meta.sharedLabels, meta.series.formatCode, meta.series.name);
    const hasLeaderLines =
      Boolean(meta.sharedLabels?.showLeaderLines) ||
      [...meta.pointOverrides.values()].some((cfg) => cfg.showLeaderLines === true);
    const selectedOffset =
      meta.explosions &&
      Math.max(...meta.explosions.map((exp) => pieExplosionToOffset(exp, isDoughnut)));

    return {
      type: 'pie' as const,
      name: meta.series.name,
      radius: isDoughnut
        ? computeDoughnutRingRadius(pieLayout.radius, idx, seriesLabelMeta.length)
        : pieLayout.radius,
      center: pieLayout.center,
      data: pieData,
      selectedMode: meta.explosions ? 'multiple' : false,
      ...(selectedOffset ? { selectedOffset } : {}),
      ...(startAngle !== undefined ? { startAngle, clockwise: true } : {}),
      label: label ?? { show: false },
      labelLine: { show: hasLeaderLines },
      labelLayout: buildPieLabelLayout(manualLayouts),
    };
  });

  const legendTopPx = getLegendTopPx(!!titleOption, legendInfo);
  const tooltipFmt = getSharedSeriesFormatCode(renderSeriesArr);
  const legendData = isDoughnut
    ? uniquePieLegendCategories(renderSeriesArr)
    : renderSeriesArr[0].categories;
  return {
    title: titleOption,
    tooltip: {
      trigger: 'item' as const,
      ...(tooltipFmt
        ? {
            valueFormatter: (value: unknown) =>
              formatValue(
                Array.isArray(value) ? (value[0] as number) : (value as number),
                tooltipFmt,
              ),
          }
        : {}),
    },
    legend: buildLegendOption(legendOpt, legendInfo, legendTopPx, legendData, legendTextStyle),
    series,
  };
}

function buildRadarChartOption(
  chartTypeNode: SafeXmlNode,
  chartNode: SafeXmlNode,
  seriesArr: SeriesData[],
  ctx: RenderContext,
  chartPalette?: string[],
  chartSize?: ChartPixelSize,
): EChartsTypes.EChartsOption {
  const titleOption = buildChartTitleOption(chartNode, seriesArr, ctx, 12);
  const legendInfo = extractLegendInfo(chartNode, ctx);
  const legendOpt = legendInfo?.option;
  const legendTextStyle = { fontSize: 10, ...(legendInfo?.textStyle ?? {}) };

  // Categories come from the first series that has them
  const categories = seriesArr.find((s) => s.categories.length > 0)?.categories || [];

  // Read valAx scaling for explicit min/max on radar
  const plotArea = chartNode.child('plotArea');
  const { valueAxis } = parseAxes(plotArea, ctx);

  // Determine indicator max: prefer explicit valAx max, else compute from data + padding
  let indicatorMax: number;
  if (valueAxis.max !== undefined) {
    indicatorMax = valueAxis.max;
  } else {
    let maxVal = 0;
    let minVal = 0;
    for (const s of seriesArr) {
      for (const v of s.values) {
        if (v > maxVal) maxVal = v;
        if (v < minVal) minVal = v;
      }
    }
    const interval = niceAxisInterval(maxVal, minVal, 5);
    indicatorMax = Math.ceil(maxVal / interval) * interval || 100;
  }

  const showValueAxisLabels = !valueAxis.deleted && valueAxis.tickLblPos !== 'none';
  const radarStyle = chartTypeNode.child('radarStyle').attr('val'); // 'marker' | 'filled' | undefined
  const valueAxisLabel = showValueAxisLabels
    ? {
        show: true,
        formatter: (val: number) => formatValue(val, valueAxis.numFmt),
        color: valueAxis.labelColor ?? '#000000',
        ...(valueAxis.labelFontSize !== undefined ? { fontSize: valueAxis.labelFontSize } : {}),
      }
    : undefined;
  // Read radar style to determine default marker/grid behavior
  const filledRadarLayering =
    radarStyle === 'filled' ? { radarZ: 4, seriesZ: 2 } : { radarZ: undefined, seriesZ: undefined };
  const valueAxisId = chartTypeNode.children('axId')[1]?.attr('val');
  const radarValueAxisNode =
    plotArea.children('valAx').find((axis) => axis.child('axId').attr('val') === valueAxisId) ??
    plotArea.child('valAx');
  const hasExplicitRadarSplitLineStyle = radarValueAxisNode
    .child('majorGridlines')
    .child('spPr')
    .exists();
  const hasExplicitRadarAxisLineStyle = radarValueAxisNode.child('spPr').child('ln').exists();
  const showRadarSplitLine =
    valueAxis.hasMajorGridlines && (radarStyle !== 'filled' || hasExplicitRadarSplitLineStyle);
  const radarSplitLine = showRadarSplitLine
    ? {
        show: true,
        lineStyle: {
          ...DEFAULT_RADAR_GRIDLINE_STYLE,
          ...(hasExplicitRadarSplitLineStyle ? (valueAxis.majorGridlineStyle ?? {}) : {}),
        },
      }
    : { show: false };
  const radarAxisLine = valueAxis.deleted
    ? { show: false }
    : {
        show: true,
        lineStyle: {
          color: hasExplicitRadarAxisLineStyle
            ? (valueAxis.lineColor ?? DEFAULT_RADAR_GRIDLINE_STYLE.color)
            : DEFAULT_RADAR_GRIDLINE_STYLE.color,
        },
      };

  // PowerPoint radar charts place categories clockwise from top,
  // but ECharts places indicators counterclockwise. To match PowerPoint,
  // keep the first category at top and reverse the rest.
  const cwCategories =
    categories.length > 1 ? [categories[0], ...categories.slice(1).reverse()] : categories;

  const indicator = cwCategories.map((cat, index) => ({
    name: cat,
    max: indicatorMax,
    ...(valueAxis.min !== undefined ? { min: valueAxis.min } : {}),
    ...(index === 0 && valueAxisLabel ? { axisLabel: valueAxisLabel } : {}),
  }));

  const radarHasTopLegend = legendIsAtTop(legendInfo) && !legendInfo?.overlay;
  const manualRadarLayout = extractManualLayoutRadar(chartNode, chartSize);
  const radarCenter: [number | string, number | string] =
    manualRadarLayout?.center ??
    (radarHasTopLegend
      ? ['50%', '66%']
      : radarStyle === 'filled'
        ? ['50%', '55%']
        : ['50%', '50%']);
  const radarRadius =
    manualRadarLayout?.radius ??
    (radarHasTopLegend ? '58%' : radarStyle === 'filled' ? '76%' : '86%');

  const radarData = seriesArr.map((s, idx) => {
    // Reorder values to match the reversed category order
    const cwValues = s.values.length > 1 ? [s.values[0], ...s.values.slice(1).reverse()] : s.values;
    const echartsSymbol = mapOoxmlSymbol(s.markerSymbol);
    // Show symbols if radarStyle is 'marker' or series has explicit marker
    const showSymbol =
      radarStyle === 'marker' || (echartsSymbol !== undefined && echartsSymbol !== 'none');
    // PowerPoint radar charts fill the area with a semi-transparent version of the line color
    const isFilled = radarStyle === 'filled';
    const color = s.colorHex ?? chartPalette?.[idx % chartPalette.length];
    const areaColor = typeof color === 'string' ? buildFilledRadarAreaColor(color) : color;
    const areaStyle = isFilled
      ? { ...(areaColor ? { color: areaColor } : {}), opacity: 0.75 }
      : undefined;
    return {
      name: s.name,
      value: cwValues,
      ...(color
        ? {
            lineStyle: {
              color,
              width: s.lineWidth ?? 3,
              cap: 'round' as const,
              join: 'round' as const,
              ...(s.lineNoFill ? { opacity: 0 } : {}),
            },
            itemStyle: { color },
          }
        : {
            lineStyle: {
              width: s.lineWidth ?? 3,
              cap: 'round' as const,
              join: 'round' as const,
              ...(s.lineNoFill ? { opacity: 0 } : {}),
            },
          }),
      ...(areaStyle ? { areaStyle } : {}),
      ...(echartsSymbol && echartsSymbol !== 'none' ? { symbol: echartsSymbol } : {}),
      ...(!showSymbol ? { symbol: 'none' as const } : {}),
      ...(s.markerSize ? { symbolSize: s.markerSize } : {}),
      ...(showSymbol ? { symbolSize: s.markerSize ?? 6 } : {}),
    };
  });

  const legendTopPx = getLegendTopPx(!!titleOption, legendInfo);
  return {
    title: titleOption,
    tooltip: {},
    legend: buildLegendOption(
      legendOpt,
      legendInfo,
      legendTopPx,
      seriesArr.map((s) => {
        const marker = mapOoxmlSymbol(s.markerSymbol);
        if (s.lineNoFill && marker && marker !== 'none') {
          return { name: s.name, icon: marker };
        }
        return {
          name: s.name,
          icon: lineLegendIconPath(),
          ...(marker && marker !== 'none' ? { marker } : {}),
        };
      }),
      legendTextStyle,
    ),
    radar: {
      ...(filledRadarLayering.radarZ !== undefined ? { z: filledRadarLayering.radarZ } : {}),
      indicator,
      radius: radarRadius,
      center: radarCenter,
      splitNumber: 5,
      splitLine: radarSplitLine,
      axisLine: radarAxisLine,
      splitArea: { show: false },
    },
    series: [
      {
        type: 'radar' as const,
        ...(filledRadarLayering.seriesZ !== undefined ? { z: filledRadarLayering.seriesZ } : {}),
        data: radarData,
      },
    ],
  };
}

function buildScatterChartOption(
  chartTypeNode: SafeXmlNode,
  chartNode: SafeXmlNode,
  seriesArr: SeriesData[],
  ctx: RenderContext,
): EChartsTypes.EChartsOption {
  const titleOption = buildChartTitleOption(chartNode, seriesArr, ctx, 14);
  const legendInfo = extractLegendInfo(chartNode, ctx);
  const legendOpt = legendInfo?.option;
  const legendTextStyle = { fontSize: 10, ...(legendInfo?.textStyle ?? {}) };

  // Parse scatter-specific marker defaults from scatterStyle
  const scatterStyle = chartTypeNode.child('scatterStyle').attr('val') ?? 'lineMarker';
  const scatterStyleDrawsLine =
    scatterStyle === 'lineMarker' ||
    scatterStyle === 'line' ||
    scatterStyle === 'smoothMarker' ||
    scatterStyle === 'smooth';
  const scatterStyleIsSmooth = scatterStyle === 'smoothMarker' || scatterStyle === 'smooth';
  const scatterStyleHidesMarkers = scatterStyle === 'line' || scatterStyle === 'smooth';

  const series = seriesArr.map((s, idx) => {
    // Use xValues if available (parsed from c:xVal), otherwise fall back to index
    const data = s.values.map((v, i) => {
      const x = s.xValues && i < s.xValues.length ? s.xValues[i] : i;
      return [x, v];
    });
    const echartsSymbol = mapOoxmlSymbol(s.markerSymbol) ?? defaultScatterSymbol(scatterStyle, idx);
    const showSymbol = !scatterStyleHidesMarkers && echartsSymbol !== 'none';
    const renderAsLine = (scatterStyleDrawsLine || s.smooth) && !s.lineNoFill;
    if (renderAsLine) {
      const shouldInterpolate = s.smooth ?? scatterStyleIsSmooth;
      const lineData = shouldInterpolate ? buildSmoothScatterLineData(data) : data;
      const lineWidth = s.lineWidth ?? 3;
      return {
        type: 'line' as const,
        name: s.name,
        data: lineData,
        smooth: false,
        showSymbol,
        ...(showSymbol
          ? { symbol: echartsSymbol, symbolSize: s.markerSize ?? DEFAULT_SCATTER_MARKER_SIZE }
          : {}),
        ...(s.colorHex
          ? {
              lineStyle: {
                color: s.colorHex,
                width: lineWidth,
                cap: 'round' as const,
                join: 'round' as const,
              },
              itemStyle: { color: s.colorHex },
            }
          : { lineStyle: { width: lineWidth, cap: 'round' as const, join: 'round' as const } }),
      };
    }
    return {
      type: 'scatter' as const,
      name: s.name,
      data,
      symbol: showSymbol ? echartsSymbol : 'none',
      symbolSize: showSymbol ? (s.markerSize ?? DEFAULT_SCATTER_MARKER_SIZE) : 0,
      itemStyle: s.colorHex ? { color: s.colorHex } : undefined,
    };
  });
  const legendData = seriesArr.map((s, idx) => {
    const echartsSymbol = mapOoxmlSymbol(s.markerSymbol) ?? defaultScatterSymbol(scatterStyle, idx);
    const showSymbol = !scatterStyleHidesMarkers && echartsSymbol !== 'none';
    const renderAsLine = (scatterStyleDrawsLine || s.smooth) && !s.lineNoFill;
    if (renderAsLine) {
      return showSymbol && echartsSymbol
        ? { name: s.name, icon: echartsSymbol }
        : { name: s.name, icon: lineLegendIconPath() };
    }
    return echartsSymbol && echartsSymbol !== 'none'
      ? { name: s.name, icon: echartsSymbol }
      : s.name;
  });

  const plotArea = chartNode.child('plotArea');
  const { xAxis: xAxisInfo, yAxis: yAxisInfo } = parseScatterAxes(plotArea, ctx);

  const gridTop = getGridTopPx(!!titleOption, legendInfo);
  const legendTopPx = getLegendTopPx(!!titleOption, legendInfo);
  const manualGrid = extractManualLayoutGrid(chartNode);
  const containLabel = !hasManualGrid(manualGrid);
  const scatterGridLeft = yAxisInfo.deleted ? 4 : 18;
  const scatterGridTop = gridTop;
  const scatterGridBottom = Math.max(getGridBottomPx(legendInfo), 20);

  const xAxisDef: Record<string, unknown> = { type: 'value' };
  const yAxisDef: Record<string, unknown> = { type: 'value' };
  applyAxisInfo(xAxisDef, xAxisInfo, 'value');
  applyAxisInfo(yAxisDef, yAxisInfo, 'value');

  return {
    title: titleOption,
    tooltip: { trigger: 'item' },
    legend: buildLegendOption(legendOpt, legendInfo, legendTopPx, legendData, legendTextStyle),
    grid: {
      containLabel,
      left: scatterGridLeft,
      right: 10,
      top: scatterGridTop,
      bottom: scatterGridBottom,
      ...manualGrid,
    },
    xAxis: xAxisDef,
    yAxis: yAxisDef,
    series,
  };
}

// ---------------------------------------------------------------------------
// Bubble Chart
// ---------------------------------------------------------------------------

function applyBubbleAxisHeadroom(
  axisDef: Record<string, unknown>,
  values: number[],
  bubbleSizes: number[],
): void {
  if (axisDef.max !== undefined || values.length === 0) return;

  const finitePairs = values
    .map((value, index) => ({ value, bubbleSize: bubbleSizes[index] ?? 0 }))
    .filter(({ value }) => Number.isFinite(value));
  if (finitePairs.length === 0) return;

  const dataMin = Math.min(...finitePairs.map(({ value }) => value));
  const dataMax = Math.max(...finitePairs.map(({ value }) => value));
  const spanFromZero = dataMax - Math.min(0, dataMin);
  const desiredTicks = spanFromZero <= 3 ? 3 : 8;
  const interval = niceAxisInterval(dataMax, dataMin, desiredTicks);
  let max = niceAxisMax(dataMax, dataMin, desiredTicks);
  if (max > dataMax && max - dataMax < interval * 0.25) {
    max += interval;
  }

  const maxBubbleSize = Math.max(...finitePairs.map(({ bubbleSize }) => bubbleSize));
  const highEdgeBubbleSize = Math.max(
    ...finitePairs
      .filter(({ value }) => Math.abs(value - dataMax) < 1e-9)
      .map(({ bubbleSize }) => bubbleSize),
    0,
  );
  if (maxBubbleSize > 0 && highEdgeBubbleSize / maxBubbleSize >= 0.75) {
    max += interval;
  }

  axisDef.max = max;
  if (axisDef.min === undefined && dataMin >= 0) {
    axisDef.min = 0;
  }
  if (axisDef.interval === undefined) {
    axisDef.interval = interval;
  }
}

function buildBubbleChartOption(
  chartTypeNode: SafeXmlNode,
  chartNode: SafeXmlNode,
  seriesArr: SeriesData[],
  ctx: RenderContext,
): EChartsTypes.EChartsOption {
  const titleOption = buildChartTitleOption(chartNode, seriesArr, ctx, 14);
  const legendInfo = extractLegendInfo(chartNode, ctx);
  const legendOpt = legendInfo?.option;
  const legendTextStyle = { fontSize: 10, ...(legendInfo?.textStyle ?? {}) };
  const bubbleScale = Math.max(chartTypeNode.child('bubbleScale').numAttr('val') ?? 100, 0);
  const maxBubbleDiameter = DEFAULT_BUBBLE_MAX_DIAMETER * (bubbleScale / 100);

  // Bubble charts scale bubble area by value. In screen space that means diameter
  // should follow sqrt(value / maxValue), not a linear min-max interpolation.
  let maxSize = -Infinity;
  for (const s of seriesArr) {
    if (s.bubbleSizes) {
      for (const sz of s.bubbleSizes) {
        if (sz > maxSize) maxSize = sz;
      }
    }
  }
  const safeMaxBubbleSize = maxSize > 0 ? maxSize : 1;

  const series: EChartsTypes.ScatterSeriesOption[] = seriesArr.map((s) => {
    const data = s.values.map((v, i) => {
      const x = s.xValues && i < s.xValues.length ? s.xValues[i] : i;
      const bub = s.bubbleSizes && i < s.bubbleSizes.length ? s.bubbleSizes[i] : 0;
      return [x, v, bub];
    });
    return {
      type: 'scatter' as const,
      name: s.name,
      data,
      symbolSize: (val: number[]) => {
        const bubbleValue = Math.max(Number(val[2]) || 0, 0);
        return Math.sqrt(bubbleValue / safeMaxBubbleSize) * maxBubbleDiameter;
      },
      itemStyle: s.colorHex ? { color: s.colorHex } : undefined,
    };
  });

  const plotArea = chartNode.child('plotArea');
  const { xAxis: xAxisInfo, yAxis: yAxisInfo } = parseScatterAxes(plotArea, ctx);

  const gridTop = getGridTopPx(!!titleOption, legendInfo);
  const legendTopPx = getLegendTopPx(!!titleOption, legendInfo);
  const manualGrid = extractManualLayoutGrid(chartNode);
  const containLabel = !hasManualGrid(manualGrid);
  const scatterGridLeft = yAxisInfo.deleted ? 4 : 18;
  const scatterGridTop = gridTop;
  const scatterGridBottom = Math.max(getGridBottomPx(legendInfo), 20);

  const xAxisDef: Record<string, unknown> = { type: 'value' };
  const yAxisDef: Record<string, unknown> = { type: 'value' };
  applyAxisInfo(xAxisDef, xAxisInfo, 'value');
  applyAxisInfo(yAxisDef, yAxisInfo, 'value');
  const bubblePoints = seriesArr.flatMap((s) =>
    s.values.map((y, i) => ({
      x: s.xValues && i < s.xValues.length ? s.xValues[i] : i,
      y,
      bubbleSize: s.bubbleSizes && i < s.bubbleSizes.length ? s.bubbleSizes[i] : 0,
    })),
  );
  applyBubbleAxisHeadroom(
    xAxisDef,
    bubblePoints.map((point) => point.x),
    bubblePoints.map((point) => point.bubbleSize),
  );
  applyBubbleAxisHeadroom(
    yAxisDef,
    bubblePoints.map((point) => point.y),
    bubblePoints.map((point) => point.bubbleSize),
  );

  return {
    title: titleOption,
    tooltip: {
      trigger: 'item',
      formatter: (params: unknown) => {
        const p = params as { seriesName: string; value: number[] };
        return `${p.seriesName}<br/>x: ${p.value[0]}, y: ${p.value[1]}, size: ${p.value[2]}`;
      },
    },
    legend: buildLegendOption(
      legendOpt,
      legendInfo,
      legendTopPx,
      seriesArr.map((s) => ({ name: s.name, icon: 'circle' })),
      legendTextStyle,
    ),
    grid: {
      containLabel,
      left: scatterGridLeft,
      right: 10,
      top: scatterGridTop,
      bottom: scatterGridBottom,
      ...manualGrid,
    },
    xAxis: xAxisDef,
    yAxis: yAxisDef,
    series,
  };
}

// ---------------------------------------------------------------------------
// Stock Chart (Candlestick)
// ---------------------------------------------------------------------------

function looksLikeDateCategory(label: string): boolean {
  return /^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(label.trim());
}

function stockMarkerSymbolToLegendIcon(symbol: string | undefined): string {
  switch (symbol) {
    case 'dot':
    case 'circle':
      return 'circle';
    case 'square':
      return 'rect';
    case 'diamond':
    case 'triangle':
      return symbol;
    case 'none':
    case undefined:
      return 'none';
    default:
      return 'circle';
  }
}

function buildStockChartOption(
  chartTypeNode: SafeXmlNode,
  chartNode: SafeXmlNode,
  seriesArr: SeriesData[],
  ctx: RenderContext,
): EChartsTypes.EChartsOption {
  const titleOption = buildChartTitleOption(chartNode, seriesArr, ctx, 14);
  const legendInfo = extractLegendInfo(chartNode, ctx);

  // Stock charts have 3 (HLC) or 4 (OHLC) series:
  // OHLC order: open, high, low, close
  // HLC order: high, low, close (open defaults to close → collapsed body)
  const categories = seriesArr.find((s) => s.categories.length > 0)?.categories || [];

  // ECharts candlestick expects [open, close, low, high] per data point
  const dataLen = categories.length || Math.max(...seriesArr.map((s) => s.values.length), 0);
  const candleData: number[][] = [];

  if (seriesArr.length >= 4) {
    // OHLC: series 0=open, 1=high, 2=low, 3=close
    for (let i = 0; i < dataLen; i++) {
      candleData.push([
        seriesArr[0].values[i] ?? 0, // open
        seriesArr[3].values[i] ?? 0, // close
        seriesArr[2].values[i] ?? 0, // low
        seriesArr[1].values[i] ?? 0, // high
      ]);
    }
  } else if (seriesArr.length >= 3) {
    // HLC: series 0=high, 1=low, 2=close; open=close (collapsed body)
    for (let i = 0; i < dataLen; i++) {
      const close = seriesArr[2].values[i] ?? 0;
      candleData.push([
        close, // open = close
        close, // close
        seriesArr[1].values[i] ?? 0, // low
        seriesArr[0].values[i] ?? 0, // high
      ]);
    }
  } else {
    // Fallback: single series treated as close values with zero open
    for (let i = 0; i < dataLen; i++) {
      const val = seriesArr[0]?.values[i] ?? 0;
      candleData.push([0, val, 0, val]);
    }
  }

  const plotArea = chartNode.child('plotArea');
  const { valueAxis, categoryAxis } = parseAxes(plotArea, ctx, chartTypeNode);

  const gridTop = getGridTopPx(!!titleOption, legendInfo);
  const manualGrid = extractManualLayoutGrid(chartNode);
  const containLabel = !hasManualGrid(manualGrid);

  const xAxisDef: Record<string, unknown> = {
    type: 'category',
    data: categories,
    axisLabel: { interval: 0, rotate: 0, fontSize: 10 },
    splitLine: { show: false },
  };
  applyAxisInfo(xAxisDef, categoryAxis, 'category');
  const autoRotateDateLabels =
    categories.length >= 3 &&
    categories.every((category) => looksLikeDateCategory(category)) &&
    !categoryAxis.deleted &&
    categoryAxis.tickLblPos !== 'none';
  if (autoRotateDateLabels) {
    const axisLabel = (xAxisDef.axisLabel as Record<string, unknown>) || {};
    xAxisDef.axisLabel = {
      ...axisLabel,
      rotate: 45,
      margin: Math.max(Number(axisLabel.margin) || 0, 10),
    };
  }

  const yAxisDef: Record<string, unknown> = { type: 'value' };
  applyAxisInfo(yAxisDef, valueAxis, 'value');

  const stockValues = candleData.flatMap((d) => [d[2], d[3]]).filter((v) => Number.isFinite(v));
  if (stockValues.length > 0) {
    const stockMin = Math.min(...stockValues);
    const stockMax = Math.max(...stockValues);
    if (yAxisDef.min === undefined && stockMin >= 0) {
      yAxisDef.min = 0;
    }
    if (yAxisDef.interval === undefined) {
      yAxisDef.interval = niceAxisInterval(stockMax, stockMin, 7);
    }
    if (yAxisDef.max === undefined) {
      const interval = Number(yAxisDef.interval) || niceAxisInterval(stockMax, stockMin, 7);
      yAxisDef.max = Math.ceil(stockMax / interval) * interval + interval;
    }
  }

  const legendOpt = legendInfo?.option;
  const legendTextStyle = { fontSize: 10, ...(legendInfo?.textStyle ?? {}) };
  const legendTopPx = getLegendTopPx(!!titleOption, legendInfo);
  const gridBottom = Math.max(getGridBottomPx(legendInfo), autoRotateDateLabels ? 56 : 0);
  const isHlc = seriesArr.length >= 3 && seriesArr.length < 4;

  const legendData = isHlc
    ? seriesArr.slice(0, 3).map((s, idx) => ({
        name: s.name,
        icon: idx === 2 ? stockMarkerSymbolToLegendIcon(s.markerSymbol) : 'none',
      }))
    : seriesArr.map((s) => s.name);

  const series: EChartsTypes.SeriesOption[] = isHlc
    ? [
        {
          type: 'custom',
          name: seriesArr[2].name,
          coordinateSystem: 'cartesian2d',
          // data: [categoryIndex, high, low, close]
          data: Array.from({ length: dataLen }, (_, i) => [
            i,
            seriesArr[0].values[i] ?? 0,
            seriesArr[1].values[i] ?? 0,
            seriesArr[2].values[i] ?? 0,
          ]),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          renderItem: (params: any, api: any) => {
            const xValue = api.value(0);
            const high = api.value(1);
            const low = api.value(2);
            const close = api.value(3);
            const highPoint = api.coord([xValue, high]);
            const lowPoint = api.coord([xValue, low]);
            const closePoint = api.coord([xValue, close]);
            const bandWidth = Math.max(8, api.size([1, 0])[0] || 12);
            // Office HLC close marks stay as short ticks; scaling them with the full
            // category band makes them look like stray mid-plot marker lines.
            const tickWidth = Math.min(4, Math.max(2, Math.round(bandWidth * 0.04)));
            const stemColor = pickSeriesStringColor(seriesArr[0].colorHex, '#000000');
            const closeColor = pickSeriesStringColor(seriesArr[2].colorHex, '#00B050');
            return {
              type: 'group',
              children: [
                {
                  type: 'line',
                  shape: {
                    x1: highPoint[0],
                    y1: highPoint[1],
                    x2: lowPoint[0],
                    y2: lowPoint[1],
                  },
                  style: {
                    stroke: stemColor,
                    lineWidth: 1,
                  },
                },
                {
                  type: 'line',
                  shape: {
                    x1: closePoint[0],
                    y1: closePoint[1],
                    x2: closePoint[0] + tickWidth,
                    y2: closePoint[1],
                  },
                  style: {
                    stroke: closeColor,
                    lineWidth: 1,
                  },
                },
              ],
            };
          },
          silent: true,
        } as EChartsTypes.SeriesOption,
      ]
    : [
        {
          type: 'candlestick' as const,
          name: seriesArr.length >= 3 ? seriesArr[2].name : seriesArr[0]?.name,
          data: candleData,
          itemStyle: {
            // OOXML up/down colors from series spPr; fallback to standard financial convention
            color: pickSeriesStringColor(
              seriesArr[seriesArr.length >= 4 ? 3 : 2]?.colorHex,
              '#ec0000',
            ),
            color0: pickSeriesStringColor(seriesArr[0]?.colorHex, '#00da3c'),
            borderColor: pickSeriesStringColor(
              seriesArr[seriesArr.length >= 4 ? 3 : 2]?.colorHex,
              '#ec0000',
            ),
            borderColor0: pickSeriesStringColor(seriesArr[0]?.colorHex, '#00da3c'),
          },
        },
      ];

  return {
    title: titleOption,
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    legend: buildLegendOption(legendOpt, legendInfo, legendTopPx, legendData, legendTextStyle),
    grid: {
      containLabel,
      // Stock charts with rotated date labels need extra left inset so the
      // first category label is not clipped by the plot boundary.
      left: 24,
      right: 10,
      top: gridTop,
      bottom: gridBottom,
      ...manualGrid,
    },
    xAxis: xAxisDef,
    yAxis: yAxisDef,
    series,
  };
}

// ---------------------------------------------------------------------------
// Main Chart XML Parser
// ---------------------------------------------------------------------------

/**
 * Parse plotArea/layout/manualLayout to ECharts grid override.
 */
interface ManualLayoutBox {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

function extractManualLayoutBox(chartNode: SafeXmlNode): ManualLayoutBox {
  const manual = chartNode.child('plotArea').child('layout').child('manualLayout');
  if (!manual.exists()) return {};
  return {
    x: manual.child('x').numAttr('val'),
    y: manual.child('y').numAttr('val'),
    w: manual.child('w').numAttr('val'),
    h: manual.child('h').numAttr('val'),
  };
}

function extractManualLayoutGrid(
  chartNode: SafeXmlNode,
): Partial<Record<'left' | 'top' | 'width' | 'height', string>> {
  const box = extractManualLayoutBox(chartNode);
  const out: Partial<Record<'left' | 'top' | 'width' | 'height', string>> = {};
  if (box.x !== undefined) out.left = numToPct(box.x);
  if (box.y !== undefined) out.top = numToPct(box.y);
  if (box.w !== undefined) out.width = numToPct(box.w);
  if (box.h !== undefined) out.height = numToPct(box.h);
  return out;
}

function extractManualLayoutRadar(
  chartNode: SafeXmlNode,
  chartSize?: ChartPixelSize,
): { center: [number | string, number | string]; radius: number | string } | undefined {
  const { x, y, w, h } = extractManualLayoutBox(chartNode);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;

  const centerX = x + w / 2;
  const centerY = y + h / 2;
  if (!chartSize) {
    return {
      center: [numToPct(centerX), numToPct(centerY)],
      radius: numToPct(Math.min(w, h) / 2),
    };
  }

  return {
    center: [centerX * chartSize.w, centerY * chartSize.h],
    radius: Math.min(w * chartSize.w, h * chartSize.h) / 2,
  };
}

function buildPlotAreaBackgroundGraphic(
  chartNode: SafeXmlNode,
  fill: string,
  chartSize?: ChartPixelSize,
): Record<string, unknown> | undefined {
  if (!chartSize) return undefined;

  const { x = 0, y = 0, w = 1, h = 1 } = extractManualLayoutBox(chartNode);
  return {
    type: 'rect',
    silent: true,
    z: -10,
    left: x * chartSize.w,
    top: y * chartSize.h,
    shape: {
      width: w * chartSize.w,
      height: h * chartSize.h,
    },
    style: {
      fill,
      stroke: 'none',
    },
  };
}

function prependGraphicOption(
  option: EChartsTypes.EChartsOption,
  graphic: Record<string, unknown>,
): void {
  const current = option.graphic;
  if (!current) {
    option.graphic = graphic;
    return;
  }

  option.graphic = Array.isArray(current) ? [graphic, ...current] : [graphic, current];
}

/** Result of parsing chart XML: option for ECharts, optional data table info. */
export interface ParseChartResult {
  option: EChartsTypes.EChartsOption;
  dataTable?: DataTableInfo;
  chartFrameStyle?: ChartFrameStyle;
}

function buildOptionForChartType(
  typeName: OoxmlChartType,
  chartTypeNode: SafeXmlNode,
  chartNode: SafeXmlNode,
  seriesArr: SeriesData[],
  ctx: RenderContext,
  chartPalette?: string[],
  chartSize?: ChartPixelSize,
): EChartsTypes.EChartsOption | undefined {
  switch (typeName) {
    case 'barChart':
    case 'bar3DChart':
      return buildBarChartOption(chartTypeNode, chartNode, seriesArr, ctx);
    case 'lineChart':
    case 'line3DChart':
      return buildLineChartOption(chartTypeNode, chartNode, seriesArr, ctx, false, chartPalette);
    case 'areaChart':
    case 'area3DChart':
    case 'surface3DChart':
      return buildLineChartOption(chartTypeNode, chartNode, seriesArr, ctx, true, chartPalette);
    case 'pieChart':
    case 'pie3DChart':
      return buildPieChartOption(chartTypeNode, chartNode, seriesArr, false, ctx);
    case 'doughnutChart':
      return buildPieChartOption(chartTypeNode, chartNode, seriesArr, true, ctx);
    case 'radarChart':
      return buildRadarChartOption(
        chartTypeNode,
        chartNode,
        seriesArr,
        ctx,
        chartPalette,
        chartSize,
      );
    case 'scatterChart':
      return buildScatterChartOption(chartTypeNode, chartNode, seriesArr, ctx);
    case 'bubbleChart':
      return buildBubbleChartOption(chartTypeNode, chartNode, seriesArr, ctx);
    case 'stockChart':
      return buildStockChartOption(chartTypeNode, chartNode, seriesArr, ctx);
    default:
      return undefined;
  }
}

function isCartesianComboCapable(typeName: OoxmlChartType): boolean {
  return (
    typeName === 'barChart' ||
    typeName === 'bar3DChart' ||
    typeName === 'lineChart' ||
    typeName === 'line3DChart' ||
    typeName === 'areaChart' ||
    typeName === 'area3DChart' ||
    typeName === 'stockChart' ||
    typeName === 'surface3DChart'
  );
}

function mergeLegendData(
  primaryLegend: EChartsTypes.EChartsOption['legend'],
  secondaryLegend: EChartsTypes.EChartsOption['legend'],
): EChartsTypes.EChartsOption['legend'] {
  const primary = getLegendOptionObject(primaryLegend);
  const secondary = getLegendOptionObject(secondaryLegend);
  if (!primary) return secondaryLegend;
  if (!secondary) return primaryLegend;

  const mergedData = [...(primary.data ?? []), ...(secondary.data ?? [])];
  const seen = new Set<string>();
  const deduped = mergedData.filter((entry) => {
    const key = typeof entry === 'string' ? entry : entry.name;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const merged: LegendOptionObject = {
    ...primary,
    data: deduped,
  };
  if (deduped.some((entry) => typeof entry === 'object' && entry.icon)) {
    delete merged.icon;
  }
  return merged;
}

function normalizeOptionArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function gridEdgePx(value: unknown, fullSize: number, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    if (value.endsWith('%')) {
      const pct = parseFloat(value);
      return Number.isFinite(pct) ? (fullSize * pct) / 100 : fallback;
    }
    const px = parseFloat(value);
    return Number.isFinite(px) ? px : fallback;
  }
  return fallback;
}

function plotSpanPx(
  grid: Record<string, unknown> | undefined,
  fullSize: number,
  startKey: 'top' | 'left',
  endKey: 'bottom' | 'right',
): number {
  if (typeof grid?.width === 'string' && startKey === 'left' && grid.width.endsWith('%')) {
    return (fullSize * parseFloat(grid.width)) / 100;
  }
  if (typeof grid?.height === 'string' && startKey === 'top' && grid.height.endsWith('%')) {
    return (fullSize * parseFloat(grid.height)) / 100;
  }
  if (typeof grid?.width === 'number' && startKey === 'left') return grid.width;
  if (typeof grid?.height === 'number' && startKey === 'top') return grid.height;

  const start = gridEdgePx(grid?.[startKey], fullSize, 0);
  const end = gridEdgePx(grid?.[endKey], fullSize, 0);
  return Math.max(0, fullSize - start - end);
}

function axisCrossesZero(axis: MutableAxisOption): boolean {
  return (
    typeof axis.min === 'number' && typeof axis.max === 'number' && axis.min < 0 && axis.max > 0
  );
}

function applyCategoryLabelZeroOffset(
  categoryAxis: MutableAxisOption,
  valueAxis: MutableAxisOption | undefined,
  plotSpan: number,
): boolean {
  if (!valueAxis || categoryAxis.type !== 'category' || valueAxis.type !== 'value') return false;
  if (categoryAxis.axisLine?.onZero !== true || !axisCrossesZero(valueAxis)) return false;
  if (plotSpan <= 0) return false;

  const zeroOffsetFromMin = plotSpan * ((0 - valueAxis.min!) / (valueAxis.max! - valueAxis.min!));
  const axisLabel = categoryAxis.axisLabel ?? (categoryAxis.axisLabel = {});
  const labelGap = Math.max(6, Math.round(axisLabel.fontSize ?? 10));
  axisLabel.margin = -Math.round(Math.max(0, zeroOffsetFromMin - labelGap));
  categoryAxis.z = Math.max(categoryAxis.z ?? 0, 20);
  return true;
}

export function applyZeroCrossingAxisLabelLayout(
  option: EChartsTypes.EChartsOption,
  chartSize: { w: number; h: number },
): void {
  const grid = normalizeOptionArray<Record<string, unknown>>(
    option.grid as Record<string, unknown> | Record<string, unknown>[] | undefined,
  )[0];
  const xAxes = normalizeOptionArray<MutableAxisOption>(
    option.xAxis as MutableAxisOption | MutableAxisOption[],
  );
  const yAxes = normalizeOptionArray<MutableAxisOption>(
    option.yAxis as MutableAxisOption | MutableAxisOption[],
  );
  const gridHeight = plotSpanPx(grid, chartSize.h, 'top', 'bottom');
  const gridWidth = plotSpanPx(grid, chartSize.w, 'left', 'right');
  let applied = false;

  xAxes.forEach((xAxis, index) => {
    applied = applyCategoryLabelZeroOffset(xAxis, yAxes[index] ?? yAxes[0], gridHeight) || applied;
  });
  yAxes.forEach((yAxis, index) => {
    applied = applyCategoryLabelZeroOffset(yAxis, xAxes[index] ?? xAxes[0], gridWidth) || applied;
  });

  if (applied && grid) {
    grid.containLabel = false;
    grid.left = Math.max(gridEdgePx(grid.left, chartSize.w, 0), 48);
  }
}

function getValueAxisId(chartTypeNode: SafeXmlNode): string | undefined {
  return getChartAxisIds(chartTypeNode)[1];
}

function mergeCartesianComboOptions(
  primary: EChartsTypes.EChartsOption,
  secondary: EChartsTypes.EChartsOption,
  primaryChartTypeNode: SafeXmlNode,
  secondaryChartTypeNode: SafeXmlNode,
): EChartsTypes.EChartsOption {
  const primarySeries = Array.isArray(primary.series) ? primary.series : [];
  const secondarySeries = Array.isArray(secondary.series) ? secondary.series : [];
  const primaryValueAxisId = getValueAxisId(primaryChartTypeNode);
  const secondaryValueAxisId = getValueAxisId(secondaryChartTypeNode);
  const usesDistinctValueAxis =
    primaryValueAxisId !== undefined &&
    secondaryValueAxisId !== undefined &&
    primaryValueAxisId !== secondaryValueAxisId;

  if (usesDistinctValueAxis) {
    const primaryYAxes = normalizeOptionArray(primary.yAxis);
    const secondaryYAxes = normalizeOptionArray(secondary.yAxis);
    const secondaryYAxisIndex = primaryYAxes.length;
    return {
      ...primary,
      legend: mergeLegendData(primary.legend, secondary.legend),
      yAxis: [...primaryYAxes, ...secondaryYAxes],
      series: [
        ...primarySeries,
        ...secondarySeries.map((series) => ({
          ...series,
          yAxisIndex:
            (series as { yAxisIndex?: number }).yAxisIndex !== undefined
              ? (series as { yAxisIndex?: number }).yAxisIndex
              : secondaryYAxisIndex,
        })),
      ],
    };
  }

  return {
    ...primary,
    legend: mergeLegendData(primary.legend, secondary.legend),
    series: [...primarySeries, ...secondarySeries],
  };
}

/**
 * Parse a chart XML (chartSpace root) into an ECharts option object and optional data table info.
 * Exported for unit testing.
 */
export function parseChartXml(
  chartXml: SafeXmlNode,
  ctx: RenderContext,
  chartPath?: string,
  chartSize?: ChartPixelSize,
): ParseChartResult {
  const chartCtx = createChartRenderContext(chartXml, ctx);
  const chartPalette = buildChartPalette(chartXml, chartCtx, chartPath);
  // Navigate: chartSpace > chart > plotArea
  const chart = chartXml.child('chart');
  const plotArea = chart.child('plotArea');

  if (!plotArea.exists()) {
    return {
      option: { title: { text: 'Unsupported chart', left: 'center' } },
      chartFrameStyle: extractChartFrameStyle(chartXml, chartCtx),
    };
  }

  // Extract background colors
  const { chartBg, plotAreaBg } = extractBackgroundColors(chartXml, chart, chartCtx);
  const chartFrameStyle = extractChartFrameStyle(chartXml, chartCtx);

  const chartTypeEntries = CHART_TYPE_ELEMENTS.flatMap((typeName) =>
    plotArea.children(typeName).map((chartTypeNode) => {
      const seriesArr = parseSeries(chartTypeNode, chartCtx);
      if (seriesArr.length === 0) return null;
      return { typeName, chartTypeNode, seriesArr };
    }),
  ).filter(
    (
      entry,
    ): entry is { typeName: OoxmlChartType; chartTypeNode: SafeXmlNode; seriesArr: SeriesData[] } =>
      entry !== null,
  );

  for (const [index, entry] of chartTypeEntries.entries()) {
    let option = buildOptionForChartType(
      entry.typeName,
      entry.chartTypeNode,
      chart,
      entry.seriesArr,
      chartCtx,
      chartPalette,
      chartSize,
    );
    if (!option) continue;

    if (index === 0 && chartTypeEntries.length > 1 && isCartesianComboCapable(entry.typeName)) {
      for (const comboEntry of chartTypeEntries.slice(1)) {
        if (!isCartesianComboCapable(comboEntry.typeName)) continue;
        const comboOption = buildOptionForChartType(
          comboEntry.typeName,
          comboEntry.chartTypeNode,
          chart,
          comboEntry.seriesArr,
          chartCtx,
          chartPalette,
          chartSize,
        );
        if (!comboOption) continue;
        option = mergeCartesianComboOptions(
          option,
          comboOption,
          entry.chartTypeNode,
          comboEntry.chartTypeNode,
        );
      }
    }

    // Apply chart-space default font sizes to text elements that use hardcoded defaults
    const defaultFs = extractChartDefaultFontSize(chartXml);
    if (defaultFs) {
      applyDefaultFontSizes(option, defaultFs);
    }
    const defaultFontFamily = getChartThemeFontFamily(chartCtx);
    if (defaultFontFamily) {
      applyDefaultFontFamily(option, defaultFontFamily);
    }
    applyDefaultTextColors(option);

    // Adjust grid margins for legend placement (non-overlay)
    applyLegendGridMargins(option, chart, defaultFs);

    // Apply PowerPoint-like nice axis range (adds headroom beyond data max)
    applyNiceAxisRange(option, chartSize);

    // Apply background colors
    if (chartBg) {
      option.backgroundColor = chartBg;
    }
    if (chartPalette && chartPalette.length > 0) {
      option.color = chartPalette;
    }
    if (plotAreaBg) {
      if (option.grid) {
        // Apply plot area background via grid (for cartesian charts)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (option.grid as any).backgroundColor = plotAreaBg;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (option.grid as any).show = true;
      } else {
        const graphic = buildPlotAreaBackgroundGraphic(chart, plotAreaBg, chartSize);
        if (graphic) prependGraphicOption(option, graphic);
      }
    }

    // PPTX slides are static unless OOXML animations are explicitly implemented.
    // Disabling ECharts transitions keeps first paint, screenshots, and exports deterministic.
    option.animation = false;

    const dataTableSeries =
      index === 0 && chartTypeEntries.length > 1 && isCartesianComboCapable(entry.typeName)
        ? chartTypeEntries
            .filter((candidate) => isCartesianComboCapable(candidate.typeName))
            .flatMap((candidate) => candidate.seriesArr)
            .sort((a, b) => a.order - b.order)
        : entry.seriesArr;

    // Build data table info when c:dTable exists
    const dTableMeta = parseDataTable(plotArea);
    const dataTable: DataTableInfo | undefined = dTableMeta
      ? {
          seriesArr: dataTableSeries,
          showKeys: dTableMeta.showKeys,
        }
      : undefined;

    return { option, dataTable, chartFrameStyle };
  }

  return {
    option: {
      title: { text: 'Unsupported chart type', left: 'center', textStyle: { fontSize: 12 } },
    },
    chartFrameStyle,
  };
}

// ---------------------------------------------------------------------------
// Public Render Function
// ---------------------------------------------------------------------------

/**
 * Render a chart node into an HTML element with an ECharts instance.
 */
export function renderChart(node: ChartNodeData, ctx: RenderContext): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.style.position = 'absolute';
  wrapper.style.left = `${node.position.x}px`;
  wrapper.style.top = `${node.position.y}px`;
  wrapper.style.width = `${node.size.w}px`;
  wrapper.style.height = `${node.size.h}px`;
  wrapper.style.overflow = 'hidden';
  wrapper.style.display = 'flex';
  wrapper.style.flexDirection = 'column';

  const chartXml = ctx.presentation.charts?.get(node.chartPath);
  if (!chartXml) {
    wrapper.style.border = '1px dashed #ccc';
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.justifyContent = 'center';
    wrapper.style.color = '#999';
    wrapper.style.fontSize = '12px';
    wrapper.textContent = 'Chart not found';
    return wrapper;
  }

  // Create chart container (clip content so legend/title stay inside)
  const chartDiv = document.createElement('div');
  chartDiv.style.width = '100%';
  chartDiv.style.flex = '1';
  chartDiv.style.minWidth = '0';
  chartDiv.style.minHeight = '0';
  chartDiv.style.overflow = 'hidden';
  wrapper.appendChild(chartDiv);

  // Parse chart data and create ECharts option
  const chartTheme = ctx.presentation.chartThemes?.get(node.chartPath);
  const chartCtx = chartTheme ? { ...ctx, theme: chartTheme, colorCache: new Map() } : ctx;
  const { option, dataTable, chartFrameStyle } = parseChartXml(
    chartXml,
    chartCtx,
    node.chartPath,
    node.size,
  );
  applyZeroCrossingAxisLabelLayout(option, node.size);
  if (chartFrameStyle) {
    wrapper.style.boxSizing = 'border-box';
    if (chartFrameStyle.borderColor && chartFrameStyle.borderWidth && chartFrameStyle.borderStyle) {
      wrapper.style.border = `${chartFrameStyle.borderWidth}px ${chartFrameStyle.borderStyle} ${chartFrameStyle.borderColor}`;
    }
  }
  const customLegend = buildCustomLegendOverlay(option, node.size);
  const legendOption = getLegendOptionObject(option.legend);
  if (customLegend && legendOption) {
    legendOption.show = false;
    wrapper.appendChild(customLegend);
  }

  // Append data table below chart when c:dTable exists
  if (dataTable) {
    const seriesColors = dataTable.seriesArr.map((s) => s.colorHex).filter(Boolean) as string[];
    const tableEl = buildDataTableElement(
      dataTable,
      seriesColors.length > 0 ? seriesColors : undefined,
    );
    wrapper.appendChild(tableEl);
  }

  const chartSet = ctx.chartInstances;

  // Initialize ECharts after the element is attached to the DOM.
  // Use requestAnimationFrame to ensure the container has dimensions.
  const chartReady = new Promise<void>((resolve) => {
    const finishInit = (): void => {
      initChart(chartDiv, option, chartSet);
      resolve();
    };

    requestAnimationFrame(() => {
      if (!chartDiv.isConnected) {
        resolve();
        return;
      }

      // Guard against 0-size containers (e.g. hidden tabs); defer until non-zero.
      if (chartDiv.offsetWidth === 0 || chartDiv.offsetHeight === 0) {
        if (typeof ResizeObserver === 'undefined') {
          finishInit();
          return;
        }

        const sizeObserver = new ResizeObserver((entries) => {
          if (!chartDiv.isConnected) {
            sizeObserver.disconnect();
            return;
          }
          const { width, height } = entries[0]?.contentRect ?? { width: 0, height: 0 };
          if (width > 0 && height > 0) {
            sizeObserver.disconnect();
            finishInit();
          }
        });
        sizeObserver.observe(chartDiv);
        resolve();
        return;
      }

      finishInit();
    });
  });
  ctx.asyncTasks?.push(chartReady);

  return wrapper;
}

/** Actually create ECharts instance, set option, and wire up resize + dispose. */
function initChart(
  container: HTMLElement,
  option: EChartsTypes.EChartsOption,
  chartInstances?: Set<EChartsType>,
): void {
  try {
    const chart = echarts.init(container);
    chart.setOption(option);
    chartInstances?.add(chart);

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    // Handle container resize
    const ro = new ResizeObserver(() => {
      if (container.isConnected) {
        chart.resize();
      } else {
        // Container removed from DOM — dispose to prevent leaks
        ro.disconnect();
        if (!chart.isDisposed()) {
          chart.dispose();
        }
        chartInstances?.delete(chart);
      }
    });
    ro.observe(container);
  } catch (e) {
    console.warn('Failed to initialize ECharts:', e);
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.justifyContent = 'center';
    container.style.color = '#999';
    container.style.fontSize = '12px';
    container.textContent = 'Chart render error';
  }
}
