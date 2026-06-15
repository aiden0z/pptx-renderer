/**
 * Chart renderer — converts OOXML chart XML into ECharts visualizations.
 */

import * as echarts from 'echarts';
import { ChartNodeData } from '../model/nodes/ChartNode';
import { RenderContext } from './RenderContext';
import { SafeXmlNode } from '../parser/XmlParser';
import { emuToPx, ptToPx } from '../parser/units';
import { parseOoxmlBool } from '../parser/booleans';
import { resolveColor, resolveLineStyle } from './StyleResolver';
import { cssFontFamilyStack, resolveThemeFontStack } from './fontResolver';

const MAX_CHART_CACHE_POINTS = 10_000;
const EXPLICIT_FONT_SIZE = Symbol('pptxExplicitFontSize');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SeriesData {
  name: string;
  order: number; // c:order val — used to sort series into correct sequence
  categories: string[];
  values: number[];
  xValues?: number[]; // scatter chart x values from c:xVal
  bubbleSizes?: number[]; // bubble chart sizes from c:bubbleSize
  colorHex?: string | object; // optional explicit series color (hex string or ECharts gradient)
  dataPointColors?: (string | undefined)[]; // per-point colors (for pie charts)
  dataPointStyles?: (DataPointStyle | undefined)[]; // per-point fill and border styles
  formatCode?: string; // numCache formatCode (e.g. "0%", "0.0%", "General")
  invertIfNegative?: boolean; // c:invertIfNegative, defaults are chart-type dependent
  markerSymbol?: string; // OOXML c:marker > c:symbol val
  markerSize?: number; // OOXML c:marker > c:size converted from points to px
  smooth?: boolean; // OOXML c:smooth val for scatter/line-like charts
  lineWidth?: number; // c:spPr > a:ln@w converted to renderer px scale
  lineNoFill?: boolean; // c:spPr > a:ln > a:noFill disables the series connector line
}

type ChartLineType = 'solid' | 'dashed' | 'dotted';

interface ChartLineStyle {
  color?: string;
  width?: number;
  type?: ChartLineType;
}

const DEFAULT_CHART_FOREGROUND_COLOR = '#000000';
const DEFAULT_MAJOR_GRIDLINE_STYLE: Required<ChartLineStyle> = {
  color: DEFAULT_CHART_FOREGROUND_COLOR,
  width: 1,
  type: 'solid',
};
const DEFAULT_RADAR_GRIDLINE_STYLE: Required<ChartLineStyle> = {
  color: '#868686',
  width: 1,
  type: 'solid',
};
const CHART_ACCENT_KEYS = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];

interface DataPointStyle {
  color?: string;
  borderColor?: string;
  borderWidth?: number;
  borderType?: ChartLineType;
}

/** Parsed axis information from plotArea valAx / catAx / dateAx. */
interface AxisInfo {
  deleted: boolean;
  tickLblPos: string; // 'nextTo' | 'none' | 'high' | 'low'
  crosses?: string; // 'autoZero' | 'min' | 'max'
  numFmt?: string; // formatCode from axis numFmt
  min?: number;
  max?: number;
  hasMajorGridlines: boolean;
  orientation: string; // 'minMax' | 'maxMin'
  title?: string;
  titleStyle?: ChartTextStyle;
  titleRotation?: number;
  labelColor?: string; // hex color from txPr for axis labels
  labelFontSize?: number; // px from txPr defRPr@sz
  lineColor?: string; // hex color from spPr > ln for axis line
  majorGridlineStyle?: ChartLineStyle; // c:majorGridlines > c:spPr > a:ln
}

interface DataLabelConfig {
  showVal: boolean;
  showCatName: boolean;
  showSerName: boolean;
  showPercent: boolean;
  position?: string; // 'outEnd', 'inEnd', 'ctr', 'bestFit'
  showLeaderLines?: boolean;
  manualLayout?: DataLabelManualLayout;
  color?: string; // text color from dLbls > txPr
  fontSize?: number; // font size from dLbls > txPr > defRPr@sz
  bold?: boolean; // font bold from dLbls > txPr > defRPr@b
  backgroundColor?: string; // label box fill from dLbls > spPr
  borderColor?: string; // label box stroke from dLbls > spPr
  borderWidth?: number; // label box stroke width
  padding?: [number, number, number, number]; // label text insets from txPr > bodyPr
}

type DataLabelManualLayout = Partial<Record<'x' | 'y' | 'width' | 'height', number>>;

type ChartTextStyle = {
  color?: string;
  fontSize?: number;
  bold?: boolean;
  fontFamily?: string;
  [EXPLICIT_FONT_SIZE]?: true;
};

export interface ChartFrameStyle {
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: ChartLineType;
}

function markExplicitFontSize<T extends object>(style: T): T {
  (style as ChartTextStyle)[EXPLICIT_FONT_SIZE] = true;
  return style;
}

function hasExplicitFontSize(style: unknown): boolean {
  return Boolean(
    style && typeof style === 'object' && (style as Record<symbol, unknown>)[EXPLICIT_FONT_SIZE],
  );
}

interface MutableAxisOption {
  type?: string;
  min?: number;
  max?: number;
  interval?: number;
  z?: number;
  axisLine?: Record<string, unknown>;
  axisLabel?: {
    fontSize?: number;
    fontFamily?: string;
    margin?: number;
  };
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
  | 'bubbleChart'
  | 'stockChart'
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
  'bubbleChart',
  'stockChart',
  'surface3DChart',
];

// ---------------------------------------------------------------------------
// Data Extraction Helpers
// ---------------------------------------------------------------------------

function getCachePointLimit(cache: SafeXmlNode): number {
  const declared = cache.child('ptCount').numAttr('val');
  let maxPresentIndex = -1;

  for (const pt of cache.children('pt')) {
    const idx = pt.numAttr('idx');
    if (idx !== undefined && Number.isInteger(idx) && idx >= 0 && idx < MAX_CHART_CACHE_POINTS) {
      maxPresentIndex = Math.max(maxPresentIndex, idx);
    }
  }

  const presentCount = maxPresentIndex + 1;
  if (declared === undefined || !Number.isFinite(declared) || declared < 0) {
    return presentCount;
  }

  const declaredCount = Math.floor(declared);
  if (declaredCount > MAX_CHART_CACHE_POINTS) {
    return presentCount;
  }

  return Math.min(Math.max(declaredCount, presentCount), MAX_CHART_CACHE_POINTS);
}

