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
