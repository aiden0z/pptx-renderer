/**
 * Background renderer — resolves and applies slide/layout/master backgrounds.
 */

import { SafeXmlNode } from '../parser/XmlParser';
import { RenderContext } from './RenderContext';
import {
  resolveColor,
  resolveFill,
  resolveGradientFill,
  resolveThemeBackgroundFillReference,
  getFocusedGradientStops,
  type GradientFillData,
} from './StyleResolver';
import { hexToRgb } from '../utils/color';
import { isExternalTargetMode, RelEntry } from '../parser/RelParser';
import { findMediaByTarget, findMediaByTargetAsync, getOrCreateBlobUrl } from '../utils/media';
import { isAllowedExternalMediaUrl } from '../utils/urlSafety';
import { splitTiledPatternFillCss } from './cssValues';

let backgroundGradientIdCounter = 0;

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
    const tiled = splitTiledPatternFillCss(fillCss);
    if (tiled) {
      container.style.backgroundImage = tiled.imageLayers;
      container.style.backgroundSize = '8px 8px';
      container.style.backgroundRepeat = 'repeat';
      container.style.backgroundColor = tiled.color;
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

function angleToSvgGradientCoords(angleDeg: number): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x1: 50 - 50 * Math.cos(rad),
    y1: 50 - 50 * Math.sin(rad),
    x2: 50 + 50 * Math.cos(rad),
    y2: 50 + 50 * Math.sin(rad),
  };
}

function appendGradientStops(gradient: SVGGradientElement, stops: GradientFillData['stops']): void {
  const svgNs = 'http://www.w3.org/2000/svg';
  for (const stop of stops) {
    const svgStop = document.createElementNS(svgNs, 'stop');
    svgStop.setAttribute('offset', `${stop.position}%`);
    svgStop.setAttribute('stop-color', stop.color);
    gradient.appendChild(svgStop);
  }
}