function isCachePointInRange(idx: number | undefined, pointLimit: number): idx is number {
  return (
    idx !== undefined &&
    Number.isInteger(idx) &&
    idx >= 0 &&
    idx < pointLimit &&
    idx < MAX_CHART_CACHE_POINTS
  );
}

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

  const pointLimit = getCachePointLimit(cache);
  const values: string[] = new Array(pointLimit).fill('');

  for (const pt of cache.children('pt')) {
    const idx = pt.numAttr('idx');
    if (isCachePointInRange(idx, pointLimit)) {
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

  const pointLimit = getCachePointLimit(cache);
  const values: number[] = new Array(pointLimit).fill(0);

  for (const pt of cache.children('pt')) {
    const idx = pt.numAttr('idx');
    if (isCachePointInRange(idx, pointLimit)) {
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
  const pointLimit = getCachePointLimit(cache);
  const values: string[] = new Array(pointLimit).fill('');

  // Check if this is a date format — format date serial numbers to human-readable strings
  const fc = cache.child('formatCode').text();
  const isDateFmt = fc && /[yYmMdD]/.test(fc) && !/[#0]/.test(fc);

  for (const pt of cache.children('pt')) {
    const idx = pt.numAttr('idx');
    if (isCachePointInRange(idx, pointLimit)) {
      const raw = pt.child('v').text();
      if (isDateFmt && raw) {
        values[idx] = excelSerialToDateString(parseFloat(raw));
      } else {
        values[idx] = raw;
      }
    }
  }

  return values;
}

/**
 * Convert Excel date serial number to a locale-formatted date string.
 * Excel epoch: 1899-12-30 (accounting for the Lotus 1-2-3 leap year bug).
 */
function excelSerialToDateString(serial: number): string {
  if (!Number.isFinite(serial) || serial < 1) return String(serial);
  // Excel serial date: 1 = 1900-01-01.
  // Excel has a Lotus 1-2-3 bug where serial 60 = Feb 29, 1900 (which doesn't exist).
  // For serials > 59, subtract 1 to correct for this phantom leap day.
  const adjusted = serial > 59 ? serial - 1 : serial;
  // Use UTC to avoid locale timezone drift shifting the rendered calendar date.
  const epochUtc = Date.UTC(1899, 11, 31);
  const date = new Date(epochUtc + adjusted * 86400000);
  // Format as YYYY/M/D (matches CJK locale conventions used in the test data)
  return `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
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

function extractSeriesLineWidth(ser: SafeXmlNode): number | undefined {
  const lnWidthEmu = ser.child('spPr').child('ln').numAttr('w');
  if (lnWidthEmu === undefined || lnWidthEmu <= 0) return undefined;
  // OOXML line width uses EMU; 12700 EMU = 1pt. Renderer text sizing already
  // treats point-sized values as CSS px-like numbers, so keep the same scale here.
  return Math.max(1, Number((lnWidthEmu / 12700).toFixed(3)));
}

function markerSizeToPx(sizePt: number): number {
  return Number(ptToPx(sizePt).toFixed(3));
}

function extractSeriesLineNoFill(ser: SafeXmlNode): boolean {
  return ser.child('spPr').child('ln').child('noFill').exists();
}

function toChartLineType(cssDash: string): ChartLineType {
  if (cssDash === 'dotted') return 'dotted';
  if (cssDash === 'dashed') return 'dashed';
  return 'solid';
}

function extractChartLineStyle(ln: SafeXmlNode, ctx: RenderContext): ChartLineStyle | undefined {
  if (!ln.exists() || ln.child('noFill').exists()) return undefined;

  const style = resolveLineStyle(ln, ctx);
  if (style.width <= 0 || style.color === 'transparent') return undefined;

  return {
    color: style.color,
    width: Math.max(style.width, 0.5),
    type: toChartLineType(style.dash),
  };
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
 * Extract per-data-point fill and border styles from c:ser > c:dPt elements.
 * Each c:dPt can define c:spPr fill and a:ln slice border independently.
 */
function extractDataPointStyles(
  ser: SafeXmlNode,
  ctx: RenderContext,
): (DataPointStyle | undefined)[] | undefined {
  const dPts = ser.children('dPt');
  if (dPts.length === 0) return undefined;

  const styles: (DataPointStyle | undefined)[] = [];
  for (const dPt of dPts) {
    const idx = dPt.child('idx').numAttr('val');
    if (idx === undefined) continue;

    const spPr = dPt.child('spPr');
    if (!spPr.exists()) continue;

    const pointStyle: DataPointStyle = {};
    const solidFill = spPr.child('solidFill');
    if (solidFill.exists()) {
      const hex = resolveColorToHex(solidFill, ctx);
      if (hex) {
        pointStyle.color = hex;
      }
    }

    const lineStyle = extractChartLineStyle(spPr.child('ln'), ctx);
    if (lineStyle) {
      pointStyle.borderColor = lineStyle.color;
      pointStyle.borderWidth = lineStyle.width;
      pointStyle.borderType = lineStyle.type;
    }

    if (Object.keys(pointStyle).length > 0) {
      while (styles.length <= idx) styles.push(undefined);
      styles[idx] = pointStyle;
    }
  }

  return styles.length > 0 ? styles : undefined;
}

/** In OOXML, boolean elements are true when present unless val="0" or val="false". */
function parseDlblBool(dLbls: SafeXmlNode, childName: string): boolean {
  return parseOoxmlBoolElement(dLbls.child(childName));
}

function parseOoxmlBoolElement(node: SafeXmlNode): boolean {
  if (!node.exists()) return false;
  return parseOoxmlBoolValue(node.attr('val'), true);
}

function parseOoxmlBoolValue(value: string | undefined, defaultValue: boolean): boolean {
  return parseOoxmlBool(value, defaultValue);
}

function parseDataLabelManualLayout(node: SafeXmlNode): DataLabelManualLayout | undefined {
  const manual = node.child('layout').child('manualLayout');
  if (!manual.exists()) return undefined;
  const out: DataLabelManualLayout = {};
  const x = manual.child('x').numAttr('val');
  const y = manual.child('y').numAttr('val');
  const width = manual.child('w').numAttr('val');
  const height = manual.child('h').numAttr('val');
  if (x !== undefined) out.x = x;
  if (y !== undefined) out.y = y;
  if (width !== undefined) out.width = width;
  if (height !== undefined) out.height = height;
  return Object.keys(out).length > 0 ? out : undefined;
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
  const showLeaderLines = parseDlblBool(dLbls, 'showLeaderLines');
  const posNode = dLbls.child('dLblPos');
  const position = posNode.exists() ? posNode.attr('val') || undefined : undefined;
  const manualLayout = parseDataLabelManualLayout(dLbls);

  const txStyle = extractTxPrStyle(dLbls, ctx);
  const color = txStyle?.color ?? extractTxPrColor(dLbls, ctx);
  const fontSize = txStyle?.fontSize;
  const bold = txStyle?.bold;
  const boxStyle = parseDataLabelBoxStyle(dLbls, ctx);

  // If nothing is shown, return undefined
  if (!showVal && !showCatName && !showSerName && !showPercent) return undefined;

  return {
    showVal,
    showCatName,
    showSerName,
    showPercent,
    position,
    showLeaderLines,
    manualLayout,
    color,
    fontSize,
    bold,
    ...boxStyle,
  };
}

function parseDlblBoolOptional(dLbl: SafeXmlNode, childName: string): boolean | undefined {
  const el = dLbl.child(childName);
  if (!el.exists()) return undefined;
  return parseOoxmlBoolElement(el);
}

function parseDataLabelBoxStyle(dLbls: SafeXmlNode, ctx: RenderContext): Partial<DataLabelConfig> {
  const style: Partial<DataLabelConfig> = {};
  const spPr = dLbls.child('spPr');
  if (spPr.exists()) {
    const solidFill = spPr.child('solidFill');
    if (solidFill.exists()) {
      const backgroundColor = resolveColorToHex(solidFill, ctx);
      if (backgroundColor) style.backgroundColor = backgroundColor;
    }

    const ln = spPr.child('ln');
    if (ln.exists() && !ln.child('noFill').exists()) {
      const strokeFill = ln.child('solidFill');
      if (strokeFill.exists()) {
        const borderColor = resolveColorToHex(strokeFill, ctx);
        if (borderColor) style.borderColor = borderColor;
      }
      const width = ln.numAttr('w');
      if (width !== undefined && width > 0) {
        style.borderWidth = Math.max(1, emuToPx(width));
      } else if (style.borderColor) {
        style.borderWidth = 1;
      }
    }
  }

  const bodyPr = dLbls.child('txPr').child('bodyPr');
  if (bodyPr.exists()) {
    const top = emuToPx(bodyPr.numAttr('tIns') ?? 0);
    const right = emuToPx(bodyPr.numAttr('rIns') ?? 0);
    const bottom = emuToPx(bodyPr.numAttr('bIns') ?? 0);
    const left = emuToPx(bodyPr.numAttr('lIns') ?? 0);
    if (top || right || bottom || left) {
      style.padding = [top, right, bottom, left];
    }
  }

  return style;
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
    const showLeaderLines = parseDlblBoolOptional(dLbl, 'showLeaderLines');
    const manualLayout = parseDataLabelManualLayout(dLbl);
    if (showVal !== undefined) cfg.showVal = showVal;
    if (showCatName !== undefined) cfg.showCatName = showCatName;
    if (showSerName !== undefined) cfg.showSerName = showSerName;
    if (showPercent !== undefined) cfg.showPercent = showPercent;
    if (showLeaderLines !== undefined) cfg.showLeaderLines = showLeaderLines;
    if (manualLayout) cfg.manualLayout = manualLayout;
    if (posNode.exists()) cfg.position = posNode.attr('val') || undefined;
    if (txStyle?.color) cfg.color = txStyle.color;
    else {
      const c = extractTxPrColor(dLbl, ctx);
      if (c) cfg.color = c;
    }
    if (txStyle?.fontSize !== undefined) cfg.fontSize = txStyle.fontSize;
    if (txStyle?.bold !== undefined) cfg.bold = txStyle.bold;
    Object.assign(cfg, parseDataLabelBoxStyle(dLbl, ctx));
    if (Object.keys(cfg).length > 0) out.set(idx, cfg);
  }
  return out;
}

/**
 * Parse pie slice explosion values from c:ser and c:dPt elements.
 */
function parseExplosion(ser: SafeXmlNode, pointCount: number): number[] | undefined {
  const explosions: number[] = new Array(pointCount).fill(0);
  let hasAny = false;

  // Series-level explosion
  const serExplosion = ser.child('explosion').numAttr('val') ?? 0;
  if (serExplosion > 0) {
    explosions.fill(serExplosion);
    hasAny = true;
  }

  // Per-point explosion overrides
  const dPts = ser.children('dPt');
  for (const dPt of dPts) {
    const idx = dPt.child('idx').numAttr('val');
    if (idx === undefined) continue;
    const exp = dPt.child('explosion').numAttr('val');
    if (exp !== undefined && exp > 0) {
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

    // Bubble chart sizes from c:bubbleSize
    const bubbleSizeNode = ser.child('bubbleSize');
    const bubbleSizes = bubbleSizeNode.exists() ? extractNumericValues(bubbleSizeNode) : undefined;

    const colorHex = extractSeriesColor(ser, ctx);
    const lineWidth = extractSeriesLineWidth(ser);
    const lineNoFill = extractSeriesLineNoFill(ser);
    const dataPointStyles = extractDataPointStyles(ser, ctx);
    const dataPointColors = dataPointStyles?.map((style) => style?.color);
    const invertIfNegativeNode = ser.child('invertIfNegative');
    const invertIfNegative = invertIfNegativeNode.exists()
      ? parseOoxmlBoolElement(invertIfNegativeNode)
      : undefined;

    // Extract marker info (c:marker > c:symbol, c:size)
    const marker = ser.child('marker');
    const markerSymbol = marker.child('symbol').attr('val');
    const markerSizePt = marker.child('size').numAttr('val');
    const markerSize = markerSizePt !== undefined ? markerSizeToPx(markerSizePt) : undefined;
    const smoothNode = ser.child('smooth');
    const smooth = smoothNode.exists() ? parseOoxmlBoolElement(smoothNode) : undefined;

    seriesArr.push({
      name,
      order,
      categories,
      values,
      xValues,
      bubbleSizes,
      colorHex,
      dataPointColors,
      dataPointStyles,
      formatCode,
      invertIfNegative,
      markerSymbol,
      markerSize,
      smooth,
      lineWidth,
      lineNoFill,
    });
  }

  // Sort by c:order so legend/stacking matches PPT
  seriesArr.sort((a, b) => a.order - b.order);

  return seriesArr;
}

// ---------------------------------------------------------------------------
// Chart Title
// ---------------------------------------------------------------------------

function extractTitleText(title: SafeXmlNode): string | undefined {
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
      for (const fld of p.children('fld')) {
        const t = fld.child('t').text();
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

function extractDefRPrStyle(defRPr: SafeXmlNode, ctx: RenderContext): ChartTextStyle | undefined {
  if (!defRPr.exists()) return undefined;

  const style: ChartTextStyle = {};
  const fill = defRPr.child('solidFill');
  if (fill.exists()) {
    const c = resolveColorToHex(fill, ctx);
    if (c) style.color = c;
  }
  const sz = defRPr.numAttr('sz');
  if (sz !== undefined && sz > 0) {
    // OOXML sz is 1/100 pt. Keep renderer's existing px-scale convention.
    style.fontSize = Math.round(sz / 100);
    style[EXPLICIT_FONT_SIZE] = true;
  }
  const b = defRPr.attr('b');
  if (b !== undefined) style.bold = parseOoxmlBool(b);
  const latinTypeface = defRPr.child('latin').attr('typeface');
  const eaTypeface = defRPr.child('ea').attr('typeface');
  const csTypeface = defRPr.child('cs').attr('typeface');
  const fontStack = resolveThemeFontStack([latinTypeface, eaTypeface, csTypeface], ctx);
  if (fontStack.length > 0) {
    style.fontFamily = cssFontFamilyStack(fontStack);
  }

  return style.color ||
    style.fontSize !== undefined ||
    style.bold !== undefined ||
    style.fontFamily !== undefined
    ? style
    : undefined;
}

function extractParagraphTextStyle(
  parentNode: SafeXmlNode,
  ctx: RenderContext,
): ChartTextStyle | undefined {
  for (const p of parentNode.children('p')) {
    const pPr = p.child('pPr');
    if (!pPr.exists()) continue;
    const defRPr = pPr.child('defRPr');
    const style = extractDefRPrStyle(defRPr, ctx);
    if (style) return style;
  }
  return undefined;
}

/**
 * Extract text color/font size from a txPr node:
 * txPr > p > pPr > defRPr (solidFill + sz).
 */
function extractTxPrStyle(parentNode: SafeXmlNode, ctx: RenderContext): ChartTextStyle | undefined {
  const txPr = parentNode.child('txPr');
  if (!txPr.exists()) return undefined;
  return extractParagraphTextStyle(txPr, ctx);
}

function extractTitleTextStyle(title: SafeXmlNode, ctx: RenderContext): ChartTextStyle | undefined {
  return (
    extractTxPrStyle(title, ctx) ?? extractParagraphTextStyle(title.child('tx').child('rich'), ctx)
  );
}

function getChartThemeFontFamily(ctx: RenderContext): string | undefined {
  const fontStack = resolveThemeFontStack(
    [
      ctx.theme.minorFont.latin,
      ctx.theme.minorFont.ea,
      ctx.theme.majorFont.latin,
      ctx.theme.majorFont.ea,
    ],
    ctx,
  );
  return fontStack.length > 0 ? cssFontFamilyStack(fontStack) : undefined;
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

/** Parsed legend info including overlay flag. */
interface LegendInfo {
  option: echarts.EChartsOption['legend'];
  position: 'b' | 't' | 'l' | 'r' | 'tr';
  overlay: boolean; // true = legend overlaps plot area (don't reserve grid space)
  textStyle?: ChartTextStyle & {
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
  const rawPosVal = legendPos.exists() ? legendPos.attr('val') || 'r' : 'r';
  const posVal = ['b', 't', 'l', 'r', 'tr'].includes(rawPosVal)
    ? (rawPosVal as LegendInfo['position'])
    : 'r';

  const overlay = parseOoxmlBoolElement(legend.child('overlay'));

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
      option = { ...base, left: '2%', top: 'middle', orient: 'vertical' as const };
      break;
    case 'r':
      option = { ...base, right: '2%', top: 'middle', orient: 'vertical' as const };
      break;
    case 'tr':
      option = { ...base, top: topBelowTitle, right: '2%', orient: 'vertical' as const };
      break;
    default:
      option = { ...base, right: '2%', top: 'middle', orient: 'vertical' as const };
      break;
  }
  return {
    option,
    position: posVal,
    overlay,
    textStyle: (() => {
      const s = extractTxPrStyle(legend, ctx);
      if (!s) return undefined;
      const textStyle: ChartTextStyle & {
        fontWeight?: 'normal' | 'bold' | 'bolder' | 'lighter' | number;
      } = {
        ...(s.color ? { color: s.color } : {}),
        ...(s.fontSize !== undefined ? { fontSize: s.fontSize } : {}),
        ...(s.bold === true ? { fontWeight: 'bold' } : {}),
        ...(s.fontFamily ? { fontFamily: s.fontFamily } : {}),
      };
      if (hasExplicitFontSize(s)) textStyle[EXPLICIT_FONT_SIZE] = true;
      return textStyle;
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
  return legendInfo?.position === 't' || legendInfo?.position === 'tr';
}

/**
 * Grid top reserve in pixels. Use fixed pixels so small chart containers (e.g. in shapes)
 * don't get oversized percentage reserve and avoid legend overlapping data labels.
 * When legend overlay=true, don't reserve extra space for legend.
 */
function getGridTopPx(hasTitle: boolean, legendInfo: LegendInfo | undefined): number {
  const atTop = legendIsAtTop(legendInfo);
  const overlayLegend = legendInfo?.overlay ?? false;
  if (hasTitle) return atTop && !overlayLegend ? 52 : 68;
  return atTop && !overlayLegend ? 32 : 20;
}

/** Legend top in pixels when legend is at top, so it sits below title and above grid. */
function getLegendTopPx(hasTitle: boolean, legendInfo: LegendInfo | undefined): number | undefined {
  if (!legendIsAtTop(legendInfo)) return undefined;
  return hasTitle ? 26 : 6;
}

function getLegendPlacement(
  legendInfo: LegendInfo | undefined,
): 'left' | 'right' | 'top' | 'bottom' | 'none' {
  if (
    !legendInfo ||
    legendInfo.overlay ||
    !legendInfo.option ||
    typeof legendInfo.option !== 'object'
  ) {
    return 'none';
  }
  const opt = legendInfo.option as Record<string, unknown>;
  if (opt.bottom !== undefined) return 'bottom';
  if (opt.top !== undefined && opt.left === undefined && opt.right === undefined) return 'top';
  if (opt.left !== undefined) return 'left';
  if (opt.right !== undefined) return 'right';
  return 'none';
}

function computePieLayout(
  legendInfo: LegendInfo | undefined,
  isDoughnut: boolean,
  showLabel: boolean,
  holeSizePct = 50,
): { center: [string, string]; radius: [string, string] | string } {
  const placement = getLegendPlacement(legendInfo);
  let center: [string, string] = ['50%', '55%'];
  let outerRadius = showLabel ? 78 : 82;

  if (placement === 'right') {
    center = ['38%', '55%'];
    outerRadius = 82;
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

function pieExplosionToOffset(explosion: number): number {
  return explosion;
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
  return 20;
}
const _GRID_BOTTOM_PX = 20; // kept as default for chart types that don't call the function

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

function defaultScatterSymbol(scatterStyle: string, seriesIndex: number): string {
  if (scatterStyle === 'lineMarker' || scatterStyle === 'smoothMarker') {
    return DEFAULT_LINE_MARKER_SCATTER_SYMBOLS[
      seriesIndex % DEFAULT_LINE_MARKER_SCATTER_SYMBOLS.length
    ];
  }
  return 'circle';
}

function buildLegendOption(
  legendOpt: echarts.EChartsOption['legend'] | undefined,
  legendInfo: LegendInfo | undefined,
  legendTopPx: number | undefined,
  data: (string | { name: string; icon?: string; marker?: string })[],
  textStyle: ChartTextStyle & {
    fontWeight?: 'normal' | 'bold' | 'bolder' | 'lighter' | number;
  },
): echarts.EChartsOption['legend'] {
  if (!legendOpt) return { show: false };
  const manual = legendInfo?.manualLayout ?? {};
  const top =
    manual.top !== undefined ? manual.top : legendTopPx !== undefined ? legendTopPx : undefined;
  // PowerPoint legend icons are sharp-cornered squares; ECharts default is 25×14 roundRect.
  // Set icon to 'rect' (no rounded corners) and both dimensions equal for square icons.
  // However, if individual data items carry their own icon (e.g. line/radar marker symbols),
  // respect those per-item icons instead of forcing 'rect' globally.
  const iconSize = textStyle.fontSize ?? 10;
  const hasPerItemIcons = data.some((d) => typeof d === 'object' && d.icon);
  const sharedIcon =
    hasPerItemIcons &&
    data.every(
      (d) =>
        typeof d === 'object' &&
        typeof d.icon === 'string' &&
        d.icon === (data[0] as { icon?: string }).icon,
    )
      ? (data[0] as { icon?: string }).icon
      : undefined;
  const useSharedIcon = sharedIcon !== undefined && !sharedIcon.startsWith('path://');
  const legendData = useSharedIcon ? data.map((d) => (typeof d === 'string' ? d : d.name)) : data;
  const hasLineLikeIcons = data.some(
    (d) => typeof d === 'object' && typeof d.icon === 'string' && d.icon.startsWith('path://'),
  );
  return {
    ...legendOpt,
    ...manual,
    ...(top !== undefined ? { top } : {}),
    ...(useSharedIcon ? { icon: sharedIcon } : hasPerItemIcons ? {} : { icon: 'rect' }),
    itemWidth: hasLineLikeIcons ? Math.max(24, Math.round(iconSize * 2.2)) : iconSize,
    itemHeight: hasLineLikeIcons ? Math.max(8, Math.round(iconSize * 0.9)) : iconSize,
    data: legendData,
    textStyle,
  };
}

type LegendOptionObject = {
  show?: boolean;
  data?: (string | { name: string; icon?: string; marker?: string })[];
  orient?: 'horizontal' | 'vertical';
  left?: string | number;
  right?: string | number;
  top?: string | number;
  bottom?: string | number;
  width?: string | number;
  height?: string | number;
  icon?: string;
  itemWidth?: number;
  itemHeight?: number;
  textStyle?: {
    color?: string;
    fontSize?: number;
    fontWeight?: 'normal' | 'bold' | 'bolder' | 'lighter' | number;
    fontFamily?: string;
  };
};

function getLegendOptionObject(legend: echarts.EChartsOption['legend']): LegendOptionObject | null {
  if (!legend) return null;
  return Array.isArray(legend)
    ? ((legend[0] as LegendOptionObject | undefined) ?? null)
    : (legend as LegendOptionObject);
}

function pickSeriesStringColor(color: string | object | undefined, fallback: string): string {
  return typeof color === 'string' ? color : fallback;
}

function pickVisualStringColor(
  visual: Record<string, unknown> | undefined,
  fallback: string,
): string {
  const lineStyle = (visual?.lineStyle as Record<string, unknown> | undefined) ?? {};
  const itemStyle = (visual?.itemStyle as Record<string, unknown> | undefined) ?? {};
  return (
    (typeof lineStyle.color === 'string' ? lineStyle.color : undefined) ??
    (typeof itemStyle.color === 'string' ? itemStyle.color : undefined) ??
    fallback
  );
}

function lineLegendIconPath(): string {
  return 'path://M2 4.5 L22 4.5';
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

function extractMajorGridlineStyle(
  ax: SafeXmlNode,
  ctx: RenderContext,
): ChartLineStyle | undefined {
  const ln = ax.child('majorGridlines').child('spPr').child('ln');
  return extractChartLineStyle(ln, ctx);
}

function extractTitleRotation(title: SafeXmlNode): number | undefined {
  const bodyPr = title.child('tx').child('rich').child('bodyPr').exists()
    ? title.child('tx').child('rich').child('bodyPr')
    : title.child('txPr').child('bodyPr');
  const rot = bodyPr.numAttr('rot');
  if (rot === undefined) return undefined;
  const deg = rot / 60000;
  return Number(deg.toFixed(3));
}

function extractAxisTitle(
  ax: SafeXmlNode,
  ctx: RenderContext,
): Pick<AxisInfo, 'title' | 'titleStyle' | 'titleRotation'> {
  const title = ax.child('title');
  if (!title.exists()) return {};

  const text = extractTitleText(title);
  if (!text) return {};

  return {
    title: text,
    titleStyle: extractTitleTextStyle(title, ctx),
    titleRotation: extractTitleRotation(title),
  };
}

/**
 * Parse a single axis node (c:valAx, c:catAx, or c:dateAx) into AxisInfo.
 */
function parseAxisNode(ax: SafeXmlNode, ctx: RenderContext): AxisInfo {
  if (!ax.exists()) return { ...DEFAULT_AXIS_INFO };
  const deleted = parseOoxmlBoolElement(ax.child('delete'));
  const tickLblPos = ax.child('tickLblPos').attr('val') || 'nextTo';
  const crosses = ax.child('crosses').attr('val');
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
  const majorGridlineStyle = hasMajorGridlines ? extractMajorGridlineStyle(ax, ctx) : undefined;
  const axisTitle = extractAxisTitle(ax, ctx);
  return {
    deleted,
    tickLblPos,
    crosses,
    numFmt: numFmt && numFmt !== 'General' ? numFmt : undefined,
    min: min !== undefined && !isNaN(min) ? min : undefined,
    max: max !== undefined && !isNaN(max) ? max : undefined,
    hasMajorGridlines,
    orientation,
    ...axisTitle,
    labelColor,
    labelFontSize,
    lineColor,
    majorGridlineStyle,
  };
}

function getChartAxisIds(chartTypeNode?: SafeXmlNode): string[] {
  if (!chartTypeNode?.exists()) return [];
  return chartTypeNode
    .children('axId')
    .map((ax) => ax.attr('val'))
    .filter((id): id is string => id !== undefined && id !== '');
}

function findAxisById(
  plotArea: SafeXmlNode,
  axisNames: readonly string[],
  axisId: string | undefined,
): SafeXmlNode {
  if (axisId) {
    for (const axisName of axisNames) {
      const axes = plotArea.children(axisName);
      const matched = axes.find((axis) => axis.child('axId').attr('val') === axisId);
      if (matched) return matched;
    }
    return new SafeXmlNode(null);
  }

  for (const axisName of axisNames) {
    const axes = plotArea.children(axisName);
    if (axes[0]?.exists()) return axes[0];
  }
  return new SafeXmlNode(null);
}

/** Parse value axis and category axis from plotArea. Also checks dateAx as category fallback. */
function parseAxes(
  plotArea: SafeXmlNode,
  ctx: RenderContext,
  chartTypeNode?: SafeXmlNode,
): { valueAxis: AxisInfo; categoryAxis: AxisInfo } {
  const axisIds = getChartAxisIds(chartTypeNode);
  const categoryAxisId = axisIds[0];
  const valueAxisId = axisIds[1];
  const valAx = findAxisById(plotArea, ['valAx'], valueAxisId);
  const catAx = findAxisById(plotArea, ['catAx', 'dateAx'], categoryAxisId);
  return {
    valueAxis: parseAxisNode(valAx, ctx),
    categoryAxis: parseAxisNode(catAx, ctx),
  };
}

/**
 * Parse scatter/bubble axes: two valAx nodes differentiated by axPos.
 * Returns X axis (bottom/top) and Y axis (left/right) separately.
 */
function parseScatterAxes(
  plotArea: SafeXmlNode,
  ctx: RenderContext,
): { xAxis: AxisInfo; yAxis: AxisInfo } {
  const allValAx = plotArea.children('valAx');
  let xAxis: AxisInfo = { ...DEFAULT_AXIS_INFO };
  let yAxis: AxisInfo = { ...DEFAULT_AXIS_INFO };
  for (const ax of allValAx) {
    const axPos = ax.child('axPos').attr('val') ?? '';
    const info = parseAxisNode(ax, ctx);
    if (axPos === 'b' || axPos === 't') {
      xAxis = info;
    } else if (axPos === 'l' || axPos === 'r') {
      yAxis = info;
    }
  }
  // Fallback: if only one valAx found, use first as Y axis (value)
  if (allValAx.length === 1) {
    yAxis = parseAxisNode(allValAx[0], ctx);
  }
  return { xAxis, yAxis };
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

  if (info.orientation === 'maxMin') {
    axisDef.inverse = true;
  }

  if (info.crosses === 'autoZero') {
    const existingLine = (axisDef.axisLine as Record<string, unknown>) || {};
    axisDef.axisLine = { ...existingLine, onZero: true };
  }

  if (info.title) {
    axisDef.name = info.title;
    axisDef.nameLocation = 'middle';
    axisDef.nameGap = kind === 'value' ? 42 : 28;
    if (info.titleRotation !== undefined) {
      axisDef.nameRotate = info.titleRotation;
    }

    const nameTextStyle: Record<string, unknown> = {};
    if (info.titleStyle?.color) nameTextStyle.color = info.titleStyle.color;
    if (info.titleStyle?.fontSize !== undefined) nameTextStyle.fontSize = info.titleStyle.fontSize;
    if (info.titleStyle?.fontFamily) nameTextStyle.fontFamily = info.titleStyle.fontFamily;
    if (info.titleStyle?.bold !== undefined) {
      nameTextStyle.fontWeight = info.titleStyle.bold ? 'bold' : 'normal';
    }
    if (Object.keys(nameTextStyle).length > 0) {
      axisDef.nameTextStyle = nameTextStyle;
    }
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

  // Axis numFmt → label formatter. Even without explicit numFmt, format through our
  // Office-like formatter so ECharts does not inject browser-style thousands separators.
  if (kind === 'value' && !info.deleted && info.tickLblPos !== 'none') {
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
    } else if (info.majorGridlineStyle) {
      const existingSplitLine = (axisDef.splitLine as Record<string, unknown>) || {};
      const existingLineStyle = (existingSplitLine.lineStyle as Record<string, unknown>) || {};
      axisDef.splitLine = {
        ...existingSplitLine,
        show: true,
        lineStyle: { ...existingLineStyle, ...info.majorGridlineStyle },
      };
    } else {
      const existingSplitLine = (axisDef.splitLine as Record<string, unknown>) || {};
      const existingLineStyle = (existingSplitLine.lineStyle as Record<string, unknown>) || {};
      axisDef.splitLine = {
        ...existingSplitLine,
        show: true,
        lineStyle: { ...DEFAULT_MAJOR_GRIDLINE_STYLE, ...existingLineStyle },
      };
    }
  }

  // Axis label color from txPr, falling back to Office's black foreground default.
  if (info.labelColor || !info.deleted) {
    const existingLabel = (axisDef.axisLabel as Record<string, unknown>) || {};
    const color =
      info.labelColor ??
      (existingLabel.color === undefined ? DEFAULT_CHART_FOREGROUND_COLOR : undefined);
    if (color) {
      axisDef.axisLabel = { ...existingLabel, color };
    }
  }
  if (info.labelFontSize !== undefined) {
    const existingLabel = (axisDef.axisLabel as Record<string, unknown>) || {};
    axisDef.axisLabel = { ...existingLabel, fontSize: info.labelFontSize };
  }

  // Axis line color from spPr > ln, falling back to Office's black foreground default.
  if (info.lineColor || !info.deleted) {
    const existingLine = (axisDef.axisLine as Record<string, unknown>) || {};
    const existingLineStyle = (existingLine.lineStyle as Record<string, unknown>) || {};
    const color =
      info.lineColor ??
      (existingLineStyle.color === undefined ? DEFAULT_CHART_FOREGROUND_COLOR : undefined);
    if (color) {
      axisDef.axisLine = {
        ...existingLine,
        show: existingLine.show ?? true,
        lineStyle: { ...existingLineStyle, color },
      };
    }
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

function collectSeriesValues(seriesArr: SeriesData[], stacked: boolean): number[] {
  if (!stacked) return seriesArr.flatMap((series) => series.values);
  const pointCount = Math.max(0, ...seriesArr.map((series) => series.values.length));
  const sums: number[] = [];
  for (let i = 0; i < pointCount; i++) {
    let sum = 0;
    for (const series of seriesArr) {
      sum += series.values[i] ?? 0;
    }
    sums.push(sum);
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

function dataLabelShowsContent(cfg: DataLabelConfig | undefined): boolean {
  return Boolean(cfg && (cfg.showVal || cfg.showCatName || cfg.showSerName || cfg.showPercent));
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
): echarts.PieSeriesOption['labelLayout'] {
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
  return labelLayout as echarts.PieSeriesOption['labelLayout'];
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
): echarts.EChartsOption {
  const barDir = chartTypeNode.child('barDir').attr('val') || chartTypeNode.attr('barDir') || 'col';
  const grouping = chartGrouping(chartTypeNode);
  const isHorizontal = barDir === 'bar';

  // Layout parameters
  const gapWidth = chartTypeNode.child('gapWidth').numAttr('val') ?? 150;
  const overlap = chartTypeNode.child('overlap').numAttr('val');

  // Use categories from the first series that has them
  const categories = seriesArr.find((s) => s.categories.length > 0)?.categories || [];

  const title = extractChartTitle(chartNode, seriesArr);
  const titleStyle = extractTitleTextStyle(chartNode.child('title'), ctx);
  const titleLayout = extractTitleManualLayout(chartNode);
  const legendInfo = extractLegendInfo(chartNode, ctx);
  const legendOpt = legendInfo?.option;
  const legendTextStyle = { fontSize: 10, ...(legendInfo?.textStyle ?? {}) };

  const isStacked = isStackedGrouping(grouping);
  const isPercentStacked = isPercentStackedGrouping(grouping);
  const percentStackedValues = isPercentStacked
    ? normalizePercentStackedValues(seriesArr)
    : undefined;
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
  const pointPalette = getVaryColorPointPalette(ctx);

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
    ): echarts.BarSeriesOption['label'] => {
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
    const label: echarts.BarSeriesOption['label'] = buildLabel(perSeriesLabels);
    const dLblsNode = (serNodesByOrder[idx] ?? chartTypeNode).child('dLbls');
    const pointOverrides = parsePointDataLabelOverrides(dLblsNode, ctx);
    const seriesValues = percentStackedValues?.[idx] ?? s.values;
    const data: echarts.BarSeriesOption['data'] = seriesValues.map((v, pointIdx) => {
      const ov = pointOverrides.get(pointIdx);
      const rawValue = s.values[pointIdx] ?? v;
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

      let pointLabel: echarts.BarSeriesOption['label'];
      if (ov) {
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

      if (!itemStyle && !pointLabel) return v;
      return {
        value: v,
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

  // Check if any series uses percentage format; axis numFmt takes priority
  const pctFormat =
    (isPercentStacked ? '0%' : undefined) ||
    valueAxis.numFmt ||
    seriesArr.find((s) => s.formatCode?.includes('%'))?.formatCode;
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

  const gridTop = getGridTopPx(!!title, legendInfo);
  const legendTopPx = getLegendTopPx(!!title, legendInfo);
  // When value axis is hidden, reduce left/right padding so bars use full width
  const gridLeft = isHorizontal ? 10 : valueAxis.deleted ? 4 : 24;
  const gridRight = isHorizontal ? 28 : 10;
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
  const title = extractChartTitle(chartNode, seriesArr);
  const titleStyle = extractTitleTextStyle(chartNode.child('title'), ctx);
  const titleLayout = extractTitleManualLayout(chartNode);
  const legendInfo = extractLegendInfo(chartNode, ctx);
  const legendOpt = legendInfo?.option;
  const legendTextStyle = { fontSize: 10, ...(legendInfo?.textStyle ?? {}) };
  const grouping = chartGrouping(chartTypeNode, 'standard');
  const isStacked = isStackedGrouping(grouping);
  const isPercentStacked = isPercentStackedGrouping(grouping);
  const percentStackedValues = isPercentStacked
    ? normalizePercentStackedValues(seriesArr)
    : undefined;
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
  const chartMarkerSymbol =
    chartMarker === true ? 'diamond' : chartMarker === false ? 'none' : undefined;

  const series: echarts.LineSeriesOption[] = seriesArr.map((s, idx) => {
    const markerSymbol = s.markerSymbol ?? chartMarkerSymbol;
    const echartsSymbol = mapOoxmlSymbol(markerSymbol);
    const showSymbol = echartsSymbol !== undefined ? echartsSymbol !== 'none' : undefined;
    const lineWidth = s.lineWidth ?? 3;
    const lineStyle = {
      ...(s.colorHex ? { color: s.colorHex } : {}),
      width: lineWidth,
      cap: 'round' as const,
      join: 'round' as const,
      ...(s.lineNoFill ? { opacity: 0 } : {}),
    };
    const fc = s.formatCode;
    const perSeriesLabels =
      parseDataLabels(serNodesByOrder[idx] ?? chartTypeNode, ctx) ?? sharedLabels;
    let label: echarts.LineSeriesOption['label'];
    if (perSeriesLabels?.showVal) {
      label = {
        show: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        position: mapLineLabelPosition(perSeriesLabels.position) as any,
        fontSize: perSeriesLabels.fontSize ?? 9,
        ...(perSeriesLabels.color ? { color: perSeriesLabels.color } : {}),
        ...(perSeriesLabels.bold === true ? { fontWeight: 'bold' as const } : {}),
        ...dataLabelBoxProps(perSeriesLabels),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          const rawVal = params?.value;
          const val =
            rawVal && typeof rawVal === 'object' && 'value' in rawVal ? rawVal.value : rawVal;
          return formatValue(val, isPercentStacked ? '0%' : fc);
        },
      };
      if (perSeriesLabels.fontSize !== undefined) markExplicitFontSize(label);
    }
    const forceSymbolForLabel = Boolean(label?.show && echartsSymbol === 'none');
    const symbol = forceSymbolForLabel
      ? 'circle'
      : echartsSymbol && echartsSymbol !== 'none'
        ? echartsSymbol
        : undefined;
    const symbolSize = forceSymbolForLabel
      ? 0
      : (s.markerSize ??
        (s.markerSymbol === undefined && chartMarker === true ? markerSizeToPx(5) : undefined));
    const resolvedShowSymbol = forceSymbolForLabel
      ? true
      : isArea && echartsSymbol === undefined
        ? false
        : showSymbol;
    return {
      type: 'line' as const,
      name: s.name,
      data: percentStackedValues?.[idx] ?? s.values,
      stack: isStacked ? 'total' : undefined,
      areaStyle: isArea ? { ...(s.colorHex ? { color: s.colorHex } : {}), opacity: 1 } : undefined,
      itemStyle: s.colorHex ? { color: s.colorHex } : undefined,
      lineStyle,
      label,
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
      z: 3,
    };
  });

  const plotArea = chartNode.child('plotArea');
  const { valueAxis, categoryAxis } = parseAxes(plotArea, ctx, chartTypeNode);

  const pctFormat =
    (isPercentStacked ? '0%' : undefined) ||
    valueAxis.numFmt ||
    seriesArr.find((s) => s.formatCode?.includes('%'))?.formatCode;
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

  const gridTop = getGridTopPx(!!title, legendInfo);
  const legendTopPx = getLegendTopPx(!!title, legendInfo);
  const gridLeft = valueAxis.deleted ? 4 : 24;
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
        ? seriesArr.map((s) => s.name)
        : seriesArr.map((s) => {
            const marker = mapOoxmlSymbol(s.markerSymbol ?? chartMarkerSymbol);
            return marker && marker !== 'none'
              ? { name: s.name, icon: lineLegendIconPath(), marker }
              : { name: s.name, icon: lineLegendIconPath() };
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
  const title = extractChartTitle(chartNode, seriesArr);
  const titleStyle = extractTitleTextStyle(chartNode.child('title'), ctx);
  const titleLayout = extractTitleManualLayout(chartNode);
  const legendInfo = extractLegendInfo(chartNode, ctx);
  const legendOpt = legendInfo?.option;
  const legendTextStyle = { fontSize: 10, ...(legendInfo?.textStyle ?? {}) };

  const renderSeriesArr = isDoughnut ? seriesArr : seriesArr.slice(0, 1);
  if (renderSeriesArr.length === 0) {
    return { title: title ? { text: title } : undefined };
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
    const dLblsNode = serNode?.exists() ? serNode.child('dLbls') : chartTypeNode.child('dLbls');
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
  const pieLayout = computePieLayout(legendInfo, isDoughnut, showLabel, holeSizePct);

  const series: echarts.PieSeriesOption[] = seriesLabelMeta.map((meta, idx) => {
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
        item.selectedOffset = pieExplosionToOffset(meta.explosions[i]);
      }
      if (override && dataLabelShowsContent(pointLabel)) {
        item.label = buildPieLabelOption(pointLabel, meta.series.formatCode, meta.series.name);
      }
      return item;
    });

    const label = buildPieLabelOption(meta.sharedLabels, meta.series.formatCode, meta.series.name);
    const hasLeaderLines =
      Boolean(meta.sharedLabels?.showLeaderLines) ||
      [...meta.pointOverrides.values()].some((cfg) => cfg.showLeaderLines === true);
    const selectedOffset =
      meta.explosions && Math.max(...meta.explosions.map((exp) => pieExplosionToOffset(exp)));

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
      label: label ?? { show: false },
      labelLine: { show: hasLeaderLines },
      labelLayout: buildPieLabelLayout(manualLayouts),
    };
  });

  const legendTopPx = getLegendTopPx(!!title, legendInfo);
  const tooltipFmt = renderSeriesArr.find((s) => s.formatCode)?.formatCode;
  const legendData = isDoughnut
    ? uniquePieLegendCategories(renderSeriesArr)
    : renderSeriesArr[0].categories;
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
    legend: buildLegendOption(legendOpt, legendInfo, legendTopPx, legendData, legendTextStyle),
    series,
  };
}

function buildRadarChartOption(
  chartTypeNode: SafeXmlNode,
  chartNode: SafeXmlNode,
  seriesArr: SeriesData[],
  ctx: RenderContext,
): echarts.EChartsOption {
  const title = extractChartTitle(chartNode, seriesArr);
  const titleStyle = extractTitleTextStyle(chartNode.child('title'), ctx);
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
  const valueAxisLabel = showValueAxisLabels
    ? {
        show: true,
        formatter: (val: number) => formatValue(val, valueAxis.numFmt),
        ...(valueAxis.labelColor ? { color: valueAxis.labelColor } : {}),
        ...(valueAxis.labelFontSize !== undefined ? { fontSize: valueAxis.labelFontSize } : {}),
      }
    : undefined;
  const radarSplitLine = valueAxis.hasMajorGridlines
    ? {
        show: true,
        lineStyle: {
          ...DEFAULT_RADAR_GRIDLINE_STYLE,
          ...(valueAxis.majorGridlineStyle ?? {}),
        },
      }
    : { show: false };
  const radarAxisLine = valueAxis.deleted
    ? { show: false }
    : {
        show: true,
        lineStyle: { color: valueAxis.lineColor ?? DEFAULT_RADAR_GRIDLINE_STYLE.color },
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

  // Read radar style to determine default marker behavior
  const radarStyle = chartTypeNode.child('radarStyle').attr('val'); // 'marker' | 'filled' | undefined
  const radarHasTopLegend = legendIsAtTop(legendInfo) && !legendInfo?.overlay;
  const radarCenter: [string, string] = radarHasTopLegend
    ? ['50%', '66%']
    : radarStyle === 'filled'
      ? ['50%', '55%']
      : ['50%', '50%'];
  const radarRadius = radarHasTopLegend ? '58%' : radarStyle === 'filled' ? '76%' : '86%';

  const radarData = seriesArr.map((s) => {
    // Reorder values to match the reversed category order
    const cwValues = s.values.length > 1 ? [s.values[0], ...s.values.slice(1).reverse()] : s.values;
    const echartsSymbol = mapOoxmlSymbol(s.markerSymbol);
    // Show symbols if radarStyle is 'marker' or series has explicit marker
    const showSymbol =
      radarStyle === 'marker' || (echartsSymbol !== undefined && echartsSymbol !== 'none');
    // PowerPoint radar charts fill the area with a semi-transparent version of the line color
    const isFilled = radarStyle === 'filled';
    const areaStyle = isFilled
      ? { ...(s.colorHex ? { color: s.colorHex } : {}), opacity: 0.75 }
      : undefined;
    return {
      name: s.name,
      value: cwValues,
      ...(s.colorHex
        ? {
            lineStyle: {
              color: s.colorHex,
              width: s.lineWidth ?? 3,
              cap: 'round' as const,
              join: 'round' as const,
              ...(s.lineNoFill ? { opacity: 0 } : {}),
            },
            itemStyle: { color: s.colorHex },
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
  const title = extractChartTitle(chartNode, seriesArr);
  const titleStyle = extractTitleTextStyle(chartNode.child('title'), ctx);
  const titleLayout = extractTitleManualLayout(chartNode);
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
        ...(showSymbol ? { symbol: echartsSymbol, symbolSize: s.markerSize ?? 8 } : {}),
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
      symbolSize: showSymbol ? (s.markerSize ?? 8) : 0,
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

  const gridTop = getGridTopPx(!!title, legendInfo);
  const legendTopPx = getLegendTopPx(!!title, legendInfo);
  const manualGrid = extractManualLayoutGrid(chartNode);
  const containLabel = !hasManualGrid(manualGrid);
  const scatterGridLeft = yAxisInfo.deleted ? 4 : 24;
  const scatterGridTop = gridTop;
  const scatterGridBottom = Math.max(getGridBottomPx(legendInfo), 20);

  const xAxisDef: Record<string, unknown> = { type: 'value' };
  const yAxisDef: Record<string, unknown> = { type: 'value' };
  applyAxisInfo(xAxisDef, xAxisInfo, 'value');
  applyAxisInfo(yAxisDef, yAxisInfo, 'value');

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
): echarts.EChartsOption {
  const title = extractChartTitle(chartNode, seriesArr);
  const titleStyle = extractTitleTextStyle(chartNode.child('title'), ctx);
  const titleLayout = extractTitleManualLayout(chartNode);
  const legendInfo = extractLegendInfo(chartNode, ctx);
  const legendOpt = legendInfo?.option;
  const legendTextStyle = { fontSize: 10, ...(legendInfo?.textStyle ?? {}) };
  const bubbleScale = Math.max(chartTypeNode.child('bubbleScale').numAttr('val') ?? 100, 0);
  const maxBubbleDiameter = 100 * (bubbleScale / 100 || 1);

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

  const series: echarts.ScatterSeriesOption[] = seriesArr.map((s) => {
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

  const gridTop = getGridTopPx(!!title, legendInfo);
  const legendTopPx = getLegendTopPx(!!title, legendInfo);
  const manualGrid = extractManualLayoutGrid(chartNode);
  const containLabel = !hasManualGrid(manualGrid);
  const scatterGridLeft = yAxisInfo.deleted ? 4 : 24;
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
    title: title
      ? {
          text: title,
          left: 'center',
          ...titleLayout,
          textStyle: { fontSize: 14, ...(titleStyle ?? {}) },
        }
      : undefined,
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

function buildStockChartOption(
  chartTypeNode: SafeXmlNode,
  chartNode: SafeXmlNode,
  seriesArr: SeriesData[],
  ctx: RenderContext,
): echarts.EChartsOption {
  const title = extractChartTitle(chartNode, seriesArr);
  const titleStyle = extractTitleTextStyle(chartNode.child('title'), ctx);
  const titleLayout = extractTitleManualLayout(chartNode);
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

  const gridTop = getGridTopPx(!!title, legendInfo);
  const manualGrid = extractManualLayoutGrid(chartNode);
  const containLabel = !hasManualGrid(manualGrid);

  const xAxisDef: Record<string, unknown> = {
    type: 'category',
    data: categories,
    axisLabel: { interval: 0, rotate: 0, fontSize: 10 },
    splitLine: { show: false },
  };
  applyAxisInfo(xAxisDef, categoryAxis, 'category');

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
  const legendTopPx = getLegendTopPx(!!title, legendInfo);
  const isHlc = seriesArr.length >= 3 && seriesArr.length < 4;

  const legendData = isHlc
    ? seriesArr.slice(0, 3).map((s) => ({ name: s.name, icon: 'none' }))
    : seriesArr.map((s) => s.name);

  const series: echarts.SeriesOption[] = isHlc
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
        } as echarts.SeriesOption,
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
    title: title
      ? {
          text: title,
          left: 'center',
          ...titleLayout,
          textStyle: { fontSize: 14, ...(titleStyle ?? {}) },
        }
      : undefined,
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    legend: buildLegendOption(legendOpt, legendInfo, legendTopPx, legendData, legendTextStyle),
    grid: {
      containLabel,
      // Stock charts with rotated date labels need extra left inset so the
      // first category label is not clipped by the plot boundary.
      left: 24,
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
  const showKeys = parseOoxmlBoolValue(dTable.child('showKeys').attr('val'), true);
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

function extractChartFrameStyle(
  chartXml: SafeXmlNode,
  ctx: RenderContext,
): ChartFrameStyle | undefined {
  const lineStyle = extractChartLineStyle(chartXml.child('spPr').child('ln'), ctx);
  if (!lineStyle) return undefined;

  return {
    borderColor: lineStyle.color,
    borderWidth: lineStyle.width,
    borderStyle: lineStyle.type,
  };
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

/**
 * Build a chart color palette from theme accents and chart style id.
 * This improves parity with Office chart styles when series colors are implicit.
 */
const CHART_COLOR_NODE_NAMES = new Set([
  'srgbClr',
  'schemeClr',
  'sysClr',
  'prstClr',
  'hslClr',
  'scrgbClr',
]);

function resolveChartColorStyleColor(
  colorNode: SafeXmlNode,
  ctx: RenderContext,
): string | undefined {
  if (!colorNode.element || !CHART_COLOR_NODE_NAMES.has(colorNode.localName)) return undefined;
  const doc = colorNode.element.ownerDocument;
  const wrapper = doc.createElementNS(colorNode.element.namespaceURI, 'solidFill');
  wrapper.appendChild(colorNode.element.cloneNode(true));
  return resolveColorToHex(new SafeXmlNode(wrapper), ctx);
}

function parseChartColorStylePalette(
  colorStyle: SafeXmlNode | undefined,
  ctx: RenderContext,
): string[] {
  if (!colorStyle?.exists()) return [];
  const colors: string[] = [];
  for (const child of colorStyle.allChildren()) {
    const color = resolveChartColorStyleColor(child, ctx);
    if (color) colors.push(color);
  }
  return colors;
}

function getThemeAccentPalette(ctx: RenderContext): string[] {
  return CHART_ACCENT_KEYS.map((k) => ctx.theme.colorScheme.get(k))
    .filter((v): v is string => !!v)
    .map((hex) => (hex.startsWith('#') ? hex : `#${hex}`));
}

function darkenHexColor(hex: string, factor: number): string {
  const cleaned = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return hex;
  const channel = (start: number): number =>
    Math.max(0, Math.min(255, Math.round(parseInt(cleaned.slice(start, start + 2), 16) * factor)));
  return `#${[channel(0), channel(2), channel(4)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

function getVaryColorPointPalette(ctx: RenderContext): string[] {
  return getThemeAccentPalette(ctx).map((color) => darkenHexColor(color, 0.88));
}

function buildChartPalette(
  chartXml: SafeXmlNode,
  ctx: RenderContext,
  chartPath?: string,
): string[] | undefined {
  if (chartPath) {
    const chartColorStylePalette = parseChartColorStylePalette(
      ctx.presentation.chartColorStyles?.get(chartPath),
      ctx,
    );
    if (chartColorStylePalette.length > 0) return chartColorStylePalette;
  }

  const accents = getThemeAccentPalette(ctx);

  if (accents.length === 0) return undefined;

  const styleId = parseChartStyleId(chartXml);
  if (styleId === undefined) return accents;

  // Style ids 100+ use the same accent order as the base palette.
  // No rotation needed — OOXML chart styles control visual appearance
  // (e.g. 3D, transparency) but don't reorder series colors.
  return accents;
}

// ---------------------------------------------------------------------------
// Chart-Space Default Font Size + Legend Grid Adjustment
// ---------------------------------------------------------------------------

type RadarTextContainer = {
  name?: {
    textStyle?: Record<string, unknown>;
  };
  indicator?: {
    axisLabel?: Record<string, unknown>;
  }[];
};

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

/**
 * Apply chart-space default font size to all text elements in the ECharts option
 * that still use hardcoded small defaults. Only overrides when no explicit OOXML
 * font size was set on that element (i.e., value matches our hardcoded defaults).
 */
function applyDefaultFontSizes(option: echarts.EChartsOption, defaultFs: number): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opt = option as any;

  // Title: our defaults are 12 or 14 — replace with the chart-space default
  if (opt.title?.textStyle?.fontSize) {
    const cur = opt.title.textStyle.fontSize;
    if (cur <= 14) {
      opt.title.textStyle.fontSize = defaultFs;
    }
  }

  // Radar indicator font size
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

  // Series data label font sizes: apply default when no explicit OOXML font was set
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

function applyDefaultFontFamily(option: echarts.EChartsOption, fontFamily: string): void {
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

function applyDefaultTextColors(option: echarts.EChartsOption): void {
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

/**
 * Adjust grid margins to prevent legend/chart overlap.
 * When legend is at right or left with overlay=false, the grid needs a larger
 * margin so that chart bars/lines don't extend into the legend area.
 */
function applyLegendGridMargins(
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

  // Only adjust for side-positioned legends
  if (posVal === 'r' || posVal === 'l') {
    // Estimate legend width based on legend names and font size
    const legendData = opt.legend.data as (string | { name: string })[] | undefined;
    if (!legendData || legendData.length === 0) return;

    const names = legendData.map((d: string | { name: string }) =>
      typeof d === 'string' ? d : d.name,
    );
    const fs = opt.legend?.textStyle?.fontSize ?? defaultFs ?? 12;
    const iconWidth = Number(opt.legend?.itemWidth) || fs;
    // Estimate legend width: icon (~fontSize) + gap + text + padding
    // Measure max text width considering CJK (wider) vs Latin (narrower) chars
    let maxTextPx = 0;
    for (const n of names) {
      let w = 0;
      for (const ch of n) {
        w += ch.charCodeAt(0) > 0x2e80 ? fs : fs * 0.55;
      }
      if (w > maxTextPx) maxTextPx = w;
    }
    // icon + gap + text + left/right padding
    const estimatedLegendPx = iconWidth + 8 + maxTextPx + 14;
    const gridMarginPx = Math.max(84, Math.round(estimatedLegendPx + 18));

    // Check if manual grid layout was applied — don't override
    if (typeof opt.grid.left === 'string' && opt.grid.left.includes('%')) return;
    if (typeof opt.grid.right === 'string' && opt.grid.right.includes('%')) return;

    if (posVal === 'r') {
      opt.grid.right = gridMarginPx;
    } else {
      opt.grid.left = gridMarginPx;
    }
  }
}

/**
 * Compute a "nice" axis max/min that PowerPoint would auto-calculate.
 * PowerPoint rounds the value axis range to tidy tick marks (e.g., data max 5 → axis max 6).
 * This post-processes the ECharts option to set axis max when not explicitly provided.
 */
function applyNiceAxisRange(option: echarts.EChartsOption): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opt = option as any;

  // Only applies to cartesian charts with axes
  if (!opt.xAxis && !opt.yAxis) return;

  // Collect all numeric data values from series, accounting for stacking
  const allValues: number[] = [];
  const xValues: number[] = [];
  const yValues: number[] = [];
  const seriesArr = Array.isArray(opt.series) ? opt.series : opt.series ? [opt.series] : [];

  // Group series by stack key to compute stacked totals
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

  // For stacked series, compute per-category sums
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

  // Find the value axes (could be xAxis or yAxis depending on bar direction)
  const processAxis = (axis: unknown, valueByIndex?: Map<number, number[]>) => {
    if (!axis) return;
    const axes = Array.isArray(axis) ? axis : [axis];
    axes.forEach((ax, index) => {
      if (!ax || ax.type !== 'value') return;
      // Skip if explicit min/max already set
      if (ax.min !== undefined && ax.max !== undefined) return;

      const axisValues = valueByIndex?.get(index) ?? allValues;
      if (axisValues.length === 0) return;
      const dataMin = Math.min(...axisValues);
      const dataMax = Math.max(...axisValues);

      const desiredTicks = 8;
      const interval = niceAxisInterval(dataMax, dataMin, desiredTicks);

      // Only set max when not already specified
      if (ax.max === undefined) {
        let max = niceAxisMax(dataMax, dataMin, desiredTicks);
        if (max > dataMax && max - dataMax < interval * 0.25) {
          max += interval;
        }
        ax.max = max;
      }
      // Set min to 0 when all values are non-negative and no explicit min
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

  processAxis(opt.xAxis);
  processAxis(opt.yAxis, valuesByYAxis);
}

/**
 * Calculate a "nice" axis maximum, similar to PowerPoint's algorithm.
 * Given data max, returns a rounded-up value that gives clean tick marks with headroom.
 * PowerPoint always adds at least one tick interval above the data max.
 */
function niceAxisMax(dataMax: number, dataMin: number, desiredTicks = 5): number {
  const niceInterval = niceAxisInterval(dataMax, dataMin, desiredTicks);
  const niceMax = Math.ceil(dataMax / niceInterval) * niceInterval;
  return niceMax <= dataMax ? niceMax + niceInterval : niceMax;
}

function niceAxisMin(dataMax: number, dataMin: number, desiredTicks = 5): number {
  const niceInterval = niceAxisInterval(dataMax, dataMin, desiredTicks);
  const niceMin = Math.floor(dataMin / niceInterval) * niceInterval;
  return niceMin >= dataMin ? niceMin - niceInterval : niceMin;
}

function niceAxisInterval(dataMax: number, dataMin: number, desiredTicks = 5): number {
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

/**
 * Extract chart-space default font size from chartSpace > txPr > defRPr@sz.
 * Returns size in pixels (OOXML sz is 1/100 pt; we convert to px at 96 DPI: 1pt = 1.333px).
 * PowerPoint uses this as the default text size for all chart text elements.
 */
function extractChartDefaultFontSize(chartSpaceNode: SafeXmlNode): number | undefined {
  const txPr = chartSpaceNode.child('txPr');
  if (!txPr.exists()) return undefined;
  for (const p of txPr.children('p')) {
    const pPr = p.child('pPr');
    if (!pPr.exists()) continue;
    const defRPr = pPr.child('defRPr');
    if (!defRPr.exists()) continue;
    const sz = defRPr.numAttr('sz');
    if (sz !== undefined && sz > 0) {
      // sz is 1/100 pt → convert to px at 96 DPI (1pt = 96/72 px ≈ 1.333px)
      return Math.round((sz / 100) * (96 / 72));
    }
  }
  return undefined;
}

function createLegendIcon(
  icon: string | undefined,
  color: string,
  width: number,
  height: number,
  strokeWidth = 2,
  marker?: string,
): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.style.display = 'block';
  const normalized = icon ?? 'rect';

  if (normalized.startsWith('path://')) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', normalized.slice('path://'.length));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', String(strokeWidth));
    path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);
    if (marker && marker !== 'none') {
      const cx = width / 2;
      const cy = height / 2;
      const markerSize = Math.max(3, Math.min(width, height) * 0.55);
      if (marker === 'diamond') {
        const markerPath = document.createElementNS(ns, 'path');
        markerPath.setAttribute(
          'd',
          `M${cx} ${cy - markerSize / 2} L${cx + markerSize / 2} ${cy} L${cx} ${cy + markerSize / 2} L${cx - markerSize / 2} ${cy} Z`,
        );
        markerPath.setAttribute('fill', color);
        svg.appendChild(markerPath);
      } else if (marker === 'rect') {
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x', String(cx - markerSize / 2));
        rect.setAttribute('y', String(cy - markerSize / 2));
        rect.setAttribute('width', String(markerSize));
        rect.setAttribute('height', String(markerSize));
        rect.setAttribute('fill', color);
        svg.appendChild(rect);
      } else if (marker === 'triangle') {
        const markerPath = document.createElementNS(ns, 'path');
        markerPath.setAttribute(
          'd',
          `M${cx} ${cy - markerSize / 2} L${cx + markerSize / 2} ${cy + markerSize / 2} L${cx - markerSize / 2} ${cy + markerSize / 2} Z`,
        );
        markerPath.setAttribute('fill', color);
        svg.appendChild(markerPath);
      } else {
        const circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('cx', String(cx));
        circle.setAttribute('cy', String(cy));
        circle.setAttribute('r', String(markerSize / 2));
        circle.setAttribute('fill', color);
        svg.appendChild(circle);
      }
    }
    return svg;
  }

  if (normalized === 'diamond') {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute(
      'd',
      `M${width / 2} 1 L${width - 1} ${height / 2} L${width / 2} ${height - 1} L1 ${height / 2} Z`,
    );
    path.setAttribute('fill', color);
    svg.appendChild(path);
    return svg;
  }

  if (normalized === 'circle') {
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', String(width / 2));
    circle.setAttribute('cy', String(height / 2));
    circle.setAttribute('r', String(Math.max(2, Math.min(width, height) / 2 - 1)));
    circle.setAttribute('fill', color);
    svg.appendChild(circle);
    return svg;
  }

  const rect = document.createElementNS(ns, 'rect');
  rect.setAttribute('x', '1');
  rect.setAttribute('y', '1');
  rect.setAttribute('width', String(Math.max(2, width - 2)));
  rect.setAttribute('height', String(Math.max(2, height - 2)));
  rect.setAttribute('fill', color);
  svg.appendChild(rect);
  return svg;
}

function resolveInsetToPx(value: string | number, total: number): string {
  if (typeof value === 'number') return `${value}px`;
  const trimmed = value.trim();
  if (trimmed.endsWith('%')) {
    const pct = Number.parseFloat(trimmed.slice(0, -1));
    if (!Number.isNaN(pct)) return `${(pct / 100) * total}px`;
  }
  return trimmed;
}

function buildCustomLegendOverlay(
  option: echarts.EChartsOption,
  size: { w: number; h: number },
): HTMLElement | null {
  const legend = getLegendOptionObject(option.legend);
  if (!legend || legend.show === false) return null;

  const isVertical = legend.orient === 'vertical';
  const isHorizontal = legend.orient === 'horizontal' || legend.orient === undefined;
  const hasHorizontalAnchor =
    legend.top !== undefined ||
    legend.bottom !== undefined ||
    legend.left !== undefined ||
    legend.right !== undefined;
  if (isVertical && legend.left === undefined && legend.right === undefined) return null;
  if (isHorizontal && !hasHorizontalAnchor) return null;

  const palette = Array.isArray(option.color)
    ? option.color.filter((entry): entry is string => typeof entry === 'string')
    : [];

  const rawData = legend.data ?? [];
  type LegendOverlayEntry = {
    name: string;
    icon: string | undefined;
    marker: string | undefined;
    color: string;
    lineWidth: number;
  };
  const seriesList = Array.isArray(option.series)
    ? option.series
    : option.series
      ? [option.series]
      : [];
  const radarSeries =
    seriesList.length === 1 &&
    (seriesList[0] as Record<string, unknown> | undefined)?.type === 'radar'
      ? (seriesList[0] as Record<string, unknown>)
      : undefined;
  const radarData = Array.isArray(radarSeries?.data)
    ? (radarSeries.data as Record<string, unknown>[])
    : undefined;
  const entries = rawData
    .map((item, index) => {
      const name = typeof item === 'string' ? item : item.name;
      const itemIcon = typeof item === 'string' ? undefined : item.icon;
      const itemMarker = typeof item === 'string' ? undefined : item.marker;
      if (!name) return null;
      const series = seriesList[index] as Record<string, unknown> | undefined;
      const visual = radarData?.[index] ?? series;
      const lineStyle = (visual?.lineStyle as Record<string, unknown> | undefined) ?? {};
      const color = pickVisualStringColor(visual, palette[index] ?? '#2f6f8f');
      const lineWidth =
        typeof lineStyle.width === 'number' && Number.isFinite(lineStyle.width)
          ? Math.max(1, lineStyle.width)
          : 2;
      return { name, icon: itemIcon ?? legend.icon, marker: itemMarker, color, lineWidth };
    })
    .filter((entry): entry is LegendOverlayEntry => entry !== null);
  if (entries.length === 0) return null;

  const overlay = document.createElement('div');
  overlay.className = 'pptx-chart-custom-legend';
  overlay.style.position = 'absolute';
  overlay.style.display = 'flex';
  overlay.style.flexDirection = isVertical ? 'column' : 'row';
  overlay.style.gap = isVertical ? '6px' : '12px';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '1';
  overlay.style.whiteSpace = 'nowrap';
  if (legend.left !== undefined) overlay.style.left = resolveInsetToPx(legend.left, size.w);
  if (legend.right !== undefined) overlay.style.right = resolveInsetToPx(legend.right, size.w);
  if (legend.width !== undefined) overlay.style.width = resolveInsetToPx(legend.width, size.w);
  if (legend.height !== undefined) overlay.style.height = resolveInsetToPx(legend.height, size.h);
  if (legend.width !== undefined || legend.height !== undefined) {
    overlay.style.boxSizing = 'border-box';
    if (isHorizontal) {
      overlay.style.alignItems = 'center';
      if (legend.width !== undefined) overlay.style.justifyContent = 'center';
    } else {
      if (legend.width !== undefined) overlay.style.alignItems = 'center';
      if (legend.height !== undefined) overlay.style.justifyContent = 'center';
    }
  }
  const sideLegend =
    legend.orient === 'vertical' && (legend.left !== undefined || legend.right !== undefined);
  if (sideLegend) {
    if (legend.top === 'middle') {
      overlay.style.top = `${size.h / 2}px`;
      overlay.style.transform = 'translateY(-50%)';
    } else if (legend.top !== undefined) {
      overlay.style.top = resolveInsetToPx(legend.top, size.h);
    } else if (legend.bottom === undefined) {
      overlay.style.top = `${size.h / 2}px`;
      overlay.style.transform = 'translateY(-50%)';
    }
  } else if (legend.top !== undefined) {
    overlay.style.top = resolveInsetToPx(legend.top, size.h);
  }
  if (legend.bottom !== undefined) overlay.style.bottom = resolveInsetToPx(legend.bottom, size.h);
  if (isHorizontal && legend.left === undefined && legend.right === undefined) {
    overlay.style.left = '50%';
    overlay.style.transform = 'translateX(-50%)';
  }

  const fontSize = legend.textStyle?.fontSize ?? 10;
  const itemWidth = legend.itemWidth ?? fontSize;
  const itemHeight = legend.itemHeight ?? fontSize;

  for (const entry of entries) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '6px';

    row.appendChild(
      createLegendIcon(
        entry.icon,
        entry.color,
        itemWidth,
        itemHeight,
        entry.lineWidth,
        entry.marker,
      ),
    );

    const label = document.createElement('span');
    label.textContent = entry.name;
    label.style.color = legend.textStyle?.color ?? '#000000';
    label.style.fontSize = `${fontSize}px`;
    if (legend.textStyle?.fontFamily) {
      label.style.fontFamily = legend.textStyle.fontFamily;
    }
    if (legend.textStyle?.fontWeight !== undefined) {
      label.style.fontWeight = String(legend.textStyle.fontWeight);
    }
    row.appendChild(label);
    overlay.appendChild(row);
  }

  return overlay;
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
  chartFrameStyle?: ChartFrameStyle;
}

function buildOptionForChartType(
  typeName: OoxmlChartType,
  chartTypeNode: SafeXmlNode,
  chartNode: SafeXmlNode,
  seriesArr: SeriesData[],
  ctx: RenderContext,
): echarts.EChartsOption | undefined {
  switch (typeName) {
    case 'barChart':
    case 'bar3DChart':
      return buildBarChartOption(chartTypeNode, chartNode, seriesArr, ctx);
    case 'lineChart':
    case 'line3DChart':
      return buildLineChartOption(chartTypeNode, chartNode, seriesArr, ctx, false);
    case 'areaChart':
    case 'area3DChart':
    case 'surface3DChart':
      return buildLineChartOption(chartTypeNode, chartNode, seriesArr, ctx, true);
    case 'pieChart':
    case 'pie3DChart':
      return buildPieChartOption(chartTypeNode, chartNode, seriesArr, false, ctx);
    case 'doughnutChart':
      return buildPieChartOption(chartTypeNode, chartNode, seriesArr, true, ctx);
    case 'radarChart':
      return buildRadarChartOption(chartTypeNode, chartNode, seriesArr, ctx);
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
  primaryLegend: echarts.EChartsOption['legend'],
  secondaryLegend: echarts.EChartsOption['legend'],
): echarts.EChartsOption['legend'] {
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
  const labelGap = (axisLabel.fontSize ?? 10) + 6;
  axisLabel.margin = -Math.round(Math.max(0, zeroOffsetFromMin - labelGap));
  categoryAxis.z = Math.max(categoryAxis.z ?? 0, 20);
  return true;
}

export function applyZeroCrossingAxisLabelLayout(
  option: echarts.EChartsOption,
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
  primary: echarts.EChartsOption,
  secondary: echarts.EChartsOption,
  primaryChartTypeNode: SafeXmlNode,
  secondaryChartTypeNode: SafeXmlNode,
): echarts.EChartsOption {
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
    applyNiceAxisRange(option);

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
          formatCode: dataTableSeries.find((s) => s.formatCode)?.formatCode,
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
  const { option, dataTable, chartFrameStyle } = parseChartXml(chartXml, chartCtx, node.chartPath);
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
  option: echarts.EChartsOption,
  chartInstances?: Set<echarts.ECharts>,
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
