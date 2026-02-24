import { describe, expect, it } from 'vitest';
import { parseLayout } from '../../../src/model/Layout';
import { parseXml } from '../../../src/parser/XmlParser';

function makeLayoutXml(opts: {
  bg?: string;
  shapes?: string;
  clrMapOvr?: string;
  showMasterSp?: string;
} = {}) {
  const bgXml = opts.bg ? `<bg>${opts.bg}</bg>` : '';
  const shapesXml = opts.shapes ?? '';
  const clrMapOvr = opts.clrMapOvr ?? '';
  const showAttr = opts.showMasterSp !== undefined ? ` showMasterSp="${opts.showMasterSp}"` : '';
  return parseXml(`
    <sldLayout${showAttr}>
      ${clrMapOvr}
      <cSld>
        ${bgXml}
        <spTree>${shapesXml}</spTree>
      </cSld>
    </sldLayout>
  `);
}

describe('parseLayout', () => {
  it('parses empty layout', () => {
    const layout = parseLayout(makeLayoutXml());
    expect(layout.placeholders).toHaveLength(0);
    expect(layout.background).toBeUndefined();
    expect(layout.colorMapOverride).toBeUndefined();
    expect(layout.showMasterSp).toBe(true);
    expect(layout.rels.size).toBe(0);
    expect(layout.spTree.exists()).toBe(true);
  });

  it('parses background', () => {
    const layout = parseLayout(makeLayoutXml({
      bg: '<bgPr><solidFill><srgbClr val="FF0000"/></solidFill></bgPr>',
    }));
    expect(layout.background).toBeDefined();
    expect(layout.background!.exists()).toBe(true);
  });

  it('parses showMasterSp="0" as false', () => {
    const layout = parseLayout(makeLayoutXml({ showMasterSp: '0' }));
    expect(layout.showMasterSp).toBe(false);
  });

  it('parses showMasterSp="1" as true', () => {
    const layout = parseLayout(makeLayoutXml({ showMasterSp: '1' }));
    expect(layout.showMasterSp).toBe(true);
  });

  it('parses colorMapOverride with overrideClrMapping', () => {
    const layout = parseLayout(makeLayoutXml({
      clrMapOvr: `
        <clrMapOvr>
          <overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"/>
        </clrMapOvr>
      `,
    }));
    expect(layout.colorMapOverride).toBeDefined();
    expect(layout.colorMapOverride!.get('bg1')).toBe('lt1');
    expect(layout.colorMapOverride!.get('tx1')).toBe('dk1');
  });

  it('ignores clrMapOvr without overrideClrMapping', () => {
    const layout = parseLayout(makeLayoutXml({
      clrMapOvr: '<clrMapOvr><masterClrMapping/></clrMapOvr>',
    }));
    expect(layout.colorMapOverride).toBeUndefined();
  });

  it('extracts placeholders from sp with nvSpPr > nvPr > ph', () => {
    const layout = parseLayout(makeLayoutXml({
      shapes: `
        <sp>
          <nvSpPr><cNvPr id="2" name="Title"/><nvPr><ph type="title"/></nvPr></nvSpPr>
          <spPr>
            <xfrm><off x="914400" y="457200"/><ext cx="7315200" cy="1143000"/></xfrm>
          </spPr>
        </sp>
      `,
    }));
    expect(layout.placeholders).toHaveLength(1);
    expect(layout.placeholders[0].absoluteXfrm).toBeDefined();
    expect(layout.placeholders[0].absoluteXfrm!.position.x).toBeCloseTo(96, 0);
    expect(layout.placeholders[0].absoluteXfrm!.position.y).toBeCloseTo(48, 0);
  });

  it('extracts placeholders from nvPicPr', () => {
    const layout = parseLayout(makeLayoutXml({
      shapes: `
        <pic>
          <nvPicPr><cNvPr id="3" name="Pic"/><nvPr><ph type="pic"/></nvPr></nvPicPr>
          <spPr>
            <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
          </spPr>
        </pic>
      `,
    }));
    expect(layout.placeholders).toHaveLength(1);
  });

  it('skips non-placeholder shapes', () => {
    const layout = parseLayout(makeLayoutXml({
      shapes: `
        <sp>
          <nvSpPr><cNvPr id="4" name="Rect"/><nvPr/></nvSpPr>
          <spPr>
            <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
          </spPr>
        </sp>
      `,
    }));
    expect(layout.placeholders).toHaveLength(0);
  });

  it('extracts placeholder without spPr (no absoluteXfrm)', () => {
    const layout = parseLayout(makeLayoutXml({
      shapes: `
        <sp>
          <nvSpPr><cNvPr id="5" name="NoXfrm"/><nvPr><ph type="body"/></nvPr></nvSpPr>
        </sp>
      `,
    }));
    expect(layout.placeholders).toHaveLength(1);
    expect(layout.placeholders[0].absoluteXfrm).toBeUndefined();
  });

  it('extracts placeholders from group shapes recursively', () => {
    const layout = parseLayout(makeLayoutXml({
      shapes: `
        <grpSp>
          <grpSpPr>
            <xfrm>
              <off x="0" y="0"/><ext cx="9144000" cy="6858000"/>
              <chOff x="0" y="0"/><chExt cx="9144000" cy="6858000"/>
            </xfrm>
          </grpSpPr>
          <sp>
            <nvSpPr><cNvPr id="10" name="GroupedTitle"/><nvPr><ph type="title"/></nvPr></nvSpPr>
            <spPr>
              <xfrm><off x="914400" y="914400"/><ext cx="4572000" cy="914400"/></xfrm>
            </spPr>
          </sp>
        </grpSp>
      `,
    }));
    expect(layout.placeholders).toHaveLength(1);
    expect(layout.placeholders[0].absoluteXfrm).toBeDefined();
    // 914400 EMU = 96px
    expect(layout.placeholders[0].absoluteXfrm!.position.x).toBeCloseTo(96, 0);
  });

  it('handles group with missing grpSpPr gracefully', () => {
    const layout = parseLayout(makeLayoutXml({
      shapes: `
        <grpSp>
          <sp>
            <nvSpPr><cNvPr id="11" name="NoGrpXfrm"/><nvPr><ph type="body"/></nvPr></nvSpPr>
            <spPr>
              <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
            </spPr>
          </sp>
        </grpSp>
      `,
    }));
    // Should still find placeholder through recursive search
    expect(layout.placeholders).toHaveLength(1);
  });

  it('computes correct absolute position for scaled group', () => {
    const layout = parseLayout(makeLayoutXml({
      shapes: `
        <grpSp>
          <grpSpPr>
            <xfrm>
              <off x="914400" y="914400"/><ext cx="4572000" cy="4572000"/>
              <chOff x="0" y="0"/><chExt cx="9144000" cy="9144000"/>
            </xfrm>
          </grpSpPr>
          <sp>
            <nvSpPr><cNvPr id="20" name="Scaled"/><nvPr><ph type="ctrTitle"/></nvPr></nvSpPr>
            <spPr>
              <xfrm><off x="914400" y="914400"/><ext cx="914400" cy="914400"/></xfrm>
            </spPr>
          </sp>
        </grpSp>
      `,
    }));
    expect(layout.placeholders).toHaveLength(1);
    const xfrm = layout.placeholders[0].absoluteXfrm!;
    // Group scale: 4572000/9144000 = 0.5
    // Group offset: 914400 EMU = 96px
    // Shape in child space: 914400 EMU
    // Absolute: 914400 + 914400*0.5 = 914400 + 457200 = 1371600 EMU ≈ 144px
    expect(xfrm.position.x).toBeCloseTo(144, 0);
    // Size: 914400 * 0.5 = 457200 EMU ≈ 48px
    expect(xfrm.size.w).toBeCloseTo(48, 0);
  });

  it('handles group with missing chOff/chExt (defaults to ext)', () => {
    const layout = parseLayout(makeLayoutXml({
      shapes: `
        <grpSp>
          <grpSpPr>
            <xfrm>
              <off x="0" y="0"/><ext cx="9144000" cy="6858000"/>
            </xfrm>
          </grpSpPr>
          <sp>
            <nvSpPr><cNvPr id="30" name="NoChExt"/><nvPr><ph type="body"/></nvPr></nvSpPr>
            <spPr>
              <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
            </spPr>
          </sp>
        </grpSp>
      `,
    }));
    expect(layout.placeholders).toHaveLength(1);
    // Scale should be 1:1 when chExt defaults to ext
    expect(layout.placeholders[0].absoluteXfrm!.size.w).toBeCloseTo(96, 0);
  });
});
