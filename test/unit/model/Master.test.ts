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
