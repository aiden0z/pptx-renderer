import { echarts } from './echartsRuntime';
import { SafeXmlNode } from '../../parser/XmlParser';
import { ptToPx } from '../../parser/units';
import { resolveColor, resolveLineStyle } from '../StyleResolver';
import { RenderContext } from '../RenderContext';
import type { ChartLineStyle, ChartLineType, DataPointStyle } from './types';

export function resolveColorToHex(fillNode: SafeXmlNode, ctx: RenderContext): string | undefined {
  try {
    const { color } = resolveColor(fillNode, ctx);
    return color.startsWith('#') ? color : `#${color}`;
  } catch {
    return undefined;
  }
}

function resolveGradientStop(
  gsNode: SafeXmlNode,
  ctx: RenderContext,
): { color: string; alpha: number; pos: number } | undefined {
  const pos = gsNode.numAttr('pos');
  if (pos === undefined) return undefined;

  for (const child of gsNode.allChildren()) {
    const ln = child.localName;
    if (ln === 'srgbClr' || ln === 'schemeClr' || ln === 'sysClr' || ln === 'prstClr') {
      try {
        const result = resolveColor(gsNode, ctx);
        const hex = result.color.startsWith('#') ? result.color : `#${result.color}`;
        return { color: hex, alpha: result.alpha, pos: pos / 100000 };
      } catch {
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

export function extractSeriesColor(
  ser: SafeXmlNode,
  ctx: RenderContext,
): string | object | undefined {
  const spPr = ser.child('spPr');
  if (!spPr.exists()) return undefined;

  const solidFill = spPr.child('solidFill');
  if (solidFill.exists()) {
    const hex = resolveColorToHex(solidFill, ctx);
    if (hex) return hex;
  }

  const gradFill = spPr.child('gradFill');
  if (gradFill.exists()) {
    const grad = buildEChartsGradient(gradFill, ctx);
    if (grad) return grad;
  }

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

export function extractSeriesLineWidth(ser: SafeXmlNode): number | undefined {
  const lnWidthEmu = ser.child('spPr').child('ln').numAttr('w');
  if (lnWidthEmu === undefined || lnWidthEmu <= 0) return undefined;
  return Math.max(1, Number((lnWidthEmu / 12700).toFixed(3)));
}

export function markerSizeToPx(sizePt: number): number {
  return Number(ptToPx(sizePt).toFixed(3));
}

export function extractSeriesLineNoFill(ser: SafeXmlNode): boolean {
  return ser.child('spPr').child('ln').child('noFill').exists();
}

function toChartLineType(cssDash: string): ChartLineType {
  if (cssDash === 'dotted') return 'dotted';
  if (cssDash === 'dashed') return 'dashed';
  return 'solid';
}

export function extractChartLineStyle(
  ln: SafeXmlNode,
  ctx: RenderContext,
): ChartLineStyle | undefined {
  if (!ln.exists() || ln.child('noFill').exists()) return undefined;

  const style = resolveLineStyle(ln, ctx);
  if (style.width <= 0 || style.color === 'transparent') return undefined;

  return {
    color: style.color,
    width: Math.max(style.width, 0.5),
    type: toChartLineType(style.dash),
  };
}

function buildEChartsGradient(gradFill: SafeXmlNode, ctx: RenderContext): object | undefined {
  const gsLst = gradFill.child('gsLst');
  if (!gsLst.exists()) return undefined;

  const stops: { offset: number; color: string }[] = [];
  for (const gs of gsLst.children('gs')) {
    const stop = resolveGradientStop(gs, ctx);
    if (stop) {
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

  stops.sort((a, b) => a.offset - b.offset);

  const lin = gradFill.child('lin');
  const angVal = lin.exists() ? (lin.numAttr('ang') ?? 5400000) : 5400000;
  const angleDeg = angVal / 60000;
  const rad = (angleDeg * Math.PI) / 180;
  const x0 = 0.5 - 0.5 * Math.cos(rad);
  const y0 = 0.5 - 0.5 * Math.sin(rad);
  const x1 = 0.5 + 0.5 * Math.cos(rad);
  const y1 = 0.5 + 0.5 * Math.sin(rad);

  return new echarts.graphic.LinearGradient(x0, y0, x1, y1, stops);
}

export function extractDataPointStyles(
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
