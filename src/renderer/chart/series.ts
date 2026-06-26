import { SafeXmlNode } from '../../parser/XmlParser';
import { RenderContext } from '../RenderContext';
import {
  extractFormatCode,
  extractNumericValues,
  extractNumericValuesWithBlanks,
  extractStringValues,
} from './format';
import { parseOoxmlBoolElement } from './ooxml';
import {
  extractDataPointStyles,
  extractSeriesColor,
  extractSeriesLineNoFill,
  extractSeriesLineWidth,
  markerSizeToPx,
} from './style';
import type { SeriesData } from './types';

function extractSeriesName(txNode: SafeXmlNode): string {
  const strRef = txNode.child('strRef');
  if (strRef.exists()) {
    const strCache = strRef.child('strCache');
    const pts = strCache.children('pt');
    if (pts.length > 0) {
      return pts[0].child('v').text();
    }
  }
  const v = txNode.child('v');
  if (v.exists()) return v.text();
  return '';
}

export function parseExplosion(ser: SafeXmlNode, pointCount: number): number[] | undefined {
  const explosions: number[] = new Array(pointCount).fill(0);
  let hasAny = false;

  const serExplosion = ser.child('explosion').numAttr('val') ?? 0;
  if (serExplosion > 0) {
    explosions.fill(serExplosion);
    hasAny = true;
  }

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

export function parseSeries(chartTypeNode: SafeXmlNode, ctx: RenderContext): SeriesData[] {
  const seriesArr: SeriesData[] = [];

  for (const ser of chartTypeNode.children('ser')) {
    const tx = ser.child('tx');
    const name = extractSeriesName(tx);
    const order = ser.child('order').numAttr('val') ?? seriesArr.length;

    const cat = ser.child('cat');
    const categories = extractStringValues(cat);

    const val = ser.child('val');
    const numericValues = extractNumericValuesWithBlanks(val);
    const values = numericValues.values;
    let blankIndices = numericValues.blankIndices;
    const formatCode = extractFormatCode(val);

    const xValNode = ser.child('xVal');
    const yValNode = ser.child('yVal');
    let xValues: number[] | undefined;
    if (yValNode.exists()) {
      const yVals = extractNumericValuesWithBlanks(yValNode);
      if (yVals.values.length > 0) {
        values.length = 0;
        values.push(...yVals.values);
        blankIndices = yVals.blankIndices;
      }
    }
    if (xValNode.exists()) {
      xValues = extractNumericValues(xValNode);
      if (categories.length === 0) {
        const xCats = extractStringValues(xValNode);
        if (xCats.length > 0) categories.push(...xCats);
      }
    }

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
      blankIndices,
      invertIfNegative,
      markerSymbol,
      markerSize,
      smooth,
      lineWidth,
      lineNoFill,
    });
  }

  seriesArr.sort((a, b) => a.order - b.order);

  return seriesArr;
}
