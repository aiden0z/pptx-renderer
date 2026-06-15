/**
 * Background renderer — resolves and applies slide/layout/master backgrounds.
 */

import { SafeXmlNode } from '../parser/XmlParser';
import { RenderContext } from './RenderContext';
import { resolveColor, resolveFill, resolveThemeBackgroundFillReference } from './StyleResolver';
import { hexToRgb } from '../utils/color';
import { isExternalTargetMode, RelEntry } from '../parser/RelParser';
import { resolveMediaPath, getOrCreateBlobUrl } from '../utils/media';
import { isAllowedExternalMediaUrl } from '../utils/urlSafety';

/**
 * Composite a semi-transparent color on white so the result is always opaque.
 * This prevents the slide background from becoming see-through when embedded
 * in containers with dark backgrounds (e.g. e2e-compare panels).
 */
function compositeOnWhite(r: number, g: number, b: number, a: number): string {
  const cr = Math.round(r * a + 255 * (1 - a));
  const cg = Math.round(g * a + 255 * (1 - a));
  const cb = Math.round(b * a + 255 * (1 - a));
  return `rgb(${cr},${cg},${cb})`;
}

function applyBackgroundFillCss(container: HTMLElement, fillCss: string): void {
  if (fillCss.includes('gradient') && fillCss.includes(' 0 0 / ')) {
    const bgMatch = fillCss.match(/,\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|[a-zA-Z]+)\s*$/);
    if (bgMatch && bgMatch.index !== undefined) {
      const imageLayers = fillCss.slice(0, bgMatch.index).replace(/\s+0 0\s*\/\s*8px 8px/g, '');
      container.style.backgroundImage = imageLayers;
      container.style.backgroundSize = '8px 8px';
      container.style.backgroundRepeat = 'repeat';
      container.style.backgroundColor = bgMatch[1];
      return;
    }
  }

  if (
    fillCss.includes('gradient') ||
    fillCss.startsWith('url(') ||
    fillCss.includes('repeating-')
  ) {
    container.style.background = fillCss;
  } else {
    container.style.backgroundColor = fillCss;
  }
}

/**
 * Render the background for a slide onto the container element.
 *
 * Background priority: slide.background -> layout.background -> master.background.
 * The first found background is used.
 */
export function renderBackground(ctx: RenderContext, container: HTMLElement): void {
  // Find the first available background in the inheritance chain,
  // and track which rels map to use for resolving image references
  let bgNode: SafeXmlNode | undefined;
  let bgRels: Map<string, RelEntry> = ctx.slide.rels;

  if (ctx.slide.background) {
    bgNode = ctx.slide.background;
    bgRels = ctx.slide.rels;
  } else if (ctx.layout.background) {
    bgNode = ctx.layout.background;
    bgRels = ctx.layout.rels;
  } else if (ctx.master.background) {
    bgNode = ctx.master.background;
    bgRels = ctx.master.rels;
  }

  if (!bgNode) {
    container.style.backgroundColor = '#FFFFFF';
    return;
  }

  // Parse p:bg > p:bgPr
  const bgPr = bgNode.child('bgPr');
  if (bgPr.exists()) {
    renderBgPr(bgPr, ctx, container, bgRels);
    return;
  }

  // Parse p:bg > p:bgRef (theme reference)
  const bgRef = bgNode.child('bgRef');
  if (bgRef.exists()) {
    renderBgRef(bgRef, ctx, container);
    return;
  }

  // Fallback
  container.style.backgroundColor = '#FFFFFF';
}

/**
 * Render background from bgPr (background properties).
 * Contains direct fill definitions: solidFill, gradFill, blipFill, etc.
 */
function renderBgPr(
  bgPr: SafeXmlNode,
  ctx: RenderContext,
  container: HTMLElement,
  rels?: Map<string, RelEntry>,
): void {
  // solidFill
  const solidFill = bgPr.child('solidFill');
  if (solidFill.exists()) {
    const { color, alpha } = resolveColor(solidFill, ctx);
    const hex = color.startsWith('#') ? color : `#${color}`;
    if (alpha < 1) {
      const { r, g, b } = hexToRgb(hex);
      container.style.backgroundColor = compositeOnWhite(r, g, b, alpha);
    } else {
      container.style.backgroundColor = hex;
    }
    return;
  }

  // gradFill
  const gradFill = bgPr.child('gradFill');
  if (gradFill.exists()) {
    const css = resolveFill(bgPr, ctx);
    if (css) {
      container.style.background = css;
    }
    return;
  }

  // pattFill
  const pattFill = bgPr.child('pattFill');
  if (pattFill.exists()) {
    const css = resolveFill(bgPr, ctx);
    if (css) {
      applyBackgroundFillCss(container, css);
    }
    return;
  }

  // blipFill (image background)
  const blipFill = bgPr.child('blipFill');
  if (blipFill.exists()) {
    renderBlipBackground(blipFill, ctx, container, rels);
    return;
  }

  // noFill — still render as white; the slide is a self-contained element
  // and transparent backgrounds break when embedded in dark containers
  const noFill = bgPr.child('noFill');
  if (noFill.exists()) {
    container.style.backgroundColor = '#FFFFFF';
    return;
  }
}

