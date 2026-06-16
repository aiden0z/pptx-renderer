/**
 * Shape renderer — converts ShapeNodeData into positioned HTML/SVG elements.
 */

import { ShapeNodeData, LineEndInfo, TextBody } from '../model/nodes/ShapeNode';
import { RenderContext } from './RenderContext';
import { parseOoxmlBool } from '../parser/booleans';
import { isExternalTargetMode } from '../parser/RelParser';

/** True if the text body has at least one non-empty run (avoids covering shapes with empty placeholder text). */
function hasVisibleText(textBody: TextBody): boolean {
  for (const p of textBody.paragraphs) {
    for (const r of p.runs) {
      if (r.text != null && r.text.trim().length > 0) return true;
    }
  }
  return false;
}

function isSingleLineTextBody(textBody: TextBody): boolean {
  let visibleParagraphCount = 0;
  for (const p of textBody.paragraphs) {
    const hasVisibleRun = p.runs.some((r) => r.text != null && r.text.length > 0);
    if (!hasVisibleRun) continue;
    visibleParagraphCount++;
    if (visibleParagraphCount > 1 || p.runs.some((r) => r.text === '\n')) return false;
  }
  return visibleParagraphCount === 1;
}

function hasExplicitCenteredParagraph(textBody: TextBody): boolean {
  const visibleParagraphs = textBody.paragraphs.filter((p) =>
    p.runs.some((r) => r.text != null && r.text.length > 0),
  );
  if (visibleParagraphs.length === 0) return false;
  return visibleParagraphs.every((p) => p.properties?.attr('algn') === 'ctr');
}

const IMPLICIT_SINGLE_LINE_LABEL_MAX_CHARS = 36;

function visibleTextLength(textBody: TextBody): number {
  const text = textBody.paragraphs
    .flatMap((p) => p.runs.map((r) => r.text ?? ''))
    .join('')
    .replace(/\s+/g, '');
  return Array.from(text).length;
}

function isShortImplicitSingleLineLabel(textBody: TextBody): boolean {
  const length = visibleTextLength(textBody);
  return length > 0 && length <= IMPLICIT_SINGLE_LINE_LABEL_MAX_CHARS;
}

function visibleParagraphCount(textBody: TextBody): number {
  return textBody.paragraphs.filter((paragraph) =>
    paragraph.runs.some((run) => run.text != null && run.text.length > 0),
  ).length;
}

function hasExplicitParagraphSpacing(textBody: TextBody): boolean {
  return textBody.paragraphs.some((paragraph) => {
    const pPr = paragraph.properties;
    return (
      pPr?.child('lnSpc').exists() || pPr?.child('spcBef').exists() || pPr?.child('spcAft').exists()
    );
  });
}

function paragraphHasBullet(
  textBody: TextBody,
  paragraph: TextBody['paragraphs'][number],
): boolean {
  const candidates = [
    paragraph.properties,
    textBody.listStyle?.child(`lvl${paragraph.level + 1}pPr`),
    textBody.listStyle?.child('defPPr'),
  ];

  for (const pPr of candidates) {
    if (!pPr?.exists()) continue;
    if (pPr.child('buNone').exists()) return false;
    if (
      pPr.child('buChar').exists() ||
      pPr.child('buAutoNum').exists() ||
      pPr.child('buBlip').exists()
    ) {
      return true;
    }
  }
  return false;
}

function hasBulletParagraph(textBody: TextBody): boolean {
  return textBody.paragraphs.some(
    (p) =>
      p.runs.some((r) => r.text != null && r.text.length > 0) && paragraphHasBullet(textBody, p),
  );
}

function isTitlePlaceholder(placeholder: ShapeNodeData['placeholder']): boolean {
  return placeholder?.type === 'title' || placeholder?.type === 'ctrTitle';
}
import {
  resolveFill,
  resolveLineStyle,
  resolveGradientStroke,
  resolveGradientFill,
  resolveColorToCss,
  resolveColor,
  resolveThemeFillReference,
} from './StyleResolver';
import { renderTextBody } from './TextRenderer';
import { renderCustomGeometry } from '../shapes/customGeometry';
import {
  getPresetShapePath,
  getActionButtonIconPath,
  getMultiPathPreset,
  PresetSubPath,
} from '../shapes/presets';
import { emuToPx } from '../parser/units';
import { applyTint, hexToRgb, rgbToHex } from '../utils/color';
import { SafeXmlNode } from '../parser/XmlParser';
import { findMediaByTarget, findMediaByTargetAsync, getOrCreateBlobUrl } from '../utils/media';
import { isAllowedExternalMediaUrl, isAllowedExternalUrl } from '../utils/urlSafety';
import { getEffectiveBodyPrChild } from './TextBodyProperties';
import { cssFontFamilyStack, resolveThemeFontStack } from './fontResolver';
import { resolveSlideNavigationIndex, slideJumpTitle } from './navigation';

function appendTransform(el: HTMLElement, transform: string): void {
  el.style.transform = `${el.style.transform || ''} ${transform}`.trim();
}

function appendCssFilter(el: HTMLElement, filter: string): void {
  const current = el.style.filter.trim();
  el.style.filter = current ? `${current} ${filter}` : filter;
}

function resolveGlowFilter(glow: SafeXmlNode, ctx: RenderContext): string | undefined {
  const radiusPx = emuToPx(glow.numAttr('rad') ?? 0);
  if (!(radiusPx > 0)) return undefined;

  const { color, alpha } = resolveColor(glow, ctx);
  if (!color || alpha <= 0) return undefined;

  const hex = color.startsWith('#') ? color : `#${color}`;
  const { r, g, b } = hexToRgb(hex);
  return `drop-shadow(0px 0px ${radiusPx.toFixed(1)}px rgba(${r},${g},${b},${alpha.toFixed(3)}))`;
}

function applyGlowFilter(el: HTMLElement, glow: SafeXmlNode, ctx: RenderContext): void {
  const filter = resolveGlowFilter(glow, ctx);
  if (!filter) return;
  appendCssFilter(el, filter);
}

function expandCssLengthForScale(length: string, scale: number): string {
  if (!(scale > 0)) return length;

  const trimmed = length.trim();
  if (!trimmed) return `${100 / scale}%`;

  const match = trimmed.match(/^(-?\d*\.?\d+(?:e[-+]?\d+)?)([a-z%]*)$/i);
  if (!match) return length;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return length;

  const unit = match[2] || '%';
  return `${value / scale}${unit}`;
}

function applyVerticalTextFlow(el: HTMLElement, anchor: string | null | undefined): void {
  el.style.writingMode = 'vertical-rl';
  el.style.justifyContent = 'center';
  el.style.alignItems = anchor === 'b' ? 'flex-end' : anchor === 'ctr' ? 'center' : 'flex-start';
}

const WRAPPED_AUTOFIT_HEIGHT_TOLERANCE = 1.1;
// Single-paragraph CJK spAutoFit boxes are especially sensitive to browser font
// metric overhang; allow a larger margin without applying one-line shrink.
const SINGLE_PARAGRAPH_WRAPPED_AUTOFIT_HEIGHT_TOLERANCE = 1.25;
const WRAPPED_AUTOFIT_WIDTH_TOLERANCE_PX = 1;
const NO_AUTOFIT_TITLE_METRIC_SCALE_FLOOR = 0.9;
const SP_AUTOFIT_UNWRAPPED_WIDTH_SCALE_FLOOR = 0.9;

function getSupportedTextWarpPreset(textBody: TextBody): 'textArchDown' | 'textArchUp' | null {
  const prstTxWarp = textBody.bodyProperties?.child('prstTxWarp');
  const preset = prstTxWarp?.attr('prst');
  return preset === 'textArchDown' || preset === 'textArchUp' ? preset : null;
}

function getSingleLineWarpText(textBody: TextBody): string | null {
  let text = '';
  let visibleParagraphCount = 0;
  for (const paragraph of textBody.paragraphs) {
    const visibleRuns = paragraph.runs.filter((run) => run.text != null && run.text.length > 0);
    if (visibleRuns.length === 0) continue;
    visibleParagraphCount++;
    if (visibleParagraphCount > 1 || visibleRuns.some((run) => run.text === '\n')) return null;
    text += visibleRuns.map((run) => run.text).join('');
  }
  return text.length > 0 ? text : null;
}

function getFirstVisibleRunProperties(textBody: TextBody): SafeXmlNode | undefined {
  for (const paragraph of textBody.paragraphs) {
    for (const run of paragraph.runs) {
      if (run.text != null && run.text.length > 0) return run.properties;
    }
  }
  return undefined;
}

function buildTextArchPath(preset: 'textArchDown' | 'textArchUp', w: number, h: number): string {
  const padX = Math.min(Math.max(w * 0.04, 4), 18);
  const startX = padX;
  const endX = Math.max(startX, w - padX);
  if (preset === 'textArchDown') {
    const y = h * 0.36;
    return `M${startX},${y} Q${w / 2},${h * 0.9} ${endX},${y}`;
  }
  const y = h * 0.66;
  return `M${startX},${y} Q${w / 2},${h * 0.08} ${endX},${y}`;
}

function renderWarpedTextBody(node: ShapeNodeData, ctx: RenderContext): SVGSVGElement | null {
  if (!node.textBody) return null;
  const preset = getSupportedTextWarpPreset(node.textBody);
  if (!preset) return null;
  const text = getSingleLineWarpText(node.textBody);
  if (!text) return null;

  const rPr = getFirstVisibleRunProperties(node.textBody);
  const fontSize = rPr?.numAttr('sz') !== undefined ? rPr.numAttr('sz')! / 100 : 12;
  const fontStack = resolveThemeFontStack(
    [
      rPr?.child('latin').attr('typeface'),
      rPr?.child('ea').attr('typeface'),
      rPr?.child('cs').attr('typeface'),
    ],
    ctx,
    [rPr?.attr('lang'), rPr?.attr('altLang')],
  );
  const fontWeight = parseOoxmlBool(rPr?.attr('b')) ? 'bold' : undefined;
  const solidFill = rPr?.child('solidFill');
  const fill = solidFill?.exists() ? resolveColorToCss(solidFill, ctx) : '#000000';

  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', `0 0 ${node.size.w} ${node.size.h}`);
  svg.setAttribute('width', String(node.size.w));
  svg.setAttribute('height', String(node.size.h));
  svg.style.position = 'absolute';
  svg.style.left = '0';
  svg.style.top = '0';
  svg.style.overflow = 'visible';

  const defs = document.createElementNS(svgNs, 'defs');
  const path = document.createElementNS(svgNs, 'path');
  const pathId = `text-warp-${++gradientIdCounter}`;
  path.setAttribute('id', pathId);
  path.setAttribute('d', buildTextArchPath(preset, node.size.w, node.size.h));
  path.setAttribute('fill', 'none');
  defs.appendChild(path);
  svg.appendChild(defs);

  const textEl = document.createElementNS(svgNs, 'text');
  textEl.setAttribute('font-size', `${fontSize}pt`);
  if (fontStack.length > 0) textEl.setAttribute('font-family', cssFontFamilyStack(fontStack));
  if (fontWeight) textEl.setAttribute('font-weight', fontWeight);
  textEl.setAttribute('fill', fill);
  textEl.setAttribute('dominant-baseline', 'middle');

  const textPath = document.createElementNS(svgNs, 'textPath');
  textPath.setAttribute('href', `#${pathId}`);
  textPath.setAttribute('startOffset', '50%');
  textPath.setAttribute('text-anchor', 'middle');
  textPath.setAttribute('xml:space', 'preserve');
  textPath.textContent = text;
  textEl.appendChild(textPath);
  svg.appendChild(textEl);

  return svg;
}

// ---------------------------------------------------------------------------
// Shape blipFill (image fill) — resolve to blob URL for reuse (e.g. SVG/PNG in process diagrams)
// ---------------------------------------------------------------------------

/** Resolve shape blipFill to a blob URL so we can render it (e.g. slide 23 process graphic). */
function resolveShapeBlipUrl(blipFill: SafeXmlNode, ctx: RenderContext): string | null {
  const blip = blipFill.child('blip');
  const embedId = blip.attr('embed') ?? blip.attr('r:embed');
  const linkId = blip.attr('link') ?? blip.attr('r:link');
  const relId = embedId ?? linkId;
  if (!relId) return null;
  const rel = ctx.slide.rels.get(relId);
  if (!rel) return null;
  if (isExternalTargetMode(rel.targetMode)) {
    return isAllowedExternalMediaUrl(rel.target) ? rel.target : null;
  }
  const resolved = findMediaByTarget(rel.target, ctx.presentation.media);
  if (!resolved) return null;
  const { mediaPath, data } = resolved;
  return getOrCreateBlobUrl(mediaPath, data, ctx.mediaUrlCache);
}

async function resolveShapeBlipUrlAsync(
  blipFill: SafeXmlNode,
  ctx: RenderContext,
): Promise<string | null> {
  const blip = blipFill.child('blip');
  const embedId = blip.attr('embed') ?? blip.attr('r:embed');
  const linkId = blip.attr('link') ?? blip.attr('r:link');
  const relId = embedId ?? linkId;
  if (!relId) return null;
  const rel = ctx.slide.rels.get(relId);
  if (!rel) return null;
  if (isExternalTargetMode(rel.targetMode)) {
    return isAllowedExternalMediaUrl(rel.target) ? rel.target : null;
  }
  const resolved = await findMediaByTargetAsync(
    rel.target,
    ctx.presentation.media,
    ctx.presentation.mediaResolver,
  );
  if (!resolved) return null;
  const { mediaPath, data } = resolved;
  return getOrCreateBlobUrl(mediaPath, data, ctx.mediaUrlCache);
}

function pctAttr(node: SafeXmlNode, name: string): number {
  return (node.numAttr(name) ?? 0) / 1000;
}