function renderSvgGradientBackground(
  container: HTMLElement,
  gradientFillData: GradientFillData,
  width: number,
  height: number,
): void {
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('data-pptx-background-gradient', 'true');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.position = 'absolute';
  svg.style.left = '0';
  svg.style.top = '0';
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.pointerEvents = 'none';
  svg.style.display = 'block';

  const defs = document.createElementNS(svgNs, 'defs');
  svg.appendChild(defs);
  const gradId = `bg-grad-${++backgroundGradientIdCounter}`;

  if (gradientFillData.type === 'radial' && gradientFillData.pathType === 'rect') {
    const gcx = gradientFillData.cx ?? 0.5;
    const gcy = gradientFillData.cy ?? 0.5;
    const mirrorStops = (centerFrac: number, axis: 'x' | 'y') => {
      const focusedStops = getFocusedGradientStops(gradientFillData, { axis });
      const mirrored: Array<{ offset: number; color: string }> = [];
      for (const stop of focusedStops) {
        const t = stop.position / 100;
        mirrored.push({ offset: centerFrac - t * centerFrac, color: stop.color });
        mirrored.push({ offset: centerFrac + t * (1 - centerFrac), color: stop.color });
      }
      return mirrored.sort((a, b) => a.offset - b.offset);
    };

    const hGradId = `${gradId}-h`;
    const hGrad = document.createElementNS(svgNs, 'linearGradient');
    hGrad.setAttribute('id', hGradId);
    hGrad.setAttribute('color-interpolation', gradientFillData.colorInterpolation ?? 'linearRGB');
    hGrad.setAttribute('x1', '0%');
    hGrad.setAttribute('y1', '0%');
    hGrad.setAttribute('x2', '100%');
    hGrad.setAttribute('y2', '0%');
    for (const stop of mirrorStops(gcx, 'x')) {
      const svgStop = document.createElementNS(svgNs, 'stop');
      svgStop.setAttribute('offset', `${(stop.offset * 100).toFixed(2)}%`);
      svgStop.setAttribute('stop-color', stop.color);
      hGrad.appendChild(svgStop);
    }
    defs.appendChild(hGrad);

    const vGradId = `${gradId}-v`;
    const vGrad = document.createElementNS(svgNs, 'linearGradient');
    vGrad.setAttribute('id', vGradId);
    vGrad.setAttribute('color-interpolation', gradientFillData.colorInterpolation ?? 'linearRGB');
    vGrad.setAttribute('x1', '0%');
    vGrad.setAttribute('y1', '0%');
    vGrad.setAttribute('x2', '0%');
    vGrad.setAttribute('y2', '100%');
    for (const stop of mirrorStops(gcy, 'y')) {
      const svgStop = document.createElementNS(svgNs, 'stop');
      svgStop.setAttribute('offset', `${(stop.offset * 100).toFixed(2)}%`);
      svgStop.setAttribute('stop-color', stop.color);
      vGrad.appendChild(svgStop);
    }
    defs.appendChild(vGrad);

    const blendGroup = document.createElementNS(svgNs, 'g');
    blendGroup.setAttribute('style', 'isolation: isolate');

    const bgRect = document.createElementNS(svgNs, 'rect');
    bgRect.setAttribute('width', String(width));
    bgRect.setAttribute('height', String(height));
    bgRect.setAttribute('fill', 'black');
    blendGroup.appendChild(bgRect);

    for (const id of [hGradId, vGradId]) {
      const rect = document.createElementNS(svgNs, 'rect');
      rect.setAttribute('width', String(width));
      rect.setAttribute('height', String(height));
      rect.setAttribute('fill', `url(#${id})`);
      rect.setAttribute('style', 'mix-blend-mode: lighten');
      blendGroup.appendChild(rect);
    }
    svg.appendChild(blendGroup);
  } else if (gradientFillData.type === 'radial') {
    const radialGrad = document.createElementNS(svgNs, 'radialGradient');
    radialGrad.setAttribute('id', gradId);
    radialGrad.setAttribute(
      'color-interpolation',
      gradientFillData.colorInterpolation ?? 'linearRGB',
    );
    radialGrad.setAttribute('gradientUnits', 'userSpaceOnUse');
    const gcx = gradientFillData.cx ?? 0.5;
    const gcy = gradientFillData.cy ?? 0.5;
    radialGrad.setAttribute('cx', String(gcx * width));
    radialGrad.setAttribute('cy', String(gcy * height));
    const maxDx = Math.max(gcx, 1 - gcx);
    const maxDy = Math.max(gcy, 1 - gcy);
    radialGrad.setAttribute('r', String(Math.hypot(maxDx * width, maxDy * height)));
    appendGradientStops(radialGrad, getFocusedGradientStops(gradientFillData, { width, height }));
    defs.appendChild(radialGrad);

    const rect = document.createElementNS(svgNs, 'rect');
    rect.setAttribute('width', String(width));
    rect.setAttribute('height', String(height));
    rect.setAttribute('fill', `url(#${gradId})`);
    svg.appendChild(rect);
  } else {
    const linearGrad = document.createElementNS(svgNs, 'linearGradient');
    linearGrad.setAttribute('id', gradId);
    linearGrad.setAttribute(
      'color-interpolation',
      gradientFillData.colorInterpolation ?? 'linearRGB',
    );
    linearGrad.setAttribute('gradientUnits', 'userSpaceOnUse');
    const coords = angleToSvgGradientCoords(gradientFillData.angle);
    linearGrad.setAttribute('x1', String((coords.x1 / 100) * width));
    linearGrad.setAttribute('y1', String((coords.y1 / 100) * height));
    linearGrad.setAttribute('x2', String((coords.x2 / 100) * width));
    linearGrad.setAttribute('y2', String((coords.y2 / 100) * height));
    appendGradientStops(linearGrad, gradientFillData.stops);
    defs.appendChild(linearGrad);

    const rect = document.createElementNS(svgNs, 'rect');
    rect.setAttribute('width', String(width));
    rect.setAttribute('height', String(height));
    rect.setAttribute('fill', `url(#${gradId})`);
    svg.appendChild(rect);
  }

  if (!container.style.position) {
    container.style.position = 'relative';
  }
  container.style.background = '';
  container.querySelectorAll('svg[data-pptx-background-gradient="true"]').forEach((el) => {
    el.remove();
  });
  container.insertBefore(svg, container.firstChild);
}

function tryRenderSvgGradientBackground(
  bgPr: SafeXmlNode,
  ctx: RenderContext,
  container: HTMLElement,
): boolean {
  return tryRenderSvgGradientBackgroundData(resolveGradientFill(bgPr, ctx), ctx, container);
}

function tryRenderSvgGradientBackgroundData(
  gradientFillData: GradientFillData | null,
  ctx: RenderContext,
  container: HTMLElement,
): boolean {
  if (!gradientFillData?.pathType) return false;

  renderSvgGradientBackground(
    container,
    gradientFillData,
    ctx.presentation.width,
    ctx.presentation.height,
  );
  return true;
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
    if (tryRenderSvgGradientBackground(bgPr, ctx, container)) {
      return;
    }
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
    const { fillCss, gradientFillData } = resolveThemeBackgroundFillReference(bgRef, ctx);
    if (tryRenderSvgGradientBackgroundData(gradientFillData, ctx, container)) {
      return;
    }
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
    const resolved = findMediaByTarget(rel.target, ctx.presentation.media);
    if (!resolved) {
      if (ctx.presentation.mediaResolver) {
        const task = findMediaByTargetAsync(
          rel.target,
          ctx.presentation.media,
          ctx.presentation.mediaResolver,
        )
          .then((lazyResolved) => {
            if (!lazyResolved) return;
            const lazyUrl = getOrCreateBlobUrl(
              lazyResolved.mediaPath,
              lazyResolved.data,
              ctx.mediaUrlCache,
            );
            applyBlipBackground(blipFill, container, lazyUrl);
          })
          .catch(() => {
            // Leave the background unchanged when lazy media cannot be decoded.
          });
        ctx.asyncTasks?.push(task);
        if (!ctx.asyncTasks) void task;
      }
      return;
    }
    const { mediaPath, data } = resolved;
    url = getOrCreateBlobUrl(mediaPath, data, ctx.mediaUrlCache);
  }

  applyBlipBackground(blipFill, container, url);
}

