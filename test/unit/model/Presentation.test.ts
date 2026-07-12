import { describe, expect, it } from 'vitest';
import {
  buildPresentation,
  materializeAllSlideNodes,
  materializeSlideNodes,
} from '../../../src/model/Presentation';
import type { PptxFiles } from '../../../src/parser/ZipParser';
import { serializePresentation } from '../../../src/export/serializePresentation';
import { buildTextIndex } from '../../../src/search/TextSearch';

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
            <txBody>
              <bodyPr/>
              <lstStyle/>
              <p><r><t>Deferred title</t></r></p>
            </txBody>
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
  it('maps embedded font relationships to isolated render families', () => {
    const regular = new Uint8Array([1, 2, 3]);
    const bold = new Uint8Array([4, 5, 6]);
    const pres = buildPresentation(
      makeMinimalFiles({
        presentation: `
          <Presentation xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <sldSz cx="9144000" cy="6858000"/>
            <embeddedFontLst>
              <embeddedFont>
                <font typeface="Example Sans"/>
                <regular r:id="rId8"/>
                <bold r:id="rId9"/>
              </embeddedFont>
            </embeddedFontLst>
            <sldIdLst><sldId id="256" r:id="rId2"/></sldIdLst>
          </Presentation>
        `,
        presentationRels: `
          <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
            <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
            <Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/example-regular.fntdata"/>
            <Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/example-bold.fntdata"/>
          </Relationships>
        `,
        fonts: new Map([
          ['ppt/fonts/example-regular.fntdata', regular],
          ['ppt/fonts/example-bold.fntdata', bold],
        ]),
      }),
    );

    expect(pres.embeddedFonts).toEqual([
      expect.objectContaining({ family: 'Example Sans', data: regular, weight: '400' }),
      expect.objectContaining({ family: 'Example Sans', data: bold, weight: '700' }),
    ]);
    const renderFamily = pres.embeddedFontFamilies?.get('example sans');
    expect(renderFamily).toMatch(/^__pptx_embedded_/);
    expect(pres.embeddedFonts?.every((face) => face.renderFamily === renderFamily)).toBe(true);
  });

  it('builds presentation with correct dimensions', () => {
    const pres = buildPresentation(makeMinimalFiles());
    expect(pres.width).toBeCloseTo(960, 0);
    expect(pres.height).toBeCloseTo(720, 0);
  });

  it('parses presentation-level default text style', () => {
    const pres = buildPresentation(
      makeMinimalFiles({
        presentation: `
          <Presentation xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <sldSz cx="9144000" cy="6858000"/>
            <defaultTextStyle>
              <lvl1pPr><defRPr sz="1800"/></lvl1pPr>
            </defaultTextStyle>
            <sldIdLst>
              <sldId id="256" r:id="rId2"/>
            </sldIdLst>
          </Presentation>
        `,
      }),
    );

    expect(pres.defaultTextStyle?.exists()).toBe(true);
    expect(pres.defaultTextStyle?.child('lvl1pPr').child('defRPr').attr('sz')).toBe('1800');
  });

  it('parses one slide with one shape', () => {
    const pres = buildPresentation(makeMinimalFiles());
    expect(pres.slides).toHaveLength(1);
    expect(pres.slides[0].nodes).toHaveLength(1);
    expect(pres.slides[0].nodes[0].nodeType).toBe('shape');
  });

  it('can defer slide node parsing until the slide is materialized', () => {
    const pres = buildPresentation(makeMinimalFiles(), { lazySlides: true });

    expect(pres.slides).toHaveLength(1);
    expect(pres.slides[0].nodes).toHaveLength(0);

    materializeSlideNodes(pres, pres.slides[0]);

    expect(pres.slides[0].nodes).toHaveLength(1);
    expect(pres.slides[0].nodes[0].nodeType).toBe('shape');
  });

  it('materializes lazy slides for search and serialization consumers', () => {
    const pres = buildPresentation(makeMinimalFiles(), { lazySlides: true });

    const index = buildTextIndex(pres);
    const serialized = serializePresentation(pres);

    expect(index.map((entry) => entry.text)).toContain('Deferred title');
    expect(serialized.slides[0].nodes[0].textBody?.totalText).toBe('Deferred title');
    expect(pres.slides[0].nodes).toHaveLength(1);
  });

  it('can materialize all lazy slides explicitly', () => {
    const pres = buildPresentation(makeMinimalFiles(), { lazySlides: true });

    materializeAllSlideNodes(pres);

    expect(pres.slides[0].nodes).toHaveLength(1);
  });

  it('preserves diagram fallback drawings for render/export/search contexts', () => {
    const pres = buildPresentation(
      makeMinimalFiles({
        diagramDrawings: new Map([['ppt/diagrams/drawing1.xml', '<dsp:drawing/>']]),
      }),
    );

    expect((pres as any).diagramDrawings?.get('ppt/diagrams/drawing1.xml')).toBe('<dsp:drawing/>');
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

  it('resolves percent-encoded relationship targets to decoded package part names', () => {
    const files = makeMinimalFiles({
      presentationRels: `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/Product%20Intro.xml"/>
        </Relationships>
      `,
      slides: new Map([['ppt/slides/Product Intro.xml', '<sld><cSld><spTree/></cSld></sld>']]),
      slideRels: new Map([
        [
          'ppt/slides/_rels/Product Intro.xml.rels',
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/Title%20Layout.xml"/></Relationships>`,
        ],
      ]),
      slideLayouts: new Map([['ppt/slideLayouts/Title Layout.xml', '<sldLayout/>']]),
      slideLayoutRels: new Map([
        [
          'ppt/slideLayouts/_rels/Title Layout.xml.rels',
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/Main%20Master.xml"/></Relationships>`,
        ],
      ]),
      slideMasters: new Map([['ppt/slideMasters/Main Master.xml', '<sldMaster/>']]),
      slideMasterRels: new Map([
        [
          'ppt/slideMasters/_rels/Main Master.xml.rels',
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/Corporate%20Theme.xml"/></Relationships>`,
        ],
      ]),
      themes: new Map([['ppt/theme/Corporate Theme.xml', '<theme/>']]),
    });

    const pres = buildPresentation(files);

    expect(pres.slides).toHaveLength(1);
    expect(pres.slides[0].slidePath).toBe('ppt/slides/Product Intro.xml');
    expect(pres.slideToLayout.get(0)).toBe('ppt/slideLayouts/Title Layout.xml');
    expect(pres.layoutToMaster.get('ppt/slideLayouts/Title Layout.xml')).toBe(
      'ppt/slideMasters/Main Master.xml',
    );
    expect(pres.masterToTheme.get('ppt/slideMasters/Main Master.xml')).toBe(
      'ppt/theme/Corporate Theme.xml',
    );
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
        [
          'ppt/slides/_rels/slide1.xml.rels',
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
        ],
        ['ppt/slides/_rels/slide2.xml.rels', slide2Rels],
      ]),
    });

    const pres = buildPresentation(files);
    expect(pres.slides).toHaveLength(2);
    expect(pres.slides[0].index).toBe(0);
    expect(pres.slides[1].index).toBe(1);
  });

  it('marks slides with show="0" as hidden without dropping them', () => {
    const files = makeMinimalFiles({
      slides: new Map([['ppt/slides/slide1.xml', '<sld show="0"><cSld><spTree/></cSld></sld>']]),
    });

    const pres = buildPresentation(files);

    expect(pres.slides).toHaveLength(1);
    expect(pres.slides[0].hidden).toBe(true);
  });

  it('preserves sldIdLst ordering when relationship attributes use a non-r prefix', () => {
    const presXml = `
      <Presentation xmlns:rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sldSz cx="9144000" cy="6858000"/>
        <sldIdLst>
          <sldId id="256" rel:id="rId10"/>
          <sldId id="257" rel:id="rId2"/>
        </sldIdLst>
      </Presentation>
    `;
    const presRels = `
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
        <Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide10.xml"/>
      </Relationships>
    `;
    const slideRels = `
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
      </Relationships>
    `;

    const pres = buildPresentation(
      makeMinimalFiles({
        presentation: presXml,
        presentationRels: presRels,
        slides: new Map([
          ['ppt/slides/slide2.xml', '<sld><cSld><spTree/></cSld></sld>'],
          ['ppt/slides/slide10.xml', '<sld><cSld><spTree/></cSld></sld>'],
        ]),
        slideRels: new Map([
          ['ppt/slides/_rels/slide2.xml.rels', slideRels],
          ['ppt/slides/_rels/slide10.xml.rels', slideRels],
        ]),
      }),
    );

    expect(pres.slides.map((slide) => slide.slidePath)).toEqual([
      'ppt/slides/slide10.xml',
      'ppt/slides/slide2.xml',
    ]);
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
      tableStyles:
        '<tblStyleLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><tblStyle styleId="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}" styleName="Medium Style 2 - Accent 1"/></tblStyleLst>',
    } as any);
    const pres = buildPresentation(files);
    expect(pres.tableStyles).toBeDefined();
  });

  it('parses charts', () => {
    const files = makeMinimalFiles({
      charts: new Map([
        [
          'ppt/charts/chart1.xml',
          '<chartSpace><chart><plotArea><barChart/></plotArea></chart></chartSpace>',
        ],
      ]),
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

    it('inherits placeholder type from layout when slide placeholder declares only idx', () => {
      const slideXml = `
        <sld xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="2" name="Title"/><nvPr><ph idx="1"/></nvPr></nvSpPr>
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
                <nvSpPr><cNvPr id="5" name="Layout Title"/><nvPr><ph type="title" idx="1"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="457200" y="914400"/><ext cx="6858000" cy="1143000"/></xfrm>
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

      expect(node.placeholder).toEqual({ idx: 1, type: 'title' });
    });

    it('inherits placeholder type from master when matching layout placeholder has no type', () => {
      const slideXml = `
        <sld xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="2" name="Body"/><nvPr><ph idx="2"/></nvPr></nvSpPr>
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
                <nvSpPr><cNvPr id="5" name="Layout Body"/><nvPr><ph idx="2"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="457200" y="914400"/><ext cx="6858000" cy="4114800"/></xfrm>
                </spPr>
              </sp>
            </spTree>
          </cSld>
        </sldLayout>
      `;
      const masterXml = `
        <sldMaster>
          <clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"/>
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="7" name="Master Body"/><nvPr><ph type="body" idx="2"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="914400" y="1828800"/><ext cx="7315200" cy="3657600"/></xfrm>
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

      expect(node.placeholder).toEqual({ idx: 2, type: 'body' });
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

    it('falls back to master bodyPr when matching layout placeholder has none', () => {
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
                <txBody>
                  <bodyPr/>
                  <p><r><t>Content</t></r></p>
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
                <nvSpPr><cNvPr id="3" name="Body Layout"/><nvPr><ph type="body" idx="1"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="914400" y="914400"/><ext cx="7315200" cy="3657600"/></xfrm>
                </spPr>
              </sp>
            </spTree>
          </cSld>
        </sldLayout>
      `;
      const masterXml = `
        <sldMaster>
          <clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"/>
          <cSld>
            <spTree>
              <sp>
                <nvSpPr><cNvPr id="4" name="Body Master"/><nvPr><ph type="body" idx="1"/></nvPr></nvSpPr>
                <spPr>
                  <xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm>
                </spPr>
                <txBody>
                  <bodyPr anchor="ctr" lIns="91440"/>
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

      expect(node.position.x).toBeCloseTo(96, 0);
      expect(node.textBody.layoutBodyProperties).toBeDefined();
      expect(node.textBody.layoutBodyProperties.attr('anchor')).toBe('ctr');
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

    it('falls back to grouped master placeholders using slide-space coordinates', () => {
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
      const layoutXml = `<sldLayout><cSld><spTree/></cSld></sldLayout>`;
      const masterXml = `
        <sldMaster>
          <clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"/>
          <cSld>
            <spTree>
              <grpSp>
                <nvGrpSpPr><cNvPr id="20" name="Footer Group"/><cNvGrpSpPr/><nvPr/></nvGrpSpPr>
                <grpSpPr>
                  <xfrm>
                    <off x="914400" y="914400"/>
                    <ext cx="1828800" cy="914400"/>
                    <chOff x="0" y="0"/>
                    <chExt cx="914400" cy="914400"/>
                  </xfrm>
                </grpSpPr>
                <sp>
                  <nvSpPr><cNvPr id="21" name="Grouped Footer"/><nvPr><ph type="ftr" idx="11"/></nvPr></nvSpPr>
                  <spPr>
                    <xfrm><off x="228600" y="457200"/><ext cx="457200" cy="228600"/></xfrm>
                  </spPr>
                </sp>
              </grpSp>
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

      expect(node.position.x).toBeCloseTo(144, 0);
      expect(node.position.y).toBeCloseTo(144, 0);
      expect(node.size.w).toBeCloseTo(96, 0);
      expect(node.size.h).toBeCloseTo(24, 0);
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
    it('maps chart style relationships to chart-local style parts', () => {
      const chartXml =
        '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" />';
      const chartRelsXml = `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2011/relationships/chartStyle" Target="style1.xml"/>
        </Relationships>
      `;
      const files = makeMinimalFiles({
        charts: new Map([['ppt/charts/chart1.xml', chartXml]]),
        chartRels: new Map([['ppt/charts/_rels/chart1.xml.rels', chartRelsXml]]),
        chartStyles: new Map([
          [
            'ppt/charts/style1.xml',
            '<cs:chartStyle xmlns:cs="http://schemas.microsoft.com/office/drawing/2012/chartStyle"/>',
          ],
        ]),
      } as any);
      const pres = buildPresentation(files);
      expect(pres.chartStyles?.get('ppt/charts/chart1.xml')?.localName).toBe('chartStyle');
    });

    it('maps chart color style relationships to chart-local color parts', () => {
      const chartXml =
        '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" />';
      const chartRelsXml = `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2011/relationships/chartColorStyle" Target="colors1.xml"/>
        </Relationships>
      `;
      const files = makeMinimalFiles({
        charts: new Map([['ppt/charts/chart1.xml', chartXml]]),
        chartRels: new Map([['ppt/charts/_rels/chart1.xml.rels', chartRelsXml]]),
        chartColors: new Map([
          [
            'ppt/charts/colors1.xml',
            '<cs:colorStyle xmlns:cs="http://schemas.microsoft.com/office/drawing/2012/chartStyle"/>',
          ],
        ]),
      } as any);
      const pres = buildPresentation(files);
      expect(pres.chartColorStyles?.get('ppt/charts/chart1.xml')?.localName).toBe('colorStyle');
    });

    it('maps chart themeOverride relationships to chart-local themes', () => {
      const chartXml =
        '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" />';
      const chartRelsXml = `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/themeOverride" Target="../theme/themeOverride1.xml"/>
        </Relationships>
      `;
      const themeOverrideXml = `
        <a:themeOverride xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <a:clrScheme name="Chart">
            <a:dk1><a:srgbClr val="000000"/></a:dk1>
            <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
            <a:dk2><a:srgbClr val="0E2841"/></a:dk2>
            <a:lt2><a:srgbClr val="E8E8E8"/></a:lt2>
            <a:accent1><a:srgbClr val="156082"/></a:accent1>
            <a:accent2><a:srgbClr val="E97132"/></a:accent2>
            <a:accent3><a:srgbClr val="196B24"/></a:accent3>
            <a:accent4><a:srgbClr val="0F9ED5"/></a:accent4>
            <a:accent5><a:srgbClr val="A02B93"/></a:accent5>
            <a:accent6><a:srgbClr val="4EA72E"/></a:accent6>
            <a:hlink><a:srgbClr val="467886"/></a:hlink>
            <a:folHlink><a:srgbClr val="96607D"/></a:folHlink>
          </a:clrScheme>
          <a:fontScheme name="Chart">
            <a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
            <a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
          </a:fontScheme>
          <a:fmtScheme name="Chart">
            <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
            <a:lnStyleLst><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
            <a:effectStyleLst/>
          </a:fmtScheme>
        </a:themeOverride>
      `;

      const pres = buildPresentation(
        makeMinimalFiles({
          charts: new Map([['ppt/charts/chart1.xml', chartXml]]),
          chartRels: new Map([['ppt/charts/_rels/chart1.xml.rels', chartRelsXml]]),
          themeOverrides: new Map([['ppt/theme/themeOverride1.xml', themeOverrideXml]]),
        } as any),
      );

      expect(pres.chartThemes?.get('ppt/charts/chart1.xml')?.colorScheme.get('accent2')).toBe(
        'E97132',
      );
    });
  });
});