function getShapeBlipImagePlacement(
  blipFill: SafeXmlNode,
  bounds: { w: number; h: number },
): { x: number; y: number; w: number; h: number; preserveAspectRatio: string } {
  const stretch = blipFill.child('stretch');
  if (!stretch.exists()) {
    return { x: 0, y: 0, w: bounds.w, h: bounds.h, preserveAspectRatio: 'xMidYMid slice' };
  }

  const fillRect = stretch.child('fillRect');
  const left = fillRect.exists() ? pctAttr(fillRect, 'l') : 0;
  const top = fillRect.exists() ? pctAttr(fillRect, 't') : 0;
  const right = fillRect.exists() ? pctAttr(fillRect, 'r') : 0;
  const bottom = fillRect.exists() ? pctAttr(fillRect, 'b') : 0;

  return {
    x: bounds.w * (left / 100),
    y: bounds.h * (top / 100),
    w: bounds.w * ((100 - left - right) / 100),
    h: bounds.h * ((100 - top - bottom) / 100),
    preserveAspectRatio: 'none',
  };
}

function appendShapeBlipImage(
  svgNs: string,
  svg: SVGSVGElement,
  defs: SVGDefsElement,
  blipFill: SafeXmlNode,
  pathD: string,
  bounds: { w: number; h: number },
  blipUrl: string,
  beforeNode?: ChildNode | null,
): void {
  const clipId = `shape-clip-${++gradientIdCounter}`;
  const clipPath = document.createElementNS(svgNs, 'clipPath');
  clipPath.setAttribute('id', clipId);
  const clipPathPath = document.createElementNS(svgNs, 'path');
  clipPathPath.setAttribute('d', pathD);
  clipPath.appendChild(clipPathPath);
  defs.appendChild(clipPath);

  const image = document.createElementNS(svgNs, 'image');
  const placement = getShapeBlipImagePlacement(blipFill, bounds);
  image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', blipUrl);
  image.setAttribute('x', String(placement.x));
  image.setAttribute('y', String(placement.y));
  image.setAttribute('width', String(placement.w));
  image.setAttribute('height', String(placement.h));
  image.setAttribute('clip-path', `url(#${clipId})`);
  image.setAttribute('preserveAspectRatio', placement.preserveAspectRatio);

  if (!defs.parentNode) {
    svg.appendChild(defs);
  }
  if (beforeNode?.parentNode === svg) {
    svg.insertBefore(image, beforeNode);
  } else {
    svg.appendChild(image);
  }
}

// ---------------------------------------------------------------------------
// Line End Marker (Arrowhead) Helpers
// ---------------------------------------------------------------------------

let markerIdCounter = 0;
let gradientIdCounter = 0;

function applySvgDropShadowFilter(
  svgNs: string,
  defs: SVGDefsElement,
  target: SVGElement,
  bounds: { w: number; h: number },
  shadow: {
    dx: number;
    dy: number;
    blur: number;
    color: { r: number; g: number; b: number };
    opacity: number;
  },
): void {
  const filterId = `shape-shadow-${++gradientIdCounter}`;
  const filter = document.createElementNS(svgNs, 'filter');
  const margin = Math.max(Math.abs(shadow.dx), Math.abs(shadow.dy)) + shadow.blur * 4 + 4;
  filter.setAttribute('id', filterId);
  filter.setAttribute('filterUnits', 'userSpaceOnUse');
  filter.setAttribute('x', String(-margin));
  filter.setAttribute('y', String(-margin));
  filter.setAttribute('width', String(bounds.w + margin * 2));
  filter.setAttribute('height', String(bounds.h + margin * 2));

  const dropShadow = document.createElementNS(svgNs, 'feDropShadow');
  dropShadow.setAttribute('dx', shadow.dx.toFixed(1));
  dropShadow.setAttribute('dy', shadow.dy.toFixed(1));
  dropShadow.setAttribute('stdDeviation', Math.max(0, shadow.blur / 2).toFixed(2));
  dropShadow.setAttribute(
    'flood-color',
    `rgb(${shadow.color.r},${shadow.color.g},${shadow.color.b})`,
  );
  dropShadow.setAttribute('flood-opacity', shadow.opacity.toFixed(4));
  filter.appendChild(dropShadow);
  defs.appendChild(filter);
  if (!defs.parentNode && target.ownerSVGElement) {
    target.ownerSVGElement.insertBefore(defs, target.ownerSVGElement.firstChild);
  }
  target.setAttribute('filter', `url(#${filterId})`);
}

function svgDashArrayForKind(dashKind: string, strokeWidth: number): string | null {
  const w = Math.max(strokeWidth, 1);
  switch (dashKind) {
    case 'dot':
    case 'sysDot':
      return `${w},${w * 2}`;
    case 'dash':
    case 'sysDash':
      return `${w * 4},${w * 2}`;
    case 'lgDash':
      return `${w * 8},${w * 3}`;
    case 'dashDot':
    case 'sysDashDot':
      return `${w * 4},${w * 2},${w},${w * 2}`;
    case 'lgDashDot':
      return `${w * 8},${w * 3},${w},${w * 3}`;
    case 'lgDashDotDot':
    case 'sysDashDotDot':
      return `${w * 8},${w * 3},${w},${w * 2},${w},${w * 2}`;
    default:
      return null;
  }
}

function appendSvgPatternFill(
  svgNs: string,
  defs: SVGDefsElement,
  pattFill: SafeXmlNode,
  ctx: RenderContext,
): string | null {
  if (!pattFill.exists()) return null;

  const preset = pattFill.attr('prst') ?? 'solid';
  if (preset === 'solid' || preset === 'solidDmnd') return null;

  const tile = 8;
  const strokeWidth = 1;
  const fgClr = pattFill.child('fgClr');
  const bgClr = pattFill.child('bgClr');
  const fg = fgClr.exists() ? resolveColorToCss(fgClr, ctx) : '#000000';
  const bg = bgClr.exists() ? resolveColorToCss(bgClr, ctx) : '#ffffff';

  const patternId = `shape-pattern-${++gradientIdCounter}`;
  const pattern = document.createElementNS(svgNs, 'pattern');
  pattern.setAttribute('id', patternId);
  pattern.setAttribute('patternUnits', 'userSpaceOnUse');
  pattern.setAttribute('width', String(tile));
  pattern.setAttribute('height', String(tile));

  const rect = document.createElementNS(svgNs, 'rect');
  rect.setAttribute('width', String(tile));
  rect.setAttribute('height', String(tile));
  rect.setAttribute('fill', bg);
  pattern.appendChild(rect);

  let hasForeground = false;
  const addLine = (x1: number, y1: number, x2: number, y2: number, dashArray?: string) => {
    const line = document.createElementNS(svgNs, 'line');
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(y2));
    line.setAttribute('stroke', fg);
    line.setAttribute('stroke-width', String(strokeWidth));
    if (dashArray) line.setAttribute('stroke-dasharray', dashArray);
    pattern.appendChild(line);
    hasForeground = true;
  };
  const addDot = (cx: number, cy: number, radius: number) => {
    const dot = document.createElementNS(svgNs, 'circle');
    dot.setAttribute('cx', String(cx));
    dot.setAttribute('cy', String(cy));
    dot.setAttribute('r', String(radius));
    dot.setAttribute('fill', fg);
    pattern.appendChild(dot);
    hasForeground = true;
  };

  const lineOffset = strokeWidth / 2;
  const dotRadius = strokeWidth;
  const dashArray = `${strokeWidth * 3},${strokeWidth * 2}`;
  let patternYOffset = 0;

  switch (preset) {
    case 'pct5':
    case 'pct10':
    case 'pct20':
    case 'pct25':
      addDot(tile / 2, tile / 2, dotRadius * 0.75);
      break;
    case 'pct30':
    case 'pct40':
    case 'pct50':
    case 'dotGrid':
    case 'dotDmnd':
      addDot(tile / 2, tile / 2, dotRadius);
      break;
    case 'pct60':
    case 'pct70':
    case 'pct75':
    case 'pct80':
    case 'pct90':
    case 'sphere':
    case 'shingle':
    case 'plaid':
    case 'divot':
    case 'zigZag':
      addDot(tile / 2, tile / 2, dotRadius * 1.5);
      break;
    case 'horz':
    case 'ltHorz':
    case 'narHorz':
    case 'dkHorz':
      addLine(0, lineOffset, tile, lineOffset);
      break;
    case 'vert':
    case 'ltVert':
    case 'narVert':
    case 'dkVert':
      addLine(lineOffset, 0, lineOffset, tile);
      break;
    case 'dnDiag':
    case 'ltDnDiag':
    case 'narDnDiag':
    case 'dkDnDiag':
    case 'wdDnDiag':
      addLine(0, tile, tile, 0);
      break;
    case 'upDiag':
    case 'ltUpDiag':
    case 'narUpDiag':
    case 'dkUpDiag':
    case 'wdUpDiag':
      addLine(0, 0, tile, tile);
      break;
    case 'smGrid':
    case 'lgGrid':
    case 'cross':
      patternYOffset = -3;
      addLine(0, lineOffset, tile, lineOffset);
      addLine(lineOffset, 0, lineOffset, tile);
      break;
    case 'smCheck':
    case 'lgCheck':
    case 'diagCross':
    case 'openDmnd':
    case 'trellis':
    case 'weave':
      addLine(0, tile, tile, 0);
      addLine(0, 0, tile, tile);
      break;
    case 'dashHorz':
      addLine(0, lineOffset, tile, lineOffset, dashArray);
      break;
    case 'dashVert':
      addLine(lineOffset, 0, lineOffset, tile, dashArray);
      break;
    case 'dashDnDiag':
      addLine(0, tile, tile, 0, dashArray);
      break;
    case 'dashUpDiag':
      addLine(0, 0, tile, tile, dashArray);
      break;
    default:
      return null;
  }

  if (!hasForeground) return null;
  if (patternYOffset !== 0) pattern.setAttribute('y', String(patternYOffset));
  defs.appendChild(pattern);
  return patternId;
}

function parseCssColorToRgb(color: string): { r: number; g: number; b: number } | null {
  if (!color) return null;
  const hex = color.trim();
  if (hex.startsWith('#')) {
    return hexToRgb(hex);
  }
  const m = hex.match(/rgba?\(([^)]+)\)/i);
  if (!m) return null;
  const parts = m[1].split(',').map((s) => Number.parseFloat(s.trim()));
  if (parts.length < 3 || parts.some((v) => Number.isNaN(v))) return null;
  return {
    r: Math.max(0, Math.min(255, parts[0])),
    g: Math.max(0, Math.min(255, parts[1])),
    b: Math.max(0, Math.min(255, parts[2])),
  };
}

function mixRgb(
  base: { r: number; g: number; b: number },
  target: { r: number; g: number; b: number },
  t: number,
): string {
  const k = Math.max(0, Math.min(1, t));
  return rgbToHex(
    base.r + (target.r - base.r) * k,
    base.g + (target.g - base.g) * k,
    base.b + (target.b - base.b) * k,
  );
}

/**
 * Convert an OOXML gradient angle (in degrees, where 0 = right-to-left in OOXML coords)
 * to SVG linearGradient x1/y1/x2/y2 coordinates (as percentages).
 */
function angleToSvgGradientCoords(angleDeg: number): {
  x1: string;
  y1: string;
  x2: string;
  y2: string;
} {
  // OOXML: 0° = left-to-right, 90° = top-to-bottom (clockwise)
  // Convert to radians for trig
  const rad = (angleDeg * Math.PI) / 180;
  // Calculate direction vector
  const x2 = Math.round(50 + 50 * Math.cos(rad));
  const y2 = Math.round(50 + 50 * Math.sin(rad));
  const x1 = Math.round(50 - 50 * Math.cos(rad));
  const y1 = Math.round(50 - 50 * Math.sin(rad));
  return {
    x1: `${x1}%`,
    y1: `${y1}%`,
    x2: `${x2}%`,
    y2: `${y2}%`,
  };
}

/**
 * Get the marker size multiplier based on OOXML size string.
 */
function getMarkerSize(size: string | undefined): number {
  switch (size) {
    case 'sm':
      return 0.5;
    case 'lg':
      return 1.5;
    default:
      return 1.0; // 'med' or undefined
  }
}

function getMarkerDimensions(
  info: LineEndInfo,
  strokeWidth: number,
): { markerW: number; markerH: number } {
  const wMul = getMarkerSize(info.w);
  const lenMul = getMarkerSize(info.len);
  // Arrow size proportional to stroke width with balanced floor:
  // avoid tiny markers, but do not overgrow relative to line length.
  const baseLen = Math.max(strokeWidth * 3, 6.5);
  const baseW = Math.max(strokeWidth * 2.5, 5);
  return {
    markerW: baseLen * lenMul,
    markerH: baseW * wMul,
  };
}

function getHeadEndStartInset(info: LineEndInfo, strokeWidth: number): number {
  if (info.type !== 'triangle' && info.type !== 'arrow' && info.type !== 'stealth') return 0;
  return getMarkerDimensions(info, strokeWidth).markerW;
}

function getTailEndEndInset(info: LineEndInfo, strokeWidth: number): number {
  if (info.type !== 'triangle' && info.type !== 'arrow' && info.type !== 'stealth') return 0;
  return getMarkerDimensions(info, strokeWidth).markerW;
}

function isFullyTransparentCssColor(color: string | undefined): boolean {
  if (!color) return true;
  const normalized = color.trim().toLowerCase();
  if (normalized === 'transparent') return true;
  const rgbaMatch = normalized.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)$/);
  return rgbaMatch ? Number(rgbaMatch[1]) <= 0.001 : false;
}

function getGradientMarkerColor(
  stops: Array<{ color: string }>,
  end: 'start' | 'end',
  fallback: string,
): string {
  if (stops.length === 0) return fallback;

  const firstIndex = end === 'start' ? 0 : stops.length - 1;
  const step = end === 'start' ? 1 : -1;
  const preferred = stops[firstIndex]?.color;
  if (preferred && !isFullyTransparentCssColor(preferred)) return preferred;

  for (let i = firstIndex; i >= 0 && i < stops.length; i += step) {
    const color = stops[i]?.color;
    if (color && !isFullyTransparentCssColor(color)) return color;
  }

  return preferred || fallback;
}

