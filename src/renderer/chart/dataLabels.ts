import { SafeXmlNode } from '../../parser/XmlParser';
import { emuToPx } from '../../parser/units';
import { RenderContext } from '../RenderContext';
import { parseOoxmlBoolElement } from './ooxml';
import { resolveColorToHex } from './style';
import { extractTxPrColor, extractTxPrStyle } from './text';
import type { DataLabelConfig, DataLabelManualLayout } from './types';

function parseDlblBool(dLbls: SafeXmlNode, childName: string): boolean {
  return parseOoxmlBoolElement(dLbls.child(childName));
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

export function parseDataLabels(
  node: SafeXmlNode,
  ctx: RenderContext,
): DataLabelConfig | undefined {
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

export function parsePointDataLabelOverrides(
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
    const deleted = parseDlblBoolOptional(dLbl, 'delete');
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
    if (deleted === true) {
      cfg.deleted = true;
      cfg.showVal = false;
      cfg.showCatName = false;
      cfg.showSerName = false;
      cfg.showPercent = false;
    }
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