function applyBlipBackground(blipFill: SafeXmlNode, container: HTMLElement, url: string): void {
  const blipOpacity = resolveBlipOpacity(blipFill.child('blip'));
  if (blipOpacity < 1 || blipFill.child('srcRect').exists()) {
    applyBlipBackgroundLayer(blipFill, container, url, blipOpacity);
    return;
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

function applyBlipBackgroundLayer(
  blipFill: SafeXmlNode,
  container: HTMLElement,
  url: string,
  opacity: number,
): void {
  if (!container.style.position) {
    container.style.position = 'relative';
  }
  container.style.backgroundImage = '';
  container.querySelectorAll('[data-pptx-background-image="true"]').forEach((el) => {
    el.remove();
  });

  const layer = document.createElement('div');
  layer.setAttribute('data-pptx-background-image', 'true');
  layer.style.position = 'absolute';
  layer.style.pointerEvents = 'none';
  layer.style.opacity = `${Number(opacity.toFixed(4))}`;

  const stretch = blipFill.child('stretch');
  const fillRect = stretch.exists() ? stretch.child('fillRect') : new SafeXmlNode(null);
  applyBackgroundLayerDestination(layer, fillRect);

  const srcRect = blipFill.child('srcRect');
  if (srcRect.exists()) {
    layer.style.overflow = 'hidden';
    const cropLayer = document.createElement('div');
    cropLayer.setAttribute('data-pptx-background-crop', 'true');
    cropLayer.style.position = 'absolute';
    cropLayer.style.backgroundImage = `url("${url}")`;
    cropLayer.style.backgroundSize = '100% 100%';
    cropLayer.style.backgroundRepeat = 'no-repeat';
    applySourceCropLayer(cropLayer, srcRect);
    layer.appendChild(cropLayer);
    container.insertBefore(layer, container.firstChild);
    return;
  }

  layer.style.backgroundImage = `url("${url}")`;
  if (stretch.exists()) {
    layer.style.backgroundSize = '100% 100%';
    layer.style.backgroundRepeat = 'no-repeat';
  }

  const tile = blipFill.child('tile');
  if (tile.exists()) {
    layer.style.backgroundRepeat = 'repeat';
    layer.style.backgroundSize = 'auto';
  }

  container.insertBefore(layer, container.firstChild);
}

interface PercentRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function getStretchFillRectBox(fillRect: SafeXmlNode): PercentRect {
  if (!fillRect.exists()) {
    return { left: 0, top: 0, width: 100, height: 100 };
  }

  const left = pctAttr(fillRect, 'l');
  const top = pctAttr(fillRect, 't');
  const right = pctAttr(fillRect, 'r');
  const bottom = pctAttr(fillRect, 'b');
  return {
    left,
    top,
    width: 100 - left - right,
    height: 100 - top - bottom,
  };
}

function applyBackgroundLayerDestination(layer: HTMLElement, fillRect: SafeXmlNode): void {
  const box = getStretchFillRectBox(fillRect);
  layer.style.left = `${box.left}%`;
  layer.style.top = `${box.top}%`;
  layer.style.width = `${box.width}%`;
  layer.style.height = `${box.height}%`;
}

function applySourceCropLayer(cropLayer: HTMLElement, srcRect: SafeXmlNode): void {
  const left = pctAttr(srcRect, 'l') / 100;
  const top = pctAttr(srcRect, 't') / 100;
  const right = pctAttr(srcRect, 'r') / 100;
  const bottom = pctAttr(srcRect, 'b') / 100;
  const visibleW = 1 - left - right;
  const visibleH = 1 - top - bottom;

  if (visibleW <= 0.001 || visibleH <= 0.001) {
    cropLayer.style.left = '0%';
    cropLayer.style.top = '0%';
    cropLayer.style.width = '100%';
    cropLayer.style.height = '100%';
    return;
  }

  const scaleX = 1 / visibleW;
  const scaleY = 1 / visibleH;
  cropLayer.style.left = `${-left * scaleX * 100}%`;
  cropLayer.style.top = `${-top * scaleY * 100}%`;
  cropLayer.style.width = `${scaleX * 100}%`;
  cropLayer.style.height = `${scaleY * 100}%`;
}

function resolveBlipOpacity(blip: SafeXmlNode): number {
  let alpha = 1;

  const alphaModFix = blip.child('alphaModFix');
  if (alphaModFix.exists()) {
    alpha *= (alphaModFix.numAttr('amt') ?? 100000) / 100000;
  }

  const alphaMod = blip.child('alphaMod');
  if (alphaMod.exists()) {
    alpha *= (alphaMod.numAttr('val') ?? 100000) / 100000;
  }

  const alphaOff = blip.child('alphaOff');
  if (alphaOff.exists()) {
    alpha += (alphaOff.numAttr('val') ?? 0) / 100000;
  }

  return Math.max(0, Math.min(1, alpha));
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