/**
 * Render background from bgRef (theme format scheme reference).
 * bgRef values 1001+ reference theme bgFillStyleLst; lower values fall back
 * to regular fillStyleLst for compatibility with non-standard producers.
 */
function renderBgRef(bgRef: SafeXmlNode, ctx: RenderContext, container: HTMLElement): void {
  const idx = bgRef.numAttr('idx') ?? 0;
  const hasThemeFill =
    (idx >= 1001 && idx - 1000 <= (ctx.theme.bgFillStyles?.length ?? 0)) ||
    (idx > 0 && idx <= (ctx.theme.fillStyles?.length ?? 0));
  if (hasThemeFill) {
    const { fillCss } = resolveThemeBackgroundFillReference(bgRef, ctx);
    applyBackgroundFillCss(container, fillCss);
    return;
  }

  // bgRef may contain a color child (schemeClr, srgbClr, etc.)
  const { color, alpha } = resolveColor(bgRef, ctx);
  if (color && color !== '#000000') {
    const hex = color.startsWith('#') ? color : `#${color}`;
    if (alpha < 1) {
      const { r, g, b } = hexToRgb(hex);
      container.style.backgroundColor = compositeOnWhite(r, g, b, alpha);
    } else {
      container.style.backgroundColor = hex;
    }
  } else {
    container.style.backgroundColor = '#FFFFFF';
  }
}

/**
 * Render a blip (image) fill as a CSS background.
 */
function renderBlipBackground(
  blipFill: SafeXmlNode,
  ctx: RenderContext,
  container: HTMLElement,
  rels?: Map<string, RelEntry>,
): void {
  const blip = blipFill.child('blip');
  const embedId = blip.attr('embed') ?? blip.attr('r:embed');
  const linkId = blip.attr('link') ?? blip.attr('r:link');
  const relId = embedId ?? linkId;

  if (!relId) return;

  // Resolve image from rels + media (use provided rels or fall back to slide rels)
  const relsMap = rels ?? ctx.slide.rels;
  const rel = relsMap.get(relId);
  if (!rel) return;

  let url: string | undefined;
  if (isExternalTargetMode(rel.targetMode)) {
    if (!isAllowedExternalMediaUrl(rel.target)) return;
    url = rel.target;
  } else {
    const mediaPath = resolveMediaPath(rel.target);
    const data = ctx.presentation.media.get(mediaPath);
    if (!data) return;
    url = getOrCreateBlobUrl(mediaPath, data, ctx.mediaUrlCache);
  }

  container.style.backgroundImage = `url("${url}")`;

  // Check for stretch or tile mode
  const stretch = blipFill.child('stretch');
  if (stretch.exists()) {
    // OOXML stretch fills the destination rectangle. When fillRect is omitted,
    // the implicit rectangle is the whole image, not an aspect-preserving cover crop.
    applyStretchFillRect(container, stretch.child('fillRect'));
    container.style.backgroundRepeat = 'no-repeat';
  }

  const tile = blipFill.child('tile');
  if (tile.exists()) {
    container.style.backgroundRepeat = 'repeat';
    container.style.backgroundSize = 'auto';
  }
}

function pctAttr(node: SafeXmlNode, name: string): number {
  return (node.numAttr(name) ?? 0) / 1000;
}

function positionForInset(startPct: number, endPct: number): number {
  const denominator = startPct + endPct;
  if (Math.abs(denominator) < 0.0001) return 0;
  return (startPct / denominator) * 100;
}

function applyStretchFillRect(container: HTMLElement, fillRect: SafeXmlNode): void {
  if (!fillRect.exists()) {
    container.style.backgroundSize = '100% 100%';
    container.style.backgroundPosition = '';
    return;
  }

  const left = pctAttr(fillRect, 'l');
  const top = pctAttr(fillRect, 't');
  const right = pctAttr(fillRect, 'r');
  const bottom = pctAttr(fillRect, 'b');
  const width = 100 - left - right;
  const height = 100 - top - bottom;

  container.style.backgroundSize = `${width}% ${height}%`;
  container.style.backgroundPosition = `${positionForInset(left, right)}% ${positionForInset(top, bottom)}%`;
}
