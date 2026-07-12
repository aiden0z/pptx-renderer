/**
 * Text renderer — converts OOXML text body into HTML DOM elements
 * with full 7-level style inheritance.
 */

import { SafeXmlNode } from '../parser/XmlParser';
import { RenderContext } from './RenderContext';
import type { TextBody, TextParagraph, TextRun } from '../model/nodes/ShapeNode';
import { PlaceholderInfo } from '../model/nodes/BaseNode';
import { resolveColor, resolveColorToCss, resolveFill } from './StyleResolver';
import { emuToPx, pctToDecimal, angleToDeg } from '../parser/units';
import { parseOoxmlBool } from '../parser/booleans';
import { isExternalTargetMode } from '../parser/RelParser';
import { isAllowedExternalUrl } from '../utils/urlSafety';
import { getEffectiveBodyPrChild } from './TextBodyProperties';
import { cssFontFamilyStack, resolveThemeFont } from './fontResolver';
import { resolveSlideNavigationIndex, slideJumpTitle } from './navigation';

// ---------------------------------------------------------------------------
// Style Inheritance Helpers
// ---------------------------------------------------------------------------

function compactNumericTokenText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const token = text.trim();
  if (token.length === 0 || token.length > 32) return undefined;
  return /^[+-]?(?:\d+(?:[.,]\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?)\s*(?:%|[A-Za-z]{1,4})?$/.test(
    token,
  )
    ? token
    : undefined;
}

function isCompactNumericToken(text: string | undefined): boolean {
  return compactNumericTokenText(text) !== undefined;
}

function appendWhitespacePreservingText(parent: HTMLElement, text: string): void {
  if (!text) return;
  parent.appendChild(document.createTextNode(text.replace(/ {2}/g, ' \u00a0')));
}

function findCompactNumericRunGroups(runs: TextRun[]): Map<number, number> {
  const groups = new Map<number, number>();
  let nextGroupId = 1;

  for (let i = 0; i < runs.length; i++) {
    if (groups.has(i)) continue;

    let text = '';
    let bestEnd = -1;
    for (let j = i; j < runs.length && j < i + 4; j++) {
      const part = runs[j].text;
      if (part === undefined || part === '\n' || part.includes('\t')) break;
      text += part;
      if (text.trim().length > 32) break;
      if (j > i && isCompactNumericToken(text)) bestEnd = j;
    }

    if (bestEnd > i) {
      const groupId = nextGroupId++;
      for (let k = i; k <= bestEnd; k++) {
        groups.set(k, groupId);
      }
      i = bestEnd;
    }
  }

  return groups;
}

/**
 * Find paragraph properties at a specific indent level from a list style node.
 * Tries lvl{n}pPr (where n = level + 1), then falls back to defPPr.
 */
function findStyleAtLevel(styleNode: SafeXmlNode | undefined, level: number): SafeXmlNode {
  if (!styleNode || !styleNode.exists()) {
    return new SafeXmlNode(null);
  }
  // Try level-specific style (lvl1pPr, lvl2pPr, etc.)
  const lvlNode = styleNode.child(`lvl${level + 1}pPr`);
  if (lvlNode.exists()) return lvlNode;
  // Fall back to default
  return styleNode.child('defPPr');
}

/**
 * Determine the placeholder category for style inheritance.
 * Returns 'title', 'body', or 'other'.
 */
function getPlaceholderCategory(
  placeholder: PlaceholderInfo | undefined,
): 'title' | 'body' | 'other' {
  if (!placeholder || !placeholder.type) return 'other';
  const t = placeholder.type;
  if (t === 'title' || t === 'ctrTitle') return 'title';
  if (
    t === 'body' ||
    t === 'subTitle' ||
    t === 'obj' ||
    t === 'dt' ||
    t === 'ftr' ||
    t === 'sldNum'
  ) {
    return 'body';
  }
  return 'other';
}

/**
 * Find a placeholder node in a list by matching type and/or idx.
 */
function findPlaceholderNode(
  placeholders: SafeXmlNode[],
  info: PlaceholderInfo,
): SafeXmlNode | undefined {
  for (const ph of placeholders) {
    // Navigate to the ph element to read its attributes
    let phEl: SafeXmlNode | undefined;
    const nvSpPr = ph.child('nvSpPr');
    if (nvSpPr.exists()) {
      phEl = nvSpPr.child('nvPr').child('ph');
    }
    if (!phEl || !phEl.exists()) {
      const nvPicPr = ph.child('nvPicPr');
      if (nvPicPr.exists()) {
        phEl = nvPicPr.child('nvPr').child('ph');
      }
    }
    if (!phEl || !phEl.exists()) continue;

    const phType = phEl.attr('type');
    const phIdx = phEl.numAttr('idx');

    // Match by idx first (most specific), then by type
    if (info.idx !== undefined && phIdx === info.idx) return ph;
    if (info.type && phType === info.type) return ph;
  }
  return undefined;
}

/**
 * Extract lstStyle from a placeholder shape node.
 */
function getPlaceholderLstStyle(phNode: SafeXmlNode): SafeXmlNode | undefined {
  const txBody = phNode.child('txBody');
  if (!txBody.exists()) return undefined;
  const lstStyle = txBody.child('lstStyle');
  return lstStyle.exists() ? lstStyle : undefined;
}

/**
 * Merge a source paragraph property node onto a target style object.
 * Later calls override earlier values (higher priority wins).
 */
interface MergedParagraphStyle {
  align?: string;
  rtl?: boolean;
  marginLeft?: number;
  textIndent?: number;
  defaultTabSize?: number;
  lineHeight?: string;
  /** True when lineHeight comes from spcPts (absolute pt value). For CJK fonts, CSS line-height
   *  with absolute values may not produce exact spacing because the font's content area can exceed
   *  the line-height. When true, we use block-level line wrappers instead of <br> for line breaks. */
  lineHeightAbsolute?: boolean;
  spaceBefore?: number;
  spaceBeforePct?: number; // percentage of font size (0-1 range)
  spaceAfter?: number;
  spaceAfterPct?: number; // percentage of font size (0-1 range)
  bulletChar?: string;
  bulletFont?: string;
  bulletAutoNum?: string;
  bulletAutoNumStartAt?: number;
  bulletSizePct?: number;
  bulletSizePt?: number;
  bulletColorFollowsText?: boolean;
  bulletNone?: boolean;
  /** When set, bullet color is taken from this OOXML buClr node (a:buClr with srgbClr/schemeClr child). */
  bulletColorNode?: SafeXmlNode;
  defRPr?: SafeXmlNode;
  defRPrs?: SafeXmlNode[];
}