type Point = { x: number; y: number };

function lerpPoint(a: Point, b: Point, t: number): Point {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const a = lerpPoint(p0, p1, t);
  const b = lerpPoint(p1, p2, t);
  const c = lerpPoint(p2, p3, t);
  const d = lerpPoint(a, b, t);
  const e = lerpPoint(b, c, t);
  return lerpPoint(d, e, t);
}

function approximateCubicLength(p0: Point, p1: Point, p2: Point, p3: Point, tEnd: number): number {
  const steps = 24;
  let length = 0;
  let prev = p0;
  for (let i = 1; i <= steps; i++) {
    const point = cubicPoint(p0, p1, p2, p3, (tEnd * i) / steps);
    length += Math.hypot(point.x - prev.x, point.y - prev.y);
    prev = point;
  }
  return length;
}

function insetCubicPathStart(pathD: string, inset: number): string {
  const n = '-?\\d*\\.?\\d+(?:e[-+]?\\d+)?';
  const match = pathD.match(
    new RegExp(`^M(${n}),(${n}) C(${n}),(${n}) (${n}),(${n}) (${n}),(${n})(?: (.*))?$`, 'i'),
  );
  if (!match) return pathD;

  const p0 = { x: Number(match[1]), y: Number(match[2]) };
  const p1 = { x: Number(match[3]), y: Number(match[4]) };
  const p2 = { x: Number(match[5]), y: Number(match[6]) };
  const p3 = { x: Number(match[7]), y: Number(match[8]) };
  const rest = match[9];
  const totalLength = approximateCubicLength(p0, p1, p2, p3, 1);
  if (!(totalLength > 0)) return pathD;

  const target = Math.min(inset, totalLength * 0.95);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (approximateCubicLength(p0, p1, p2, p3, mid) < target) lo = mid;
    else hi = mid;
  }

  const t = hi;
  const a = lerpPoint(p0, p1, t);
  const b = lerpPoint(p1, p2, t);
  const c = lerpPoint(p2, p3, t);
  const d = lerpPoint(a, b, t);
  const e = lerpPoint(b, c, t);
  const start = lerpPoint(d, e, t);
  const trimmed = `M${start.x},${start.y} C${e.x},${e.y} ${c.x},${c.y} ${p3.x},${p3.y}`;
  return rest ? `${trimmed} ${rest}` : trimmed;
}

function insetPathStart(pathD: string, inset: number): string {
  if (!(inset > 0)) return pathD;

  const match = pathD.match(
    /^M(-?\d*\.?\d+(?:e[-+]?\d+)?),(-?\d*\.?\d+(?:e[-+]?\d+)?) L(-?\d*\.?\d+(?:e[-+]?\d+)?),(-?\d*\.?\d+(?:e[-+]?\d+)?)$/i,
  );
  if (!match) return insetCubicPathStart(pathD, inset);

  const x1 = Number(match[1]);
  const y1 = Number(match[2]);
  const x2 = Number(match[3]);
  const y2 = Number(match[4]);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return pathD;

  const clampedInset = Math.min(inset, length * 0.95);
  const nextX = x1 + (dx / length) * clampedInset;
  const nextY = y1 + (dy / length) * clampedInset;
  return `M${nextX},${nextY} L${x2},${y2}`;
}

function insetPathEnd(pathD: string, inset: number): string {
  if (!(inset > 0)) return pathD;

  const match = pathD.match(
    /^M(-?\d*\.?\d+(?:e[-+]?\d+)?),(-?\d*\.?\d+(?:e[-+]?\d+)?) L(-?\d*\.?\d+(?:e[-+]?\d+)?),(-?\d*\.?\d+(?:e[-+]?\d+)?)$/i,
  );
  if (!match) return pathD;

  const x1 = Number(match[1]);
  const y1 = Number(match[2]);
  const x2 = Number(match[3]);
  const y2 = Number(match[4]);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return pathD;

  const clampedInset = Math.min(inset, length * 0.95);
  const nextX = x2 - (dx / length) * clampedInset;
  const nextY = y2 - (dy / length) * clampedInset;
  return `M${x1},${y1} L${nextX},${nextY}`;
}

/**
 * Create an SVG marker element for a line end (arrowhead).
 */
