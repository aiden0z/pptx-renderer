import { describe, expect, it } from 'vitest';
import { buildPresentation } from '../../../src/model/Presentation';
import type { PptxFiles } from '../../../src/parser/ZipParser';

/**
 * Create a minimal PptxFiles structure with one slide, layout, master, and theme.
 */
function makeMinimalFiles(overrides: Partial<PptxFiles> = {}): PptxFiles {
  const presentationXml = `
    <Presentation xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sldSz cx="9144000" cy="6858000"/>
      <sldIdLst>
        <sldId id="256" r:id="rId2"/>
      </sldIdLst>
    </Presentation>
  `;

  const presentationRels = `
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
    </Relationships>
  `;

  const slideXml = `
    <sld xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <cSld>
        <spTree>
          <sp>
            <nvSpPr><cNvPr id="2" name="Title"/><nvPr/></nvSpPr>
            <spPr>
              <xfrm><off x="914400" y="914400"/><ext cx="7315200" cy="1143000"/></xfrm>
              <prstGeom prst="rect"><avLst/></prstGeom>
            </spPr>
          </sp>
        </spTree>
      </cSld>
    </sld>
  `;

  const slideRels = `
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
    </Relationships>
  `;

  const layoutXml = `
    <sldLayout>
      <cSld><spTree/></cSld>
    </sldLayout>
  `;

  const layoutRels = `
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
    </Relationships>
  `;

  const masterXml = `
    <sldMaster>
      <clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"/>
      <cSld><spTree/></cSld>
    </sldMaster>
  `;

  const masterRels = `
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
    </Relationships>
  `;

  const themeXml = `
    <theme>
      <themeElements>
        <clrScheme name="Office">
          <dk1><sysClr val="windowText" lastClr="000000"/></dk1>
          <lt1><sysClr val="window" lastClr="FFFFFF"/></lt1>
          <dk2><srgbClr val="44546A"/></dk2>
          <lt2><srgbClr val="E7E6E6"/></lt2>
          <accent1><srgbClr val="4472C4"/></accent1>
          <accent2><srgbClr val="ED7D31"/></accent2>
          <accent3><srgbClr val="A5A5A5"/></accent3>
          <accent4><srgbClr val="FFC000"/></accent4>
          <accent5><srgbClr val="5B9BD5"/></accent5>
          <accent6><srgbClr val="70AD47"/></accent6>
          <hlink><srgbClr val="0563C1"/></hlink>
          <folHlink><srgbClr val="954F72"/></folHlink>
        </clrScheme>
        <fontScheme name="Office">
          <majorFont><latin typeface="Calibri Light"/><ea typeface=""/><cs typeface=""/></majorFont>
          <minorFont><latin typeface="Calibri"/><ea typeface=""/><cs typeface=""/></minorFont>
        </fontScheme>
        <fmtScheme name="Office">
          <fillStyleLst><solidFill><srgbClr val="FFFFFF"/></solidFill></fillStyleLst>
          <lnStyleLst><ln w="12700"><solidFill><srgbClr val="000000"/></solidFill></ln></lnStyleLst>
          <effectStyleLst/>
        </fmtScheme>
      </themeElements>
    </theme>
  `;

  return {
    presentation: presentationXml,
    presentationRels,
    slides: new Map([['ppt/slides/slide1.xml', slideXml]]),
    slideRels: new Map([['ppt/slides/_rels/slide1.xml.rels', slideRels]]),
    slideLayouts: new Map([['ppt/slideLayouts/slideLayout1.xml', layoutXml]]),
    slideLayoutRels: new Map([['ppt/slideLayouts/_rels/slideLayout1.xml.rels', layoutRels]]),
    slideMasters: new Map([['ppt/slideMasters/slideMaster1.xml', masterXml]]),
    slideMasterRels: new Map([['ppt/slideMasters/_rels/slideMaster1.xml.rels', masterRels]]),
    themes: new Map([['ppt/theme/theme1.xml', themeXml]]),
    media: new Map(),
    charts: new Map(),
    diagramDrawings: new Map(),
    ...overrides,
  };
}