function mergeParagraphProps(target: MergedParagraphStyle, pPr: SafeXmlNode): void {
  if (!pPr.exists()) return;

  const algn = pPr.attr('algn');
  if (algn) target.align = algn;

  const rtl = pPr.attr('rtl');
  if (rtl !== undefined) target.rtl = parseOoxmlBool(rtl);

  const marL = pPr.numAttr('marL');
  if (marL !== undefined) target.marginLeft = emuToPx(marL);

  const indent = pPr.numAttr('indent');
  if (indent !== undefined) target.textIndent = emuToPx(indent);

  const defTabSz = pPr.numAttr('defTabSz');
  if (defTabSz !== undefined) target.defaultTabSize = emuToPx(defTabSz);

  // Line spacing
  // OOXML spcPct: 100000 = "single spacing" = 1.0× the font's line height.
  // IMPORTANT: We must use UNITLESS CSS line-height values (e.g., 1.0, 1.2)
  // instead of percentages (e.g., 100%, 120%). CSS percentage line-height is
  // computed once against the element's own font-size and inherited as a FIXED
  // pixel value — so a parent div with line-height:120% and font-size:16px
  // inherits 19.2px to ALL children, even those with font-size:80pt.
  // Unitless values are inherited as-is and each child recomputes against its
  // own font-size.
  const lnSpc = pPr.child('lnSpc');
  if (lnSpc.exists()) {
    const spcPct = lnSpc.child('spcPct');
    if (spcPct.exists()) {
      const val = spcPct.numAttr('val');
      if (val !== undefined) {
        // OOXML 100000 → CSS unitless 1.0; OOXML 120000 → CSS 1.2
        target.lineHeight = `${(val / 100000).toFixed(3)}`;
      }
    }
    const spcPts = lnSpc.child('spcPts');
    if (spcPts.exists()) {
      const val = spcPts.numAttr('val');
      if (val !== undefined) {
        target.lineHeight = `${val / 100}pt`;
        target.lineHeightAbsolute = true;
      }
    }
  }

  // Space before
  const spcBef = pPr.child('spcBef');
  if (spcBef.exists()) {
    const spcPts = spcBef.child('spcPts');
    if (spcPts.exists()) {
      const val = spcPts.numAttr('val');
      if (val !== undefined) target.spaceBefore = val / 100;
    }
    const spcPct = spcBef.child('spcPct');
    if (spcPct.exists()) {
      const val = spcPct.numAttr('val');
      if (val !== undefined) target.spaceBeforePct = val / 100000; // store as ratio
    }
  }

  // Space after
  const spcAft = pPr.child('spcAft');
  if (spcAft.exists()) {
    const spcPts = spcAft.child('spcPts');
    if (spcPts.exists()) {
      const val = spcPts.numAttr('val');
      if (val !== undefined) target.spaceAfter = val / 100;
    }
    const spcPct = spcAft.child('spcPct');
    if (spcPct.exists()) {
      const val = spcPct.numAttr('val');
      if (val !== undefined) target.spaceAfterPct = val / 100000; // store as ratio
    }
  }

  // Bullets
  const buChar = pPr.child('buChar');
  if (buChar.exists()) {
    target.bulletChar = buChar.attr('char') || '';
    target.bulletNone = false;
  }
  const buAutoNum = pPr.child('buAutoNum');
  if (buAutoNum.exists()) {
    target.bulletAutoNum = buAutoNum.attr('type') || 'arabicPeriod';
    const startAt = buAutoNum.numAttr('startAt');
    if (startAt !== undefined) target.bulletAutoNumStartAt = startAt;
    target.bulletNone = false;
  }
  const buNone = pPr.child('buNone');
  if (buNone.exists()) {
    target.bulletNone = true;
    target.bulletChar = undefined;
    target.bulletAutoNum = undefined;
  }
  const buFont = pPr.child('buFont');
  if (buFont.exists()) {
    target.bulletFont = buFont.attr('typeface');
  }
  const buSzPct = pPr.child('buSzPct');
  if (buSzPct.exists()) {
    const val = buSzPct.numAttr('val');
    if (val !== undefined) {
      target.bulletSizePct = val / 100000;
      target.bulletSizePt = undefined;
    }
  }
  const buSzPts = pPr.child('buSzPts');
  if (buSzPts.exists()) {
    const val = buSzPts.numAttr('val');
    if (val !== undefined) {
      target.bulletSizePt = val / 100;
      target.bulletSizePct = undefined;
    }
  }
  const buSzTx = pPr.child('buSzTx');
  if (buSzTx.exists()) {
    target.bulletSizePct = undefined;
    target.bulletSizePt = undefined;
  }
  // Bullet color follows text color (a:buClrTx). This must override inherited bullet colors.
  const buClrTx = pPr.child('buClrTx');
  if (buClrTx.exists()) {
    target.bulletColorFollowsText = true;
    target.bulletColorNode = undefined;
  }
  // Explicit bullet color (a:buClr); when present overrides buClrTx/defRPr for bullet color.
  const buClr = pPr.child('buClr');
  if (buClr.exists()) {
    target.bulletColorNode = buClr;
    target.bulletColorFollowsText = false;
  }

  // Default run properties (used as fallback for runs without rPr)
  const defRPr = pPr.child('defRPr');
  if (defRPr.exists()) {
    target.defRPr = defRPr;
    target.defRPrs ??= [];
    target.defRPrs.push(defRPr);
  }
}

// ---------------------------------------------------------------------------
// Run Style Resolution
// ---------------------------------------------------------------------------

interface MergedRunStyle {
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color?: string;
  fontFamily?: string;
  fontFamilyStack?: string[];
  hlinkClick?: string;
  hlinkSlideIndex?: number;
  hlinkTooltip?: string;
  /** Character spacing (tracking) in points — from a:spc @val (hundredths of pt). */
  letterSpacingPt?: number;
  /** Kerning: minimum font size (pt) for kerning; 0 = always kern. */
  kern?: number;
  /** Text capitalization: "all" = ALL CAPS, "small" = SMALL CAPS, "none" = normal. */
  cap?: string;
  /** Baseline shift in percentage (positive = superscript, negative = subscript). */
  baseline?: number;
  /** CSS gradient string for text fill (from rPr > gradFill). */
  textGradientCss?: string;
  /** CSS background for text fill (from rPr > pattFill). */
  textPatternCss?: string;
  /** CSS background color for a:highlight. */
  highlightColor?: string;
  /** Explicit underline CSS color from a:uFill. */
  underlineColor?: string;
  /** True when underline color should follow the effective text color. */
  underlineFollowsText?: boolean;
  /** When true, text fill is transparent (a:noFill on rPr). */
  textNoFill?: boolean;
  /** Text outline width in px (from a:ln on rPr). */
  textOutlineWidth?: number;
  /** Text outline CSS color (solid fill on ln). */
  textOutlineColor?: string;
  /** Text outline CSS gradient (gradient fill on ln) — used as mask-image for fade effect. */
  textOutlineGradientCss?: string;
  /** CSS text-shadow fragments from a:rPr/a:effectLst effects. */
  textShadow?: string;
}

function getRunColorKind(rPr: SafeXmlNode | undefined): 'none' | 'defaultTextScheme' | 'explicit' {
  if (!rPr?.exists()) return 'none';
  if (rPr.child('gradFill').exists()) return 'explicit';
  const solidFill = rPr.child('solidFill');
  if (!solidFill.exists()) return 'none';
  const scheme = solidFill.child('schemeClr').attr('val');
  return scheme === 'tx1' || scheme === 'tx2' ? 'defaultTextScheme' : 'explicit';
}

