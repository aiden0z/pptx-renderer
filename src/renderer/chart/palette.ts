import { SafeXmlNode } from '../../parser/XmlParser';
import { RenderContext } from '../RenderContext';
import { resolveColorToHex } from './style';
import { CHART_ACCENT_KEYS } from './types';

function parseChartColorMapOverride(chartXml: SafeXmlNode): Map<string, string> | undefined {
  const clrMapOvr = chartXml.child('clrMapOvr');
  if (!clrMapOvr.exists()) return undefined;

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

export function createChartRenderContext(chartXml: SafeXmlNode, ctx: RenderContext): RenderContext {
  const colorMapOverride = parseChartColorMapOverride(chartXml);
  if (!colorMapOverride) return ctx;
  return {
    ...ctx,
    layout: { ...ctx.layout, colorMapOverride },
    colorCache: new Map(),
  };
}

export function parseChartStyleId(chartXml: SafeXmlNode): number | undefined {
  const styleNode = chartXml.child('style');
  const direct = styleNode.numAttr('val');
  if (direct !== undefined) return direct;

  const alt = chartXml.child('AlternateContent');
  if (!alt.exists()) return undefined;
  for (const branch of alt.allChildren()) {
    const s = branch.child('style');
    const v = s.numAttr('val');
    if (v !== undefined) return v;
  }
  return undefined;
}

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

export function getVaryColorPointPalette(
  ctx: RenderContext,
  options: { darken?: boolean } = {},
): string[] {
  const accents = getThemeAccentPalette(ctx);
  return options.darken === false ? accents : accents.map((color) => darkenHexColor(color, 0.88));
}

export function buildChartPalette(
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

  return accents;
}
