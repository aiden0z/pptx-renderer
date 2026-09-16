import { SafeXmlNode } from '../parser/XmlParser';
import type { PlaceholderInfo } from './nodes/BaseNode';

export const UNLINKED_PLACEHOLDER_IDX = 0xffffffff;

const PLACEHOLDER_WRAPPERS = [
  'nvSpPr',
  'nvPicPr',
  'nvGrpSpPr',
  'nvGraphicFramePr',
  'nvCxnSpPr',
] as const;

export function getPlaceholderInfo(node: SafeXmlNode): PlaceholderInfo {
  for (const wrapper of PLACEHOLDER_WRAPPERS) {
    const ph = node.child(wrapper).child('nvPr').child('ph');
    if (!ph.exists()) continue;

    const idx = ph.numAttr('idx');
    return {
      type: ph.attr('type'),
      idx: idx !== undefined && Number.isFinite(idx) ? idx : undefined,
    };
  }
  return {};
}

export function findMatchingLayoutPlaceholder<T>(
  placeholders: readonly T[],
  target: PlaceholderInfo,
  getInfo: (placeholder: T) => PlaceholderInfo,
): T | undefined {
  if (target.idx !== undefined && target.idx !== UNLINKED_PLACEHOLDER_IDX) {
    return placeholders.find((placeholder) => (getInfo(placeholder).idx ?? 0) === target.idx);
  }

  const targetType = target.type ?? 'obj';
  return placeholders.find((placeholder) => (getInfo(placeholder).type ?? 'obj') === targetType);
}

export function findMatchingMasterPlaceholder<T>(
  placeholders: readonly T[],
  layoutType: string | undefined,
  getInfo: (placeholder: T) => PlaceholderInfo,
): T | undefined {
  const targetType = masterPlaceholderType(layoutType);
  return placeholders.find((placeholder) => (getInfo(placeholder).type ?? 'obj') === targetType);
}

/**
 * Layout placeholder categories that inherit from the master's body/title placeholder.
 * Master inheritance uses this type mapping, not the layout/slide idx namespace.
 * Reference: https://python-pptx.readthedocs.io/en/develop/dev/analysis/placeholders/layout-placeholders.html
 */
export function masterPlaceholderType(type: string | undefined): string {
  const effectiveType = type ?? 'obj';
  if (effectiveType === 'ctrTitle') return 'title';
  if (
    ['obj', 'subTitle', 'pic', 'chart', 'clipArt', 'dgm', 'media', 'tbl'].includes(effectiveType)
  ) {
    return 'body';
  }
  return effectiveType;
}
