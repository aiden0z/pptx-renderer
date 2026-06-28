import type * as echarts from 'echarts';
import { SafeXmlNode } from '../../parser/XmlParser';
import { RenderContext } from '../RenderContext';
import { numToPct } from './layout';
import { parseOoxmlBoolElement } from './ooxml';
import { extractTxPrStyle } from './text';
import {
  EXPLICIT_FONT_SIZE,
  hasExplicitFontSize,
  type ChartTextStyle,
  type LegendInfo,
} from './types';

type LegendDataItem =
  | string
  | {
      name: string;
      icon?: string;
      marker?: string;
      itemStyle?: Record<string, unknown>;
      lineStyle?: Record<string, unknown>;
    };

export function extractLegendInfo(
  chartNode: SafeXmlNode,
  ctx: RenderContext,
): LegendInfo | undefined {
  const legend = chartNode.child('legend');
  if (!legend.exists()) return undefined;

  const legendPos = legend.child('legendPos');
  const rawPosVal = legendPos.exists() ? legendPos.attr('val') || 'r' : 'r';
  const posVal = ['b', 't', 'l', 'r', 'tr'].includes(rawPosVal)
    ? (rawPosVal as LegendInfo['position'])
    : 'r';

  const overlay = parseOoxmlBoolElement(legend.child('overlay'));

  const base = { confine: true as const };
  const topBelowTitle = '14%';
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
        ...(s.textShadowColor ? { textShadowColor: s.textShadowColor } : {}),
        ...(s.textShadowBlur !== undefined ? { textShadowBlur: s.textShadowBlur } : {}),
        ...(s.textShadowOffsetX !== undefined ? { textShadowOffsetX: s.textShadowOffsetX } : {}),
        ...(s.textShadowOffsetY !== undefined ? { textShadowOffsetY: s.textShadowOffsetY } : {}),
      };
      if (hasExplicitFontSize(s)) textStyle[EXPLICIT_FONT_SIZE] = true;
      return textStyle;
    })(),
    manualLayout: extractLegendManualLayout(legend),
  };
}

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

export function legendIsAtTop(legendInfo: LegendInfo | undefined): boolean {
  return legendInfo?.position === 't' || legendInfo?.position === 'tr';
}

export function getGridTopPx(hasTitle: boolean, legendInfo: LegendInfo | undefined): number {
  const atTop = legendIsAtTop(legendInfo);
  const overlayLegend = legendInfo?.overlay ?? false;
  if (hasTitle) return atTop && !overlayLegend ? 52 : 68;
  return atTop && !overlayLegend ? 32 : 20;
}

export function getLegendTopPx(
  hasTitle: boolean,
  legendInfo: LegendInfo | undefined,
): number | undefined {
  if (!legendIsAtTop(legendInfo)) return undefined;
  return hasTitle ? 26 : 6;
}

export function getLegendPlacement(
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

export function getGridBottomPx(legendInfo: LegendInfo | undefined): number {
  if (legendInfo) {
    const opt = legendInfo.option as Record<string, unknown> | undefined;
    if (opt && opt.bottom !== undefined) {
      return 35;
    }
  }
  return 20;
}

export function buildLegendOption(
  legendOpt: echarts.EChartsOption['legend'] | undefined,
  legendInfo: LegendInfo | undefined,
  legendTopPx: number | undefined,
  data: LegendDataItem[],
  textStyle: ChartTextStyle & {
    fontWeight?: 'normal' | 'bold' | 'bolder' | 'lighter' | number;
  },
): echarts.EChartsOption['legend'] {
  if (!legendOpt) return { show: false };
  const manual = legendInfo?.manualLayout ?? {};
  const top =
    manual.top !== undefined ? manual.top : legendTopPx !== undefined ? legendTopPx : undefined;
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

export type LegendOptionObject = {
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

export function getLegendOptionObject(
  legend: echarts.EChartsOption['legend'],
): LegendOptionObject | null {
  if (!legend) return null;
  return Array.isArray(legend)
    ? ((legend[0] as LegendOptionObject | undefined) ?? null)
    : (legend as LegendOptionObject);
}

export function pickSeriesStringColor(
  color: string | object | undefined,
  fallback: string,
): string {
  return typeof color === 'string' ? color : fallback;
}

export function pickVisualStringColor(
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

export function lineLegendIconPath(): string {
  return 'path://M2 4.5 L22 4.5';
}