describe('buildPresentation', () => {
  it('builds presentation with correct dimensions', () => {
    const pres = buildPresentation(makeMinimalFiles());
    expect(pres.width).toBeCloseTo(960, 0);
    expect(pres.height).toBeCloseTo(720, 0);
  });

  it('parses one slide with one shape', () => {
    const pres = buildPresentation(makeMinimalFiles());
    expect(pres.slides).toHaveLength(1);
    expect(pres.slides[0].nodes).toHaveLength(1);
    expect(pres.slides[0].nodes[0].nodeType).toBe('shape');
  });

  it('resolves slide → layout → master → theme chain', () => {
    const pres = buildPresentation(makeMinimalFiles());
    const layoutPath = pres.slideToLayout.get(0);
    expect(layoutPath).toBe('ppt/slideLayouts/slideLayout1.xml');

    const masterPath = pres.layoutToMaster.get(layoutPath!);
    expect(masterPath).toBe('ppt/slideMasters/slideMaster1.xml');

    const themePath = pres.masterToTheme.get(masterPath!);
    expect(themePath).toBe('ppt/theme/theme1.xml');
  });

  it('parses theme with 12 color slots', () => {
    const pres = buildPresentation(makeMinimalFiles());
    const theme = pres.themes.values().next().value;
    expect(theme.colorScheme.size).toBe(12);
    expect(theme.colorScheme.get('accent1')).toBe('4472C4');
  });

  it('parses master color map', () => {
    const pres = buildPresentation(makeMinimalFiles());
    const master = pres.masters.values().next().value;
    expect(master.colorMap.get('tx1')).toBe('dk1');
    expect(master.colorMap.get('bg1')).toBe('lt1');
  });

  it('handles multiple slides in order', () => {
    const presXml = `
      <Presentation xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sldSz cx="9144000" cy="6858000"/>
        <sldIdLst>
          <sldId id="256" r:id="rId2"/>
          <sldId id="257" r:id="rId3"/>
        </sldIdLst>
      </Presentation>
    `;
    const presRels = `
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
        <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
      </Relationships>
    `;
    const slide2Xml = '<sld><cSld><spTree/></cSld></sld>';
    const slide2Rels = `
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
      </Relationships>
    `;

    const files = makeMinimalFiles({
      presentation: presXml,
      presentationRels: presRels,
      slides: new Map([
        ['ppt/slides/slide1.xml', '<sld><cSld><spTree/></cSld></sld>'],
        ['ppt/slides/slide2.xml', slide2Xml],
      ]),
      slideRels: new Map([
        ['ppt/slides/_rels/slide1.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`],
        ['ppt/slides/_rels/slide2.xml.rels', slide2Rels],
      ]),
    });

    const pres = buildPresentation(files);
    expect(pres.slides).toHaveLength(2);
    expect(pres.slides[0].index).toBe(0);
    expect(pres.slides[1].index).toBe(1);
  });

  it('detects WPS format', () => {
    const files = makeMinimalFiles({
      presentation: `
        <Presentation xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
                       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <sldSz cx="9144000" cy="6858000"/>
          <sldIdLst><sldId id="256" r:id="rId2"/></sldIdLst>
        </Presentation>
      `,
    });
    const pres = buildPresentation(files);
    expect(pres.isWps).toBe(true);
  });

  it('isWps is false for standard PPTX', () => {
    const pres = buildPresentation(makeMinimalFiles());
    expect(pres.isWps).toBe(false);
  });

  it('parses table styles', () => {
    const files = makeMinimalFiles({
      tableStyles: '<tblStyleLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><tblStyle styleId="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}" styleName="Medium Style 2 - Accent 1"/></tblStyleLst>',
    } as any);
    const pres = buildPresentation(files);
    expect(pres.tableStyles).toBeDefined();
  });

  it('parses charts', () => {
    const files = makeMinimalFiles({
      charts: new Map([['ppt/charts/chart1.xml', '<chartSpace><chart><plotArea><barChart/></plotArea></chart></chartSpace>']]),
    });
    const pres = buildPresentation(files);
    expect(pres.charts.size).toBe(1);
    expect(pres.charts.has('ppt/charts/chart1.xml')).toBe(true);
  });

  it('handles missing slide rels gracefully', () => {
    const files = makeMinimalFiles({
      slideRels: new Map(), // No rels
    });
    const pres = buildPresentation(files);
    expect(pres.slides).toHaveLength(1);
    expect(pres.slides[0].layoutIndex).toBe('');
  });

  it('handles missing layout rels gracefully', () => {
    const files = makeMinimalFiles({
      slideLayoutRels: new Map(),
    });
    const pres = buildPresentation(files);
    expect(pres.layouts.size).toBe(1);
    // layoutToMaster won't have an entry
    expect(pres.layoutToMaster.size).toBe(0);
  });

  it('handles missing master rels gracefully', () => {
    const files = makeMinimalFiles({
      slideMasterRels: new Map(),
    });
    const pres = buildPresentation(files);
    expect(pres.masters.size).toBe(1);
    expect(pres.masterToTheme.size).toBe(0);
  });

  it('uses fallback slide ordering when sldIdLst parsing fails', () => {
    // No sldIdLst — should fallback to presRels
    const presXml = `
      <Presentation xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sldSz cx="9144000" cy="6858000"/>
      </Presentation>
    `;
    const presRels = `
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
      </Relationships>
    `;
    const files = makeMinimalFiles({
      presentation: presXml,
      presentationRels: presRels,
    });
    const pres = buildPresentation(files);
    expect(pres.slides).toHaveLength(1);
  });

  it('resolves placeholder position inheritance from layout', () => {
    const slideXml = `
      <sld xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <cSld>
          <spTree>
            <sp>
              <nvSpPr><cNvPr id="2" name="Title"/><nvPr><ph type="title"/></nvPr></nvSpPr>
              <spPr>
                <xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm>
                <prstGeom prst="rect"><avLst/></prstGeom>
              </spPr>
            </sp>
          </spTree>
        </cSld>
      </sld>
    `;

    const layoutXml = `
      <sldLayout>
        <cSld>
          <spTree>
            <sp>
              <nvSpPr><cNvPr id="2" name="Title"/><nvPr><ph type="title"/></nvPr></nvSpPr>
              <spPr>
                <xfrm><off x="914400" y="457200"/><ext cx="7315200" cy="1143000"/></xfrm>
              </spPr>
            </sp>
          </spTree>
        </cSld>
      </sldLayout>
    `;

    const files = makeMinimalFiles({
      slides: new Map([['ppt/slides/slide1.xml', slideXml]]),
      slideLayouts: new Map([['ppt/slideLayouts/slideLayout1.xml', layoutXml]]),
    });

    const pres = buildPresentation(files);
    const node = pres.slides[0].nodes[0];
    // Placeholder with size=0 should inherit from layout
    expect(node.size.w).toBeGreaterThan(0);
    expect(node.size.h).toBeGreaterThan(0);
  });

  it('sets media from files', () => {
    const mediaData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const files = makeMinimalFiles({
      media: new Map([['ppt/media/image1.png', mediaData]]),
    });
    const pres = buildPresentation(files);
    expect(pres.media.size).toBe(1);
    expect(pres.media.get('ppt/media/image1.png')).toBe(mediaData);
  });

  it('uses default slide size when sldSz is missing', () => {
    const presXml = `
      <Presentation xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sldIdLst><sldId id="256" r:id="rId2"/></sldIdLst>
      </Presentation>
    `;
    const files = makeMinimalFiles({ presentation: presXml });
    const pres = buildPresentation(files);
    // Defaults: 9144000 EMU = 960px, 6858000 EMU = 720px
    expect(pres.width).toBeCloseTo(960, 0);
    expect(pres.height).toBeCloseTo(720, 0);
  });

  describe('placeholder inheritance', () => {
    it('inherits position from master when layout has no match', () => {
      const slideXml = `
        <sld xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="2" name="Body"/><nvPr><ph type="body" idx="1"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm>
                  <prstGeom prst="rect"><avLst/></prstGeom>
                </spPr>
              </sp>
            </spTree>
          </cSld>
        </sld>
      `;
      const masterXml = `
        <sldMaster>
          <clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"/>
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="3" name="Body"/><nvPr><ph type="body" idx="1"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="914400" y="1828800"/><ext cx="7315200" cy="3657600"/></xfrm>
                </spPr>
              </sp>
            </spTree>
          </cSld>
        </sldMaster>
      `;
      // Layout has NO matching placeholder
      const layoutXml = `<sldLayout><cSld><spTree/></cSld></sldLayout>`;
      const files = makeMinimalFiles({
        slides: new Map([['ppt/slides/slide1.xml', slideXml]]),
        slideLayouts: new Map([['ppt/slideLayouts/slideLayout1.xml', layoutXml]]),
        slideMasters: new Map([['ppt/slideMasters/slideMaster1.xml', masterXml]]),
      });
      const pres = buildPresentation(files);
      const node = pres.slides[0].nodes[0];
      // Should inherit from master since layout has no match
      expect(node.size.w).toBeGreaterThan(0);
      expect(node.size.h).toBeGreaterThan(0);
    });

    it('inherits position only (not size) when size is non-zero but y < 5', () => {
      const slideXml = `
        <sld xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="2" name="Title"/><nvPr><ph type="title"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="0" y="0"/><ext cx="914400" cy="457200"/></xfrm>
                  <prstGeom prst="rect"><avLst/></prstGeom>
                </spPr>
              </sp>
            </spTree>
          </cSld>
        </sld>
      `;
      const layoutXml = `
        <sldLayout>
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="2" name="Title"/><nvPr><ph type="title"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="914400" y="914400"/><ext cx="7315200" cy="1143000"/></xfrm>
                </spPr>
              </sp>
            </spTree>
          </cSld>
        </sldLayout>
      `;
      const files = makeMinimalFiles({
        slides: new Map([['ppt/slides/slide1.xml', slideXml]]),
        slideLayouts: new Map([['ppt/slideLayouts/slideLayout1.xml', layoutXml]]),
      });
      const pres = buildPresentation(files);
      const node = pres.slides[0].nodes[0];
      // Size should remain from slide (non-zero), but position inherited from layout
      expect(node.position.x).toBeGreaterThan(0);
    });

    it('matches placeholder by idx only when type is undefined', () => {
      const slideXml = `
        <sld xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="2" name="Content"/><nvPr><ph idx="10"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm>
                  <prstGeom prst="rect"><avLst/></prstGeom>
                </spPr>
              </sp>
            </spTree>
          </cSld>
        </sld>
      `;
      const layoutXml = `
        <sldLayout>
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="5" name="Content"/><nvPr><ph idx="10"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="457200" y="914400"/><ext cx="6858000" cy="4114800"/></xfrm>
                </spPr>
              </sp>
            </spTree>
          </cSld>
        </sldLayout>
      `;
      const files = makeMinimalFiles({
        slides: new Map([['ppt/slides/slide1.xml', slideXml]]),
        slideLayouts: new Map([['ppt/slideLayouts/slideLayout1.xml', layoutXml]]),
      });
      const pres = buildPresentation(files);
      const node = pres.slides[0].nodes[0];
      expect(node.size.w).toBeGreaterThan(0);
    });

    it('inherits bodyPr from layout placeholder for text rendering', () => {
      const slideXml = `
        <sld xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="2" name="Title"/><nvPr><ph type="title"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm>
                  <prstGeom prst="rect"><avLst/></prstGeom>
                </spPr>
                <txBody>
                  <bodyPr/>
                  <p><r><t>Hello</t></r></p>
                </txBody>
              </sp>
            </spTree>
          </cSld>
        </sld>
      `;
      const layoutXml = `
        <sldLayout>
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="2" name="Title"/><nvPr><ph type="title"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="914400" y="457200"/><ext cx="7315200" cy="1143000"/></xfrm>
                </spPr>
                <txBody>
                  <bodyPr anchor="ctr" lIns="91440"/>
                  <p><r><t/></r></p>
                </txBody>
              </sp>
            </spTree>
          </cSld>
        </sldLayout>
      `;
      const files = makeMinimalFiles({
        slides: new Map([['ppt/slides/slide1.xml', slideXml]]),
        slideLayouts: new Map([['ppt/slideLayouts/slideLayout1.xml', layoutXml]]),
      });
      const pres = buildPresentation(files);
      const node = pres.slides[0].nodes[0] as any;
      expect(node.textBody).toBeDefined();
      expect(node.textBody.layoutBodyProperties).toBeDefined();
    });

    it('inherits bodyPr from master when layout has no match', () => {
      const slideXml = `
        <sld xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="2" name="Body"/><nvPr><ph type="body" idx="1"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="914400" y="914400"/><ext cx="7315200" cy="3657600"/></xfrm>
                  <prstGeom prst="rect"><avLst/></prstGeom>
                </spPr>
                <txBody>
                  <bodyPr/>
                  <p><r><t>Content</t></r></p>
                </txBody>
              </sp>
            </spTree>
          </cSld>
        </sld>
      `;
      const layoutXml = `<sldLayout><cSld><spTree/></cSld></sldLayout>`;
      const masterXml = `
        <sldMaster>
          <clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"/>
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="3" name="Body"/><nvPr><ph type="body" idx="1"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="914400" y="1828800"/><ext cx="7315200" cy="3657600"/></xfrm>
                </spPr>
                <txBody>
                  <bodyPr anchor="t" lIns="91440" rIns="91440"/>
                  <p><r><t/></r></p>
                </txBody>
              </sp>
            </spTree>
          </cSld>
        </sldMaster>
      `;
      const files = makeMinimalFiles({
        slides: new Map([['ppt/slides/slide1.xml', slideXml]]),
        slideLayouts: new Map([['ppt/slideLayouts/slideLayout1.xml', layoutXml]]),
        slideMasters: new Map([['ppt/slideMasters/slideMaster1.xml', masterXml]]),
      });
      const pres = buildPresentation(files);
      const node = pres.slides[0].nodes[0] as any;
      expect(node.textBody.layoutBodyProperties).toBeDefined();
    });

    it('does not inherit when slide placeholder has non-empty size and y >= 5', () => {
      const slideXml = `
        <sld xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="2" name="Title"/><nvPr><ph type="title"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="914400" y="914400"/><ext cx="7315200" cy="1143000"/></xfrm>
                  <prstGeom prst="rect"><avLst/></prstGeom>
                </spPr>
              </sp>
            </spTree>
          </cSld>
        </sld>
      `;
      const layoutXml = `
        <sldLayout>
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="2" name="Title"/><nvPr><ph type="title"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="100" y="100"/><ext cx="100" cy="100"/></xfrm>
                </spPr>
              </sp>
            </spTree>
          </cSld>
        </sldLayout>
      `;
      const files = makeMinimalFiles({
        slides: new Map([['ppt/slides/slide1.xml', slideXml]]),
        slideLayouts: new Map([['ppt/slideLayouts/slideLayout1.xml', layoutXml]]),
      });
      const pres = buildPresentation(files);
      const node = pres.slides[0].nodes[0];
      // Should keep slide's own position/size (not inherit from layout)
      expect(node.position.y).toBeCloseTo(96, 0); // 914400 EMU
    });
  });

  describe('resolveSlidePositions — placeholder position resolution', () => {
    it('shape with zero size inherits both position and size from layout', () => {
      const slideXml = `
        <sld xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="2" name="Subtitle"/><nvPr><ph type="subTitle" idx="1"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm>
                  <prstGeom prst="rect"><avLst/></prstGeom>
                </spPr>
              </sp>
            </spTree>
          </cSld>
        </sld>
      `;
      const layoutXml = `
        <sldLayout>
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="5" name="Subtitle"/><nvPr><ph type="subTitle" idx="1"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="1828800" y="3657600"/><ext cx="5486400" cy="1828800"/></xfrm>
                </spPr>
              </sp>
            </spTree>
          </cSld>
        </sldLayout>
      `;
      const files = makeMinimalFiles({
        slides: new Map([['ppt/slides/slide1.xml', slideXml]]),
        slideLayouts: new Map([['ppt/slideLayouts/slideLayout1.xml', layoutXml]]),
      });
      const pres = buildPresentation(files);
      const node = pres.slides[0].nodes[0];
      // Both position and size should be inherited from layout
      expect(node.position.x).toBeGreaterThan(0);
      expect(node.position.y).toBeGreaterThan(0);
      expect(node.size.w).toBeGreaterThan(0);
      expect(node.size.h).toBeGreaterThan(0);
    });

    it('shape with positionLooksDefault (y < 5) inherits position but keeps size', () => {
      const slideXml = `
        <sld xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="2" name="Title"/><nvPr><ph type="title"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="0" y="0"/><ext cx="4572000" cy="914400"/></xfrm>
                  <prstGeom prst="rect"><avLst/></prstGeom>
                </spPr>
              </sp>
            </spTree>
          </cSld>
        </sld>
      `;
      const layoutXml = `
        <sldLayout>
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="2" name="Title"/><nvPr><ph type="title"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="914400" y="914400"/><ext cx="7315200" cy="1143000"/></xfrm>
                </spPr>
              </sp>
            </spTree>
          </cSld>
        </sldLayout>
      `;
      const files = makeMinimalFiles({
        slides: new Map([['ppt/slides/slide1.xml', slideXml]]),
        slideLayouts: new Map([['ppt/slideLayouts/slideLayout1.xml', layoutXml]]),
      });
      const pres = buildPresentation(files);
      const node = pres.slides[0].nodes[0];
      // Position inherited from layout (y should be ~96px from 914400 EMU)
      expect(node.position.x).toBeCloseTo(96, 0);
      expect(node.position.y).toBeCloseTo(96, 0);
      // Size should stay from slide's own values (non-zero, so not overwritten)
      expect(node.size.w).toBeCloseTo(480, 0); // 4572000 EMU ~ 480px
      expect(node.size.h).toBeCloseTo(96, 0); // 914400 EMU ~ 96px
    });

    it('falls back to master placeholder when layout has no match', () => {
      const slideXml = `
        <sld xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="2" name="Footer"/><nvPr><ph type="ftr" idx="11"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm>
                  <prstGeom prst="rect"><avLst/></prstGeom>
                </spPr>
              </sp>
            </spTree>
          </cSld>
        </sld>
      `;
      // Layout has NO footer placeholder
      const layoutXml = `<sldLayout><cSld><spTree/></cSld></sldLayout>`;
      // Master has footer placeholder
      const masterXml = `
        <sldMaster>
          <clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"/>
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="7" name="Footer"/><nvPr><ph type="ftr" idx="11"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="3048000" y="6400800"/><ext cx="3048000" cy="365125"/></xfrm>
                </spPr>
              </sp>
            </spTree>
          </cSld>
        </sldMaster>
      `;
      const files = makeMinimalFiles({
        slides: new Map([['ppt/slides/slide1.xml', slideXml]]),
        slideLayouts: new Map([['ppt/slideLayouts/slideLayout1.xml', layoutXml]]),
        slideMasters: new Map([['ppt/slideMasters/slideMaster1.xml', masterXml]]),
      });
      const pres = buildPresentation(files);
      const node = pres.slides[0].nodes[0];
      // Should inherit from master
      expect(node.size.w).toBeGreaterThan(0);
      expect(node.size.h).toBeGreaterThan(0);
      expect(node.position.x).toBeGreaterThan(0);
    });

    it('master fallback also inherits position when positionLooksDefault', () => {
      const slideXml = `
        <sld xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="2" name="Dt"/><nvPr><ph type="dt" idx="10"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="0" y="0"/><ext cx="2743200" cy="365125"/></xfrm>
                  <prstGeom prst="rect"><avLst/></prstGeom>
                </spPr>
              </sp>
            </spTree>
          </cSld>
        </sld>
      `;
      const layoutXml = `<sldLayout><cSld><spTree/></cSld></sldLayout>`;
      const masterXml = `
        <sldMaster>
          <clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"/>
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="8" name="Dt"/><nvPr><ph type="dt" idx="10"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="457200" y="6400800"/><ext cx="2743200" cy="365125"/></xfrm>
                </spPr>
              </sp>
            </spTree>
          </cSld>
        </sldMaster>
      `;
      const files = makeMinimalFiles({
        slides: new Map([['ppt/slides/slide1.xml', slideXml]]),
        slideLayouts: new Map([['ppt/slideLayouts/slideLayout1.xml', layoutXml]]),
        slideMasters: new Map([['ppt/slideMasters/slideMaster1.xml', masterXml]]),
      });
      const pres = buildPresentation(files);
      const node = pres.slides[0].nodes[0];
      // Position should be inherited from master (y was 0 < 5 so positionLooksDefault)
      expect(node.position.x).toBeCloseTo(48, 0); // 457200 EMU
      expect(node.position.y).toBeCloseTo(672, -1); // 6400800 EMU
    });

    it('no inheritance when shape has non-zero size and y >= 5', () => {
      const slideXml = `
        <sld xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="2" name="Title"/><nvPr><ph type="title"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="457200" y="457200"/><ext cx="7315200" cy="1143000"/></xfrm>
                  <prstGeom prst="rect"><avLst/></prstGeom>
                </spPr>
              </sp>
            </spTree>
          </cSld>
        </sld>
      `;
      const layoutXml = `
        <sldLayout>
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="2" name="Title"/><nvPr><ph type="title"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="914400" y="914400"/><ext cx="100" cy="100"/></xfrm>
                </spPr>
              </sp>
            </spTree>
          </cSld>
        </sldLayout>
      `;
      const files = makeMinimalFiles({
        slides: new Map([['ppt/slides/slide1.xml', slideXml]]),
        slideLayouts: new Map([['ppt/slideLayouts/slideLayout1.xml', layoutXml]]),
      });
      const pres = buildPresentation(files);
      const node = pres.slides[0].nodes[0];
      // y = 457200 EMU ~ 48px which is >= 5, so no position inheritance
      // Size is non-zero, so no size inheritance either
      expect(node.position.y).toBeCloseTo(48, 0); // Keeps original
      expect(node.size.w).toBeCloseTo(768, 0); // 7315200 EMU ~ 768px
    });
  });

  describe('chart style and color parsing', () => {
    it('parses chart styles', () => {
      const files = makeMinimalFiles({
        chartStyles: new Map([['ppt/charts/style1.xml', '<cs:chartStyle xmlns:cs="http://schemas.microsoft.com/office/drawing/2012/chartStyle"/>']]),
      } as any);
      const pres = buildPresentation(files);
      expect(pres).toBeDefined();
    });

    it('parses chart colors', () => {
      const files = makeMinimalFiles({
        chartColors: new Map([['ppt/charts/colors1.xml', '<cs:colorStyle xmlns:cs="http://schemas.microsoft.com/office/drawing/2012/chartStyle"/>']]),
      } as any);
      const pres = buildPresentation(files);
      expect(pres).toBeDefined();
    });
  });
});
