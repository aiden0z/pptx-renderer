import { describe, expect, it } from 'vitest';
import { parseGroupNode } from '../../../../src/model/nodes/GroupNode';
import { parseXml } from '../../../../src/parser/XmlParser';

function makeGroupXml(opts: {
  childCount?: number;
  noChOff?: boolean;
  noChExt?: boolean;
} = {}) {
  const childCount = opts.childCount ?? 2;
  const children = Array.from({ length: childCount }, (_, i) => `
    <sp>
      <nvSpPr><cNvPr id="${i + 100}" name="child-${i}"/><nvPr/></nvSpPr>
      <spPr>
        <xfrm><off x="${i * 457200}" y="0"/><ext cx="457200" cy="457200"/></xfrm>
        <prstGeom prst="rect"><avLst/></prstGeom>
      </spPr>
    </sp>
  `).join('');

  const chOff = opts.noChOff ? '' : '<chOff x="0" y="0"/>';
  const chExt = opts.noChExt ? '' : '<chExt cx="1828800" cy="914400"/>';

  return parseXml(`
    <grpSp xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <nvGrpSpPr>
        <cNvPr id="20" name="Group 1"/>
        <nvPr/>
      </nvGrpSpPr>
      <grpSpPr>
        <xfrm>
          <off x="914400" y="914400"/>
          <ext cx="1828800" cy="914400"/>
          ${chOff}${chExt}
        </xfrm>
      </grpSpPr>
      ${children}
    </grpSp>
  `);
}

describe('parseGroupNode', () => {
  it('parses basic group', () => {
    const node = parseGroupNode(makeGroupXml());
    expect(node.nodeType).toBe('group');
    expect(node.id).toBe('20');
    expect(node.name).toBe('Group 1');
  });

  it('collects child shape nodes', () => {
    const node = parseGroupNode(makeGroupXml({ childCount: 3 }));
    expect(node.children).toHaveLength(3);
    expect(node.children[0].localName).toBe('sp');
  });

  it('parses child offset and extent', () => {
    const node = parseGroupNode(makeGroupXml());
    expect(node.childOffset.x).toBe(0);
    expect(node.childOffset.y).toBe(0);
    expect(node.childExtent.w).toBeGreaterThan(0);
    expect(node.childExtent.h).toBeGreaterThan(0);
  });

  it('uses group size as childExtent fallback when chExt missing', () => {
    const node = parseGroupNode(makeGroupXml({ noChExt: true }));
    // Falls back to base.size
    expect(node.childExtent.w).toBe(node.size.w);
    expect(node.childExtent.h).toBe(node.size.h);
  });

  it('uses 0,0 as childOffset fallback when chOff missing', () => {
    const node = parseGroupNode(makeGroupXml({ noChOff: true }));
    expect(node.childOffset.x).toBe(0);
    expect(node.childOffset.y).toBe(0);
  });

  it('ignores non-shape children (e.g. grpSpPr)', () => {
    // grpSpPr is NOT a shape child, should not be in children[]
    const node = parseGroupNode(makeGroupXml({ childCount: 0 }));
    expect(node.children).toHaveLength(0);
  });
});
