import { describe, it, expect } from 'vitest';
import { parseBaseProps } from '../../../../src/model/nodes/BaseNode';
import { parseXml } from '../../../../src/parser/XmlParser';

function base(xml: string) {
  return parseBaseProps(parseXml(xml));
}

describe('parseBaseProps', () => {
  it('parses id and name from nvSpPr > cNvPr', () => {
    const props = base(`
      <sp>
        <nvSpPr><cNvPr id="42" name="MyShape"/><nvPr/></nvSpPr>
        <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
      </sp>
    `);
    expect(props.id).toBe('42');
    expect(props.name).toBe('MyShape');
  });

  it('parses position and size from spPr > xfrm', () => {
    const props = base(`
      <sp>
        <nvSpPr><cNvPr id="1" name="R"/><nvPr/></nvSpPr>
        <spPr><xfrm><off x="914400" y="457200"/><ext cx="1828800" cy="914400"/></xfrm></spPr>
      </sp>
    `);
    expect(props.position.x).toBeCloseTo(96, 0);
    expect(props.position.y).toBeCloseTo(48, 0);
    expect(props.size.w).toBeCloseTo(192, 0);
    expect(props.size.h).toBeCloseTo(96, 0);
  });

  it('parses rotation from xfrm rot attribute', () => {
    const props = base(`
      <sp>
        <nvSpPr><cNvPr id="1" name="R"/><nvPr/></nvSpPr>
        <spPr><xfrm rot="5400000"><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
      </sp>
    `);
    expect(props.rotation).toBeCloseTo(90, 0);
  });

  it('parses flipH and flipV', () => {
    const props = base(`
      <sp>
        <nvSpPr><cNvPr id="1" name="R"/><nvPr/></nvSpPr>
        <spPr><xfrm flipH="1" flipV="true"><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
      </sp>
    `);
    expect(props.flipH).toBe(true);
    expect(props.flipV).toBe(true);
  });

  it('defaults flipH and flipV to false', () => {
    const props = base(`
      <sp>
        <nvSpPr><cNvPr id="1" name="R"/><nvPr/></nvSpPr>
        <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
      </sp>
    `);
    expect(props.flipH).toBe(false);
    expect(props.flipV).toBe(false);
  });

  it('parses placeholder info from nvPr > ph', () => {
    const props = base(`
      <sp>
        <nvSpPr><cNvPr id="1" name="T"/><nvPr><ph type="title" idx="0"/></nvPr></nvSpPr>
        <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
      </sp>
    `);
    expect(props.placeholder).toBeDefined();
    expect(props.placeholder!.type).toBe('title');
    expect(props.placeholder!.idx).toBe(0);
  });

  it('returns undefined placeholder when no ph element', () => {
    const props = base(`
      <sp>
        <nvSpPr><cNvPr id="1" name="T"/><nvPr/></nvSpPr>
        <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
      </sp>
    `);
    expect(props.placeholder).toBeUndefined();
  });

  it('parses hlinkClick action from cNvPr', () => {
    const props = base(`
      <sp xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <nvSpPr>
          <cNvPr id="1" name="T">
            <hlinkClick r:id="rId5" action="ppaction://hlinksldjump" tooltip="Go to slide 3"/>
          </cNvPr>
          <nvPr/>
        </nvSpPr>
        <spPr><xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm></spPr>
      </sp>
    `);
    expect(props.hlinkClick).toBeDefined();
    expect(props.hlinkClick!.action).toBe('ppaction://hlinksldjump');
    expect(props.hlinkClick!.rId).toBe('rId5');
    expect(props.hlinkClick!.tooltip).toBe('Go to slide 3');
  });

  it('finds xfrm from grpSpPr for groups', () => {
    const props = base(`
      <grpSp>
        <nvGrpSpPr><cNvPr id="5" name="Group"/><nvPr/></nvGrpSpPr>
        <grpSpPr>
          <xfrm><off x="914400" y="0"/><ext cx="914400" cy="914400"/></xfrm>
        </grpSpPr>
      </grpSp>
    `);
    expect(props.position.x).toBeCloseTo(96, 0);
    expect(props.size.w).toBeCloseTo(96, 0);
  });

  it('finds xfrm directly on graphic frame', () => {
    const props = base(`
      <graphicFrame>
        <nvGraphicFramePr><cNvPr id="6" name="Table"/><nvPr/></nvGraphicFramePr>
        <xfrm><off x="457200" y="457200"/><ext cx="4572000" cy="2743200"/></xfrm>
      </graphicFrame>
    `);
    expect(props.position.x).toBeCloseTo(48, 0);
    expect(props.size.w).toBeCloseTo(480, 0);
  });

  it('falls back to empty node when no xfrm found', () => {
    const props = base(`
      <sp>
        <nvSpPr><cNvPr id="1" name="NoXfrm"/><nvPr/></nvSpPr>
        <spPr/>
      </sp>
    `);
    expect(props.position.x).toBe(0);
    expect(props.position.y).toBe(0);
    expect(props.size.w).toBe(0);
    expect(props.size.h).toBe(0);
  });

  it('finds nvProps from nvPicPr for pictures', () => {
    const props = base(`
      <pic>
        <nvPicPr><cNvPr id="10" name="Picture 1"/><nvPr/></nvPicPr>
        <spPr><xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm></spPr>
      </pic>
    `);
    expect(props.id).toBe('10');
    expect(props.name).toBe('Picture 1');
  });

  it('finds nvProps from nvCxnSpPr for connectors', () => {
    const props = base(`
      <cxnSp>
        <nvCxnSpPr><cNvPr id="20" name="Connector"/><nvPr/></nvCxnSpPr>
        <spPr><xfrm><off x="0" y="0"/><ext cx="914400" cy="0"/></xfrm></spPr>
      </cxnSp>
    `);
    expect(props.id).toBe('20');
    expect(props.name).toBe('Connector');
  });
});