function createArrowMarker(
  svgNs: string,
  info: LineEndInfo,
  strokeColor: string,
  strokeWidth: number,
  isHead: boolean,
): SVGMarkerElement | null {
  const marker = document.createElementNS(svgNs, 'marker') as SVGMarkerElement;
  const id = `arrow-marker-${++markerIdCounter}`;
  marker.setAttribute('id', id);
  // Use userSpaceOnUse so markerWidth/Height are in SVG pixels directly.
  // This avoids the quadratic blow-up from markerUnits="strokeWidth" combined
  // with a base size that already factors in stroke width.
  marker.setAttribute('markerUnits', 'userSpaceOnUse');
  marker.setAttribute('orient', 'auto');

  const { markerW, markerH } = getMarkerDimensions(info, strokeWidth);

  switch (info.type) {
    case 'triangle':
    case 'arrow': {
      marker.setAttribute('viewBox', '0 0 10 10');
      marker.setAttribute('refX', isHead ? '10' : '0');
      marker.setAttribute('refY', '5');
      marker.setAttribute('markerWidth', String(markerW));
      marker.setAttribute('markerHeight', String(markerH));

      const polygon = document.createElementNS(svgNs, 'polygon');
      if (isHead) {
        // headEnd at marker-start: arrow points backward (-x / left)
        polygon.setAttribute('points', '0,5 10,0 10,10');
      } else {
        // tailEnd at marker-end: arrow points forward (+x / right)
        polygon.setAttribute('points', '10,5 0,0 0,10');
      }
      polygon.setAttribute('fill', strokeColor);
      marker.appendChild(polygon);
      break;
    }
    case 'stealth': {
      marker.setAttribute('viewBox', '0 0 10 10');
      marker.setAttribute('refX', isHead ? '10' : '0');
      marker.setAttribute('refY', '5');
      marker.setAttribute('markerWidth', String(markerW));
      marker.setAttribute('markerHeight', String(markerH));

      const path = document.createElementNS(svgNs, 'path');
      if (isHead) {
        // headEnd at marker-start: arrow points backward (-x / left)
        path.setAttribute('d', 'M0,5 L10,0 L7,5 L10,10 Z');
      } else {
        // tailEnd at marker-end: arrow points forward (+x / right)
        path.setAttribute('d', 'M10,5 L0,0 L3,5 L0,10 Z');
      }
      path.setAttribute('fill', strokeColor);
      marker.appendChild(path);
      break;
    }
    case 'diamond': {
      marker.setAttribute('viewBox', '0 0 10 10');
      marker.setAttribute('refX', '5');
      marker.setAttribute('refY', '5');
      marker.setAttribute('markerWidth', String(markerW));
      marker.setAttribute('markerHeight', String(markerH));

      const diamond = document.createElementNS(svgNs, 'polygon');
      diamond.setAttribute('points', '5,0 10,5 5,10 0,5');
      diamond.setAttribute('fill', strokeColor);
      marker.appendChild(diamond);
      break;
    }
    case 'oval': {
      marker.setAttribute('viewBox', '0 0 10 10');
      marker.setAttribute('refX', '5');
      marker.setAttribute('refY', '5');
      marker.setAttribute('markerWidth', String(markerW));
      marker.setAttribute('markerHeight', String(markerH));

      const circle = document.createElementNS(svgNs, 'circle');
      circle.setAttribute('cx', '5');
      circle.setAttribute('cy', '5');
      circle.setAttribute('r', '4');
      circle.setAttribute('fill', strokeColor);
      marker.appendChild(circle);
      break;
    }
    default:
      return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (marker as any)._markerId = id;
  return marker;
}

/** Read headEnd/tailEnd from an OOXML a:ln node (e.g. theme line style). */
function getLineEndsFromLn(ln: SafeXmlNode): { headEnd?: LineEndInfo; tailEnd?: LineEndInfo } {
  const out: { headEnd?: LineEndInfo; tailEnd?: LineEndInfo } = {};
  const he = ln.child('headEnd');
  if (he.exists()) {
    const t = he.attr('type');
    if (t && t !== 'none') out.headEnd = { type: t, w: he.attr('w'), len: he.attr('len') };
  }
  const te = ln.child('tailEnd');
  if (te.exists()) {
    const t = te.attr('type');
    if (t && t !== 'none') out.tailEnd = { type: t, w: te.attr('w'), len: te.attr('len') };
  }
  return out;
}

interface PresetGeometryCacheEntry {
  effectivePreset: string;
  w: number;
  h: number;
  adjustmentKey: string;
  pathD: string;
  multiPaths: PresetSubPath[] | null;
}

const presetGeometryCache = new WeakMap<ShapeNodeData, PresetGeometryCacheEntry>();

function buildAdjustmentKey(adjustments?: Map<string, number>): string {
  if (!adjustments || adjustments.size === 0) return '';

  return Array.from(adjustments.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join('|');
}

function resolvePresetGeometry(
  node: ShapeNodeData,
  effectivePreset: string,
  w: number,
  h: number,
): { pathD: string; multiPaths: PresetSubPath[] | null } {
  const adjustmentKey = buildAdjustmentKey(node.adjustments);
  const cached = presetGeometryCache.get(node);
  if (
    cached &&
    cached.effectivePreset === effectivePreset &&
    cached.w === w &&
    cached.h === h &&
    cached.adjustmentKey === adjustmentKey
  ) {
    return {
      pathD: cached.pathD,
      multiPaths: cached.multiPaths,
    };
  }

  const multiPaths = getMultiPathPreset(effectivePreset, w, h, node.adjustments);
  const pathD = multiPaths
    ? (multiPaths[0]?.d ?? '')
    : getPresetShapePath(effectivePreset, w, h, node.adjustments);
  presetGeometryCache.set(node, {
    effectivePreset,
    w,
    h,
    adjustmentKey,
    pathD,
    multiPaths,
  });
  return { pathD, multiPaths };
}

// ---------------------------------------------------------------------------
// Shape Rendering
// ---------------------------------------------------------------------------

/**
 * Render a shape node into an absolutely-positioned HTML element with SVG geometry.
 */
export function renderShape(node: ShapeNodeData, ctx: RenderContext): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.style.position = 'absolute';
  wrapper.style.left = `${node.position.x}px`;
  wrapper.style.top = `${node.position.y}px`;
  wrapper.style.width = `${node.size.w}px`;
  // Line-like: preset line/connector, or cxnSp (connection shape), or flat extent (one dimension 0)
  const presetKey = node.presetGeometry?.toLowerCase() ?? '';
  const outlineOnlyPresets = new Set([
    'arc',
    'leftbracket',
    'rightbracket',
    'leftbrace',
    'rightbrace',
    'bracketpair',
    'bracepair',
  ]);
  const presetIsLine =
    !!presetKey &&
    (presetKey === 'line' ||
      presetKey === 'lineinv' ||
      presetKey.startsWith('straightconnector') ||
      presetKey.startsWith('bentconnector') ||
      presetKey.startsWith('curvedconnector') ||
      outlineOnlyPresets.has(presetKey));
  const isConnectorShape = node.source.localName === 'cxnSp';
  const flatExtent = (node.size.w > 0 && node.size.h < 1) || (node.size.w < 1 && node.size.h > 0);
  const isLineLike = presetIsLine || isConnectorShape || flatExtent;
  const minH = isLineLike && node.size.h < 1 ? 1 : node.size.h;
  const minW = isLineLike && node.size.w < 1 ? 1 : node.size.w;
  wrapper.style.height = `${minH}px`;
  if (node.size.w === 0) wrapper.style.width = `${minW}px`;
  wrapper.style.overflow = 'visible';
  // Apply transforms (rotation + flip)
  const transforms: string[] = [];
  if (node.rotation !== 0) {
    transforms.push(`rotate(${node.rotation}deg)`);
  }
  if (node.flipH) {
    transforms.push('scaleX(-1)');
  }
  if (node.flipV) {
    transforms.push('scaleY(-1)');
  }
  if (transforms.length > 0) {
    wrapper.style.transform = transforms.join(' ');
  }

  const w = node.size.w;
  const h = node.size.h;
  // For path generation, pass original w/h so preset functions can detect zero-extent
  // directions (e.g. line preset draws vertical when w=0, horizontal when h=0).
  // For SVG viewport, use minW/minH to guarantee a visible container.
  const pathW = w;
  const pathH = h;

  // Style references (needed for path fallback and line resolution)
  const styleNode = node.source.child('style');
  const lnRef = styleNode.exists() ? styleNode.child('lnRef') : undefined;
  const fillRef = styleNode.exists() ? styleNode.child('fillRef') : undefined;

  // ---- Generate SVG path ----
  let pathD = '';
  let multiPaths: PresetSubPath[] | null = null;
  if (node.presetGeometry) {
    // For connector shapes (cxnSp), the 'line' preset should draw from start to end
    // point (0,0)→(w,h), not a horizontal midline. Use 'straightConnector1' instead,
    // which correctly handles diagonal/near-vertical connectors (e.g. cx≈0 but non-zero).
    let effectivePreset = node.presetGeometry;
    if (isConnectorShape && effectivePreset === 'line') {
      effectivePreset = 'straightConnector1';
    }
    const geometry = resolvePresetGeometry(node, effectivePreset, pathW, pathH);
    pathD = geometry.pathD;
    multiPaths = geometry.multiPaths;
  } else if (node.customGeometry) {
    const extNode = node.source.child('spPr').child('xfrm').child('ext');
    const sourceExtentEmu = {
      w: extNode.numAttr('cx') ?? 0,
      h: extNode.numAttr('cy') ?? 0,
    };
    pathD = renderCustomGeometry(node.customGeometry, pathW, pathH, sourceExtentEmu);
  }
  // Connectors (cxnSp) or flat-extent shapes with line style but no geometry: draw as line
  if (
    !pathD &&
    isLineLike &&
    (node.line?.exists() ||
      (lnRef?.exists() &&
        (lnRef.numAttr('idx') ?? 0) > 0 &&
        (ctx.theme.lineStyles?.length ?? 0) >= (lnRef.numAttr('idx') ?? 0)))
  ) {
    pathD = getPresetShapePath(
      isConnectorShape ? 'straightConnector1' : 'line',
      pathW,
      pathH,
      undefined,
    );
  }

  // ---- Resolve fill and line styles ----
  const spPr = node.source.child('spPr');
  let fillCss = '';
  // Resolve structured gradient fill data (for SVG gradient elements)
  let gradientFillData = node.fill ? resolveGradientFill(spPr, ctx) : null;
  if (node.fill && node.fill.exists()) {
    if (node.fill.localName === 'solidFill') {
      const colorChild = node.fill.child('srgbClr').exists()
        ? node.fill.child('srgbClr')
        : node.fill.child('schemeClr').exists()
          ? node.fill.child('schemeClr')
          : node.fill.child('scrgbClr').exists()
            ? node.fill.child('scrgbClr')
            : node.fill.child('sysClr').exists()
              ? node.fill.child('sysClr')
              : undefined;
      if (colorChild?.exists()) fillCss = resolveColorToCss(colorChild, ctx);
    }
    if (!fillCss) fillCss = resolveFill(spPr, ctx);
  }
  // Diagram/SmartArt: read fill directly from source when still missing (spPr > solidFill > color)
  if (!fillCss) {
    const solidFill = spPr.child('solidFill');
    if (solidFill.exists()) {
      const colorChild = solidFill.child('srgbClr').exists()
        ? solidFill.child('srgbClr')
        : solidFill.child('schemeClr').exists()
          ? solidFill.child('schemeClr')
          : solidFill.child('scrgbClr').exists()
            ? solidFill.child('scrgbClr')
            : solidFill.child('sysClr').exists()
              ? solidFill.child('sysClr')
              : undefined;
      if (colorChild?.exists()) fillCss = resolveColorToCss(colorChild, ctx);
    }
  }
  // fillRef fallback: when no explicit fill but fillRef idx > 0, use fillRef color
  if (!fillCss && fillRef && fillRef.exists()) {
    const resolvedThemeFill = resolveThemeFillReference(fillRef, ctx);
    fillCss = resolvedThemeFill.fillCss;
    if (!gradientFillData) gradientFillData = resolvedThemeFill.gradientFillData;
  }
  // Connectors and other line-like presets are stroke-only in OOXML. They may still
  // carry style fillRefs, but those must not become filled ribbons in SVG.
  if (isLineLike) {
    fillCss = '';
    gradientFillData = null;
  }

  let strokeColor = 'none';
  let strokeWidth = 0;
  let strokeDash = '';
  let strokeDashKind = 'solid';
  let strokeLinecap = '';
  let strokeLinejoin = '';
  let gradientStroke: ReturnType<typeof resolveGradientStroke> = null;

  // Resolve effective line: explicit <a:ln> on shape, or use theme line from lnRef.
  // When line is explicitly <a:noFill/>, do not use lnRef — diagram arrows (e.g. circularArrow) must have no stroke.
  const lineIsNoFill = node.line && node.line.child('noFill').exists();
  const hasExplicitLine = node.line && !lineIsNoFill;
  const themeLineFromLnRef =
    !hasExplicitLine &&
    !lineIsNoFill &&
    lnRef?.exists() &&
    (lnRef.numAttr('idx') ?? 0) > 0 &&
    (ctx.theme.lineStyles?.length ?? 0) >= (lnRef.numAttr('idx') ?? 0)
      ? ctx.theme.lineStyles![(lnRef.numAttr('idx') ?? 1) - 1]
      : undefined;
  let effectiveLine = hasExplicitLine ? node.line! : themeLineFromLnRef;
  if (lineIsNoFill) effectiveLine = undefined;

  if (effectiveLine?.exists()) {
    gradientStroke = resolveGradientStroke(effectiveLine, ctx);
    if (!gradientStroke) {
      const lineStyle = resolveLineStyle(effectiveLine, ctx, lnRef);
      strokeColor = lineStyle.color;
      strokeWidth = lineStyle.width;
      strokeDash = lineStyle.dash;
      strokeDashKind = lineStyle.dashKind;
    }

    // Line cap: a:ln@cap → SVG stroke-linecap
    const capAttr = effectiveLine.attr('cap');
    if (capAttr === 'rnd') strokeLinecap = 'round';
    else if (capAttr === 'sq') strokeLinecap = 'square';
    else if (capAttr === 'flat') strokeLinecap = 'butt';

    // Line join: from child elements
    if (effectiveLine.child('round').exists()) strokeLinejoin = 'round';
    else if (effectiveLine.child('bevel').exists()) strokeLinejoin = 'bevel';
    else if (effectiveLine.child('miter').exists()) strokeLinejoin = 'miter';
  }
  if (lineIsNoFill) {
    strokeColor = 'none';
    strokeWidth = 0;
    gradientStroke = null;
  }
  // SmartArt circularArrow must be fill-only (no stroke); preset-based override so diagram XML is not relied on.
  const isCircularArrow = node.presetGeometry?.toLowerCase() === 'circulararrow';
  if (isCircularArrow) {
    strokeColor = 'none';
    strokeWidth = 0;
    gradientStroke = null;
    if (!fillCss) {
      const solid = spPr.child('solidFill');
      if (solid.exists()) {
        const color = solid.child('srgbClr').exists()
          ? solid.child('srgbClr')
          : solid.child('schemeClr').exists()
            ? solid.child('schemeClr')
            : solid.child('scrgbClr').exists()
              ? solid.child('scrgbClr')
              : solid.child('sysClr').exists()
                ? solid.child('sysClr')
                : undefined;
        if (color?.exists()) fillCss = resolveColorToCss(color, ctx);
      }
    }
  }

  // ---- Create SVG element ----
  let mainSvgNs: string | null = null;
  let mainDefs: SVGDefsElement | null = null;
  let mainPath: SVGPathElement | null = null;
  let mainSvgBounds: { w: number; h: number } | null = null;
  if (pathD) {
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    const svgW = isLineLike ? minW : w;
    const svgH = isLineLike ? minH : h;
    svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
    svg.setAttribute('width', String(svgW));
    svg.setAttribute('height', String(svgH));
    svg.style.position = 'absolute';
    svg.style.left = '0';
    svg.style.top = '0';
    svg.style.overflow = 'visible';

    const blipFill = spPr.child('blipFill');
    const blipUrl = blipFill.exists() ? resolveShapeBlipUrl(blipFill, ctx) : null;

    // When shape has image fill (blipFill), render image clipped to path so complex graphics (e.g. slide 23 process) show
    if (blipUrl) {
      const defs = document.createElementNS(svgNs, 'defs');
      appendShapeBlipImage(svgNs, svg, defs, blipFill, pathD, { w: svgW, h: svgH }, blipUrl);

      const mainPathStrokeSuppressed = multiPaths && multiPaths[0]?.stroke === false;
      if (
        !isCircularArrow &&
        !mainPathStrokeSuppressed &&
        !gradientStroke &&
        strokeWidth > 0 &&
        strokeColor !== 'none' &&
        strokeColor !== 'transparent'
      ) {
        const outlinePath = document.createElementNS(svgNs, 'path');
        outlinePath.setAttribute('d', pathD);
        outlinePath.setAttribute('fill', 'none');
        outlinePath.setAttribute('stroke', strokeColor);
        outlinePath.setAttribute('stroke-width', String(strokeWidth));
        if (strokeLinecap) outlinePath.setAttribute('stroke-linecap', strokeLinecap);
        if (strokeLinejoin) outlinePath.setAttribute('stroke-linejoin', strokeLinejoin);
        const svgDashArray = svgDashArrayForKind(strokeDashKind, strokeWidth);
        if (svgDashArray) {
          outlinePath.setAttribute('stroke-dasharray', svgDashArray);
        } else if (strokeDash === 'dashed') {
          outlinePath.setAttribute('stroke-dasharray', `${strokeWidth * 4},${strokeWidth * 2}`);
        } else if (strokeDash === 'dotted') {
          outlinePath.setAttribute('stroke-dasharray', `${strokeWidth},${strokeWidth * 2}`);
        }
        svg.appendChild(outlinePath);
      }

      wrapper.appendChild(svg);
    } else {
      // Create <defs> for gradients and markers
      const defs = document.createElementNS(svgNs, 'defs');

      const path = document.createElementNS(svgNs, 'path');
      path.setAttribute('d', pathD);
      mainSvgNs = svgNs;
      mainDefs = defs;
      mainPath = path;
      mainSvgBounds = { w: svgW, h: svgH };
      const presetLower = node.presetGeometry?.toLowerCase();
      if (presetLower === 'curveduparrow' || presetLower === 'curveddownarrow') {
        // Curved arrows can contain overlapping sub-contours near arrowhead roots.
        // evenodd avoids tiny anti-alias seams that appear with nonzero winding.
        path.setAttribute('fill-rule', 'evenodd');
        path.setAttribute('stroke-linejoin', 'round');
      } else if (presetLower === 'funnel') {
        // Funnel has an inset ellipse sub-path that creates a "hole" (even-odd fill).
        path.setAttribute('fill-rule', 'evenodd');
      }

      // Fill
      if (fillCss) {
        const pattFill = spPr.child('pattFill');
        const patternFillId = pattFill.exists()
          ? appendSvgPatternFill(svgNs, defs, pattFill, ctx)
          : null;

        if (patternFillId) {
          path.setAttribute('fill', `url(#${patternFillId})`);
        } else if (gradientFillData && gradientFillData.stops.length > 0) {
          // Create SVG gradient definition for proper shape-clipped gradient fills
          const fillGradId = `grad-fill-${++gradientIdCounter}`;

          if (gradientFillData.type === 'radial' && gradientFillData.pathType === 'rect') {
            // OOXML path="rect" gradient: Chebyshev distance (L∞ norm) creates
            // rectangular contour lines (the characteristic cross/X pattern).
            // SVG/CSS radial-gradient only supports elliptical contours.
            // Approximation: two linear gradients (H + V) blended with "lighten"
            // (per-channel max). max(dx, dy) = L∞ norm = rectangular contours.
            const gcx = gradientFillData.cx ?? 0.5;
            const gcy = gradientFillData.cy ?? 0.5;
            const stops = gradientFillData.stops;

            // Mirror stops for center-out: original stop at N% → two stops at
            // (center - N%*distToEdge) and (center + N%*distToEdge) in gradient coords.
            const mirrorStops = (centerFrac: number) => {
              const mirrored: Array<{ offset: number; color: string }> = [];
              for (const s of stops) {
                const t = s.position / 100; // 0..1 from center to edge
                const below = centerFrac - t * centerFrac;
                const above = centerFrac + t * (1 - centerFrac);
                mirrored.push({ offset: below, color: s.color });
                mirrored.push({ offset: above, color: s.color });
              }
              mirrored.sort((a, b) => a.offset - b.offset);
              return mirrored;
            };

            // Horizontal linear gradient (left → right, center at gcx)
            const hGradId = `${fillGradId}-h`;
            const hGrad = document.createElementNS(svgNs, 'linearGradient');
            hGrad.setAttribute('id', hGradId);
            hGrad.setAttribute(
              'color-interpolation',
              gradientFillData.colorInterpolation ?? 'linearRGB',
            );
            hGrad.setAttribute('x1', '0%');
            hGrad.setAttribute('y1', '0%');
            hGrad.setAttribute('x2', '100%');
            hGrad.setAttribute('y2', '0%');
            for (const ms of mirrorStops(gcx)) {
              const svgStop = document.createElementNS(svgNs, 'stop');
              svgStop.setAttribute('offset', `${(ms.offset * 100).toFixed(2)}%`);
              svgStop.setAttribute('stop-color', ms.color);
              hGrad.appendChild(svgStop);
            }
            defs.appendChild(hGrad);

            // Vertical linear gradient (top → bottom, center at gcy)
            const vGradId = `${fillGradId}-v`;
            const vGrad = document.createElementNS(svgNs, 'linearGradient');
            vGrad.setAttribute('id', vGradId);
            vGrad.setAttribute(
              'color-interpolation',
              gradientFillData.colorInterpolation ?? 'linearRGB',
            );
            vGrad.setAttribute('x1', '0%');
            vGrad.setAttribute('y1', '0%');
            vGrad.setAttribute('x2', '0%');
            vGrad.setAttribute('y2', '100%');
            for (const ms of mirrorStops(gcy)) {
              const svgStop = document.createElementNS(svgNs, 'stop');
              svgStop.setAttribute('offset', `${(ms.offset * 100).toFixed(2)}%`);
              svgStop.setAttribute('stop-color', ms.color);
              vGrad.appendChild(svgStop);
            }
            defs.appendChild(vGrad);

            // Use clipPath to constrain the blend group to the shape
            const clipId = `${fillGradId}-clip`;
            const clipPath = document.createElementNS(svgNs, 'clipPath');
            clipPath.setAttribute('id', clipId);
            const clipUsePath = document.createElementNS(svgNs, 'path');
            clipUsePath.setAttribute('d', pathD);
            clipPath.appendChild(clipUsePath);
            defs.appendChild(clipPath);

            // Isolated group: black backdrop + two gradient layers with lighten blend.
            // lighten = per-channel max. Against black (0,0,0), first layer is identity.
            // Second layer's lighten against first = max(H, V) per channel.
            const blendGroup = document.createElementNS(svgNs, 'g');
            blendGroup.setAttribute('clip-path', `url(#${clipId})`);
            blendGroup.setAttribute('style', 'isolation: isolate');

            const bgRect = document.createElementNS(svgNs, 'rect');
            bgRect.setAttribute('width', '100%');
            bgRect.setAttribute('height', '100%');
            bgRect.setAttribute('fill', 'black');
            blendGroup.appendChild(bgRect);

            const hPath = document.createElementNS(svgNs, 'path');
            hPath.setAttribute('d', pathD);
            hPath.setAttribute('fill', `url(#${hGradId})`);
            hPath.setAttribute('style', 'mix-blend-mode: lighten');
            blendGroup.appendChild(hPath);

            const vPath = document.createElementNS(svgNs, 'path');
            vPath.setAttribute('d', pathD);
            vPath.setAttribute('fill', `url(#${vGradId})`);
            vPath.setAttribute('style', 'mix-blend-mode: lighten');
            blendGroup.appendChild(vPath);

            // Mark path as no-fill; the blend group handles it.
            // Tag the blend group so we can insert it before the main path later.
            path.setAttribute('fill', 'none');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (path as any).__rectBlendGroup = blendGroup;
          } else if (gradientFillData.type === 'radial') {
            const radialGrad = document.createElementNS(svgNs, 'radialGradient');
            radialGrad.setAttribute('id', fillGradId);
            radialGrad.setAttribute(
              'color-interpolation',
              gradientFillData.colorInterpolation ?? 'linearRGB',
            );
            radialGrad.setAttribute('gradientUnits', 'userSpaceOnUse');
            const gcx = gradientFillData.cx ?? 0.5;
            const gcy = gradientFillData.cy ?? 0.5;
            radialGrad.setAttribute('cx', String(gcx * svgW));
            radialGrad.setAttribute('cy', String(gcy * svgH));
            // path="circle"/"shape": gradient reaches farthest corner
            const maxDx = Math.max(gcx, 1 - gcx);
            const maxDy = Math.max(gcy, 1 - gcy);
            const r = Math.sqrt(maxDx * maxDx + maxDy * maxDy);
            radialGrad.setAttribute('r', String(r * Math.max(svgW, svgH)));
            for (const stop of gradientFillData.stops) {
              const svgStop = document.createElementNS(svgNs, 'stop');
              svgStop.setAttribute('offset', `${stop.position}%`);
              svgStop.setAttribute('stop-color', stop.color);
              radialGrad.appendChild(svgStop);
            }
            defs.appendChild(radialGrad);
          } else {
            // Linear gradient
            const linearGrad = document.createElementNS(svgNs, 'linearGradient');
            linearGrad.setAttribute('id', fillGradId);
            linearGrad.setAttribute(
              'color-interpolation',
              gradientFillData.colorInterpolation ?? 'linearRGB',
            );
            linearGrad.setAttribute('gradientUnits', 'userSpaceOnUse');
            const coords = angleToSvgGradientCoords(gradientFillData.angle);
            linearGrad.setAttribute('x1', String((parseFloat(coords.x1) / 100) * svgW));
            linearGrad.setAttribute('y1', String((parseFloat(coords.y1) / 100) * svgH));
            linearGrad.setAttribute('x2', String((parseFloat(coords.x2) / 100) * svgW));
            linearGrad.setAttribute('y2', String((parseFloat(coords.y2) / 100) * svgH));
            for (const stop of gradientFillData.stops) {
              const svgStop = document.createElementNS(svgNs, 'stop');
              svgStop.setAttribute('offset', `${stop.position}%`);
              svgStop.setAttribute('stop-color', stop.color);
              linearGrad.appendChild(svgStop);
            }
            defs.appendChild(linearGrad);
          }

          // For rect blend group, fill was already handled (path set to 'none', blend group added).
          if (!(gradientFillData.type === 'radial' && gradientFillData.pathType === 'rect')) {
            path.setAttribute('fill', `url(#${fillGradId})`);
          }
        } else if (fillCss === 'transparent') {
          path.setAttribute('fill', 'none');
        } else if (fillCss.includes('gradient')) {
          // Fallback for gradients without structured data (shouldn't normally happen)
          // Apply to wrapper as before
          wrapper.style.background = fillCss;
          path.setAttribute('fill', 'transparent');
        } else {
          path.setAttribute('fill', fillCss);
        }
      } else {
        path.setAttribute('fill', 'none');
      }
      // SmartArt circularArrow: force no stroke; fill already resolved via fillRef/solidFill above
      if (isCircularArrow) {
        // fillCss was already resolved (including fillRef fallback). Only override if still empty.
        if (!fillCss || fillCss === 'none' || fillCss === 'transparent') {
          // Try spPr > solidFill > color child as last resort
          const colorTags = ['srgbClr', 'schemeClr', 'scrgbClr', 'sysClr', 'hslClr', 'prstClr'];
          let fallbackFill = '';
          const solid = spPr.child('solidFill');
          if (solid.exists()) {
            for (const child of solid.allChildren()) {
              if (colorTags.includes(child.localName)) {
                fallbackFill = resolveColorToCss(child, ctx);
                break;
              }
            }
          }
          if (!fallbackFill && node.fill?.exists()) {
            for (const child of node.fill.allChildren()) {
              if (colorTags.includes(child.localName)) {
                fallbackFill = resolveColorToCss(child, ctx);
                break;
              }
            }
          }
          if (fallbackFill) path.setAttribute('fill', fallbackFill);
        }
        path.setAttribute('stroke', 'none');
      }

      // Resolve arrow ends and effective stroke width before applying stroke (so we can enforce min width for connectors)
      let effectiveHeadEnd = node.headEnd;
      let effectiveTailEnd = node.tailEnd;
      if ((!effectiveHeadEnd || !effectiveTailEnd) && effectiveLine?.exists()) {
        const fromLn = getLineEndsFromLn(effectiveLine);
        if (!effectiveHeadEnd && fromLn.headEnd) effectiveHeadEnd = fromLn.headEnd;
        if (!effectiveTailEnd && fromLn.tailEnd) effectiveTailEnd = fromLn.tailEnd;
      }
      // For gradient strokes, use first stop for marker-start and last stop for marker-end
      // so arrowhead colours match the visible gradient end rather than always using the lightest stop.
      const gradStartColor = gradientStroke
        ? getGradientMarkerColor(gradientStroke.stops, 'start', 'black')
        : strokeColor;
      const gradEndColor = gradientStroke
        ? getGradientMarkerColor(gradientStroke.stops, 'end', gradStartColor)
        : strokeColor;
      let effectiveStrokeWidth = gradientStroke ? gradientStroke.width : strokeWidth;
      if (isLineLike && (effectiveHeadEnd || effectiveTailEnd) && effectiveStrokeWidth <= 0) {
        effectiveStrokeWidth = 1; // so connector line and arrows both show (e.g. slide 24)
      }
      const effectiveStrokeLinecap =
        isLineLike && (effectiveHeadEnd || effectiveTailEnd) ? 'butt' : strokeLinecap;
      if (isLineLike && effectiveHeadEnd && effectiveStrokeWidth > 0) {
        const headInset = getHeadEndStartInset(effectiveHeadEnd, effectiveStrokeWidth);
        if (headInset > 0) {
          pathD = insetPathStart(pathD, headInset);
          path.setAttribute('d', pathD);
        }
      }
      if (isLineLike && effectiveTailEnd && effectiveStrokeWidth > 0) {
        const tailInset = getTailEndEndInset(effectiveTailEnd, effectiveStrokeWidth);
        if (tailInset > 0) {
          pathD = insetPathEnd(pathD, tailInset);
          path.setAttribute('d', pathD);
        }
      }

      // Stroke — gradient stroke or solid stroke (skip for circularArrow; already set stroke=none above)
      // For multi-path presets where the first sub-path specifies stroke:false (e.g. callout1/2/3,
      // accentCallout1/2/3), suppress stroke on the main path element — the leader line and accent
      // bar are rendered as separate sub-path elements with their own stroke settings.
      const mainPathStrokeSuppressed = multiPaths && multiPaths[0]?.stroke === false;
      if (
        !isCircularArrow &&
        !mainPathStrokeSuppressed &&
        gradientStroke &&
        gradientStroke.stops.length > 0
      ) {
        // Create SVG linearGradient for the gradient stroke.
        // Use userSpaceOnUse so the gradient is defined in SVG coordinate space rather
        // than objectBoundingBox. This is critical for straight line paths (zero-width or
        // zero-height bounding box) where objectBoundingBox produces degenerate coordinates
        // and the gradient becomes invisible.
        const gradId = `grad-stroke-${++gradientIdCounter}`;
        const linearGrad = document.createElementNS(svgNs, 'linearGradient');
        linearGrad.setAttribute('id', gradId);
        linearGrad.setAttribute(
          'color-interpolation',
          gradientStroke.colorInterpolation ?? 'linearRGB',
        );
        linearGrad.setAttribute('gradientUnits', 'userSpaceOnUse');

        if (isLineLike || svgW <= 1 || svgH <= 1) {
          // Convert gradient angle to absolute coordinates in SVG user space.
          // For straight connectors the path bbox may be zero on one axis, so use
          // the long-axis strategy to avoid degenerate gradient coordinates.
          const rad = (gradientStroke.angle * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const cx = svgW / 2;
          const cy = svgH / 2;
          const halfLen = Math.max(svgW, svgH) / 2;
          linearGrad.setAttribute('x1', String(cx - halfLen * cos));
          linearGrad.setAttribute('y1', String(cy - halfLen * sin));
          linearGrad.setAttribute('x2', String(cx + halfLen * cos));
          linearGrad.setAttribute('y2', String(cy + halfLen * sin));
        } else {
          const coords = angleToSvgGradientCoords(gradientStroke.angle);
          linearGrad.setAttribute('x1', String((parseFloat(coords.x1) / 100) * svgW));
          linearGrad.setAttribute('y1', String((parseFloat(coords.y1) / 100) * svgH));
          linearGrad.setAttribute('x2', String((parseFloat(coords.x2) / 100) * svgW));
          linearGrad.setAttribute('y2', String((parseFloat(coords.y2) / 100) * svgH));
        }

        for (const stop of gradientStroke.stops) {
          const svgStop = document.createElementNS(svgNs, 'stop');
          svgStop.setAttribute('offset', `${stop.position}%`);
          svgStop.setAttribute('stop-color', stop.color);
          linearGrad.appendChild(svgStop);
        }

        defs.appendChild(linearGrad);

        const strokeW = Math.max(gradientStroke.width, 1);
        path.setAttribute('stroke', `url(#${gradId})`);
        path.setAttribute('stroke-width', String(strokeW));
        if (effectiveStrokeLinecap) path.setAttribute('stroke-linecap', effectiveStrokeLinecap);
        if (strokeLinejoin) path.setAttribute('stroke-linejoin', strokeLinejoin);
      } else if (
        !isCircularArrow &&
        !mainPathStrokeSuppressed &&
        effectiveStrokeWidth > 0 &&
        strokeColor !== 'transparent'
      ) {
        path.setAttribute('stroke', strokeColor);
        path.setAttribute('stroke-width', String(effectiveStrokeWidth));
        if (effectiveStrokeLinecap) path.setAttribute('stroke-linecap', effectiveStrokeLinecap);
        if (strokeLinejoin) path.setAttribute('stroke-linejoin', strokeLinejoin);
        const svgDashArray = svgDashArrayForKind(strokeDashKind, effectiveStrokeWidth);
        if (svgDashArray) {
          path.setAttribute('stroke-dasharray', svgDashArray);
        } else if (strokeDash === 'dashed') {
          path.setAttribute(
            'stroke-dasharray',
            `${effectiveStrokeWidth * 4},${effectiveStrokeWidth * 2}`,
          );
        } else if (strokeDash === 'dotted') {
          path.setAttribute(
            'stroke-dasharray',
            `${effectiveStrokeWidth},${effectiveStrokeWidth * 2}`,
          );
        }
      } else {
        path.setAttribute('stroke', 'none');
      }

      // Line end markers (arrowheads)
      // Use gradient start colour for head (marker-start) and end colour for tail (marker-end)
      if (effectiveStrokeWidth > 0 && (effectiveHeadEnd || effectiveTailEnd)) {
        if (effectiveHeadEnd) {
          const marker = createArrowMarker(
            svgNs,
            effectiveHeadEnd,
            gradStartColor,
            effectiveStrokeWidth,
            true,
          );
          if (marker) {
            defs.appendChild(marker);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            path.setAttribute('marker-start', `url(#${(marker as any)._markerId})`);
          }
        }

        if (effectiveTailEnd) {
          const marker = createArrowMarker(
            svgNs,
            effectiveTailEnd,
            gradEndColor,
            effectiveStrokeWidth,
            false,
          );
          if (marker) {
            defs.appendChild(marker);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            path.setAttribute('marker-end', `url(#${(marker as any)._markerId})`);
          }
        }
      }

      // Insert rect blend group (two linear gradients + lighten) before the main path
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((path as any).__rectBlendGroup) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        svg.appendChild((path as any).__rectBlendGroup);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (path as any).__rectBlendGroup;
      }

      svg.appendChild(path);

      if (blipFill.exists() && ctx.presentation.mediaResolver) {
        const task = resolveShapeBlipUrlAsync(blipFill, ctx)
          .then((lazyBlipUrl) => {
            if (!lazyBlipUrl) return;
            appendShapeBlipImage(
              svgNs,
              svg,
              defs,
              blipFill,
              pathD,
              { w: svgW, h: svgH },
              lazyBlipUrl,
              path,
            );
          })
          .catch(() => {
            // Keep the shape's fallback fill/stroke when lazy media cannot be decoded.
          });
        ctx.asyncTasks?.push(task);
        if (!ctx.asyncTasks) void task;
      }

      // --- Multi-path preset rendering ---
      // For complex shapes (scrolls, etc.) that have multiple sub-paths with different
      // fill modifiers (darkenLess for shadow areas, none for stroke-only detail lines).
      if (multiPaths && multiPaths.length > 1) {
        const mainPathFill = path.getAttribute('fill') ?? '';
        const presetLower = node.presetGeometry?.toLowerCase() ?? '';
        const shadingBaseFill =
          mainPathFill && !mainPathFill.startsWith('url(')
            ? mainPathFill
            : fillRef?.exists()
              ? resolveColorToCss(fillRef, ctx)
              : (gradientFillData?.stops[0]?.color ?? fillCss);
        const baseRgb = parseCssColorToRgb(shadingBaseFill);
        const appendTintedGradientFill = (
          amount: number,
          target: { r: number; g: number; b: number },
        ): string | undefined => {
          if (gradientFillData?.type !== 'linear' || gradientFillData.stops.length === 0)
            return undefined;
          const gradId = `grad-fill-detail-${++gradientIdCounter}`;
          const linearGrad = document.createElementNS(svgNs, 'linearGradient');
          linearGrad.setAttribute('id', gradId);
          linearGrad.setAttribute('gradientUnits', 'userSpaceOnUse');
          linearGrad.setAttribute(
            'color-interpolation',
            gradientFillData.colorInterpolation ?? 'sRGB',
          );
          const coords = angleToSvgGradientCoords(gradientFillData.angle);
          linearGrad.setAttribute('x1', String((parseFloat(coords.x1) / 100) * svgW));
          linearGrad.setAttribute('y1', String((parseFloat(coords.y1) / 100) * svgH));
          linearGrad.setAttribute('x2', String((parseFloat(coords.x2) / 100) * svgW));
          linearGrad.setAttribute('y2', String((parseFloat(coords.y2) / 100) * svgH));
          for (const stop of gradientFillData.stops) {
            const svgStop = document.createElementNS(svgNs, 'stop');
            svgStop.setAttribute('offset', `${stop.position}%`);
            const stopRgb = parseCssColorToRgb(stop.color);
            svgStop.setAttribute(
              'stop-color',
              stopRgb ? mixRgb(stopRgb, target, amount) : stop.color,
            );
            linearGrad.appendChild(svgStop);
          }
          defs.appendChild(linearGrad);
          return `url(#${gradId})`;
        };
        // The first path was already rendered above as the main path.
        // Render additional sub-paths (darkenLess shadow, stroke-only detail lines).
        for (let pi = 1; pi < multiPaths.length; pi++) {
          const sp = multiPaths[pi];
          const extraPath = document.createElementNS(svgNs, 'path');
          extraPath.setAttribute('d', sp.d);
          if (sp.fill === 'none') {
            extraPath.setAttribute('fill', 'none');
          } else if (sp.fill === 'darkenLess') {
            extraPath.setAttribute(
              'fill',
              appendTintedGradientFill(0.15, { r: 0, g: 0, b: 0 }) ||
                (baseRgb ? mixRgb(baseRgb, { r: 0, g: 0, b: 0 }, 0.15) : 'rgba(0,0,0,0.15)'),
            );
          } else if (sp.fill === 'darken') {
            extraPath.setAttribute(
              'fill',
              appendTintedGradientFill(0.3, { r: 0, g: 0, b: 0 }) ||
                (baseRgb ? mixRgb(baseRgb, { r: 0, g: 0, b: 0 }, 0.3) : 'rgba(0,0,0,0.3)'),
            );
          } else if (sp.fill === 'lightenLess') {
            extraPath.setAttribute(
              'fill',
              appendTintedGradientFill(0.18, { r: 255, g: 255, b: 255 }) ||
                (baseRgb
                  ? mixRgb(baseRgb, { r: 255, g: 255, b: 255 }, 0.18)
                  : 'rgba(255,255,255,0.15)'),
            );
          } else if (sp.fill === 'lighten') {
            let canHighlight: string | undefined;
            if (
              presetLower === 'can' &&
              gradientFillData?.type === 'linear' &&
              gradientFillData.stops.length > 0
            ) {
              const faceGradId = `grad-fill-face-${++gradientIdCounter}`;
              const faceGrad = document.createElementNS(svgNs, 'linearGradient');
              faceGrad.setAttribute('id', faceGradId);
              faceGrad.setAttribute('gradientUnits', 'userSpaceOnUse');
              faceGrad.setAttribute('color-interpolation', 'sRGB');
              const coords = angleToSvgGradientCoords(gradientFillData.angle);
              faceGrad.setAttribute('x1', String((parseFloat(coords.x1) / 100) * svgW));
              faceGrad.setAttribute('y1', String((parseFloat(coords.y1) / 100) * svgH));
              faceGrad.setAttribute('x2', String((parseFloat(coords.x2) / 100) * svgW));
              faceGrad.setAttribute('y2', String((parseFloat(coords.y2) / 100) * svgH));
              for (const stop of gradientFillData.stops) {
                const svgStop = document.createElementNS(svgNs, 'stop');
                svgStop.setAttribute('offset', `${stop.position}%`);
                svgStop.setAttribute('stop-color', applyTint(stop.color, 65000));
                faceGrad.appendChild(svgStop);
              }
              defs.appendChild(faceGrad);
              canHighlight = `url(#${faceGradId})`;
            } else if (presetLower === 'can' && mainPathFill.startsWith('url(')) {
              canHighlight = mainPathFill;
            }
            const gradientHighlight =
              presetLower === 'can'
                ? undefined
                : appendTintedGradientFill(0.3, { r: 255, g: 255, b: 255 });
            extraPath.setAttribute(
              'fill',
              canHighlight ||
                gradientHighlight ||
                (baseRgb
                  ? mixRgb(baseRgb, { r: 255, g: 255, b: 255 }, 0.3)
                  : 'rgba(255,255,255,0.3)'),
            );
          } else {
            // 'norm' — same fill as main path
            extraPath.setAttribute('fill', mainPathFill || 'none');
          }
          if (sp.stroke && effectiveStrokeWidth > 0 && strokeColor !== 'transparent') {
            extraPath.setAttribute('stroke', strokeColor);
            const isBorderCalloutLeader =
              node.presetGeometry?.toLowerCase() === 'bordercallout1' && sp.fill === 'none';
            const scaledStrokeWidth =
              sp.strokeWidthScale && Number.isFinite(sp.strokeWidthScale) && sp.strokeWidthScale > 0
                ? effectiveStrokeWidth * sp.strokeWidthScale
                : effectiveStrokeWidth;
            const extraStrokeWidth = isBorderCalloutLeader
              ? Math.max(scaledStrokeWidth, 2.4)
              : scaledStrokeWidth;
            extraPath.setAttribute('stroke-width', String(extraStrokeWidth));
            if (isBorderCalloutLeader) extraPath.setAttribute('stroke-linecap', 'round');
            if (
              sp.maskToMainOutlineBandScale &&
              sp.maskToMainOutlineBandScale > 0 &&
              sp.maskToMainOutlineBandScale < 1
            ) {
              const maskId = `shape-detail-band-mask-${++gradientIdCounter}`;
              const mask = document.createElementNS(svgNs, 'mask');
              mask.setAttribute('id', maskId);
              mask.setAttribute('maskUnits', 'userSpaceOnUse');
              mask.setAttribute('maskContentUnits', 'userSpaceOnUse');
              const maskBg = document.createElementNS(svgNs, 'rect');
              maskBg.setAttribute('x', '0');
              maskBg.setAttribute('y', '0');
              maskBg.setAttribute('width', String(svgW));
              maskBg.setAttribute('height', String(svgH));
              maskBg.setAttribute('fill', 'black');
              mask.appendChild(maskBg);

              const outerPath = document.createElementNS(svgNs, 'path');
              outerPath.setAttribute('d', pathD);
              outerPath.setAttribute('fill', 'white');
              outerPath.setAttribute('stroke', 'none');
              mask.appendChild(outerPath);

              const insetScale = sp.maskToMainOutlineBandScale;
              const insetPath = document.createElementNS(svgNs, 'path');
              insetPath.setAttribute('d', pathD);
              insetPath.setAttribute('fill', 'black');
              insetPath.setAttribute('stroke', 'none');
              const tx = (svgW * (1 - insetScale)) / 2;
              const ty = (svgH * (1 - insetScale)) / 2;
              insetPath.setAttribute('transform', `translate(${tx} ${ty}) scale(${insetScale})`);
              mask.appendChild(insetPath);

              defs.appendChild(mask);
              extraPath.setAttribute('mask', `url(#${maskId})`);
            } else if (sp.maskToMainOutline) {
              const maskId = `shape-detail-mask-${++gradientIdCounter}`;
              const mask = document.createElementNS(svgNs, 'mask');
              mask.setAttribute('id', maskId);
              mask.setAttribute('maskUnits', 'userSpaceOnUse');
              mask.setAttribute('maskContentUnits', 'userSpaceOnUse');
              const maskBg = document.createElementNS(svgNs, 'rect');
              maskBg.setAttribute('x', '0');
              maskBg.setAttribute('y', '0');
              maskBg.setAttribute('width', String(svgW));
              maskBg.setAttribute('height', String(svgH));
              maskBg.setAttribute('fill', 'black');
              mask.appendChild(maskBg);
              const maskPath = document.createElementNS(svgNs, 'path');
              maskPath.setAttribute('d', pathD);
              maskPath.setAttribute('fill', 'none');
              maskPath.setAttribute('stroke', 'white');
              const maskStrokeWidth = Math.max(
                extraStrokeWidth *
                  (sp.maskStrokeScale && sp.maskStrokeScale > 0 ? sp.maskStrokeScale : 3),
                extraStrokeWidth,
              );
              maskPath.setAttribute('stroke-width', String(maskStrokeWidth));
              maskPath.setAttribute('stroke-linecap', 'round');
              maskPath.setAttribute('stroke-linejoin', 'round');
              mask.appendChild(maskPath);
              defs.appendChild(mask);
              extraPath.setAttribute('mask', `url(#${maskId})`);
            }
          } else if (sp.stroke && !lineIsNoFill) {
            // Detail lines without explicit line style: avoid using identical fill color,
            // otherwise guide lines (e.g. chartX diagonals) become visually invisible.
            const detailStroke = baseRgb ? mixRgb(baseRgb, { r: 0, g: 0, b: 0 }, 0.55) : '#666666';
            extraPath.setAttribute('stroke', detailStroke);
            extraPath.setAttribute('stroke-width', '1');
          } else {
            extraPath.setAttribute('stroke', 'none');
          }
          svg.appendChild(extraPath);
        }
      }

      // Some multi-path detail rendering adds masks/gradients after the initial defs population.
      if (defs.children.length > 0 && !defs.parentNode) {
        svg.insertBefore(defs, svg.firstChild);
      }

      // circularArrow: ensure no stroke and remove markers
      if (isCircularArrow) {
        path.setAttribute('stroke', 'none');
        path.removeAttribute('stroke-width');
        path.removeAttribute('marker-start');
        path.removeAttribute('marker-end');
      }

      // --- Action button icon overlay (legacy fallback) ---
      // Only used for action buttons that don't have multiPathPresets entries.
      // Shapes with multiPathPresets already include the icon in their darken sub-paths.
      if (node.presetGeometry && !multiPaths) {
        const iconD = getActionButtonIconPath(node.presetGeometry, pathW, pathH);
        if (iconD) {
          const iconPath = document.createElementNS(svgNs, 'path');
          iconPath.setAttribute('d', iconD);
          // PowerPoint uses a darkened shade (~50%) of the fill colour for action button icons.
          let iconFill = '#333333';
          if (fillCss && fillCss !== 'transparent' && fillCss !== 'none') {
            const m = fillCss.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
            if (m) {
              const r = parseInt(m[1], 16);
              const g = parseInt(m[2], 16);
              const b = parseInt(m[3], 16);
              // Shade at 50%: darken each channel by half
              iconFill = rgbToHex(Math.round(r * 0.5), Math.round(g * 0.5), Math.round(b * 0.5));
            }
          }
          iconPath.setAttribute('fill', iconFill);
          iconPath.setAttribute('stroke', 'none');
          svg.appendChild(iconPath);
        }
      }

      // (Can top ellipse overlay removed — now handled by multiPathPresets 'can' lighten sub-path)

      wrapper.appendChild(svg);
    }
  } else if (fillCss && fillCss !== 'transparent') {
    // No geometry but has fill — apply as background color
    if (fillCss.includes('gradient')) {
      wrapper.style.background = fillCss;
    } else {
      wrapper.style.backgroundColor = fillCss;
    }
  }

  // ---- Render text overlay (only when there is visible text; skip for decorative shapes with empty txBody) ----
  if (node.textBody && node.textBody.paragraphs.length > 0 && hasVisibleText(node.textBody)) {
    const warpedText = renderWarpedTextBody(node, ctx);
    if (warpedText) {
      wrapper.appendChild(warpedText);
    } else {
      const textContainer = document.createElement('div');
      textContainer.style.position = 'absolute';
      if (node.textBoxBounds) {
        textContainer.style.left = `${node.textBoxBounds.x}px`;
        textContainer.style.top = `${node.textBoxBounds.y}px`;
        textContainer.style.width = `${node.textBoxBounds.w}px`;
        textContainer.style.height = `${node.textBoxBounds.h}px`;
      } else {
        textContainer.style.left = '0';
        textContainer.style.top = '0';
        textContainer.style.width = '100%';
        textContainer.style.height = '100%';
      }
      textContainer.style.display = 'flex';
      textContainer.style.flexDirection = 'column';
      textContainer.style.boxSizing = 'border-box';
      // Overflow handling based on bodyPr auto-fit mode:
      // - spAutoFit: shape resizes to fit text → overflow visible
      // - normAutofit: text shrinks to fit shape → apply fontScale, overflow hidden
      // - noAutofit: text clips → overflow hidden
      // - (default, no child): PowerPoint implicitly auto-shrinks simple single-line labels
      const spAutoFit = getEffectiveBodyPrChild(node.textBody, 'spAutoFit');
      const hasSpAutoFit = spAutoFit?.exists();
      const normAutofit = getEffectiveBodyPrChild(node.textBody, 'normAutofit');
      const hasNormAutofit = normAutofit?.exists();
      const noAutofit = getEffectiveBodyPrChild(node.textBody, 'noAutofit');
      const hasNoAutofit = noAutofit?.exists();
      const bodyPr = node.textBody.bodyProperties;
      const fallbackBp = node.textBody.layoutBodyProperties;
      const textWrap =
        (bodyPr ? bodyPr.attr('wrap') : undefined) ??
        (fallbackBp ? fallbackBp.attr('wrap') : undefined);
      const horzOverflow =
        (bodyPr ? bodyPr.attr('horzOverflow') : undefined) ??
        (fallbackBp ? fallbackBp.attr('horzOverflow') : undefined);
      const vertOverflow =
        (bodyPr ? bodyPr.attr('vertOverflow') : undefined) ??
        (fallbackBp ? fallbackBp.attr('vertOverflow') : undefined);
      const spAutoFitAllowsHorizontalOverflow =
        hasSpAutoFit && !hasNormAutofit && horzOverflow === 'overflow';
      const spAutoFitAllowsVerticalOverflow =
        hasSpAutoFit && !hasNormAutofit && vertOverflow === 'overflow';
      const usesImplicitSingleLineFit =
        !hasSpAutoFit &&
        !hasNormAutofit &&
        !hasNoAutofit &&
        isSingleLineTextBody(node.textBody) &&
        !hasBulletParagraph(node.textBody) &&
        (textWrap === 'none' ||
          (textWrap === undefined && isShortImplicitSingleLineLabel(node.textBody)));
      const usesNoAutofitSingleLineTitleFit =
        hasNoAutofit && isTitlePlaceholder(node.placeholder) && isSingleLineTextBody(node.textBody);
      textContainer.style.overflowX = 'visible';
      // noAutofit means "don't auto-fit" — NOT "clip text". PowerPoint allows text to
      // overflow the shape boundary visibly.
      textContainer.style.overflowY = 'visible';

      // normAutofit: PowerPoint stores the computed fontScale (1000ths of percent).
      // Apply it as a CSS transform to shrink text so it fits the shape.
      let needsDynamicAutofit = false;
      if (hasNormAutofit && normAutofit) {
        textContainer.style.overflowY = 'hidden';
        const lnSpcReduction = normAutofit.numAttr('lnSpcReduction') ?? 0;
        // renderTextBody applies normAutofit@fontScale to run and paragraph font sizes.
        // The container transform is reserved for additional browser-measured shrink.
        needsDynamicAutofit = true;
        if (lnSpcReduction > 0) {
          const lnFactor = 1 - lnSpcReduction / 100000;
          textContainer.style.lineHeight = `${lnFactor}`;
        }
      }
      // spAutoFit requests in-shape text fitting. In browser rendering we cannot
      // resize the absolutely positioned shape like PowerPoint editor behavior,
      // so use bounded dynamic scaling to prevent bleed across neighboring nodes.
      if (hasSpAutoFit && !hasNormAutofit) {
        if (!spAutoFitAllowsVerticalOverflow) {
          textContainer.style.overflowY = 'hidden';
        }
        needsDynamicAutofit =
          !spAutoFitAllowsHorizontalOverflow || !spAutoFitAllowsVerticalOverflow;
      }
      // When no autofit mode is serialized, PowerPoint still keeps simple
      // single-line shape labels within the shape bounds instead of wrapping them
      // into neighboring content. Measure and apply the same bounded shrink.
      if (usesImplicitSingleLineFit) {
        textContainer.style.overflowY = 'hidden';
        needsDynamicAutofit = true;
      }
      // Office-authored title placeholders often inherit layout-level noAutofit even
      // when the title box is visually one line tall. Browser font fallback can make
      // the same single-line title wrap, so measure it and only shrink when wrapping
      // would overflow the title box.
      if (usesNoAutofitSingleLineTitleFit) {
        needsDynamicAutofit = true;
      }

      let isVerticalText = false;
      let textAnchor: string | null | undefined;
      const isSingleLineSpAutoFit =
        !!hasSpAutoFit && !hasNormAutofit && isSingleLineTextBody(node.textBody);
      const hasCenteredParagraphs = hasExplicitCenteredParagraph(node.textBody);

      // Apply bodyPr (text body properties)
      // Use layout/master bodyPr as fallback for missing attributes
      {
        if (bodyPr) {
          // Text wrap: only wrap="none" should force single-line.
          // Title placeholders without explicit wrap should still be allowed to wrap.
          if (textWrap === 'none') {
            textContainer.style.whiteSpace = 'nowrap';
          }
        }

        // Vertical alignment (anchor): prefer shape's own, then layout placeholder
        const ownAnchor = bodyPr ? bodyPr.attr('anchor') : undefined;
        const fallbackAnchor = fallbackBp ? fallbackBp.attr('anchor') : undefined;
        const anchor = ownAnchor || fallbackAnchor;
        const hasExplicitTextAnchor = ownAnchor !== undefined || fallbackAnchor !== undefined;
        textAnchor = anchor;
        const vert =
          (bodyPr ? bodyPr.attr('vert') : null) || (fallbackBp ? fallbackBp.attr('vert') : null);
        if (anchor === 't') {
          textContainer.style.justifyContent = 'flex-start';
        } else if (anchor === 'ctr') {
          textContainer.style.justifyContent = 'center';
        } else if (anchor === 'b') {
          textContainer.style.justifyContent = 'flex-end';
        } else {
          textContainer.style.justifyContent = 'flex-start';
        }

        // Internal margins (insets): prefer shape's own, then layout, then OOXML defaults
        const lIns =
          (bodyPr ? bodyPr.numAttr('lIns') : undefined) ??
          (fallbackBp ? fallbackBp.numAttr('lIns') : undefined);
        const tIns =
          (bodyPr ? bodyPr.numAttr('tIns') : undefined) ??
          (fallbackBp ? fallbackBp.numAttr('tIns') : undefined);
        const rIns =
          (bodyPr ? bodyPr.numAttr('rIns') : undefined) ??
          (fallbackBp ? fallbackBp.numAttr('rIns') : undefined);
        const bIns =
          (bodyPr ? bodyPr.numAttr('bIns') : undefined) ??
          (fallbackBp ? fallbackBp.numAttr('bIns') : undefined);

        // Default insets are 91440 EMU (0.1 inch) for L/R, 45720 EMU (0.05 inch) for T/B
        const leftPad = lIns !== undefined ? emuToPx(lIns) : emuToPx(91440);
        const topPad = tIns !== undefined ? emuToPx(tIns) : emuToPx(45720);
        const rightPad = rIns !== undefined ? emuToPx(rIns) : emuToPx(91440);
        const bottomPad = bIns !== undefined ? emuToPx(bIns) : emuToPx(45720);
        const textBoxHeight = node.textBoxBounds?.h ?? node.size.h;
        const collapseVerticalInsets =
          usesImplicitSingleLineFit &&
          !vert &&
          anchor === 'ctr' &&
          textBoxHeight > 0 &&
          topPad + bottomPad >= textBoxHeight;
        const effectiveTopPad = collapseVerticalInsets ? 0 : topPad;
        const effectiveBottomPad = collapseVerticalInsets ? 0 : bottomPad;

        textContainer.style.paddingLeft = `${leftPad}px`;
        textContainer.style.paddingTop = `${effectiveTopPad}px`;
        textContainer.style.paddingRight = `${rightPad}px`;
        textContainer.style.paddingBottom = `${effectiveBottomPad}px`;

        // Vertical text support (bodyPr@vert)
        if (vert === 'eaVert') {
          applyVerticalTextFlow(textContainer, textAnchor);
          isVerticalText = true;
        } else if (vert === 'vert' || vert === 'wordArtVert') {
          applyVerticalTextFlow(textContainer, textAnchor);
          isVerticalText = true;
        } else if (vert === 'vert270') {
          applyVerticalTextFlow(textContainer, textAnchor);
          appendTransform(textContainer, 'rotate(180deg)');
          isVerticalText = true;
        }

        if (
          isSingleLineSpAutoFit &&
          !hasExplicitTextAnchor &&
          !isVerticalText &&
          hasCenteredParagraphs
        ) {
          textContainer.style.justifyContent = 'center';
        }
      }

      // Diagram text can carry its own txXfrm rotation; apply it inside the shape wrapper.
      if (node.textBoxBounds?.rotation && node.textBoxBounds.rotation !== 0) {
        appendTransform(textContainer, `rotate(${node.textBoxBounds.rotation}deg)`);
        textContainer.style.transformOrigin = 'center center';
      }

      // If text was flipped, un-flip the text so it reads correctly
      // Append to existing transforms (don't overwrite vert270 rotation)
      if (node.flipH || node.flipV) {
        const existing = textContainer.style.transform || '';
        const flipParts: string[] = [];
        if (node.flipH) flipParts.push('scaleX(-1)');
        if (node.flipV) flipParts.push('scaleY(-1)');
        textContainer.style.transform = `${existing} ${flipParts.join(' ')}`.trim();
      }

      // Resolve fontRef color from shape style element (used by SmartArt diagram shapes
      // where text color is specified via dsp:style > a:fontRef > a:schemeClr).
      let fontRefColor: string | undefined;
      const shapeStyle = node.source.child('style');
      if (shapeStyle.exists()) {
        const fontRef = shapeStyle.child('fontRef');
        if (fontRef.exists() && fontRef.allChildren().length > 0) {
          fontRefColor = resolveColorToCss(fontRef, ctx);
        }
      }

      const textOptions =
        fontRefColor || isVerticalText || (hasSpAutoFit && !hasNormAutofit)
          ? {
              ...(fontRefColor ? { fontRefColor } : {}),
              ...(isVerticalText ? { isVerticalText } : {}),
              ...(hasSpAutoFit && !hasNormAutofit
                ? (() => {
                    const paragraphCount = visibleParagraphCount(node.textBody);
                    const hasExplicitSpacing = hasExplicitParagraphSpacing(node.textBody);
                    const shouldUseOfficeWrappedLineHeight =
                      !hasExplicitSpacing &&
                      textWrap !== 'none' &&
                      (paragraphCount > 1 ||
                        visibleTextLength(node.textBody) > IMPLICIT_SINGLE_LINE_LABEL_MAX_CHARS);

                    return {
                      trimOuterParagraphSpacing: true,
                      ...(isSingleLineSpAutoFit &&
                      !isVerticalText &&
                      (textWrap === 'none' || hasCenteredParagraphs)
                        ? {
                            compactSingleLineSpacing: true,
                            defaultLineHeight: '1',
                          }
                        : shouldUseOfficeWrappedLineHeight
                          ? {
                              defaultLineHeight: '1.1',
                            }
                          : {}),
                    };
                  })()
                : {}),
            }
          : undefined;

      renderTextBody(node.textBody, node.placeholder, ctx, textContainer, textOptions);
      wrapper.appendChild(textContainer);

      // Dynamic text fit: measure rendered text and compute any additional scale
      // needed after OOXML fontScale, spAutoFit, or implicit single-line fitting.
      if (needsDynamicAutofit) {
        const baseTransform = textContainer.style.transform;
        const baseTransformOrigin = textContainer.style.transformOrigin;
        const baseWidth = textContainer.style.width;
        const baseHeight = textContainer.style.height;
        const baseWhiteSpace = textContainer.style.whiteSpace;
        const baseOverflowY = textContainer.style.overflowY;
        const applyDynamicAutofit = () => {
          textContainer.style.transform = baseTransform;
          textContainer.style.transformOrigin = baseTransformOrigin;
          textContainer.style.width = baseWidth;
          textContainer.style.height = baseHeight;
          textContainer.style.whiteSpace = baseWhiteSpace;
          textContainer.style.overflowY = baseOverflowY;

          // The wrapper is not always in the DOM yet, so temporarily attach it offscreen to measure.
          const wasConnected = wrapper.isConnected;
          const savedWrapperVisibility = wrapper.style.visibility;
          const measurementRoot = ctx.measurementRoot?.isConnected
            ? ctx.measurementRoot
            : document.body;
          if (!wasConnected) {
            wrapper.style.visibility = 'hidden';
            measurementRoot.appendChild(wrapper);
          }

          // Temporarily neutralise vertical alignment so content overflows downward
          // (flex-end would push content upward, making scrollHeight == clientHeight).
          const savedJC = textContainer.style.justifyContent;
          const savedWhiteSpace = textContainer.style.whiteSpace;
          textContainer.style.justifyContent = 'flex-start';
          const containerW = textContainer.clientWidth;
          const containerH = textContainer.clientHeight;
          const wrappedContentH = textContainer.scrollHeight;
          const wrappedContentW = textContainer.scrollWidth;
          let contentW = wrappedContentW;
          let contentH = wrappedContentH;
          const wrappedWidthFits =
            containerW > 0 && wrappedContentW <= containerW + WRAPPED_AUTOFIT_WIDTH_TOLERANCE_PX;
          const wrappedHeightTolerance = isSingleLineSpAutoFit
            ? SINGLE_PARAGRAPH_WRAPPED_AUTOFIT_HEIGHT_TOLERANCE
            : WRAPPED_AUTOFIT_HEIGHT_TOLERANCE;
          const wrappedHeightFits =
            containerH > 0 &&
            (wrappedContentH <= containerH ||
              (!spAutoFitAllowsVerticalOverflow &&
                wrappedWidthFits &&
                wrappedContentH <= containerH * wrappedHeightTolerance));
          const wrappedFits =
            containerW > 0 && containerH > 0 && wrappedWidthFits && wrappedHeightFits;
          const hasToleratedVerticalMetricOverhang =
            hasSpAutoFit &&
            !hasNormAutofit &&
            !spAutoFitAllowsVerticalOverflow &&
            wrappedWidthFits &&
            wrappedHeightFits &&
            wrappedContentH > containerH &&
            containerH > 0;
          const hasIgnoredImplicitSingleLineVerticalOverflow =
            usesImplicitSingleLineFit &&
            wrappedWidthFits &&
            wrappedContentH > containerH &&
            containerH > 0;
          const shouldMeasureUnwrappedWidth =
            !isVerticalText &&
            !spAutoFitAllowsHorizontalOverflow &&
            !wrappedFits &&
            (!wrappedWidthFits ||
              !wrappedHeightFits ||
              isSingleLineSpAutoFit ||
              usesImplicitSingleLineFit ||
              usesNoAutofitSingleLineTitleFit);
          let measuredUnwrappedWidth = false;
          if (shouldMeasureUnwrappedWidth) {
            textContainer.style.whiteSpace = 'nowrap';
            contentW = textContainer.scrollWidth;
            contentH = textContainer.scrollHeight;
            measuredUnwrappedWidth = true;
            textContainer.style.whiteSpace = savedWhiteSpace;
          }
          textContainer.style.justifyContent = savedJC;
          if (!wasConnected) {
            if (wrapper.parentNode === measurementRoot) {
              measurementRoot.removeChild(wrapper);
            }
            wrapper.style.visibility = savedWrapperVisibility;
          }
          let scale = 1;
          const fitWidthOnly = usesNoAutofitSingleLineTitleFit || usesImplicitSingleLineFit;
          const usesUnwrappedNoScaleFit =
            hasSpAutoFit &&
            !hasNormAutofit &&
            textWrap !== 'none' &&
            measuredUnwrappedWidth &&
            !wrappedHeightFits &&
            contentW <= containerW + WRAPPED_AUTOFIT_WIDTH_TOLERANCE_PX &&
            contentH <= containerH;
          if (usesUnwrappedNoScaleFit) {
            textContainer.style.whiteSpace = 'nowrap';
          }
          if (
            !spAutoFitAllowsHorizontalOverflow &&
            contentW > containerW + WRAPPED_AUTOFIT_WIDTH_TOLERANCE_PX &&
            containerW > 0
          ) {
            const widthScale = containerW / contentW;
            const canFitWrappedLinesByWidth =
              hasSpAutoFit &&
              !hasNormAutofit &&
              !wrappedHeightFits &&
              contentH <= containerH &&
              widthScale >= SP_AUTOFIT_UNWRAPPED_WIDTH_SCALE_FLOOR;
            const usesSingleLineSpAutoFitWidthFit =
              hasSpAutoFit &&
              !hasNormAutofit &&
              isSingleLineSpAutoFit &&
              (textWrap === undefined || textWrap === 'none' || hasCenteredParagraphs);
            const canUseUnwrappedWidthScale =
              !hasSpAutoFit ||
              hasNormAutofit ||
              canFitWrappedLinesByWidth ||
              usesSingleLineSpAutoFitWidthFit ||
              usesImplicitSingleLineFit ||
              usesNoAutofitSingleLineTitleFit;
            if (
              canUseUnwrappedWidthScale &&
              (!usesNoAutofitSingleLineTitleFit ||
                widthScale >= NO_AUTOFIT_TITLE_METRIC_SCALE_FLOOR)
            ) {
              scale = Math.min(scale, widthScale);
            }
          }
          const usesUnwrappedWidthFit =
            hasSpAutoFit &&
            !hasNormAutofit &&
            scale < 1 &&
            contentH <= containerH &&
            !wrappedHeightFits;
          if (usesUnwrappedWidthFit) {
            textContainer.style.whiteSpace = 'nowrap';
          }
          if (
            !fitWidthOnly &&
            !usesUnwrappedNoScaleFit &&
            !usesUnwrappedWidthFit &&
            !spAutoFitAllowsVerticalOverflow &&
            !wrappedHeightFits &&
            contentH > containerH &&
            containerH > 0
          ) {
            scale = Math.min(scale, containerH / contentH);
          }
          if (
            !fitWidthOnly &&
            !usesUnwrappedNoScaleFit &&
            !usesUnwrappedWidthFit &&
            !spAutoFitAllowsVerticalOverflow &&
            scale === 1 &&
            !wrappedHeightFits &&
            wrappedContentH > containerH &&
            containerH > 0
          ) {
            scale = containerH / wrappedContentH;
          }
          if (scale < 1) {
            if (!textContainer.style.transform) {
              textContainer.style.transformOrigin = 'top left';
            }
            appendTransform(textContainer, `scale(${scale})`);
            textContainer.style.width = expandCssLengthForScale(baseWidth, scale);
            textContainer.style.height = expandCssLengthForScale(baseHeight, scale);
          } else if (
            hasToleratedVerticalMetricOverhang ||
            hasIgnoredImplicitSingleLineVerticalOverflow
          ) {
            textContainer.style.overflowY = 'visible';
          }
        };

        const scheduleDynamicAutofit = () => {
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => requestAnimationFrame(applyDynamicAutofit));
          } else {
            setTimeout(applyDynamicAutofit, 0);
          }
        };

        applyDynamicAutofit();
        scheduleDynamicAutofit();
        if (document.fonts?.status === 'loading' && document.fonts.ready) {
          void document.fonts.ready.then(() => scheduleDynamicAutofit()).catch(() => undefined);
        }
      }
    }
  }

  // ---- Effects (explicit effectLst or theme effectRef fallback) ----
  let effectiveEffectLst = spPr.child('effectLst');
  if (!effectiveEffectLst.exists()) {
    const effectRef = node.source.child('style').child('effectRef');
    const idx = effectRef.numAttr('idx') ?? 0;
    if (idx > 0 && (ctx.theme.effectStyles?.length ?? 0) >= idx) {
      const themeEffect = ctx.theme.effectStyles[idx - 1];
      if (themeEffect.exists()) {
        const lst = themeEffect.child('effectLst');
        if (lst.exists()) effectiveEffectLst = lst;
      }
    }
  }

  if (effectiveEffectLst.exists()) {
    const outerShdw = effectiveEffectLst.child('outerShdw');
    if (outerShdw.exists()) {
      const dir = outerShdw.numAttr('dir') ?? 0; // direction in 60000ths of degree
      const dist = outerShdw.numAttr('dist') ?? 0; // distance in EMU
      const blurRad = outerShdw.numAttr('blurRad') ?? 0; // blur radius in EMU
      const sx = outerShdw.numAttr('sx'); // horizontal scale (100000 = 100%)
      const sy = outerShdw.numAttr('sy'); // vertical scale (100000 = 100%)
      const algn = outerShdw.attr('algn'); // alignment anchor (t, b, tl, tr, etc.)

      const dirDeg = dir / 60000;
      const distPx = emuToPx(dist);
      const blurPx = emuToPx(blurRad);
      const offsetX = distPx * Math.cos((dirDeg * Math.PI) / 180);
      const offsetY = distPx * Math.sin((dirDeg * Math.PI) / 180);

      // Resolve shadow color
      let shadowColor = 'rgba(0,0,0,0.4)';
      let shadowRgb = { r: 0, g: 0, b: 0 };
      const { color: shdColor, alpha: shdAlpha } = resolveColor(outerShdw, ctx);
      if (shdColor) {
        const hex = shdColor.startsWith('#') ? shdColor : `#${shdColor}`;
        const { r: sr, g: sg, b: sb } = hexToRgb(hex);
        shadowRgb = { r: sr, g: sg, b: sb };
        shadowColor = `rgba(${sr},${sg},${sb},${shdAlpha.toFixed(3)})`;
      }

      // PowerPoint outerShdw with sx/sy creates a scaled shadow copy, then draws the
      // shape on top.  When dist=0 and scale ≈ 100%, only the thin edge overhang is
      // visible – far subtler than a CSS drop-shadow with the full blur radius.
      // Approximate with box-shadow using spread derived from scale and reduced blur.
      if (sx != null && sy != null && sx > 0 && sy > 0) {
        const scaleX = sx / 100000;
        const scaleY = sy / 100000;
        const shapeW = node.size?.w ?? 100;
        const shapeH = node.size?.h ?? 100;

        // For line-like shapes, sx/sy should scale line thickness, not full line length.
        // Using shape width here can explode spread on long connectors (slide 68 regression).
        let spreadBasisW = shapeW;
        let spreadBasisH = shapeH;
        if (isLineLike || shapeW <= 1 || shapeH <= 1) {
          const lineWEmu = node.line?.numAttr('w') ?? 12700;
          const lineThickness = Math.max(1, emuToPx(lineWEmu));
          spreadBasisW = lineThickness;
          spreadBasisH = lineThickness;
        }

        // Spread = how far the shadow extends beyond the shape on each side
        const spreadX = (spreadBasisW * (scaleX - 1)) / 2;
        const spreadY = (spreadBasisH * (scaleY - 1)) / 2;
        const spread = Math.max(0, (spreadX + spreadY) / 2);

        // Alignment shifts the shadow anchor point; compute extra offset
        let alignOffX = 0;
        let alignOffY = 0;
        if (algn) {
          // OOXML algn is an enum (t, b, l, r, tl, tr, bl, br, ctr), not a substring bag.
          // Exact matching avoids misinterpreting "ctr" as containing both "t" and "r".
          const a = algn.toLowerCase();
          if (a === 't' || a === 'tl' || a === 'tr') alignOffY = (spreadBasisH * (scaleY - 1)) / 2;
          if (a === 'b' || a === 'bl' || a === 'br') alignOffY = (-spreadBasisH * (scaleY - 1)) / 2;
          if (a === 'l' || a === 'tl' || a === 'bl') alignOffX = (spreadBasisW * (scaleX - 1)) / 2;
          if (a === 'r' || a === 'tr' || a === 'br') alignOffX = (-spreadBasisW * (scaleX - 1)) / 2;
        }

        // When spread is tiny relative to blurPx, PowerPoint's Gaussian blur
        // distributes energy across the full blur area.  The visible edge (only
        // `spread` wide) receives only a fraction of the original alpha.
        // Attenuate alpha accordingly so thin-edge shadows are nearly invisible.
        const effectiveBlur = Math.min(blurPx, spread * 3);
        let effectiveAlpha = shdAlpha;
        if (blurPx > 0 && spread < blurPx) {
          effectiveAlpha = shdAlpha * (spread / blurPx);
        }

        // Skip shadow entirely if effective alpha is negligible
        if (effectiveAlpha >= 0.01) {
          const bsX = offsetX + alignOffX;
          const bsY = offsetY + alignOffY;
          // Recompute shadow color with attenuated alpha
          let attenuatedColor = shadowColor;
          if (shdColor) {
            const hex2 = shdColor.startsWith('#') ? shdColor : `#${shdColor}`;
            const { r: sr2, g: sg2, b: sb2 } = hexToRgb(hex2);
            shadowRgb = { r: sr2, g: sg2, b: sb2 };
            attenuatedColor = `rgba(${sr2},${sg2},${sb2},${effectiveAlpha.toFixed(4)})`;
          }
          if (!isLineLike && mainSvgNs && mainDefs && mainPath && mainSvgBounds) {
            applySvgDropShadowFilter(mainSvgNs, mainDefs, mainPath, mainSvgBounds, {
              dx: bsX,
              dy: bsY,
              blur: effectiveBlur,
              color: shadowRgb,
              opacity: effectiveAlpha,
            });
          } else {
            wrapper.style.boxShadow = `${bsX.toFixed(1)}px ${bsY.toFixed(1)}px ${effectiveBlur.toFixed(1)}px ${spread.toFixed(1)}px ${attenuatedColor}`;
          }
        }
      } else {
        if (!isLineLike && mainSvgNs && mainDefs && mainPath && mainSvgBounds) {
          applySvgDropShadowFilter(mainSvgNs, mainDefs, mainPath, mainSvgBounds, {
            dx: offsetX,
            dy: offsetY,
            blur: blurPx,
            color: shadowRgb,
            opacity: shdAlpha,
          });
        } else {
          appendCssFilter(
            wrapper,
            `drop-shadow(${offsetX.toFixed(1)}px ${offsetY.toFixed(1)}px ${blurPx.toFixed(1)}px ${shadowColor})`,
          );
        }
      }
    }

    const glow = effectiveEffectLst.child('glow');
    if (glow.exists()) {
      applyGlowFilter(wrapper, glow, ctx);
    }

    // Reflection is not directly representable in standard CSS across browsers.
    // Approximate via -webkit-box-reflect when available (Chromium/WebKit).
    const reflection = effectiveEffectLst.child('reflection');
    if (reflection.exists()) {
      const dist = emuToPx(reflection.numAttr('dist') ?? 0);
      const stA = (reflection.numAttr('stA') ?? 50000) / 100000;
      const endA = (reflection.numAttr('endA') ?? 0) / 100000;
      const stPos = Math.max(0, Math.min(100, (reflection.numAttr('stPos') ?? 0) / 1000));
      const endPos = Math.max(0, Math.min(100, (reflection.numAttr('endPos') ?? 100000) / 1000));
      const mask = `linear-gradient(to bottom, rgba(255,255,255,${stA.toFixed(3)}) ${stPos.toFixed(1)}%, rgba(255,255,255,${endA.toFixed(3)}) ${endPos.toFixed(1)}%)`;
      const reflectValue = `below ${dist.toFixed(1)}px ${mask}`;
      wrapper.style.setProperty('-webkit-box-reflect', reflectValue);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (wrapper.style as any).webkitBoxReflect = reflectValue;
    }
  }

  // ---- Shape-level hyperlink / action button navigation ----
  if (node.hlinkClick && ctx.onNavigate) {
    const { action, rId } = node.hlinkClick;
    const rel = rId ? ctx.slide.rels.get(rId) : undefined;
    const slideIndex = resolveSlideNavigationIndex(ctx, action, rel);
    if (slideIndex !== undefined) {
      wrapper.style.cursor = 'pointer';
      wrapper.title = node.hlinkClick.tooltip || slideJumpTitle(slideIndex);
      wrapper.addEventListener('click', (e) => {
        e.stopPropagation();
        ctx.onNavigate!({ slideIndex });
      });
    } else if (rId) {
      // External URL link
      if (rel && isExternalTargetMode(rel.targetMode) && isAllowedExternalUrl(rel.target)) {
        wrapper.style.cursor = 'pointer';
        wrapper.title = node.hlinkClick.tooltip || rel.target;
        wrapper.addEventListener('click', (e) => {
          e.stopPropagation();
          ctx.onNavigate!({ url: rel.target });
        });
      }
    }
  }

  return wrapper;
}
