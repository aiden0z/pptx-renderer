import { SafeXmlNode } from '../../parser/XmlParser';
import { parseOoxmlBool } from '../../parser/booleans';
import { emuToPx } from '../../parser/units';
import { cssFontFamilyStack, resolveThemeFontStack } from '../fontResolver';
import { RenderContext } from '../RenderContext';
import { resolveColor } from '../StyleResolver';
import { resolveColorToHex } from './style';
import { EXPLICIT_FONT_SIZE, type ChartTextStyle } from './types';

type EChartsTextStyle = ChartTextStyle & {
  fontWeight?: 'normal' | 'bold' | 'bolder' | 'lighter' | number;
};

interface ChartRichText {
  text: string;
  rich: Record<string, EChartsTextStyle>;
}

export function extractTitleText(title: SafeXmlNode): string | undefined {
  const tx = title.child('tx');
  if (!tx.exists()) return undefined;

  const rich = tx.child('rich');
  if (rich.exists()) {
    const paragraphs: string[] = [];
    for (const p of rich.children('p')) {
      const parts: string[] = [];
      for (const child of p.allChildren()) {
        if (child.localName === 'br') {
          parts.push('\n');
          continue;
        }
        if (child.localName !== 'r' && child.localName !== 'fld') {
          continue;
        }
        const t = child.child('t').text();
        if (t) parts.push(t);
      }
      const paragraph = parts.join('');
      if (paragraph) paragraphs.push(paragraph);
    }
    if (paragraphs.length > 0) return paragraphs.join('\n');
  }

  const strRef = tx.child('strRef');
  if (strRef.exists()) {
    const strCache = strRef.child('strCache');
    const pts = strCache.children('pt');
    if (pts.length > 0) return pts[0].child('v').text();
  }

  return undefined;
}

function escapeRichTextContent(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\|/g, '\\|');
}

