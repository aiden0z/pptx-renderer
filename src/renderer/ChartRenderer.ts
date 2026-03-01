/**
 * Chart renderer — converts OOXML chart XML into ECharts visualizations.
 */

import * as echarts from 'echarts';
import { ChartNodeData } from '../model/nodes/ChartNode';
import { RenderContext } from './RenderContext';
import { SafeXmlNode } from '../parser/XmlParser';
import { resolveColor } from './StyleResolver';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SeriesData {
  name: string;
  order: number; // c:order val — used to sort series into correct sequence
  categories: string[];
  values: number[];
  xValues?: number[]; // scatter chart x values from c:xVal
  colorHex?: string | object; // optional explicit series color (hex string or ECharts gradient)
  dataPointColors?: (string | undefined)[]; // per-point colors (for pie charts)
  formatCode?: string; // numCache formatCode (e.g. "0%", "0.0%", "General")
  markerSymbol?: string; // OOXML c:marker > c:symbol val
  markerSize?: number; // OOXML c:marker > c:size val (points)
}

/** Parsed axis information from plotArea valAx / catAx / dateAx. */
interface AxisInfo {
  deleted: boolean;
  tickLblPos: string; // 'nextTo' | 'none' | 'high' | 'low'
  numFmt?: string; // formatCode from axis numFmt
  min?: number;
  max?: number;
  hasMajorGridlines: boolean;
  orientation: string; // 'minMax' | 'maxMin'
  labelColor?: string; // hex color from txPr for axis labels
  labelFontSize?: number; // px from txPr defRPr@sz
  lineColor?: string; // hex color from spPr > ln for axis line
}

interface DataLabelConfig {
  showVal: boolean;
  showCatName: boolean;
  showSerName: boolean;
  showPercent: boolean;
  position?: string; // 'outEnd', 'inEnd', 'ctr', 'bestFit'
  color?: string; // text color from dLbls > txPr
  fontSize?: number; // font size from dLbls > txPr > defRPr@sz
  bold?: boolean; // font bold from dLbls > txPr > defRPr@b
}

type OoxmlChartType =
  | 'barChart'
  | 'bar3DChart'
  | 'lineChart'
  | 'line3DChart'
  | 'areaChart'
  | 'area3DChart'
  | 'pieChart'
  | 'pie3DChart'
  | 'doughnutChart'
  | 'radarChart'
  | 'scatterChart'
  | 'surface3DChart';

// ---------------------------------------------------------------------------
// Chart Type Mapping
// ---------------------------------------------------------------------------

const CHART_TYPE_ELEMENTS: OoxmlChartType[] = [
  'barChart',
  'bar3DChart',
  'lineChart',
  'line3DChart',
  'areaChart',
  'area3DChart',
  'pieChart',
  'pie3DChart',
  'doughnutChart',
  'radarChart',
  'scatterChart',
  'surface3DChart',
];

/** Fallback series colors when OOXML does not specify (e.g. radar line colors). */
const DEFAULT_SERIES_COLORS = [
  '#5470c6',
  '#91cc75',
  '#fac858',
  '#ee6666',
  '#73c0de',
  '#3ba272',
  '#fc8452',
  '#9a60b4',
  '#ea7ccc',
];

// ---------------------------------------------------------------------------
// Data Extraction Helpers
// ---------------------------------------------------------------------------

/**
 * Extract text values from a strRef or strCache structure.
 * Path: strRef > strCache > pt (with idx attr) > v
 */
function extractStringValues(refNode: SafeXmlNode): string[] {
  const cache = refNode.child('strRef').exists()
    ? refNode.child('strRef').child('strCache')
    : refNode.child('strCache');

  if (!cache.exists()) {
    // Try numRef > numCache as fallback (categories can be numeric)
    const numCache = refNode.child('numRef').exists()
      ? refNode.child('numRef').child('numCache')
      : refNode.child('numCache');
    if (numCache.exists()) {
      return extractNumericValuesAsStrings(numCache);
    }
    return [];
  }

  const ptCount = cache.child('ptCount').numAttr('val') ?? 0;
  const values: string[] = new Array(ptCount).fill('');

  for (const pt of cache.children('pt')) {
    const idx = pt.numAttr('idx');
    if (idx !== undefined) {
      const v = pt.child('v').text();
      values[idx] = v;
    }
  }

  return values;
}

/**
 * Extract the formatCode from a numRef > numCache > formatCode structure.
 */
function extractFormatCode(refNode: SafeXmlNode): string | undefined {
  const cache = refNode.child('numRef').exists()
    ? refNode.child('numRef').child('numCache')
    : refNode.child('numCache');

  if (!cache.exists()) return undefined;

  const fc = cache.child('formatCode');
  if (!fc.exists()) return undefined;

  const text = fc.text();
  return text || undefined;
}

/**
 * Format a numeric value according to its numCache formatCode.
 * Handles percentage formats (containing '%') and general numbers.
 */