function mergeRunProps(target: MergedRunStyle, rPr: SafeXmlNode, ctx: RenderContext): void {
  if (!rPr.exists()) return;

  const sz = rPr.numAttr('sz');
  if (sz !== undefined) target.fontSize = sz / 100; // hundredths of point -> pt

  const b = rPr.attr('b');
  if (b !== undefined) target.bold = parseOoxmlBool(b);

  const i = rPr.attr('i');
  if (i !== undefined) target.italic = parseOoxmlBool(i);

  const u = rPr.attr('u');
  if (u !== undefined && u !== 'none') target.underline = true;
  if (u === 'none') target.underline = false;

  const strike = rPr.attr('strike');
  if (strike !== undefined && strike !== 'noStrike') target.strikethrough = true;
  if (strike === 'noStrike') target.strikethrough = false;

  const highlight = rPr.child('highlight');
  if (highlight.exists()) {
    target.highlightColor = resolveColorToCss(highlight, ctx);
  }

  const uFill = rPr.child('uFill');
  if (uFill.exists()) {
    const uSolidFill = uFill.child('solidFill');
    if (uSolidFill.exists()) {
      target.underlineColor = resolveColorToCss(uSolidFill, ctx);
      target.underlineFollowsText = false;
    }
  }
  const uFillTx = rPr.child('uFillTx');
  if (uFillTx.exists()) {
    target.underlineFollowsText = true;
    target.underlineColor = undefined;
  }

  // Color from solidFill or gradFill child
  const solidFill = rPr.child('solidFill');
  if (solidFill.exists()) {
    delete target.textGradientCss;
    delete target.textPatternCss;
    delete target.textNoFill;
    const { color, alpha } = resolveColor(solidFill, ctx);
    const hex = color.startsWith('#') ? color : `#${color}`;
    if (alpha < 1) {
      const { r, g, b: bl } = hexToRgbInternal(hex);
      target.color = `rgba(${r},${g},${bl},${alpha.toFixed(3)})`;
    } else {
      target.color = hex;
    }
  }
  const gradFill = rPr.child('gradFill');
  if (gradFill.exists()) {
    delete target.color;
    delete target.textPatternCss;
    delete target.textNoFill;
    const css = resolveGradientForText(gradFill, ctx);
    if (css) target.textGradientCss = css;
  }
  const pattFill = rPr.child('pattFill');
  if (pattFill.exists()) {
    delete target.color;
    delete target.textGradientCss;
    delete target.textNoFill;
    const css = resolveFill(rPr, ctx);
    if (css) target.textPatternCss = css;
  }

  // Font family. Office often writes separate Latin/East Asian typefaces in the
  // same run; keep them as a CSS fallback stack so CJK glyphs use the EA face.
  const fontFamilyStack: string[] = [];
  const languageHints = [rPr.attr('lang'), rPr.attr('altLang')];
  for (const fontNodeName of ['latin', 'ea', 'cs'] as const) {
    const fontNode = rPr.child(fontNodeName);
    if (!fontNode.exists()) continue;
    const typeface = fontNode.attr('typeface');
    if (!typeface) continue;
    fontFamilyStack.push(resolveThemeFont(typeface, ctx, languageHints));
  }
  if (fontFamilyStack.length > 0) {
    target.fontFamily = fontFamilyStack[0];
    target.fontFamilyStack = fontFamilyStack;
  }

  // Hyperlink
  const hlinkClick = rPr.child('hlinkClick');
  if (hlinkClick.exists()) {
    // The actual target is in the slide rels, referenced by r:id.
    const rId = hlinkClick.attr('id') ?? hlinkClick.attr('r:id');
    const rel = rId ? ctx.slide.rels.get(rId) : undefined;
    const action = hlinkClick.attr('action');
    const slideIndex = resolveSlideNavigationIndex(ctx, action, rel);
    if (slideIndex !== undefined && ctx.onNavigate) {
      target.hlinkSlideIndex = slideIndex;
      target.hlinkTooltip = hlinkClick.attr('tooltip');
      if (target.underline === undefined) target.underline = true;
    } else if (rel && isExternalTargetMode(rel.targetMode) && isAllowedExternalUrl(rel.target)) {
      target.hlinkClick = rel.target;
      if (target.underline === undefined) target.underline = true;
    }
  }

  // Character spacing (compact/tracking): rPr@spc in hundredths of a point
  const spc = rPr.numAttr('spc');
  if (spc !== undefined) target.letterSpacingPt = spc / 100;

  // Kerning: rPr@kern = minimum font size (hundredths of pt) to apply kerning; 0 = always
  const kern = rPr.numAttr('kern');
  if (kern !== undefined) target.kern = kern / 100;

  // Text capitalization: cap="all" (ALL CAPS) or cap="small" (SMALL CAPS)
  const cap = rPr.attr('cap');
  if (cap !== undefined) target.cap = cap;

  // Baseline shift: positive = superscript, negative = subscript (in 1000ths of percent)
  const baseline = rPr.numAttr('baseline');
  if (baseline !== undefined) target.baseline = baseline;

  const effectLst = rPr.child('effectLst');
  const outerShdw = effectLst.child('outerShdw');
  if (outerShdw.exists()) {
    const textOuterShadow = resolveTextOuterShadow(outerShdw, ctx);
    if (textOuterShadow) appendTextShadow(target, textOuterShadow);
  }

  const glow = effectLst.child('glow');
  if (glow.exists()) {
    const textGlowShadow = resolveTextGlowShadow(glow, ctx);
    if (textGlowShadow) appendTextShadow(target, textGlowShadow);
  }

  // Text noFill: a:noFill on rPr makes text interior transparent
  if (rPr.child('noFill').exists()) {
    delete target.color;
    delete target.textGradientCss;
    delete target.textPatternCss;
    target.textNoFill = true;
  }

  // Text outline: a:ln on rPr defines text stroke/outline
  const ln = rPr.child('ln');
  if (ln.exists() && !ln.child('noFill').exists()) {
    const lnW = ln.numAttr('w');
    target.textOutlineWidth = lnW ? emuToPx(lnW) : 0.75; // default ~0.75px
    // Solid fill on outline
    const lnSolid = ln.child('solidFill');
    if (lnSolid.exists()) {
      const { color: c, alpha: a } = resolveColor(lnSolid, ctx);
      target.textOutlineColor = colorToCssLocal(c, a);
    }
    // Gradient fill on outline — build CSS gradient for mask effect
    const lnGrad = ln.child('gradFill');
    if (lnGrad.exists()) {
      target.textOutlineGradientCss = resolveGradientForText(lnGrad, ctx);
    }
  }
}

function mergeParagraphDefaultRunProps(
  target: MergedRunStyle,
  paragraphStyle: MergedParagraphStyle,
  ctx: RenderContext,
): void {
  for (const defRPr of paragraphStyle.defRPrs ?? []) {
    mergeRunProps(target, defRPr, ctx);
  }
}

function getParagraphDefaultRunStyle(
  paragraphStyle: MergedParagraphStyle,
  ctx: RenderContext,
): MergedRunStyle {
  const style: MergedRunStyle = {};
  mergeParagraphDefaultRunProps(style, paragraphStyle, ctx);
  return style;
}

/**
 * Minimal hex-to-rgb parser for inline use.
 */
function hexToRgbInternal(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace(/^#/, '');
  const num = parseInt(
    cleaned.length === 3
      ? cleaned[0] + cleaned[0] + cleaned[1] + cleaned[1] + cleaned[2] + cleaned[2]
      : cleaned,
    16,
  );
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff };
}

/**
 * Convert resolved color + alpha to CSS color string.
 */