export function chartTextStyleToEChartsTextStyle(
  style: ChartTextStyle | undefined,
): EChartsTextStyle | undefined {
  if (!style) return undefined;
  const out: EChartsTextStyle = {
    ...(style.color ? { color: style.color } : {}),
    ...(style.fontSize !== undefined ? { fontSize: style.fontSize } : {}),
    ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
    ...(style.textShadowColor ? { textShadowColor: style.textShadowColor } : {}),
    ...(style.textShadowBlur !== undefined ? { textShadowBlur: style.textShadowBlur } : {}),
    ...(style.textShadowOffsetX !== undefined
      ? { textShadowOffsetX: style.textShadowOffsetX }
      : {}),
    ...(style.textShadowOffsetY !== undefined
      ? { textShadowOffsetY: style.textShadowOffsetY }
      : {}),
  };
  if (style.bold !== undefined) {
    out.fontWeight = style.bold ? 'bold' : 'normal';
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function extractTxPrColor(parentNode: SafeXmlNode, ctx: RenderContext): string | undefined {
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

function hexToRgbInternal(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace(/^#/, '');
  const expanded =
    cleaned.length === 3
      ? cleaned[0] + cleaned[0] + cleaned[1] + cleaned[1] + cleaned[2] + cleaned[2]
      : cleaned;
  const num = parseInt(expanded, 16);
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff };
}

function colorToCss(color: string, alpha: number): string {
  const hex = color.startsWith('#') ? color : `#${color}`;
  if (alpha >= 1) return hex;
  const { r, g, b } = hexToRgbInternal(hex);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

function extractTextOuterShadow(
  defRPr: SafeXmlNode,
  ctx: RenderContext,
): Partial<ChartTextStyle> | undefined {
  const outerShdw = defRPr.child('effectLst').child('outerShdw');
  if (!outerShdw.exists()) return undefined;

  try {
    const { color, alpha } = resolveColor(outerShdw, ctx);
    if (!color || alpha <= 0) return undefined;

    const distPx = emuToPx(outerShdw.numAttr('dist') ?? 0);
    const blurPx = emuToPx(outerShdw.numAttr('blurRad') ?? 0);
    const dirDeg = (outerShdw.numAttr('dir') ?? 0) / 60000;
    const offsetX = distPx * Math.cos((dirDeg * Math.PI) / 180);
    const offsetY = distPx * Math.sin((dirDeg * Math.PI) / 180);

    return {
      textShadowColor: colorToCss(color, alpha),
      textShadowBlur: blurPx,
      textShadowOffsetX: offsetX,
      textShadowOffsetY: offsetY,
    };
  } catch {
    return undefined;
  }
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
    style.fontSize = Math.round(sz / 100);
    style[EXPLICIT_FONT_SIZE] = true;
  }
  const b = defRPr.attr('b');
  if (b !== undefined) style.bold = parseOoxmlBool(b);
  const latinTypeface = defRPr.child('latin').attr('typeface');
  const eaTypeface = defRPr.child('ea').attr('typeface');
  const csTypeface = defRPr.child('cs').attr('typeface');
  const fontStack = resolveThemeFontStack([latinTypeface, eaTypeface, csTypeface], ctx, [
    defRPr.attr('lang'),
    defRPr.attr('altLang'),
  ]);
  if (fontStack.length > 0) {
    style.fontFamily = cssFontFamilyStack(fontStack);
  }
  const shadowStyle = extractTextOuterShadow(defRPr, ctx);
  if (shadowStyle) Object.assign(style, shadowStyle);

  return style.color ||
    style.fontSize !== undefined ||
    style.bold !== undefined ||
    style.fontFamily !== undefined ||
    style.textShadowColor !== undefined
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

export function extractTxPrStyle(
  parentNode: SafeXmlNode,
  ctx: RenderContext,
): ChartTextStyle | undefined {
  const txPr = parentNode.child('txPr');
  if (!txPr.exists()) return undefined;
  return extractParagraphTextStyle(txPr, ctx);
}

export function extractTitleTextStyle(
  title: SafeXmlNode,
  ctx: RenderContext,
): ChartTextStyle | undefined {
  return (
    extractTxPrStyle(title, ctx) ?? extractParagraphTextStyle(title.child('tx').child('rich'), ctx)
  );
}

export function extractTitleRichText(
  title: SafeXmlNode,
  ctx: RenderContext,
): ChartRichText | undefined {
  const richNode = title.child('tx').child('rich');
  if (!richNode.exists()) return undefined;

  const paragraphs: string[] = [];
  const rich: Record<string, EChartsTextStyle> = {};
  let runIndex = 0;

  for (const p of richNode.children('p')) {
    const parts: string[] = [];
    for (const child of p.allChildren()) {
      if (child.localName === 'br') {
        parts.push('\n');
        continue;
      }
      if (child.localName !== 'r' && child.localName !== 'fld') {
        continue;
      }

      const text = child.child('t').text();
      if (!text) continue;
      const runStyle = chartTextStyleToEChartsTextStyle(
        extractDefRPrStyle(child.child('rPr'), ctx),
      );
      if (!runStyle) {
        parts.push(escapeRichTextContent(text));
        continue;
      }

      const styleName = `r${runIndex++}`;
      rich[styleName] = runStyle;
      parts.push(`{${styleName}|${escapeRichTextContent(text)}}`);
    }
    const paragraph = parts.join('');
    if (paragraph) paragraphs.push(paragraph);
  }

  if (Object.keys(rich).length === 0) return undefined;
  return { text: paragraphs.join('\n'), rich };
}

export function getChartThemeFontFamily(ctx: RenderContext): string | undefined {
  const fontStack = resolveThemeFontStack(['+mn-lt', '+mn-ea', '+mj-lt', '+mj-ea'], ctx);
  return fontStack.length > 0 ? cssFontFamilyStack(fontStack) : undefined;
}