function formatValue(value: number, formatCode: string | undefined): string {
  if (!formatCode || formatCode === 'General') {
    // No format or "General": show a sensible number of decimal places.
    // Avoid ugly long floats (e.g. 0.91509433962264153 → "0.92").
    if (Number.isInteger(value)) return String(value);
    // Up to 2 decimal places, strip trailing zeros
    return parseFloat(value.toFixed(2)).toString();
  }

  // Percentage format: the raw value is a fraction (e.g., 0.213 means 21.3%)
  if (formatCode.includes('%')) {
    // Determine decimal places from the format code
    const match = formatCode.match(/0\.(0+)%/);
    const decimals = match ? match[1].length : 0;
    const pctValue = value * 100;
    return `${pctValue.toFixed(decimals)}%`;
  }

  // Numeric format with decimal places: e.g. "0.00", "#,##0.0"
  const decMatch = formatCode.match(/\.(0+|#+)/);
  if (decMatch) {
    const decimals = decMatch[1].length;
    return parseFloat(value.toFixed(decimals)).toString();
  }

  // Integer format: "0", "#,##0"
  if (/^[#0,]+$/.test(formatCode.replace(/[[\]"\\]/g, ''))) {
    return Math.round(value).toString();
  }

  // Fallback: reasonable precision
  if (Number.isInteger(value)) return String(value);
  return parseFloat(value.toFixed(2)).toString();
}

/**
 * Extract numeric values from a numRef > numCache structure.
 */
function extractNumericValues(refNode: SafeXmlNode): number[] {
  const cache = refNode.child('numRef').exists()
    ? refNode.child('numRef').child('numCache')
    : refNode.child('numCache');

  if (!cache.exists()) return [];

  const ptCount = cache.child('ptCount').numAttr('val') ?? 0;
  const values: number[] = new Array(ptCount).fill(0);

  for (const pt of cache.children('pt')) {
    const idx = pt.numAttr('idx');
    if (idx !== undefined) {
      const v = parseFloat(pt.child('v').text());
      values[idx] = isNaN(v) ? 0 : v;
    }
  }

  return values;
}

/**
 * Extract numeric cache values as strings (for category axis that uses numbers).
 */
function extractNumericValuesAsStrings(cache: SafeXmlNode): string[] {
  const ptCount = cache.child('ptCount').numAttr('val') ?? 0;
  const values: string[] = new Array(ptCount).fill('');

  for (const pt of cache.children('pt')) {
    const idx = pt.numAttr('idx');
    if (idx !== undefined) {
      values[idx] = pt.child('v').text();
    }
  }

  return values;
}

/**
 * Extract series name from c:tx element.
 */
function extractSeriesName(txNode: SafeXmlNode): string {
  // Try strRef > strCache > pt > v
  const strRef = txNode.child('strRef');
  if (strRef.exists()) {
    const strCache = strRef.child('strCache');
    const pts = strCache.children('pt');
    if (pts.length > 0) {
      return pts[0].child('v').text();
    }
  }
  // Try direct v element
  const v = txNode.child('v');
  if (v.exists()) return v.text();
  return '';
}

/**
 * Resolve a color from a fill node (solidFill) to a hex string.
 */
function resolveColorToHex(fillNode: SafeXmlNode, ctx: RenderContext): string | undefined {
  try {
    const { color } = resolveColor(fillNode, ctx);
    return color.startsWith('#') ? color : `#${color}`;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a color from a single gradient stop node (a:gs > color child) to hex + alpha.
 */
function resolveGradientStop(
  gsNode: SafeXmlNode,
  ctx: RenderContext,
): { color: string; alpha: number; pos: number } | undefined {
  const pos = gsNode.numAttr('pos');
  if (pos === undefined) return undefined;

  // Try each color type: srgbClr, schemeClr, sysClr
  for (const child of gsNode.allChildren()) {
    const ln = child.localName;
    if (ln === 'srgbClr' || ln === 'schemeClr' || ln === 'sysClr' || ln === 'prstClr') {
      try {
        const result = resolveColor(gsNode, ctx);
        const hex = result.color.startsWith('#') ? result.color : `#${result.color}`;
        return { color: hex, alpha: result.alpha, pos: pos / 100000 };
      } catch {
        // For sysClr with lastClr, fall back to lastClr
        if (ln === 'sysClr') {
          const lastClr = child.attr('lastClr');
          if (lastClr) {
            const alphaNode = child.child('alpha');
            const alphaVal = alphaNode.exists() ? (alphaNode.numAttr('val') ?? 100000) / 100000 : 1;
            return { color: `#${lastClr}`, alpha: alphaVal, pos: pos / 100000 };
          }
        }
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * Extract a series color from c:ser > c:spPr fill.
 * Supports solidFill and gradFill (converted to ECharts LinearGradient).
 * Also checks c:spPr > a:ln > a:solidFill as fallback (used by line/area charts).
 */
function extractSeriesColor(ser: SafeXmlNode, ctx: RenderContext): string | object | undefined {
  const spPr = ser.child('spPr');
  if (!spPr.exists()) return undefined;

  // Primary: solid fill
  const solidFill = spPr.child('solidFill');
  if (solidFill.exists()) {
    const hex = resolveColorToHex(solidFill, ctx);
    if (hex) return hex;
  }

  // Gradient fill → ECharts LinearGradient
  const gradFill = spPr.child('gradFill');
  if (gradFill.exists()) {
    const grad = buildEChartsGradient(gradFill, ctx);
    if (grad) return grad;
  }

  // Fallback: line color (used by lineChart, areaChart series)
  const ln = spPr.child('ln');
  if (ln.exists()) {
    const lnFill = ln.child('solidFill');
    if (lnFill.exists()) {
      const hex = resolveColorToHex(lnFill, ctx);
      if (hex) return hex;
    }
  }

  return undefined;
}

/**
 * Build an ECharts LinearGradient from an OOXML a:gradFill node.
 */
function buildEChartsGradient(gradFill: SafeXmlNode, ctx: RenderContext): object | undefined {
  const gsLst = gradFill.child('gsLst');
  if (!gsLst.exists()) return undefined;

  const stops: { offset: number; color: string }[] = [];
  for (const gs of gsLst.children('gs')) {
    const stop = resolveGradientStop(gs, ctx);
    if (stop) {
      // Convert color + alpha to rgba string
      const hex = stop.color.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      stops.push({
        offset: stop.pos,
        color: `rgba(${r},${g},${b},${stop.alpha})`,
      });
    }
  }

  if (stops.length < 2) return undefined;

  // Sort stops by offset
  stops.sort((a, b) => a.offset - b.offset);

  // Determine gradient direction from a:lin angle. Default: top-to-bottom (ang=5400000 = 90°)
  const lin = gradFill.child('lin');
  const angVal = lin.exists() ? (lin.numAttr('ang') ?? 5400000) : 5400000;
  const angleDeg = angVal / 60000; // Convert from 60000ths of a degree

  // Map angle to x0,y0,x1,y1 (ECharts LinearGradient coordinates)
  // OOXML angle: 0°=right(→), 90°=down(↓), 180°=left(←), 270°=up(↑)
  // Direction vector: dx=cos(θ), dy=sin(θ) (clockwise from east in screen coords)
  const rad = (angleDeg * Math.PI) / 180;
  const x0 = 0.5 - 0.5 * Math.cos(rad);
  const y0 = 0.5 - 0.5 * Math.sin(rad);
  const x1 = 0.5 + 0.5 * Math.cos(rad);
  const y1 = 0.5 + 0.5 * Math.sin(rad);

  return new echarts.graphic.LinearGradient(x0, y0, x1, y1, stops);
}

/**
 * Extract per-data-point colors from c:ser > c:dPt elements.
 * Each c:dPt has c:idx and c:spPr > a:solidFill.
 */
function extractDataPointColors(
  ser: SafeXmlNode,
  ctx: RenderContext,
): (string | undefined)[] | undefined {
  const dPts = ser.children('dPt');
  if (dPts.length === 0) return undefined;

  const colors: (string | undefined)[] = [];
  for (const dPt of dPts) {
    const idx = dPt.child('idx').numAttr('val');
    if (idx === undefined) continue;

    const spPr = dPt.child('spPr');
    if (!spPr.exists()) continue;

    const solidFill = spPr.child('solidFill');
    if (solidFill.exists()) {
      const hex = resolveColorToHex(solidFill, ctx);
      if (hex) {
        while (colors.length <= idx) colors.push(undefined);
        colors[idx] = hex;
      }
    }
  }

  return colors.length > 0 ? colors : undefined;
}

/** In OOXML, boolean elements are true when present unless val="0" or val="false". */
function parseDlblBool(dLbls: SafeXmlNode, childName: string): boolean {
  const el = dLbls.child(childName);
  if (!el.exists()) return false;
  const val = el.attr('val');
  return val !== '0' && val !== 'false';
}

/**
 * Extract text color from a txPr element: txPr > p > pPr > defRPr > solidFill.
 */
function extractTxPrColor(parentNode: SafeXmlNode, ctx: RenderContext): string | undefined {
  const txPr = parentNode.child('txPr');
  if (!txPr.exists()) return undefined;
  for (const p of txPr.children('p')) {
    const pPr = p.child('pPr');
    if (!pPr.exists()) continue;
    const defRPr = pPr.child('defRPr');
    if (!defRPr.exists()) continue;
    const fill = defRPr.child('solidFill');
    if (fill.exists()) {
      return resolveColorToHex(fill, ctx);
    }
  }
  return undefined;
}

/**
 * Parse c:dLbls (data labels) configuration from a chart type node or series.
 */
function parseDataLabels(node: SafeXmlNode, ctx: RenderContext): DataLabelConfig | undefined {
  const dLbls = node.child('dLbls');
  if (!dLbls.exists()) return undefined;

  const showVal = parseDlblBool(dLbls, 'showVal');
  const showCatName = parseDlblBool(dLbls, 'showCatName');
  const showSerName = parseDlblBool(dLbls, 'showSerName');
  const showPercent = parseDlblBool(dLbls, 'showPercent');
  const posNode = dLbls.child('dLblPos');
  const position = posNode.exists() ? posNode.attr('val') || undefined : undefined;

  const txStyle = extractTxPrStyle(dLbls, ctx);
  const color = txStyle?.color ?? extractTxPrColor(dLbls, ctx);
  const fontSize = txStyle?.fontSize;
  const bold = txStyle?.bold;

  // If nothing is shown, return undefined
  if (!showVal && !showCatName && !showSerName && !showPercent) return undefined;

  return { showVal, showCatName, showSerName, showPercent, position, color, fontSize, bold };
}

function parseDlblBoolOptional(dLbl: SafeXmlNode, childName: string): boolean | undefined {
  const el = dLbl.child(childName);
  if (!el.exists()) return undefined;
  const val = el.attr('val');
  return val !== '0' && val !== 'false';
}

/**
 * Parse per-point data label overrides from c:dLbls > c:dLbl(idx=...).
 */
function parsePointDataLabelOverrides(
  dLbls: SafeXmlNode,
  ctx: RenderContext,
): Map<number, Partial<DataLabelConfig>> {
  const out = new Map<number, Partial<DataLabelConfig>>();
  if (!dLbls.exists()) return out;
  for (const dLbl of dLbls.children('dLbl')) {
    const idx = dLbl.child('idx').numAttr('val');
    if (idx === undefined) continue;
    const txStyle = extractTxPrStyle(dLbl, ctx);
    const posNode = dLbl.child('dLblPos');
    const cfg: Partial<DataLabelConfig> = {};
    const showVal = parseDlblBoolOptional(dLbl, 'showVal');
    const showCatName = parseDlblBoolOptional(dLbl, 'showCatName');
    const showSerName = parseDlblBoolOptional(dLbl, 'showSerName');
    const showPercent = parseDlblBoolOptional(dLbl, 'showPercent');
    if (showVal !== undefined) cfg.showVal = showVal;
    if (showCatName !== undefined) cfg.showCatName = showCatName;
    if (showSerName !== undefined) cfg.showSerName = showSerName;
    if (showPercent !== undefined) cfg.showPercent = showPercent;
    if (posNode.exists()) cfg.position = posNode.attr('val') || undefined;
    if (txStyle?.color) cfg.color = txStyle.color;
    else {
      const c = extractTxPrColor(dLbl, ctx);
      if (c) cfg.color = c;
    }
    if (txStyle?.fontSize !== undefined) cfg.fontSize = txStyle.fontSize;
    if (txStyle?.bold !== undefined) cfg.bold = txStyle.bold;
    if (Object.keys(cfg).length > 0) out.set(idx, cfg);
  }
  return out;
}

/**
 * Parse pie slice explosion values from c:ser and c:dPt elements.
 */
function parseExplosion(ser: SafeXmlNode): number[] | undefined {
  const explosions: number[] = [];
  let hasAny = false;

  // Series-level explosion
  const serExplosion = ser.child('explosion').numAttr('val') ?? 0;

  // Per-point explosion overrides
  const dPts = ser.children('dPt');
  for (const dPt of dPts) {
    const idx = dPt.child('idx').numAttr('val');
    if (idx === undefined) continue;
    const exp = dPt.child('explosion').numAttr('val');
    if (exp !== undefined && exp > 0) {
      while (explosions.length <= idx) explosions.push(serExplosion);
      explosions[idx] = exp;
      hasAny = true;
    }
  }

  return hasAny ? explosions : undefined;
}

/**
 * Parse all c:ser elements from a chart type node into SeriesData[].
 * Results are sorted by c:order to match the intended series sequence.
 */
function parseSeries(chartTypeNode: SafeXmlNode, ctx: RenderContext): SeriesData[] {
  const seriesArr: SeriesData[] = [];

  for (const ser of chartTypeNode.children('ser')) {
    const tx = ser.child('tx');
    const name = extractSeriesName(tx);
    const order = ser.child('order').numAttr('val') ?? seriesArr.length;

    const cat = ser.child('cat');
    const categories = extractStringValues(cat);

    const val = ser.child('val');
    const values = extractNumericValues(val);
    const formatCode = extractFormatCode(val);

    // Scatter charts use xVal / yVal instead of cat / val
    const xValNode = ser.child('xVal');
    const yValNode = ser.child('yVal');
    let xValues: number[] | undefined;
    if (yValNode.exists()) {
      // yVal overrides val for scatter
      const yVals = extractNumericValues(yValNode);
      if (yVals.length > 0) {
        values.length = 0;
        values.push(...yVals);
      }
    }
    if (xValNode.exists()) {
      xValues = extractNumericValues(xValNode);
      // If categories are empty but xVal exists as strings, try that
      if (categories.length === 0) {
        const xCats = extractStringValues(xValNode);
        if (xCats.length > 0) categories.push(...xCats);
      }
    }

    const colorHex = extractSeriesColor(ser, ctx);
    const dataPointColors = extractDataPointColors(ser, ctx);

    // Extract marker info (c:marker > c:symbol, c:size)
    const marker = ser.child('marker');
    const markerSymbol = marker.child('symbol').attr('val');
    const markerSize = marker.child('size').numAttr('val');

    seriesArr.push({
      name,
      order,
      categories,
      values,
      xValues,
      colorHex,
      dataPointColors,
      formatCode,
      markerSymbol,
      markerSize,
    });
  }

  // Sort by c:order so legend/stacking matches PPT
  seriesArr.sort((a, b) => a.order - b.order);

  return seriesArr;
}

// ---------------------------------------------------------------------------
// Chart Title
// ---------------------------------------------------------------------------

/**
 * Extract chart title from chartSpace > chart > title.
 * Returns undefined when autoTitleDeleted val="1" (title was intentionally removed).
 */
function extractChartTitle(chartNode: SafeXmlNode): string | undefined {
  // Respect autoTitleDeleted: if set, the title should not be shown
  const autoTitleDeleted = chartNode.child('autoTitleDeleted');
  if (autoTitleDeleted.exists() && autoTitleDeleted.attr('val') === '1') {
    return undefined;
  }

  const title = chartNode.child('title');
  if (!title.exists()) return undefined;

  const tx = title.child('tx');
  if (!tx.exists()) return undefined;

  // Try rich text: tx > rich > p > r > t
  const rich = tx.child('rich');
  if (rich.exists()) {
    const parts: string[] = [];
    for (const p of rich.children('p')) {
      for (const r of p.children('r')) {
        const t = r.child('t').text();
        if (t) parts.push(t);
      }
    }
    if (parts.length > 0) return parts.join('');
  }

  // Try strRef
  const strRef = tx.child('strRef');
  if (strRef.exists()) {
    const strCache = strRef.child('strCache');
    const pts = strCache.children('pt');
    if (pts.length > 0) return pts[0].child('v').text();
  }

  return undefined;
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

/**
 * Extract text color/font size from a txPr node:
 * txPr > p > pPr > defRPr (solidFill + sz).
 */
function extractTxPrStyle(
  parentNode: SafeXmlNode,
  ctx: RenderContext,
): { color?: string; fontSize?: number; bold?: boolean } | undefined {
  const txPr = parentNode.child('txPr');
  if (!txPr.exists()) return undefined;

  for (const p of txPr.children('p')) {
    const pPr = p.child('pPr');
    if (!pPr.exists()) continue;
    const defRPr = pPr.child('defRPr');
    if (!defRPr.exists()) continue;

    const style: { color?: string; fontSize?: number; bold?: boolean } = {};
    const fill = defRPr.child('solidFill');
    if (fill.exists()) {
      const c = resolveColorToHex(fill, ctx);
      if (c) style.color = c;
    }
    const sz = defRPr.numAttr('sz');
    if (sz !== undefined && sz > 0) {
      // OOXML sz is 1/100 pt. Keep renderer's existing px-scale convention.
      style.fontSize = Math.round(sz / 100);
    }
    const b = defRPr.attr('b');
    if (b === '1' || b === 'true') style.bold = true;
    else if (b === '0' || b === 'false') style.bold = false;

    if (style.color || style.fontSize !== undefined || style.bold !== undefined) return style;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

/** Parsed legend info including overlay flag. */
interface LegendInfo {
  option: echarts.EChartsOption['legend'];
  overlay: boolean; // true = legend overlaps plot area (don't reserve grid space)
  textStyle?: {
    color?: string;
    fontSize?: number;
    fontWeight?: 'normal' | 'bold' | 'bolder' | 'lighter' | number;
  };
  manualLayout?: Partial<Record<'left' | 'top' | 'width' | 'height', string>>;
}

/**
 * Extract legend position from chartSpace > chart > legend > legendPos.
 */
function extractLegendInfo(chartNode: SafeXmlNode, ctx: RenderContext): LegendInfo | undefined {
  const legend = chartNode.child('legend');
  if (!legend.exists()) return undefined;

  const legendPos = legend.child('legendPos');
  // OOXML default legend position is 'r' (right) per the spec, not 'b'
  const posVal = legendPos.exists() ? legendPos.attr('val') || 'r' : 'r';

  const overlay = legend.child('overlay').attr('val') === '1';

  // Map OOXML positions to ECharts; keep legend inside and below chart title (avoid overlap on slide 4, 6, etc.)
  const base = { confine: true as const };
  const topBelowTitle = '14%'; // leave room for chart title so legend does not overlap
  let option: echarts.EChartsOption['legend'];
  switch (posVal) {
    case 'b':
      option = { ...base, bottom: '5%', orient: 'horizontal' as const };
      break;
    case 't':
      option = { ...base, top: topBelowTitle, orient: 'horizontal' as const };
      break;
    case 'l':
      option = { ...base, left: '2%', orient: 'vertical' as const };
      break;
    case 'r':
      option = { ...base, right: '2%', orient: 'vertical' as const };
      break;
    case 'tr':
      option = { ...base, top: topBelowTitle, right: '2%', orient: 'vertical' as const };
      break;
    default:
      option = { ...base, right: '2%', orient: 'vertical' as const };
      break;
  }
  return {
    option,
    overlay,
    textStyle: (() => {
      const s = extractTxPrStyle(legend, ctx);
      if (!s) return undefined;
      return {
        ...(s.color ? { color: s.color } : {}),
        ...(s.fontSize !== undefined ? { fontSize: s.fontSize } : {}),
        ...(s.bold === true ? { fontWeight: 'bold' } : {}),
      };
    })(),
    manualLayout: extractLegendManualLayout(legend),
  };
}

/**
 * Parse legend/layout/manualLayout to ECharts legend position/size override.
 */
function extractLegendManualLayout(
  legendNode: SafeXmlNode,
): Partial<Record<'left' | 'top' | 'width' | 'height', string>> {
  const manual = legendNode.child('layout').child('manualLayout');
  if (!manual.exists()) return {};
  const out: Partial<Record<'left' | 'top' | 'width' | 'height', string>> = {};
  const x = manual.child('x').numAttr('val');
  const y = manual.child('y').numAttr('val');
  const w = manual.child('w').numAttr('val');
  const h = manual.child('h').numAttr('val');
  if (x !== undefined) out.left = numToPct(x);
  if (y !== undefined) out.top = numToPct(y);
  if (w !== undefined) out.width = numToPct(w);
  if (h !== undefined) out.height = numToPct(h);
  return out;
}

/** True when legend is positioned at top (t or tr), so plot area should reserve more top space. */
function legendIsAtTop(legendInfo: LegendInfo | undefined): boolean {
  if (!legendInfo || !legendInfo.option || typeof legendInfo.option !== 'object') return false;
  const o = legendInfo.option as Record<string, unknown>;
  return o.top !== undefined && o.top !== null;
}

/**
 * Grid top reserve in pixels. Use fixed pixels so small chart containers (e.g. in shapes)
 * don't get oversized percentage reserve and avoid legend overlapping data labels.
 * When legend overlay=true, don't reserve extra space for legend.
 */
function getGridTopPx(hasTitle: boolean, legendInfo: LegendInfo | undefined): number {
  const atTop = legendIsAtTop(legendInfo);
  const overlayLegend = legendInfo?.overlay ?? false;
  if (hasTitle) return atTop && !overlayLegend ? 52 : 40;
  return atTop && !overlayLegend ? 32 : 20;
}

/** Legend top in pixels when legend is at top, so it sits below title and above grid. */
function getLegendTopPx(hasTitle: boolean, legendInfo: LegendInfo | undefined): number | undefined {
  if (!legendIsAtTop(legendInfo)) return undefined;
  return hasTitle ? 26 : 6;
}

/** Grid bottom in pixels — leave more room when the legend sits at the bottom. */
function getGridBottomPx(legendInfo: LegendInfo | undefined): number {
  if (legendInfo) {
    const opt = legendInfo.option as Record<string, unknown> | undefined;
    if (opt && opt.bottom !== undefined) {
      // Legend is at bottom — reserve space for it so axis labels don't overlap
      return 35;
    }
  }
  return 8;
}
const _GRID_BOTTOM_PX = 8; // kept as default for chart types that don't call the function

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

function buildLegendOption(
  legendOpt: echarts.EChartsOption['legend'] | undefined,
  legendInfo: LegendInfo | undefined,
  legendTopPx: number | undefined,
  data: (string | { name: string; icon?: string })[],
  textStyle: {
    color?: string;
    fontSize?: number;
    fontWeight?: 'normal' | 'bold' | 'bolder' | 'lighter' | number;
  },
): echarts.EChartsOption['legend'] {
  if (!legendOpt) return { show: false };
  const manual = legendInfo?.manualLayout ?? {};
  const top =
    manual.top !== undefined ? manual.top : legendTopPx !== undefined ? legendTopPx : undefined;
  return {
    ...legendOpt,
    ...manual,
    ...(top !== undefined ? { top } : {}),
    data,
    textStyle,
  };
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
// Axis Parsing
// ---------------------------------------------------------------------------

const DEFAULT_AXIS_INFO: AxisInfo = {
  deleted: false,
  tickLblPos: 'nextTo',
  hasMajorGridlines: false,
  orientation: 'minMax',
};

/**
 * Extract label color from axis txPr: txPr > p > pPr > defRPr > solidFill.
 */
function extractAxisLabelColor(ax: SafeXmlNode, ctx: RenderContext): string | undefined {
  const txPr = ax.child('txPr');
  if (!txPr.exists()) return undefined;

  // Navigate: txPr > a:p > a:pPr > a:defRPr > a:solidFill
  for (const p of txPr.children('p')) {
    const pPr = p.child('pPr');
    if (!pPr.exists()) continue;
    const defRPr = pPr.child('defRPr');
    if (!defRPr.exists()) continue;
    const fill = defRPr.child('solidFill');
    if (fill.exists()) {
      return resolveColorToHex(fill, ctx);
    }
  }
  return undefined;
}

/**
 * Extract axis line color from axis spPr: spPr > ln > solidFill.
 */
function extractAxisLineColor(ax: SafeXmlNode, ctx: RenderContext): string | undefined {
  const ln = ax.child('spPr').child('ln');
  if (!ln.exists()) return undefined;
  const fill = ln.child('solidFill');
  if (!fill.exists()) return undefined;
  return resolveColorToHex(fill, ctx);
}

/**
 * Parse a single axis node (c:valAx, c:catAx, or c:dateAx) into AxisInfo.
 */
function parseAxisNode(ax: SafeXmlNode, ctx: RenderContext): AxisInfo {
  if (!ax.exists()) return { ...DEFAULT_AXIS_INFO };
  const deleted = ax.child('delete').attr('val') === '1';
  const tickLblPos = ax.child('tickLblPos').attr('val') || 'nextTo';
  const numFmtNode = ax.child('numFmt');
  const numFmt = numFmtNode.exists() ? numFmtNode.attr('formatCode') || undefined : undefined;
  const scaling = ax.child('scaling');
  const minNode = scaling.child('min');
  const maxNode = scaling.child('max');
  const min = minNode.exists() ? parseFloat(minNode.attr('val') || '') : undefined;
  const max = maxNode.exists() ? parseFloat(maxNode.attr('val') || '') : undefined;
  const hasMajorGridlines = ax.child('majorGridlines').exists();
  const orientation = scaling.child('orientation').attr('val') || 'minMax';
  const txStyle = extractTxPrStyle(ax, ctx);
  const labelColor = txStyle?.color ?? extractAxisLabelColor(ax, ctx);
  const labelFontSize = txStyle?.fontSize;
  const lineColor = extractAxisLineColor(ax, ctx);
  return {
    deleted,
    tickLblPos,
    numFmt: numFmt && numFmt !== 'General' ? numFmt : undefined,
    min: min !== undefined && !isNaN(min) ? min : undefined,
    max: max !== undefined && !isNaN(max) ? max : undefined,
    hasMajorGridlines,
    orientation,
    labelColor,
    labelFontSize,
    lineColor,
  };
}

/** Parse value axis and category axis from plotArea. Also checks dateAx as category fallback. */
function parseAxes(
  plotArea: SafeXmlNode,
  ctx: RenderContext,
): { valueAxis: AxisInfo; categoryAxis: AxisInfo } {
  const valAx = plotArea.child('valAx');
  const catAx = plotArea.child('catAx');
  const dateAx = plotArea.child('dateAx');
  return {
    valueAxis: parseAxisNode(valAx, ctx),
    categoryAxis: catAx.exists() ? parseAxisNode(catAx, ctx) : parseAxisNode(dateAx, ctx),
  };
}

/**
 * Apply axis visibility and styling to an ECharts axis definition.
 * Handles: delete (hide everything), tickLblPos=none (hide only labels),
 * min/max (scaling), numFmt (label formatter), majorGridlines (splitLine).
 */
function applyAxisInfo(
  axisDef: Record<string, unknown>,
  info: AxisInfo,
  kind: 'value' | 'category',
): void {
  // Fully deleted axis: hide everything
  if (info.deleted) {
    axisDef.axisLabel = { ...((axisDef.axisLabel as object) || {}), show: false };
    axisDef.axisLine = { show: false };
    axisDef.axisTick = { show: false };
    if (kind === 'value') axisDef.splitLine = { show: false };
    return;
  }

  // tickLblPos=none: hide labels only, keep axis line/tick
  if (info.tickLblPos === 'none') {
    axisDef.axisLabel = { ...((axisDef.axisLabel as object) || {}), show: false };
  }

  // Scaling min/max
  if (kind === 'value') {
    if (info.min !== undefined) axisDef.min = info.min;
    if (info.max !== undefined) axisDef.max = info.max;
  }

  // Axis numFmt → label formatter (only for value axis, and only if not already set by series pctFormat)
  if (kind === 'value' && info.numFmt && !info.deleted && info.tickLblPos !== 'none') {
    const existingLabel = (axisDef.axisLabel as Record<string, unknown>) || {};
    if (!existingLabel.formatter) {
      const nf = info.numFmt;
      axisDef.axisLabel = {
        ...existingLabel,
        formatter: (val: number) => formatValue(val, nf),
      };
    }
  }

  // Major gridlines → splitLine
  if (kind === 'value') {
    if (!info.hasMajorGridlines) {
      axisDef.splitLine = { show: false };
    }
    // If has gridlines, ECharts shows them by default — no action needed
  }

  // Axis label color from txPr
  if (info.labelColor) {
    const existingLabel = (axisDef.axisLabel as Record<string, unknown>) || {};
    axisDef.axisLabel = { ...existingLabel, color: info.labelColor };
  }
  if (info.labelFontSize !== undefined) {
    const existingLabel = (axisDef.axisLabel as Record<string, unknown>) || {};
    axisDef.axisLabel = { ...existingLabel, fontSize: info.labelFontSize };
  }

  // Axis line color from spPr > ln
  if (info.lineColor) {
    const existingLine = (axisDef.axisLine as Record<string, unknown>) || {};
    const existingLineStyle = (existingLine.lineStyle as Record<string, unknown>) || {};
    axisDef.axisLine = {
      ...existingLine,
      show: existingLine.show ?? true,
      lineStyle: { ...existingLineStyle, color: info.lineColor },
    };
  }
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

function buildBarChartOption(
  chartTypeNode: SafeXmlNode,
  chartNode: SafeXmlNode,
  seriesArr: SeriesData[],
  ctx: RenderContext,
): echarts.EChartsOption {
  const barDir = chartTypeNode.child('barDir').attr('val') || chartTypeNode.attr('barDir') || 'col';
  const groupingNode = chartTypeNode.child('grouping');
  const grouping = groupingNode.exists() ? groupingNode.attr('val') || 'clustered' : 'clustered';
  const isHorizontal = barDir === 'bar';

  // Layout parameters
  const gapWidth = chartTypeNode.child('gapWidth').numAttr('val');
  const overlap = chartTypeNode.child('overlap').numAttr('val');

  // Use categories from the first series that has them
  const categories = seriesArr.find((s) => s.categories.length > 0)?.categories || [];

  const title = extractChartTitle(chartNode);
  const titleStyle = extractTxPrStyle(chartNode.child('title'), ctx);
  const titleLayout = extractTitleManualLayout(chartNode);
  const legendInfo = extractLegendInfo(chartNode, ctx);
  const legendOpt = legendInfo?.option;
  const legendTextStyle = { fontSize: 10, ...(legendInfo?.textStyle ?? {}) };

  const isStacked = grouping === 'stacked' || grouping === 'percentStacked';

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

  const series: echarts.BarSeriesOption[] = seriesArr.map((s, idx) => {
    // Capture formatCode for use in label formatter closure
    const fc = s.formatCode;
    const perSeriesLabels =
      parseDataLabels(serNodesByOrder[idx] ?? chartTypeNode, ctx) ?? sharedLabels;

    const buildLabel = (
      cfg: DataLabelConfig | Partial<DataLabelConfig> | undefined,
    ): echarts.BarSeriesOption['label'] =>
      cfg?.showVal
        ? {
            show: true,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            position: mapBarLabelPosition(cfg.position, isStacked) as any,
            fontSize: cfg.fontSize ?? 9,
            ...(cfg.color ? { color: cfg.color } : {}),
            ...(cfg.bold === true ? { fontWeight: 'bold' } : {}),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter: (params: any) => {
              const rawVal = params?.value;
              const val =
                rawVal && typeof rawVal === 'object' && 'value' in rawVal ? rawVal.value : rawVal;
              if (val === 0 || val === null) return '';
              return formatValue(val, fc);
            },
          }
        : undefined;

    // Per-series label config (override shared)
    const label: echarts.BarSeriesOption['label'] = buildLabel(perSeriesLabels);
    const dLblsNode = (serNodesByOrder[idx] ?? chartTypeNode).child('dLbls');
    const pointOverrides = parsePointDataLabelOverrides(dLblsNode, ctx);
    const data: echarts.BarSeriesOption['data'] = s.values.map((v, pointIdx) => {
      const ov = pointOverrides.get(pointIdx);
      if (!ov) return v;
      const merged: DataLabelConfig = {
        showVal: perSeriesLabels?.showVal ?? false,
        showCatName: perSeriesLabels?.showCatName ?? false,
        showSerName: perSeriesLabels?.showSerName ?? false,
        showPercent: perSeriesLabels?.showPercent ?? false,
        position: perSeriesLabels?.position,
        color: perSeriesLabels?.color,
        fontSize: perSeriesLabels?.fontSize,
        bold: perSeriesLabels?.bold,
        ...ov,
      };
      return {
        value: v,
        label: buildLabel(merged),
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
      barGap: overlap !== undefined ? `${-overlap}%` : undefined,
      // OOXML gapWidth = gap-between-groups / bar-width × 100.
      // ECharts barCategoryGap = gap / category-band × 100 where band = bar + gap.
      // So barCategoryGap = gapWidth / (100 + gapWidth) × 100.
      barCategoryGap:
        gapWidth !== undefined ? `${Math.round((gapWidth * 100) / (100 + gapWidth))}%` : undefined,
    };
  });

  const plotArea = chartNode.child('plotArea');
  const { valueAxis, categoryAxis } = parseAxes(plotArea, ctx);

  const categoryAxisDef: Record<string, unknown> = {
    type: 'category',
    data: categories,
    axisLabel: { interval: 0, rotate: categories.length > 6 ? 30 : 0, fontSize: 10 },
  };
  applyAxisInfo(categoryAxisDef, categoryAxis, 'category');

  // Check if any series uses percentage format; axis numFmt takes priority
  const pctFormat =
    valueAxis.numFmt || seriesArr.find((s) => s.formatCode?.includes('%'))?.formatCode;
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
  applyAxisInfo(valueAxisDef, valueAxis, 'value');

  const gridTop = getGridTopPx(!!title, legendInfo);
  const legendTopPx = getLegendTopPx(!!title, legendInfo);
  // When value axis is hidden, reduce left/right padding so bars use full width
  const gridLeft = valueAxis.deleted && !isHorizontal ? 4 : 10;
  const gridRight = 10;
  // Determine a shared format code for tooltips: prefer axis numFmt, then first series formatCode
  const tooltipFmt = pctFormat || seriesArr.find((s) => s.formatCode)?.formatCode;
  const gridBottom = getGridBottomPx(legendInfo);
  const manualGrid = extractManualLayoutGrid(chartNode);
  const containLabel = !hasManualGrid(manualGrid);

  return {
    title: title
      ? {
          text: title,
          left: 'center',
          ...titleLayout,
          textStyle: { fontSize: 12, ...(titleStyle ?? {}) },
        }
      : undefined,
    tooltip: {
      trigger: 'axis' as const,
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
  } as echarts.EChartsOption;
}

function buildLineChartOption(
  chartTypeNode: SafeXmlNode,
  chartNode: SafeXmlNode,
  seriesArr: SeriesData[],
  ctx: RenderContext,
  isArea: boolean,
): echarts.EChartsOption {
  const categories = seriesArr.find((s) => s.categories.length > 0)?.categories || [];
  const title = extractChartTitle(chartNode);
  const titleStyle = extractTxPrStyle(chartNode.child('title'), ctx);
  const titleLayout = extractTitleManualLayout(chartNode);
  const legendInfo = extractLegendInfo(chartNode, ctx);
  const legendOpt = legendInfo?.option;
  const legendTextStyle = { fontSize: 10, ...(legendInfo?.textStyle ?? {}) };

  const series: echarts.LineSeriesOption[] = seriesArr.map((s) => {
    const echartsSymbol = mapOoxmlSymbol(s.markerSymbol);
    const showSymbol = echartsSymbol !== undefined ? echartsSymbol !== 'none' : undefined;
    return {
      type: 'line' as const,
      name: s.name,
      data: s.values,
      areaStyle: isArea ? (s.colorHex ? { color: s.colorHex } : {}) : undefined,
      itemStyle: s.colorHex ? { color: s.colorHex } : undefined,
      lineStyle: s.colorHex ? { color: s.colorHex } : undefined,
      ...(echartsSymbol && echartsSymbol !== 'none' ? { symbol: echartsSymbol } : {}),
      ...(s.markerSize ? { symbolSize: s.markerSize } : {}),
      ...(showSymbol !== undefined ? { showSymbol } : {}),
    };
  });

  const plotArea = chartNode.child('plotArea');
  const { valueAxis, categoryAxis } = parseAxes(plotArea, ctx);

  const pctFormat =
    valueAxis.numFmt || seriesArr.find((s) => s.formatCode?.includes('%'))?.formatCode;
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
  applyAxisInfo(yAxisDef, valueAxis, 'value');

  const xAxisDef: Record<string, unknown> = {
    type: 'category',
    data: categories,
    axisLabel: { interval: 0, rotate: categories.length > 6 ? 30 : 0 },
  };
  applyAxisInfo(xAxisDef, categoryAxis, 'category');

  const gridTop = getGridTopPx(!!title, legendInfo);
  const legendTopPx = getLegendTopPx(!!title, legendInfo);
  const gridLeft = valueAxis.deleted ? 4 : 10;
  const tooltipFmt = pctFormat || seriesArr.find((s) => s.formatCode)?.formatCode;
  const gridBottom = getGridBottomPx(legendInfo);
  const manualGrid = extractManualLayoutGrid(chartNode);
  const containLabel = !hasManualGrid(manualGrid);
  return {
    title: title
      ? {
          text: title,
          left: 'center',
          ...titleLayout,
          textStyle: { fontSize: 14, ...(titleStyle ?? {}) },
        }
      : undefined,
    tooltip: {
      trigger: 'axis' as const,
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
      seriesArr.map((s) => {
        const icon = mapOoxmlSymbol(s.markerSymbol);
        return icon && icon !== 'none' ? { name: s.name, icon } : s.name;
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
): echarts.EChartsOption {
  const title = extractChartTitle(chartNode);
  const titleStyle = extractTxPrStyle(chartNode.child('title'), ctx);
  const titleLayout = extractTitleManualLayout(chartNode);
  const legendInfo = extractLegendInfo(chartNode, ctx);
  const legendOpt = legendInfo?.option;
  const legendTextStyle = { fontSize: 10, ...(legendInfo?.textStyle ?? {}) };

  // Pie charts typically use the first series
  const firstSeries = seriesArr[0];
  if (!firstSeries) {
    return { title: title ? { text: title } : undefined };
  }

  // Parse data labels: for pie, prefer first series (ser) over chart-type — left/right pies may differ
  const firstSer = chartTypeNode.children('ser')[0];
  let sharedLabels = firstSer?.exists() ? parseDataLabels(firstSer, ctx) : undefined;
  if (!sharedLabels) sharedLabels = parseDataLabels(chartTypeNode, ctx);

  // Parse explosion from the first c:ser element
  const explosions = firstSer ? parseExplosion(firstSer) : undefined;

  const pieData = firstSeries.categories.map((cat, i) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item: any = {
      name: cat || `Item ${i + 1}`,
      value: firstSeries.values[i] ?? 0,
    };
    // Per-point color
    if (firstSeries.dataPointColors && firstSeries.dataPointColors[i]) {
      item.itemStyle = { color: firstSeries.dataPointColors[i] };
    }
    // Explosion (selected offset)
    if (explosions && explosions[i] && explosions[i] > 0) {
      item.selected = true;
      item.selectedOffset = Math.min(explosions[i], 15); // cap to prevent oversized offsets
    }
    return item;
  });

  const radius: [string, string] | string = isDoughnut ? ['40%', '70%'] : '70%';

  // Build label formatter based on data label config; show value and percent when requested
  const fc = firstSeries.formatCode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let labelFormatter: string | ((params: any) => string) = '{b}: {c} ({d}%)';
  if (sharedLabels) {
    if (sharedLabels.showVal && fc && fc.includes('%')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      labelFormatter = (params: any) => {
        const parts: string[] = [];
        if (sharedLabels!.showCatName) parts.push(params.name);
        parts.push(formatValue(params.value, fc));
        if (sharedLabels!.showPercent) parts.push(`${params.percent}%`);
        return parts.join(', ');
      };
    } else {
      const parts: string[] = [];
      if (sharedLabels.showCatName) parts.push('{b}');
      if (sharedLabels.showVal) parts.push('{c}');
      if (sharedLabels.showPercent) parts.push('{d}%');
      labelFormatter = parts.length > 0 ? parts.join(' ') : '{b}: {c} ({d}%)';
    }
  }

  const series: echarts.PieSeriesOption[] = [
    {
      type: 'pie' as const,
      name: firstSeries.name,
      radius,
      data: pieData,
      selectedMode: explosions ? 'single' : false,
      label: {
        show: true,
        formatter: labelFormatter,
        fontSize: sharedLabels?.fontSize ?? 10,
        ...(sharedLabels?.bold === true ? { fontWeight: 'bold' as const } : {}),
        position:
          sharedLabels?.position === 'outEnd'
            ? 'outside'
            : sharedLabels?.position === 'ctr'
              ? 'inside'
              : 'outside',
      },
    },
  ];

  const legendTopPx = getLegendTopPx(!!title, legendInfo);
  const tooltipFmt = fc;
  return {
    title: title
      ? {
          text: title,
          left: 'center',
          ...titleLayout,
          textStyle: { fontSize: 12, ...(titleStyle ?? {}) },
        }
      : undefined,
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
    legend: buildLegendOption(
      legendOpt,
      legendInfo,
      legendTopPx,
      firstSeries.categories,
      legendTextStyle,
    ),
    series,
  };
}

function buildRadarChartOption(
  chartTypeNode: SafeXmlNode,
  chartNode: SafeXmlNode,
  seriesArr: SeriesData[],
  ctx: RenderContext,
): echarts.EChartsOption {
  const title = extractChartTitle(chartNode);
  const titleStyle = extractTxPrStyle(chartNode.child('title'), ctx);
  const titleLayout = extractTitleManualLayout(chartNode);
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
    for (const s of seriesArr) {
      for (const v of s.values) {
        if (v > maxVal) maxVal = v;
      }
    }
    indicatorMax = Math.ceil(maxVal * 1.1) || 100;
  }

  // PowerPoint radar charts place categories clockwise from top,
  // but ECharts places indicators counterclockwise. To match PowerPoint,
  // keep the first category at top and reverse the rest.
  const cwCategories =
    categories.length > 1 ? [categories[0], ...categories.slice(1).reverse()] : categories;

  const indicator = cwCategories.map((cat) => ({
    name: cat,
    max: indicatorMax,
  }));

  // Read radar style to determine default marker behavior
  const radarStyle = chartTypeNode.child('radarStyle').attr('val'); // 'marker' | 'filled' | undefined

  const radarData = seriesArr.map((s, idx) => {
    const color = s.colorHex ?? DEFAULT_SERIES_COLORS[idx % DEFAULT_SERIES_COLORS.length];
    // Reorder values to match the reversed category order
    const cwValues = s.values.length > 1 ? [s.values[0], ...s.values.slice(1).reverse()] : s.values;
    const echartsSymbol = mapOoxmlSymbol(s.markerSymbol);
    // Show symbols if radarStyle is 'marker' or series has explicit marker
    const showSymbol =
      radarStyle === 'marker' || (echartsSymbol !== undefined && echartsSymbol !== 'none');
    return {
      name: s.name,
      value: cwValues,
      lineStyle: { color },
      itemStyle: { color },
      ...(echartsSymbol && echartsSymbol !== 'none' ? { symbol: echartsSymbol } : {}),
      ...(s.markerSize ? { symbolSize: s.markerSize } : {}),
      ...(showSymbol ? { symbolSize: s.markerSize ?? 6 } : {}),
    };
  });

  const legendTopPx = getLegendTopPx(!!title, legendInfo);
  return {
    title: title
      ? {
          text: title,
          left: 'center',
          ...titleLayout,
          textStyle: { fontSize: 12, ...(titleStyle ?? {}) },
        }
      : undefined,
    tooltip: {},
    legend: buildLegendOption(
      legendOpt,
      legendInfo,
      legendTopPx,
      seriesArr.map((s) => {
        const icon = mapOoxmlSymbol(s.markerSymbol);
        return icon && icon !== 'none' ? { name: s.name, icon } : s.name;
      }),
      legendTextStyle,
    ),
    radar: { indicator, radius: '58%', center: ['50%', '55%'] },
    series: [
      {
        type: 'radar' as const,
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
): echarts.EChartsOption {
  const title = extractChartTitle(chartNode);
  const titleStyle = extractTxPrStyle(chartNode.child('title'), ctx);
  const titleLayout = extractTitleManualLayout(chartNode);
  const legendInfo = extractLegendInfo(chartNode, ctx);
  const legendOpt = legendInfo?.option;
  const legendTextStyle = { fontSize: 10, ...(legendInfo?.textStyle ?? {}) };

  const series: echarts.ScatterSeriesOption[] = seriesArr.map((s) => {
    // Use xValues if available (parsed from c:xVal), otherwise fall back to index
    const data = s.values.map((v, i) => {
      const x = s.xValues && i < s.xValues.length ? s.xValues[i] : i;
      return [x, v];
    });
    return {
      type: 'scatter' as const,
      name: s.name,
      data,
      itemStyle: s.colorHex ? { color: s.colorHex } : undefined,
    };
  });

  const plotArea = chartNode.child('plotArea');
  const { valueAxis } = parseAxes(plotArea, ctx);

  const gridTop = getGridTopPx(!!title, legendInfo);
  const legendTopPx = getLegendTopPx(!!title, legendInfo);
  const manualGrid = extractManualLayoutGrid(chartNode);
  const containLabel = !hasManualGrid(manualGrid);

  const xAxisDef: Record<string, unknown> = { type: 'value' };
  const yAxisDef: Record<string, unknown> = { type: 'value' };
  applyAxisInfo(yAxisDef, valueAxis, 'value');

  return {
    title: title
      ? {
          text: title,
          left: 'center',
          ...titleLayout,
          textStyle: { fontSize: 14, ...(titleStyle ?? {}) },
        }
      : undefined,
    tooltip: { trigger: 'item' },
    legend: buildLegendOption(
      legendOpt,
      legendInfo,
      legendTopPx,
      seriesArr.map((s) => s.name),
      legendTextStyle,
    ),
    grid: {
      containLabel,
      left: 10,
      right: 10,
      top: gridTop,
      bottom: getGridBottomPx(legendInfo),
      ...manualGrid,
    },
    xAxis: xAxisDef,
    yAxis: yAxisDef,
    series,
  };
}

// ---------------------------------------------------------------------------
// Data Table (c:dTable)
// ---------------------------------------------------------------------------

/** Parsed c:dTable info for building the chart data table. */
interface DataTableInfo {
  seriesArr: SeriesData[];
  showKeys: boolean;
  formatCode?: string;
}

/**
 * Check if plotArea has c:dTable and parse showKeys.
 */
function parseDataTable(plotArea: SafeXmlNode): { showKeys: boolean } | undefined {
  const dTable = plotArea.child('dTable');
  if (!dTable.exists()) return undefined;
  const showKeys = dTable.child('showKeys').attr('val') !== '0';
  return { showKeys };
}

/**
 * Build HTML table element from series data for chart data table (c:dTable).
 */
function buildDataTableElement(info: DataTableInfo, seriesColors?: string[]): HTMLTableElement {
  const table = document.createElement('table');
  table.style.width = '100%';
  table.style.borderCollapse = 'collapse';
  table.style.fontSize = '10px';
  table.style.marginTop = '8px';

  const { seriesArr, showKeys, formatCode } = info;
  const categories = seriesArr.find((s) => s.categories.length > 0)?.categories || [];
  const fc = formatCode || seriesArr.find((s) => s.formatCode)?.formatCode;

  // Header row: empty cell + category names (columns = categories, matching X-axis)
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const emptyTh = document.createElement('th');
  emptyTh.style.border = '1px solid #ccc';
  emptyTh.style.padding = '2px 6px';
  emptyTh.style.textAlign = 'left';
  emptyTh.style.fontWeight = 'bold';
  headerRow.appendChild(emptyTh);
  for (let i = 0; i < categories.length; i++) {
    const th = document.createElement('th');
    th.style.border = '1px solid #ccc';
    th.style.padding = '2px 6px';
    th.style.textAlign = 'right';
    th.style.fontWeight = 'bold';
    th.textContent = categories[i] ?? '';
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Data rows: series name (with optional legend key) + values across categories
  const tbody = document.createElement('tbody');
  for (let si = 0; si < seriesArr.length; si++) {
    const s = seriesArr[si];
    const tr = document.createElement('tr');
    const nameTd = document.createElement('td');
    nameTd.style.border = '1px solid #ccc';
    nameTd.style.padding = '2px 6px';
    nameTd.style.textAlign = 'left';
    nameTd.style.fontWeight = 'bold';
    if (showKeys && seriesColors && seriesColors[si]) {
      const key = document.createElement('span');
      key.style.display = 'inline-block';
      key.style.width = '8px';
      key.style.height = '8px';
      key.style.marginRight = '4px';
      key.style.verticalAlign = 'middle';
      key.style.backgroundColor = seriesColors[si];
      nameTd.appendChild(key);
    }
    nameTd.appendChild(document.createTextNode(s.name || ''));
    tr.appendChild(nameTd);
    for (let ci = 0; ci < categories.length; ci++) {
      const td = document.createElement('td');
      td.style.border = '1px solid #ccc';
      td.style.padding = '2px 6px';
      td.style.textAlign = 'right';
      const val = s.values[ci];
      td.textContent = val !== undefined ? formatValue(val, fc ?? s.formatCode) : '';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  return table;
}

// ---------------------------------------------------------------------------
// Main Chart XML Parser
// ---------------------------------------------------------------------------

/**
 * Extract background colors from chartSpace and plotArea.
 * Returns { chartBg, plotAreaBg } hex color strings or undefined.
 */
function extractBackgroundColors(
  chartXml: SafeXmlNode,
  chartNode: SafeXmlNode,
  ctx: RenderContext,
): { chartBg?: string; plotAreaBg?: string } {
  let chartBg: string | undefined;
  let plotAreaBg: string | undefined;

  // chartSpace > spPr > solidFill (overall chart background)
  const chartSpaceSpPr = chartXml.child('spPr');
  if (chartSpaceSpPr.exists()) {
    const noFill = chartSpaceSpPr.child('noFill');
    if (noFill.exists()) {
      // Explicit noFill — leave chartBg undefined (transparent)
    } else {
      const fill = chartSpaceSpPr.child('solidFill');
      if (fill.exists()) {
        chartBg = resolveColorToHex(fill, ctx);
      } else {
        // No fill specified — use white so chart area is visible
        chartBg = '#ffffff';
      }
    }
  }

  // chart > plotArea > spPr > solidFill (plot area background)
  const plotArea = chartNode.child('plotArea');
  if (plotArea.exists()) {
    const plotSpPr = plotArea.child('spPr');
    if (plotSpPr.exists()) {
      const noFill = plotSpPr.child('noFill');
      if (!noFill.exists()) {
        const fill = plotSpPr.child('solidFill');
        if (fill.exists()) {
          plotAreaBg = resolveColorToHex(fill, ctx);
        }
      }
    }
  }

  return { chartBg, plotAreaBg };
}

/**
 * Parse chartSpace-level clrMapOvr attributes into a color-map override.
 * Example: <c:clrMapOvr bg1="lt1" tx1="dk1" .../>
 */
function parseChartColorMapOverride(chartXml: SafeXmlNode): Map<string, string> | undefined {
  const clrMapOvr = chartXml.child('clrMapOvr');
  if (!clrMapOvr.exists()) return undefined;

  // Common forms:
  // 1) <c:clrMapOvr bg1="lt1" .../>
  // 2) <c:clrMapOvr><a:overrideClrMapping bg1="lt1" .../></c:clrMapOvr>
  // 3) <c:clrMapOvr><a:masterClrMapping/></c:clrMapOvr> (no override)
  let sourceEl = clrMapOvr.element;
  const override = clrMapOvr.child('overrideClrMapping');
  if (override.exists() && override.element) {
    sourceEl = override.element;
  } else {
    const master = clrMapOvr.child('masterClrMapping');
    if (master.exists()) return undefined;
  }
  if (!sourceEl) return undefined;

  const attrs = sourceEl.attributes;
  const map = new Map<string, string>();
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i];
    map.set(attr.localName, attr.value);
  }
  return map.size > 0 ? map : undefined;
}

/**
 * Create a chart-local render context that applies chartSpace clrMapOvr.
 */
function createChartRenderContext(chartXml: SafeXmlNode, ctx: RenderContext): RenderContext {
  const colorMapOverride = parseChartColorMapOverride(chartXml);
  if (!colorMapOverride) return ctx;
  return {
    ...ctx,
    layout: { ...ctx.layout, colorMapOverride },
    // color cache depends on color map; isolate chart-local cache.
    colorCache: new Map(),
  };
}

function parseChartStyleId(chartXml: SafeXmlNode): number | undefined {
  // c:chartSpace > c:style val="N"
  const styleNode = chartXml.child('style');
  const direct = styleNode.numAttr('val');
  if (direct !== undefined) return direct;

  // Some files use mc:AlternateContent > mc:Choice(c14) > c14:style
  const alt = chartXml.child('AlternateContent');
  if (!alt.exists()) return undefined;
  for (const branch of alt.allChildren()) {
    const s = branch.child('style');
    const v = s.numAttr('val');
    if (v !== undefined) return v;
  }
  return undefined;
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function tintHex(hex: string, amount: number): string {
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex;
  if (normalized.length !== 6) return hex.startsWith('#') ? hex : `#${hex}`;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return hex.startsWith('#') ? hex : `#${hex}`;
  const a = clamp01(amount);
  const mix = (c: number) => Math.round(c + (255 - c) * a);
  return `#${[mix(r), mix(g), mix(b)].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Build a chart color palette from theme accents and chart style id.
 * This improves parity with Office chart styles when series colors are implicit.
 */
function buildChartPalette(chartXml: SafeXmlNode, ctx: RenderContext): string[] | undefined {
  const accents = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']
    .map((k) => ctx.theme.colorScheme.get(k))
    .filter((v): v is string => !!v)
    .map((hex) => (hex.startsWith('#') ? hex : `#${hex}`));

  if (accents.length === 0) return undefined;

  const styleId = parseChartStyleId(chartXml);
  if (styleId === undefined) return accents;

  // Keep this conservative:
  // - style ids >= 100 tend to use stronger contrast; brighten the latter half.
  // - even style ids rotate palette to better match Office's style cycles.
  const palette = accents.slice();
  if (styleId % 2 === 0) {
    palette.push(...palette.splice(0, 1));
  }
  if (styleId >= 100) {
    for (let i = Math.floor(palette.length / 2); i < palette.length; i++) {
      palette[i] = tintHex(palette[i], 0.18);
    }
  }
  return palette;
}

function numToPct(val: number): string {
  const n = Math.round(val * 10000) / 100;
  return `${Number.isInteger(n) ? n.toFixed(0) : n}%`.replace(/\.0%$/, '%');
}

/**
 * Parse plotArea/layout/manualLayout to ECharts grid override.
 */
function extractManualLayoutGrid(
  chartNode: SafeXmlNode,
): Partial<Record<'left' | 'top' | 'width' | 'height', string>> {
  const manual = chartNode.child('plotArea').child('layout').child('manualLayout');
  if (!manual.exists()) return {};
  const out: Partial<Record<'left' | 'top' | 'width' | 'height', string>> = {};
  const x = manual.child('x').numAttr('val');
  const y = manual.child('y').numAttr('val');
  const w = manual.child('w').numAttr('val');
  const h = manual.child('h').numAttr('val');
  if (x !== undefined) out.left = numToPct(x);
  if (y !== undefined) out.top = numToPct(y);
  if (w !== undefined) out.width = numToPct(w);
  if (h !== undefined) out.height = numToPct(h);
  return out;
}

/** Result of parsing chart XML: option for ECharts, optional data table info. */
export interface ParseChartResult {
  option: echarts.EChartsOption;
  dataTable?: DataTableInfo;
}

/**
 * Parse a chart XML (chartSpace root) into an ECharts option object and optional data table info.
 * Exported for unit testing.
 */
export function parseChartXml(chartXml: SafeXmlNode, ctx: RenderContext): ParseChartResult {
  const chartCtx = createChartRenderContext(chartXml, ctx);
  const chartPalette = buildChartPalette(chartXml, chartCtx);
  // Navigate: chartSpace > chart > plotArea
  const chart = chartXml.child('chart');
  const plotArea = chart.child('plotArea');

  if (!plotArea.exists()) {
    return { option: { title: { text: 'Unsupported chart', left: 'center' } } };
  }

  // Extract background colors
  const { chartBg, plotAreaBg } = extractBackgroundColors(chartXml, chart, chartCtx);

  // Find the first chart type element with data
  // (Some plotAreas have multiple chart types, e.g. combo charts — pick the primary one)
  for (const typeName of CHART_TYPE_ELEMENTS) {
    const chartTypeNode = plotArea.child(typeName);
    if (!chartTypeNode.exists()) continue;

    const seriesArr = parseSeries(chartTypeNode, chartCtx);
    if (seriesArr.length === 0) continue;

    let option: echarts.EChartsOption;

    switch (typeName) {
      case 'barChart':
      case 'bar3DChart':
        option = buildBarChartOption(chartTypeNode, chart, seriesArr, chartCtx);
        break;

      case 'lineChart':
      case 'line3DChart':
        option = buildLineChartOption(chartTypeNode, chart, seriesArr, chartCtx, false);
        break;

      case 'areaChart':
      case 'area3DChart':
      case 'surface3DChart':
        option = buildLineChartOption(chartTypeNode, chart, seriesArr, chartCtx, true);
        break;

      case 'pieChart':
      case 'pie3DChart':
        option = buildPieChartOption(chartTypeNode, chart, seriesArr, false, chartCtx);
        break;

      case 'doughnutChart':
        option = buildPieChartOption(chartTypeNode, chart, seriesArr, true, chartCtx);
        break;

      case 'radarChart':
        option = buildRadarChartOption(chartTypeNode, chart, seriesArr, chartCtx);
        break;

      case 'scatterChart':
        option = buildScatterChartOption(chartTypeNode, chart, seriesArr, chartCtx);
        break;

      default:
        continue;
    }

    // Apply background colors
    if (chartBg) {
      option.backgroundColor = chartBg;
    }
    if (chartPalette && chartPalette.length > 0) {
      option.color = chartPalette;
    }
    if (plotAreaBg && option.grid) {
      // Apply plot area background via grid (for cartesian charts)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (option.grid as any).backgroundColor = plotAreaBg;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (option.grid as any).show = true;
    }

    // Build data table info when c:dTable exists
    const dTableMeta = parseDataTable(plotArea);
    const dataTable: DataTableInfo | undefined = dTableMeta
      ? {
          seriesArr,
          showKeys: dTableMeta.showKeys,
          formatCode: seriesArr.find((s) => s.formatCode)?.formatCode,
        }
      : undefined;

    return { option, dataTable };
  }

  return {
    option: {
      title: { text: 'Unsupported chart type', left: 'center', textStyle: { fontSize: 12 } },
    },
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
  const { option, dataTable } = parseChartXml(chartXml, ctx);

  // Append data table below chart when c:dTable exists
  if (dataTable) {
    const seriesColors = dataTable.seriesArr.map((s) => s.colorHex).filter(Boolean) as string[];
    const tableEl = buildDataTableElement(
      dataTable,
      seriesColors.length > 0 ? seriesColors : undefined,
    );
    wrapper.appendChild(tableEl);
  }

  // Initialize ECharts after the element is attached to the DOM.
  // Use requestAnimationFrame to ensure the container has dimensions.
  const chartSet = ctx.chartInstances;
  requestAnimationFrame(() => {
    if (!chartDiv.isConnected) return;
    // Guard against 0-size containers (e.g. hidden tabs); defer until non-zero.
    if (chartDiv.offsetWidth === 0 || chartDiv.offsetHeight === 0) {
      const sizeObserver = new ResizeObserver((entries) => {
        const { width, height } = entries[0].contentRect;
        if (width > 0 && height > 0) {
          sizeObserver.disconnect();
          initChart(chartDiv, option, chartSet);
        }
      });
      sizeObserver.observe(chartDiv);
      return;
    }
    initChart(chartDiv, option, chartSet);
  });

  return wrapper;
}

/** Actually create ECharts instance, set option, and wire up resize + dispose. */
function initChart(
  container: HTMLElement,
  option: echarts.EChartsOption,
  chartInstances?: Set<echarts.ECharts>,
): void {
  try {
    const chart = echarts.init(container);
    chart.setOption(option);
    chartInstances?.add(chart);

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