function colorToCssLocal(color: string, alpha: number): string {
  const hex = color.startsWith('#') ? color : `#${color}`;
  if (alpha >= 1) return hex;
  const { r, g, b } = hexToRgbInternal(hex);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

function resolveTextGlowShadow(glow: SafeXmlNode, ctx: RenderContext): string | undefined {
  const radiusPx = emuToPx(glow.numAttr('rad') ?? 0);
  if (!(radiusPx > 0)) return undefined;

  const { color, alpha } = resolveColor(glow, ctx);
  if (!color || alpha <= 0) return undefined;

  return `0px 0px ${radiusPx.toFixed(1)}px ${colorToCssLocal(color, alpha)}`;
}

function resolveTextOuterShadow(outerShdw: SafeXmlNode, ctx: RenderContext): string | undefined {
  const distPx = emuToPx(outerShdw.numAttr('dist') ?? 0);
  const blurPx = emuToPx(outerShdw.numAttr('blurRad') ?? 0);
  const dirDeg = (outerShdw.numAttr('dir') ?? 0) / 60000;
  const offsetX = distPx * Math.cos((dirDeg * Math.PI) / 180);
  const offsetY = distPx * Math.sin((dirDeg * Math.PI) / 180);

  const { color, alpha } = resolveColor(outerShdw, ctx);
  if (!color || alpha <= 0) return undefined;

  return `${offsetX.toFixed(1)}px ${offsetY.toFixed(1)}px ${blurPx.toFixed(1)}px ${colorToCssLocal(color, alpha)}`;
}

function appendTextShadow(target: MergedRunStyle, shadow: string): void {
  target.textShadow = target.textShadow ? `${target.textShadow}, ${shadow}` : shadow;
}

function getResolvedRunColor(rPr: SafeXmlNode | undefined, ctx: RenderContext): string | undefined {
  if (!rPr?.exists()) return undefined;
  const style: MergedRunStyle = {};
  mergeRunProps(style, rPr, ctx);
  return style.color;
}

function normalizeCssColorForCompare(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const trimmed = color.trim().toLowerCase();
  if (trimmed.startsWith('#')) {
    const { r, g, b } = hexToRgbInternal(trimmed);
    return `${r},${g},${b},1`;
  }
  const match = trimmed.match(/^rgba?\(([^)]+)\)$/);
  if (!match) return trimmed;
  const parts = match[1].split(',').map((part) => part.trim());
  if (parts.length < 3) return trimmed;
  const [r, g, b] = parts;
  const alpha = parts[3] ?? '1';
  return `${Number(r)},${Number(g)},${Number(b)},${Number(alpha)}`;
}

function colorsEqualForCompare(a: string | undefined, b: string | undefined): boolean {
  const normalizedA = normalizeCssColorForCompare(a);
  const normalizedB = normalizeCssColorForCompare(b);
  return normalizedA !== undefined && normalizedA === normalizedB;
}

function hasSrgbSolidFill(rPr: SafeXmlNode | undefined): boolean {
  return rPr?.child('solidFill').child('srgbClr').exists() ?? false;
}

function runHasHyperlink(rPr: SafeXmlNode | undefined): boolean {
  return rPr?.child('hlinkClick').exists() ?? false;
}

function hasRenderableHyperlink(runStyle: MergedRunStyle): boolean {
  return Boolean(runStyle.hlinkClick) || runStyle.hlinkSlideIndex !== undefined;
}

function hasMatchingNonHyperlinkTextColor(
  run: TextRun,
  paragraph: TextParagraph,
  runColor: string | undefined,
  ctx: RenderContext,
): boolean {
  if (!runColor) return false;
  for (const otherRun of paragraph.runs) {
    if (otherRun === run || runHasHyperlink(otherRun.properties)) continue;
    const otherColor = getResolvedRunColor(otherRun.properties, ctx);
    if (colorsEqualForCompare(runColor, otherColor)) return true;
  }
  const endParaColor = getResolvedRunColor(paragraph.endParaRPr, ctx);
  return colorsEqualForCompare(runColor, endParaColor);
}

function shouldUseHyperlinkThemeColor(
  run: TextRun,
  paragraph: TextParagraph,
  runStyle: MergedRunStyle,
  runColorKind: ReturnType<typeof getRunColorKind>,
  hasExplicitRunColor: boolean,
  ctx: RenderContext,
): boolean {
  if (!hasRenderableHyperlink(runStyle)) return false;
  if (!hasExplicitRunColor || runColorKind === 'defaultTextScheme') return true;
  if (runColorKind !== 'explicit' || !hasSrgbSolidFill(run.properties)) return false;
  return hasMatchingNonHyperlinkTextColor(run, paragraph, runStyle.color, ctx);
}

/**
 * Resolve a gradient fill node into a CSS linear-gradient string.
 * Used for text outline gradient effects.
 */
function resolveGradientForText(gradFill: SafeXmlNode, ctx: RenderContext): string {
  const gsLst = gradFill.child('gsLst');
  const stops: { position: number; color: string }[] = [];
  for (const gs of gsLst.children('gs')) {
    const pos = gs.numAttr('pos') ?? 0;
    const posPercent = pctToDecimal(pos) * 100;
    const { color, alpha } = resolveColor(gs, ctx);
    stops.push({ position: posPercent, color: colorToCssLocal(color, alpha) });
  }
  if (stops.length === 0) return '';
  stops.sort((a, b) => a.position - b.position);
  const stopsStr = stops.map((s) => `${s.color} ${s.position.toFixed(1)}%`).join(', ');
  const lin = gradFill.child('lin');
  if (lin.exists()) {
    const angle = angleToDeg(lin.numAttr('ang') ?? 0);
    const cssAngle = (angle + 90) % 360;
    return `linear-gradient(${cssAngle.toFixed(1)}deg, ${stopsStr})`;
  }
  return `linear-gradient(180deg, ${stopsStr})`;
}

