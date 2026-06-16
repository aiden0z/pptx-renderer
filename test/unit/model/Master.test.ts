import { describe, expect, it } from 'vitest';
import { parseMaster } from '../../../src/model/Master';
import { parseXml } from '../../../src/parser/XmlParser';

function makeMasterXml(opts: {
  bg?: string;
  clrMap?: string;
  txStyles?: string;
  defaultTextStyle?: string;
  shapes?: string;
} = {}) {
  const bgXml = opts.bg ? `<bg>${opts.bg}</bg>` : '';
  const clrMap = opts.clrMap ?? '<clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"/>';
  const txStyles = opts.txStyles ?? '';
  const defaultTextStyle = opts.defaultTextStyle ?? '';
  const shapes = opts.shapes ?? '';
  return parseXml(`
    <sldMaster>
      ${clrMap}
      ${txStyles ? `<txStyles>${txStyles}</txStyles>` : ''}
      ${defaultTextStyle ? `<defaultTextStyle>${defaultTextStyle}</defaultTextStyle>` : ''}
      <cSld>
        ${bgXml}
        <spTree>${shapes}</spTree>
      </cSld>
    </sldMaster>
  `);
}

describe('parseMaster', () => {
  it('parses empty master', () => {
    const master = parseMaster(makeMasterXml());
    expect(master.colorMap.size).toBeGreaterThan(0);
    expect(master.background).toBeUndefined();
    expect(master.textStyles.titleStyle).toBeUndefined();
    expect(master.textStyles.bodyStyle).toBeUndefined();
    expect(master.textStyles.otherStyle).toBeUndefined();
    expect(master.defaultTextStyle).toBeUndefined();
    expect(master.placeholders).toHaveLength(0);
    expect(master.rels.size).toBe(0);
    expect(master.spTree.exists()).toBe(true);
  });

  it('parses color map attributes', () => {
    const master = parseMaster(makeMasterXml({
      clrMap: '<clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" hlink="hlink"/>',
    }));
    expect(master.colorMap.get('bg1')).toBe('lt1');
    expect(master.colorMap.get('tx1')).toBe('dk1');
    expect(master.colorMap.get('accent1')).toBe('accent1');
    expect(master.colorMap.get('hlink')).toBe('hlink');
  });

  it('parses background', () => {
    const master = parseMaster(makeMasterXml({
      bg: '<bgPr><solidFill><srgbClr val="003366"/></solidFill></bgPr>',
    }));
    expect(master.background).toBeDefined();
    expect(master.background!.exists()).toBe(true);
  });

  it('parses text styles', () => {
    const master = parseMaster(makeMasterXml({
      txStyles: `
        <titleStyle><lvl1pPr><defRPr sz="4400"/></lvl1pPr></titleStyle>
        <bodyStyle><lvl1pPr><defRPr sz="3200"/></lvl1pPr></bodyStyle>
        <otherStyle><lvl1pPr><defRPr sz="1800"/></lvl1pPr></otherStyle>
      `,
    }));
    expect(master.textStyles.titleStyle).toBeDefined();
    expect(master.textStyles.bodyStyle).toBeDefined();
    expect(master.textStyles.otherStyle).toBeDefined();
  });

  it('parses defaultTextStyle', () => {
    const master = parseMaster(makeMasterXml({
      defaultTextStyle: '<lvl1pPr><defRPr sz="1800"/></lvl1pPr>',
    }));
    expect(master.defaultTextStyle).toBeDefined();
    expect(master.defaultTextStyle!.exists()).toBe(true);
  });

  it('extracts placeholder shapes from spTree', () => {
    const master = parseMaster(makeMasterXml({
      shapes: `
        <sp>
          <nvSpPr><cNvPr id="2" name="Title"/><nvPr><ph type="title"/></nvPr></nvSpPr>
          <spPr/>
        </sp>
        <sp>
          <nvSpPr><cNvPr id="3" name="Body"/><nvPr><ph type="body" idx="1"/></nvPr></nvSpPr>
          <spPr/>
        </sp>
        <sp>
          <nvSpPr><cNvPr id="4" name="Rect"/><nvPr/></nvSpPr>
          <spPr/>
        </sp>
      `,
    }));
    // Should find 2 placeholders, skip the non-placeholder
    expect(master.placeholders).toHaveLength(2);
  });

  it('recognizes pic placeholders via nvPicPr', () => {
    const master = parseMaster(makeMasterXml({
      shapes: `
        <pic>
          <nvPicPr><cNvPr id="5" name="PicPh"/><nvPr><ph type="pic"/></nvPr></nvPicPr>
          <blipFill/>
          <spPr/>
        </pic>
      `,
    }));
    expect(master.placeholders).toHaveLength(1);
  });

  it('recognizes graphicFrame and connector placeholders', () => {
    const master = parseMaster(makeMasterXml({
      shapes: `
        <graphicFrame>
          <nvGraphicFramePr><cNvPr id="6" name="Chart"/><nvPr><ph type="chart"/></nvPr></nvGraphicFramePr>
          <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
        </graphicFrame>
        <cxnSp>
          <nvCxnSpPr><cNvPr id="7" name="Connector"/><nvPr><ph type="body"/></nvPr></nvCxnSpPr>
          <spPr><xfrm><off x="0" y="0"/><ext cx="457200" cy="457200"/></xfrm></spPr>
        </cxnSp>
      `,
    }));

    expect(master.placeholders).toHaveLength(2);
    expect(master.placeholderEntries?.map((entry) => entry.absoluteXfrm?.size.w)).toEqual([
      96,
      48,
    ]);
  });

  it('extracts grouped placeholder absolute transforms from master spTree', () => {
    const master = parseMaster(makeMasterXml({
      shapes: `
        <grpSp>
          <grpSpPr>
            <xfrm>
              <off x="914400" y="457200"/><ext cx="4572000" cy="2286000"/>
              <chOff x="914400" y="0"/><chExt cx="9144000" cy="4572000"/>
            </xfrm>
          </grpSpPr>
          <sp>
            <nvSpPr><cNvPr id="8" name="Grouped"/><nvPr><ph type="body"/></nvPr></nvSpPr>
            <spPr>
              <xfrm><off x="1828800" y="914400"/><ext cx="914400" cy="914400"/></xfrm>
            </spPr>
          </sp>
        </grpSp>
      `,
    }));

    const entry = master.placeholderEntries![0];
    expect(entry.absoluteXfrm?.position.x).toBeCloseTo(144, 0);
    expect(entry.absoluteXfrm?.position.y).toBeCloseTo(96, 0);
    expect(entry.absoluteXfrm?.size.w).toBeCloseTo(48, 0);
    expect(entry.absoluteXfrm?.size.h).toBeCloseTo(48, 0);
  });

  it('keeps collecting master placeholders when group transforms are missing', () => {
    const master = parseMaster(makeMasterXml({
      shapes: `
        <grpSp>
          <sp>
            <nvSpPr><cNvPr id="9" name="NoGroupXfrm"/><nvPr><ph type="body"/></nvPr></nvSpPr>
            <spPr>
              <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
            </spPr>
          </sp>
        </grpSp>
      `,
    }));

    expect(master.placeholders).toHaveLength(1);
    expect(master.placeholderEntries![0].absoluteXfrm?.size.w).toBe(96);
  });

  it('guards zero child extents in master grouped placeholders', () => {
    const master = parseMaster(makeMasterXml({
      shapes: `
        <grpSp>
          <grpSpPr>
            <xfrm>
              <off x="0" y="0"/><ext cx="914400" cy="914400"/>
              <chExt cx="0" cy="0"/>
            </xfrm>
          </grpSpPr>
          <sp>
            <nvSpPr><cNvPr id="10" name="ZeroChildExtent"/><nvPr><ph type="body"/></nvPr></nvSpPr>
            <spPr>
              <xfrm><off x="0" y="0"/><ext cx="1" cy="1"/></xfrm>
            </spPr>
          </sp>
        </grpSp>
      `,
    }));

    expect(master.placeholders).toHaveLength(1);
    expect(master.placeholderEntries![0].absoluteXfrm?.size.w).toBeCloseTo(96, 0);
  });

  it('defaults missing placeholder xfrm attributes to zero', () => {
    const master = parseMaster(makeMasterXml({
      shapes: `
        <sp>
          <nvSpPr><cNvPr id="11" name="IncompleteXfrm"/><nvPr><ph type="body"/></nvPr></nvSpPr>
          <spPr><xfrm><off/><ext/></xfrm></spPr>
        </sp>
      `,
    }));

    expect(master.placeholders).toHaveLength(1);
    expect(master.placeholderEntries![0].absoluteXfrm).toEqual({
      position: { x: 0, y: 0 },
      size: { w: 0, h: 0 },
    });
  });

  it('composes transforms for nested grouped placeholders with sparse group xfrm attrs', () => {
    const master = parseMaster(makeMasterXml({
      shapes: `
        <grpSp>
          <grpSpPr>
            <xfrm>
              <off x="914400" y="0"/><ext cx="1828800" cy="1828800"/>
              <chOff/><chExt/>
            </xfrm>
          </grpSpPr>
          <grpSp>
            <grpSpPr>
              <xfrm>
                <off x="457200" y="457200"/><ext cx="914400" cy="914400"/>
                <chOff x="0" y="0"/><chExt cx="914400" cy="914400"/>
              </xfrm>
            </grpSpPr>
            <sp>
              <nvSpPr><cNvPr id="12" name="Nested"/><nvPr><ph type="body"/></nvPr></nvSpPr>
              <spPr><xfrm><off x="457200" y="0"/><ext cx="457200" cy="457200"/></xfrm></spPr>
            </sp>
          </grpSp>
        </grpSp>
      `,
    }));

    expect(master.placeholders).toHaveLength(1);
    expect(master.placeholderEntries![0].absoluteXfrm!.position.x).toBeCloseTo(192, 0);
    expect(master.placeholderEntries![0].absoluteXfrm!.position.y).toBeCloseTo(48, 0);
    expect(master.placeholderEntries![0].absoluteXfrm!.size.w).toBeCloseTo(48, 0);
  });

  it('returns empty color map when clrMap is absent', () => {
    const xml = parseXml(`
      <sldMaster>
        <cSld><spTree/></cSld>
      </sldMaster>
    `);
    const master = parseMaster(xml);
    expect(master.colorMap.size).toBe(0);
  });
});