function applyClippedTextBackground(element: HTMLElement, css: string): void {
  element.style.background = css;
  // jsdom currently drops valid multi-layer background shorthand with
  // background-size. Preserve the generated pattern as longhand declarations too.
  if (!element.style.background && css.includes(' 0 0 / 8px 8px, ')) {
    const layers = css.split(' 0 0 / 8px 8px, ');
    const backgroundColor = layers[layers.length - 1]?.trim();
    const backgroundImages = layers.slice(0, -1).map((layer) => layer.trim());
    if (backgroundImages.length > 0) {
      element.style.backgroundImage = backgroundImages.join(', ');
      element.style.backgroundSize = backgroundImages.map(() => '8px 8px').join(', ');
    }
    if (backgroundColor) {
      element.style.backgroundColor = backgroundColor;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (element.style as any).webkitBackgroundClip = 'text';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (element.style as any).backgroundClip = 'text';
  element.style.color = 'transparent';
}

// ---------------------------------------------------------------------------
// Bullet Generation
// ---------------------------------------------------------------------------

function generateAutoNumber(type: string, num: number): string {
  switch (type) {
    case 'arabicPeriod':
      return `${num}.`;
    case 'arabicParenR':
      return `${num})`;
    case 'arabicParenBoth':
      return `(${num})`;
    case 'arabicPlain':
      return `${num}`;
    case 'romanUcPeriod':
      return `${toRoman(num)}.`;
    case 'romanLcPeriod':
      return `${toRoman(num).toLowerCase()}.`;
    case 'alphaUcPeriod':
      return `${String.fromCharCode(64 + (((num - 1) % 26) + 1))}.`;
    case 'alphaLcPeriod':
      return `${String.fromCharCode(96 + (((num - 1) % 26) + 1))}.`;
    case 'alphaUcParenR':
      return `${String.fromCharCode(64 + (((num - 1) % 26) + 1))})`;
    case 'alphaLcParenR':
      return `${String.fromCharCode(96 + (((num - 1) % 26) + 1))})`;
    default:
      return `${num}.`;
  }
}

function toRoman(num: number): string {
  const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const syms = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
  let result = '';
  let remaining = num;
  for (let i = 0; i < vals.length; i++) {
    while (remaining >= vals[i]) {
      result += syms[i];
      remaining -= vals[i];
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main Render Function
// ---------------------------------------------------------------------------

/**
 * Render a text body into the provided container element.
 *
 * Implements style inheritance:
 * 1. presentation.defaultTextStyle
 * 2. master.defaultTextStyle
 * 3. master.textStyles[category] (titleStyle / bodyStyle / otherStyle)
 * 4. master placeholder lstStyle
 * 5. layout placeholder lstStyle
 * 6. shape lstStyle
 * 7. paragraph pPr
 * 8. run rPr
 */
/** Optional overrides when rendering text (e.g. table cell style text properties from tcTxStyle). */
interface RenderTextBodyOptions {
  /** When set, used as text color when the run has no explicit color (e.g. table style tcTxStyle). */
  cellTextColor?: string;
  /** When set, applies bold from table style tcTxStyle (overrides inherited, yields to explicit run rPr). */
  cellTextBold?: boolean;
  /** When set, applies italic from table style tcTxStyle (overrides inherited, yields to explicit run rPr). */
  cellTextItalic?: boolean;
  /** When set, applies font family from table style tcTxStyle (overrides inherited, yields to explicit run rPr). */
  cellTextFontFamily?: string | string[];
  /** fontRef color from shape style (e.g. SmartArt). Overrides inherited styles but yields to explicit run rPr color. */
  fontRefColor?: string;
  /** True when the text container uses vertical writing mode. */
  isVerticalText?: boolean;
  /** Fallback CSS line-height when OOXML inheritance does not specify one. */
  defaultLineHeight?: string;
  /** Collapse paragraph spacing outside the first/last visible paragraph. */
  trimOuterParagraphSpacing?: boolean;
  /** Treat absolute line spacing as inter-line spacing for a single-line paragraph. */
  compactSingleLineSpacing?: boolean;
}

export function renderTextBody(
  textBody: TextBody,
  placeholder: PlaceholderInfo | undefined,
  ctx: RenderContext,
  container: HTMLElement,
  options?: RenderTextBodyOptions,
): void {
  const category = getPlaceholderCategory(placeholder);

  // Parse normAutofit from bodyPr (font scaling + line spacing reduction)
  let fontScale = 1;
  let lnSpcReduction = 0;
  const normAutofit = getEffectiveBodyPrChild(textBody, 'normAutofit');
  if (normAutofit?.exists()) {
    const fs = normAutofit.numAttr('fontScale');
    if (fs !== undefined) fontScale = fs / 100000; // 100000 = 100%
    const lsr = normAutofit.numAttr('lnSpcReduction');
    if (lsr !== undefined) lnSpcReduction = lsr / 100000; // e.g., 20000 = 20%
  }

  const bulletCounters = new Map<string, number>();
  const visibleParagraphIndexes = textBody.paragraphs
    .map((paragraph, index) => ({
      index,
      visible: paragraph.runs.some((run) => run.text != null && run.text.length > 0),
    }))
    .filter((item) => item.visible)
    .map((item) => item.index);
  const firstVisibleParagraphIndex = visibleParagraphIndexes[0];
  const lastVisibleParagraphIndex = visibleParagraphIndexes[visibleParagraphIndexes.length - 1];
  const singleVisibleParagraph =
    visibleParagraphIndexes.length === 1 ? visibleParagraphIndexes[0] : undefined;

  for (const [paragraphIndex, paragraph] of textBody.paragraphs.entries()) {
    const paraDiv = document.createElement('div');
    paraDiv.style.width = '100%';
    paraDiv.style.minWidth = '0px';
    paraDiv.style.maxWidth = '100%';
    paraDiv.style.boxSizing = 'border-box';
    paraDiv.style.overflowWrap = 'anywhere';
    const level = paragraph.level;
    if (options?.isVerticalText) {
      paraDiv.style.wordBreak = 'keep-all';
    }
    const hasLineBreaks = paragraph.runs.some((r) => r.text === '\n');
    const isSingleLineAutoFitParagraph =
      options?.compactSingleLineSpacing &&
      paragraphIndex === singleVisibleParagraph &&
      !hasLineBreaks;

    // ---- Build merged paragraph style (7-level inheritance) ----
    const merged: MergedParagraphStyle = {};

    // Level 1: presentation defaultTextStyle
    mergeParagraphProps(merged, findStyleAtLevel(ctx.presentation.defaultTextStyle, level));

    // Level 2: master defaultTextStyle
    mergeParagraphProps(merged, findStyleAtLevel(ctx.master.defaultTextStyle, level));

    // Level 3: master text styles by category
    const masterTextStyle =
      category === 'title'
        ? ctx.master.textStyles.titleStyle
        : category === 'body'
          ? ctx.master.textStyles.bodyStyle
          : ctx.master.textStyles.otherStyle;
    mergeParagraphProps(merged, findStyleAtLevel(masterTextStyle, level));

    // Level 4: master placeholder lstStyle
    if (placeholder) {
      const masterPh = findPlaceholderNode(ctx.master.placeholders, placeholder);
      if (masterPh) {
        const lstStyle = getPlaceholderLstStyle(masterPh);
        mergeParagraphProps(merged, findStyleAtLevel(lstStyle, level));
      }
    }

    // Level 5: layout placeholder lstStyle
    if (placeholder) {
      const layoutPh = findPlaceholderNode(
        ctx.layout.placeholders.map((e) => e.node),
        placeholder,
      );
      if (layoutPh) {
        const lstStyle = getPlaceholderLstStyle(layoutPh);
        mergeParagraphProps(merged, findStyleAtLevel(lstStyle, level));
      }
    }

    // Level 6: shape lstStyle
    mergeParagraphProps(merged, findStyleAtLevel(textBody.listStyle, level));

    // Level 7: paragraph pPr
    if (paragraph.properties) {
      mergeParagraphProps(merged, paragraph.properties);
    }

    // ---- Apply paragraph styles ----
    if (merged.align) {
      const alignMap: Record<string, string> = {
        l: 'left',
        ctr: 'center',
        r: 'right',
        just: 'justify',
        justLow: 'justify',
        dist: 'justify',
        thaiDist: 'justify',
      };
      paraDiv.style.textAlign = alignMap[merged.align] || 'left';
    }
    if (merged.rtl !== undefined) {
      paraDiv.style.direction = merged.rtl ? 'rtl' : 'ltr';
    }
    if (merged.marginLeft !== undefined) {
      paraDiv.style.paddingLeft = `${merged.marginLeft}px`;
    }
    if (merged.textIndent !== undefined) {
      paraDiv.style.textIndent = `${merged.textIndent}px`;
    }
    // Compute effective line-height (with optional lnSpcReduction from normAutofit)
    let effectiveLineHeight = merged.lineHeight ?? options?.defaultLineHeight;
    if (effectiveLineHeight) {
      if (lnSpcReduction > 0) {
        const parsed = parseFloat(effectiveLineHeight);
        if (!isNaN(parsed)) {
          if (effectiveLineHeight.includes('pt')) {
            effectiveLineHeight = `${(parsed * (1 - lnSpcReduction)).toFixed(2)}pt`;
          } else {
            effectiveLineHeight = `${(parsed * (1 - lnSpcReduction)).toFixed(3)}`;
          }
        }
      }
      if (options?.isVerticalText && !merged.lineHeightAbsolute) {
        effectiveLineHeight = '1';
      } else if (isSingleLineAutoFitParagraph && merged.lineHeightAbsolute) {
        effectiveLineHeight = 'normal';
      }
      paraDiv.style.lineHeight = effectiveLineHeight!;
    }
    // Determine effective font size for percentage-based spacing
    // Use defRPr or first run's font size, fallback to 12pt
    let effectiveFontSize = 12; // default 12pt
    const defaultRunStyle = getParagraphDefaultRunStyle(merged, ctx);
    if (defaultRunStyle.fontSize !== undefined) effectiveFontSize = defaultRunStyle.fontSize;
    if (paragraph.runs.length > 0 && paragraph.runs[0].properties) {
      const sz = paragraph.runs[0].properties.numAttr('sz');
      if (sz !== undefined) effectiveFontSize = sz / 100;
    } else if (paragraph.runs.length === 0 && paragraph.endParaRPr) {
      const sz = paragraph.endParaRPr.numAttr('sz');
      if (sz !== undefined) effectiveFontSize = sz / 100;
    }
    // Browser line boxes include a "strut" based on the block element's own font size.
    // Keep the paragraph block in sync with Office's effective run size so tiny
    // multi-paragraph labels do not inherit a 13px page font and overflow their boxes.
    paraDiv.style.fontSize = `${effectiveFontSize * fontScale}pt`;

    const trimSpaceBefore =
      options?.trimOuterParagraphSpacing && paragraphIndex === firstVisibleParagraphIndex;
    const trimSpaceAfter =
      options?.trimOuterParagraphSpacing && paragraphIndex === lastVisibleParagraphIndex;

    if (trimSpaceBefore) {
      paraDiv.style.marginTop = '0px';
    } else if (merged.spaceBefore !== undefined) {
      paraDiv.style.marginTop = `${merged.spaceBefore}pt`;
    } else if (merged.spaceBeforePct !== undefined) {
      paraDiv.style.marginTop = `${merged.spaceBeforePct * effectiveFontSize}pt`;
    }
    if (trimSpaceAfter) {
      paraDiv.style.marginBottom = '0px';
    } else if (merged.spaceAfter !== undefined) {
      paraDiv.style.marginBottom = `${merged.spaceAfter}pt`;
    } else if (merged.spaceAfterPct !== undefined) {
      paraDiv.style.marginBottom = `${merged.spaceAfterPct * effectiveFontSize}pt`;
    }

    // ---- Bullets ----
    // Suppress bullets for metadata placeholders (slide number, date, footer)
    // Also suppress for empty paragraphs (no visible runs) — PowerPoint never shows bullets for them
    const hasVisibleRuns = paragraph.runs.some((r) => r.text != null && r.text.length > 0);
    const suppressBullet =
      !hasVisibleRuns ||
      placeholder?.type === 'sldNum' ||
      placeholder?.type === 'dt' ||
      placeholder?.type === 'ftr' ||
      placeholder?.type === 'title' ||
      placeholder?.type === 'ctrTitle' ||
      placeholder?.type === 'subTitle';
    let bulletPrefix = '';
    if (!suppressBullet && merged.bulletNone !== true) {
      if (merged.bulletChar) {
        bulletPrefix = merged.bulletChar;
      } else if (merged.bulletAutoNum) {
        const counterKey = `${level}:${merged.bulletAutoNum}`;
        const num = merged.bulletAutoNumStartAt ?? bulletCounters.get(counterKey) ?? 1;
        bulletPrefix = generateAutoNumber(merged.bulletAutoNum, num);
        bulletCounters.set(counterKey, num + 1);
      }
    }

    if (bulletPrefix) {
      const bulletSpan = document.createElement('span');
      bulletSpan.textContent = bulletPrefix + ' ';
      const marginLeft = merged.marginLeft;
      const textIndent = merged.textIndent;
      const useHangingBulletGutter =
        marginLeft !== undefined && marginLeft > 0 && textIndent !== undefined && textIndent < 0;
      if (useHangingBulletGutter) {
        const markerLeft = Math.max(0, marginLeft + textIndent);
        const markerWidth = Math.max(0, marginLeft - markerLeft);
        paraDiv.style.textIndent = '0px';
        if (merged.align === 'ctr' || merged.align === 'r') {
          paraDiv.style.paddingLeft = '0px';
          bulletSpan.style.display = 'inline-block';
          bulletSpan.style.width = `${markerWidth}px`;
          bulletSpan.style.whiteSpace = 'pre';
        } else {
          paraDiv.style.position = 'relative';
          bulletSpan.style.position = 'absolute';
          bulletSpan.style.left = `${markerLeft}px`;
          bulletSpan.style.top = '0px';
          bulletSpan.style.width = `${markerWidth}px`;
          bulletSpan.style.whiteSpace = 'pre';
        }
      }
      if (merged.bulletFont) {
        bulletSpan.style.fontFamily = cssFontFamilyStack(resolveThemeFont(merged.bulletFont, ctx));
      }
      const bulletFontSize = merged.bulletSizePt ?? effectiveFontSize * (merged.bulletSizePct ?? 1);
      bulletSpan.style.fontSize = `${bulletFontSize * fontScale}pt`;
      // Bullet color: explicit buClr > first visible run text color > inherited defaults > fallback.
      let bulletColor: string | undefined;
      const firstVisibleRunTextColor = (): string | undefined => {
        const firstVisibleRun = paragraph.runs.find(
          (run) => run.text != null && run.text.length > 0,
        );
        if (!firstVisibleRun) return undefined;
        const runStyle = getParagraphDefaultRunStyle(merged, ctx);
        if (firstVisibleRun.properties) {
          mergeRunProps(runStyle, firstVisibleRun.properties, ctx);
        }
        return (
          runStyle.color ??
          options?.fontRefColor ??
          options?.cellTextColor ??
          (runStyle.textNoFill ? 'transparent' : undefined)
        );
      };
      if (merged.bulletColorNode && merged.bulletColorNode.exists()) {
        bulletColor = resolveColorToCss(merged.bulletColorNode, ctx);
      }
      if (bulletColor === undefined) {
        bulletColor = firstVisibleRunTextColor();
      }
      // Fallback: check shape's lstStyle defRPr for color (same as run fallback)
      if (bulletColor === undefined && textBody.listStyle) {
        const lstStyleLevel = findStyleAtLevel(textBody.listStyle, level);
        if (lstStyleLevel.exists()) {
          const lstDefRPr = lstStyleLevel.child('defRPr');
          if (lstDefRPr.exists()) {
            const fallbackStyle: MergedRunStyle = {};
            mergeRunProps(fallbackStyle, lstDefRPr, ctx);
            if (fallbackStyle.color !== undefined) {
              bulletColor = fallbackStyle.color;
            }
          }
        }
      }
      bulletSpan.style.color =
        bulletColor ?? options?.fontRefColor ?? options?.cellTextColor ?? '#000000';
      paraDiv.appendChild(bulletSpan);
    }

    // ---- Render runs ----
    const compactNumericRunGroups = findCompactNumericRunGroups(paragraph.runs);
    const compactNumericGroupElements = new Map<number, HTMLElement>();
    if (!hasVisibleRuns) {
      // Empty paragraph — still need to maintain spacing
      paraDiv.appendChild(document.createElement('br'));
    }

    // When line spacing is absolute (spcPts) and paragraph has line breaks,
    // wrap each line in a block-level div with explicit height. This ensures
    // exact spacing regardless of font metrics (CJK fonts e.g. Microsoft YaHei have
    // content areas taller than font-size, causing CSS line-height to be
    // overridden by the font's natural spacing).
    // Set tab-size when paragraph contains tab characters (default OOXML tab spacing = 914400 EMU = 96px)
    if (paragraph.runs.some((r) => r.text?.includes('\t'))) {
      const defaultTabPx = merged.defaultTabSize ?? 96; // 914400 EMU at 96 dpi
      paraDiv.style.tabSize = `${defaultTabPx}px`;
    }
    const useLineWrappers = merged.lineHeightAbsolute && hasLineBreaks && effectiveLineHeight;
    let currentLineDiv: HTMLElement | null = null;
    if (useLineWrappers) {
      currentLineDiv = document.createElement('div');
      currentLineDiv.style.height = effectiveLineHeight!;
      currentLineDiv.style.overflow = 'visible';
      paraDiv.appendChild(currentLineDiv);
    }

    for (const [runIndex, sourceRun] of paragraph.runs.entries()) {
      const run =
        sourceRun.fieldType?.toLowerCase() === 'slidenum'
          ? { ...sourceRun, text: String(ctx.slide.index + 1) }
          : sourceRun;
      if (run.text === '\n') {
        if (useLineWrappers) {
          // Close current line div and start a new one
          currentLineDiv = document.createElement('div');
          currentLineDiv.style.height = effectiveLineHeight!;
          currentLineDiv.style.overflow = 'visible';
          paraDiv.appendChild(currentLineDiv);
        } else {
          paraDiv.appendChild(document.createElement('br'));
        }
        continue;
      }

      // Build merged run style
      const runStyle: MergedRunStyle = {};

      // Apply default run properties from merged paragraph defRPr
      mergeParagraphDefaultRunProps(runStyle, merged, ctx);

      // Level 8: run rPr
      if (run.properties) {
        mergeRunProps(runStyle, run.properties, ctx);
      }

      // Fallback: if no color resolved yet, check the shape's lstStyle defRPr.
      // This handles the case where paragraph pPr has an empty <a:defRPr/> that
      // overwrites the lstStyle's defRPr (which may carry solidFill color).
      if (runStyle.color === undefined && textBody.listStyle) {
        const lstStyleLevel = findStyleAtLevel(textBody.listStyle, level);
        if (lstStyleLevel.exists()) {
          const lstDefRPr = lstStyleLevel.child('defRPr');
          if (lstDefRPr.exists()) {
            const fallbackStyle: MergedRunStyle = {};
            mergeRunProps(fallbackStyle, lstDefRPr, ctx);
            if (fallbackStyle.color !== undefined) {
              runStyle.color = fallbackStyle.color;
            }
          }
        }
      }

      // Determine if this should be a link
      let element: HTMLElement;
      if (runStyle.hlinkSlideIndex !== undefined) {
        const span = document.createElement('span');
        const slideIndex = runStyle.hlinkSlideIndex;
        span.setAttribute('role', 'link');
        span.tabIndex = 0;
        span.title = runStyle.hlinkTooltip || slideJumpTitle(slideIndex);
        span.style.cursor = 'pointer';
        span.addEventListener('click', (e) => {
          e.stopPropagation();
          ctx.onNavigate?.({ slideIndex });
        });
        span.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          e.stopPropagation();
          ctx.onNavigate?.({ slideIndex });
        });
        element = span;
      } else if (runStyle.hlinkClick) {
        const a = document.createElement('a');
        a.href = runStyle.hlinkClick;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        element = a;
      } else {
        element = document.createElement('span');
      }

      // Preserve consecutive spaces by alternating with &nbsp; so they survive
      // HTML whitespace collapse without being stretched by text-align:justify.
      // Tabs still need white-space:pre for tab-stop rendering.
      const compactNumericToken = compactNumericTokenText(run.text);
      const usesElementLevelTextPaint =
        !!runStyle.textGradientCss ||
        !!runStyle.textPatternCss ||
        !!runStyle.textNoFill ||
        runStyle.textOutlineWidth !== undefined ||
        !!runStyle.textOutlineColor ||
        !!runStyle.textOutlineGradientCss;
      const shouldSplitCompactNumericToken =
        !!run.text &&
        !!compactNumericToken &&
        run.text !== compactNumericToken &&
        !usesElementLevelTextPaint;
      if (run.text && run.text.includes('\t')) {
        element.textContent = run.text;
        element.style.whiteSpace = 'pre';
      } else if (shouldSplitCompactNumericToken) {
        const tokenStart = run.text.indexOf(compactNumericToken);
        const tokenEnd = tokenStart + compactNumericToken.length;
        appendWhitespacePreservingText(element, run.text.slice(0, tokenStart));
        const tokenSpan = document.createElement('span');
        tokenSpan.textContent = compactNumericToken;
        tokenSpan.style.whiteSpace = 'nowrap';
        element.appendChild(tokenSpan);
        appendWhitespacePreservingText(element, run.text.slice(tokenEnd));
      } else if (run.text && / {2}/.test(run.text)) {
        // Replace pairs of spaces with " &nbsp;" so browsers cannot collapse them,
        // while normal spaces between words remain stretchable for justify.
        const escaped = run.text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/ {2}/g, ' \u00a0');
        element.innerHTML = escaped;
      } else {
        element.textContent = run.text;
      }
      if (
        compactNumericToken &&
        (run.text === compactNumericToken ||
          (!!run.text && run.text !== compactNumericToken && usesElementLevelTextPaint))
      ) {
        // Office keeps compact number/unit tokens together, e.g. "80%" or "15 %".
        element.style.whiteSpace = 'nowrap';
      }

      // Apply run styles (with normAutofit fontScale)
      // Default to 12pt if no font size specified at any inheritance level
      const fontSize = runStyle.fontSize || 12;
      element.style.fontSize = `${fontSize * fontScale}pt`;
      // Bold: explicit run rPr > cellTextBold (table style tcTxStyle) > inherited styles
      const hasExplicitRunBold = run.properties?.attr('b') !== undefined;
      if (hasExplicitRunBold ? runStyle.bold : (options?.cellTextBold ?? runStyle.bold)) {
        element.style.fontWeight = 'bold';
      }
      // Italic: explicit run rPr > cellTextItalic (table style tcTxStyle) > inherited styles
      const hasExplicitRunItalic = run.properties?.attr('i') !== undefined;
      if (hasExplicitRunItalic ? runStyle.italic : (options?.cellTextItalic ?? runStyle.italic)) {
        element.style.fontStyle = 'italic';
      }

      const decorations: string[] = [];
      if (runStyle.underline) decorations.push('underline');
      if (runStyle.strikethrough) decorations.push('line-through');
      if (decorations.length > 0) {
        element.style.textDecoration = decorations.join(' ');
      }
      if (runStyle.highlightColor) {
        element.style.backgroundColor = runStyle.highlightColor;
      }

      // Color priority: explicit run rPr > hlink theme color > cellTextColor (table style tcTxStyle) > fontRef (shape style) > inherited styles > black default
      // cellTextColor from table style overrides inherited cascade colors but yields to explicit run/paragraph solidFill/gradFill.
      // fontRefColor overrides inherited styles but yields to explicit run solidFill/gradFill.
      const runColorKind = getRunColorKind(run.properties);
      const hasExplicitRunColor = runColorKind !== 'none';
      let effectiveColor: string | undefined;
      if (options?.fontRefColor) {
        effectiveColor = hasExplicitRunColor ? runStyle.color : options.fontRefColor;
      } else if (options?.cellTextColor && !hasExplicitRunColor) {
        effectiveColor = options.cellTextColor;
      } else {
        effectiveColor = runStyle.color;
      }

      // Hyperlink default color: Office often writes default text fills on hyperlink
      // runs (tx1/tx2, or the same srgb color as surrounding text) but displays
      // those runs with the theme hlink color.
      if (
        shouldUseHyperlinkThemeColor(
          run,
          paragraph,
          runStyle,
          runColorKind,
          hasExplicitRunColor,
          ctx,
        )
      ) {
        const hlinkHex = ctx.theme.colorScheme.get('hlink');
        if (hlinkHex) {
          effectiveColor = hlinkHex.startsWith('#') ? hlinkHex : `#${hlinkHex}`;
        }
      }

      if (effectiveColor) {
        element.style.color = effectiveColor;
      } else {
        // No explicit color from run/paragraph/style: use black so text does not inherit page CSS (e.g. body { color: #e0e0e0 })
        element.style.color = '#000000';
      }
      if (runStyle.underlineFollowsText && effectiveColor) {
        element.style.textDecorationColor = effectiveColor;
      }
      if (runStyle.underlineColor) {
        element.style.textDecorationColor = runStyle.underlineColor;
      }
      if (runStyle.textShadow) {
        element.style.textShadow = runStyle.textShadow;
      }

      // Gradient text fill: use background-clip to paint text with gradient
      if (runStyle.textGradientCss) {
        applyClippedTextBackground(element, runStyle.textGradientCss);
      }
      if (runStyle.textPatternCss) {
        applyClippedTextBackground(element, runStyle.textPatternCss);
      }

      // Text outline (a:ln on rPr) and noFill handling
      if (runStyle.textNoFill || runStyle.textOutlineWidth) {
        const strokeW = runStyle.textOutlineWidth ?? 0.75;
        if (runStyle.textNoFill && runStyle.textOutlineGradientCss) {
          // Ghost text: no fill + gradient outline → show outline fading via mask
          const outlineColor = '#ffffff'; // base stroke color (gradient applied via mask)
          element.style.color = 'transparent';
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (element.style as any).webkitTextStrokeWidth = `${strokeW}px`;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (element.style as any).webkitTextStrokeColor = outlineColor;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (element.style as any).paintOrder = 'stroke fill';
          // Use mask-image to apply the gradient fade to the entire text element
          const maskGrad = runStyle.textOutlineGradientCss;
          element.style.maskImage = maskGrad;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (element.style as any).webkitMaskImage = maskGrad;
        } else if (runStyle.textNoFill && runStyle.textOutlineColor) {
          // Ghost text with solid outline
          element.style.color = 'transparent';
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (element.style as any).webkitTextStrokeWidth = `${strokeW}px`;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (element.style as any).webkitTextStrokeColor = runStyle.textOutlineColor;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (element.style as any).paintOrder = 'stroke fill';
        } else if (runStyle.textNoFill) {
          // noFill with no outline — invisible text (but keep space)
          element.style.color = 'transparent';
        } else if (runStyle.textOutlineColor) {
          // Outline with normal fill
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (element.style as any).webkitTextStrokeWidth = `${strokeW}px`;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (element.style as any).webkitTextStrokeColor = runStyle.textOutlineColor;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (element.style as any).paintOrder = 'stroke fill';
        }
      }

      // Font family: explicit run rPr > cellTextFontFamily (table style) > inherited > theme fallback
      const hasExplicitRunFont =
        run.properties?.child('latin').exists() ||
        run.properties?.child('ea').exists() ||
        run.properties?.child('cs').exists();
      const effectiveFont = hasExplicitRunFont
        ? (runStyle.fontFamilyStack ?? runStyle.fontFamily)
        : (options?.cellTextFontFamily ?? runStyle.fontFamilyStack ?? runStyle.fontFamily);
      if (effectiveFont) {
        const resolvedFont = Array.isArray(effectiveFont)
          ? effectiveFont.map((font) => resolveThemeFont(font, ctx))
          : resolveThemeFont(effectiveFont, ctx);
        element.style.fontFamily = cssFontFamilyStack(resolvedFont);
      } else {
        // Fallback to theme minor font
        const fallback = ctx.theme.minorFont.latin || ctx.theme.minorFont.ea;
        if (fallback) {
          element.style.fontFamily = cssFontFamilyStack(fallback);
        }
      }

      // Character spacing (a:spc) — compact/tracking in points
      if (runStyle.letterSpacingPt !== undefined) {
        element.style.letterSpacing = `${runStyle.letterSpacingPt}pt`;
      }
      // Kerning (a:kern): val = min font size (pt) to kern; 0 = always kern
      if (runStyle.kern !== undefined) {
        const effectivePt = (runStyle.fontSize || 12) * fontScale;
        element.style.fontKerning = effectivePt >= runStyle.kern ? 'normal' : 'none';
      }

      // Text capitalization (a:rPr@cap)
      if (runStyle.cap === 'all') {
        element.style.textTransform = 'uppercase';
      } else if (runStyle.cap === 'small') {
        element.style.fontVariant = 'small-caps';
      }

      // Baseline shift (superscript/subscript)
      if (runStyle.baseline !== undefined && runStyle.baseline !== 0) {
        // OOXML baseline is in 1000ths of percent; positive = superscript, negative = subscript
        const shiftPct = runStyle.baseline / 1000;
        element.style.verticalAlign = `${shiftPct}%`;
        // Reduce font size for super/subscript
        if (Math.abs(shiftPct) >= 20) {
          element.style.fontSize = `${fontSize * fontScale * 0.65}pt`;
        }
      }

      // Append to the current line wrapper (when using absolute line spacing)
      // or directly to the paragraph div
      const appendTarget = currentLineDiv ?? paraDiv;
      const compactGroupId = compactNumericRunGroups.get(runIndex);
      if (compactGroupId !== undefined) {
        let group = compactNumericGroupElements.get(compactGroupId);
        if (!group) {
          group = document.createElement('span');
          group.style.whiteSpace = 'nowrap';
          compactNumericGroupElements.set(compactGroupId, group);
          appendTarget.appendChild(group);
        }
        group.appendChild(element);
      } else {
        appendTarget.appendChild(element);
      }
    }

    // endParaRPr: when the paragraph ends with a line break (trailing \n),
    // the end-of-paragraph mark (endParaRPr) defines the font size for the
    // trailing blank line. Without this, bottom-anchored text boxes render
    // content too low because the trailing space is too small.
    if (paragraph.endParaRPr) {
      const lastRun = paragraph.runs[paragraph.runs.length - 1];
      if (lastRun?.text === '\n') {
        const epSz = paragraph.endParaRPr.numAttr('sz');
        if (epSz !== undefined) {
          const spacer = document.createElement('span');
          spacer.textContent = '\u200B'; // zero-width space to maintain line height
          spacer.style.fontSize = `${(epSz / 100) * fontScale}pt`;
          const target = currentLineDiv ?? paraDiv;
          target.appendChild(spacer);
        }
      }
    }

    container.appendChild(paraDiv);
  }
}
