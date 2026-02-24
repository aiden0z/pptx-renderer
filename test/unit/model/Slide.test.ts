import { describe, expect, it } from 'vitest';
import { parseSlide, parseOleFrameAsPicture } from '../../../src/model/Slide';
import { parseXml } from '../../../src/parser/XmlParser';
import type { RelEntry } from '../../../src/parser/RelParser';

function makeRels(entries: Array<[string, RelEntry]> = []): Map<string, RelEntry> {
  return new Map(entries);
}

function makeSlideXml(opts: {
  bg?: string;
  shapes?: string;
  showMasterSp?: string;
} = {}) {
  const bgXml = opts.bg ? `<bg>${opts.bg}</bg>` : '';
  const shapes = opts.shapes ?? '';
  const showAttr = opts.showMasterSp !== undefined ? ` showMasterSp="${opts.showMasterSp}"` : '';
  return parseXml(`
    <sld${showAttr}
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <cSld>
        ${bgXml}
        <spTree>${shapes}</spTree>
      </cSld>
    </sld>
  `);
}

describe('parseSlide', () => {
  it('parses empty slide', () => {
    const slide = parseSlide(makeSlideXml(), 0, makeRels());
    expect(slide.index).toBe(0);
    expect(slide.nodes).toHaveLength(0);
    expect(slide.background).toBeUndefined();
    expect(slide.layoutIndex).toBe('');
    expect(slide.showMasterSp).toBe(true);
  });

  it('parses background', () => {
    const slide = parseSlide(makeSlideXml({
      bg: '<bgPr><solidFill><srgbClr val="FF0000"/></solidFill></bgPr>',
    }), 0, makeRels());
    expect(slide.background).toBeDefined();
  });

  it('parses showMasterSp="0" as false', () => {
    const slide = parseSlide(makeSlideXml({ showMasterSp: '0' }), 0, makeRels());
    expect(slide.showMasterSp).toBe(false);
  });

  it('parses sp as shape node', () => {
    const slide = parseSlide(makeSlideXml({
      shapes: `
        <sp>
          <nvSpPr><cNvPr id="2" name="Rect"/><nvPr/></nvSpPr>
          <spPr>
            <xfrm><off x="914400" y="914400"/><ext cx="914400" cy="914400"/></xfrm>
            <prstGeom prst="rect"><avLst/></prstGeom>
          </spPr>
        </sp>
      `,
    }), 0, makeRels());
    expect(slide.nodes).toHaveLength(1);
    expect(slide.nodes[0].nodeType).toBe('shape');
    expect(slide.nodes[0].name).toBe('Rect');
  });

  it('parses cxnSp as shape node', () => {
    const slide = parseSlide(makeSlideXml({
      shapes: `
        <cxnSp>
          <nvCxnSpPr><cNvPr id="3" name="Connector"/><nvPr/></nvCxnSpPr>
          <spPr>
            <xfrm><off x="0" y="0"/><ext cx="914400" cy="0"/></xfrm>
            <prstGeom prst="line"><avLst/></prstGeom>
          </spPr>
        </cxnSp>
      `,
    }), 0, makeRels());
    expect(slide.nodes).toHaveLength(1);
    expect(slide.nodes[0].nodeType).toBe('shape');
  });

  it('parses pic as picture node', () => {
    const slide = parseSlide(makeSlideXml({
      shapes: `
        <pic>
          <nvPicPr><cNvPr id="4" name="Img"/><nvPr/></nvPicPr>
          <blipFill><blip r:embed="rId1"/></blipFill>
          <spPr>
            <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
          </spPr>
        </pic>
      `,
    }), 0, makeRels());
    expect(slide.nodes).toHaveLength(1);
    expect(slide.nodes[0].nodeType).toBe('picture');
  });

  it('parses grpSp as group node', () => {
    const slide = parseSlide(makeSlideXml({
      shapes: `
        <grpSp>
          <nvGrpSpPr><cNvPr id="5" name="Group"/><nvPr/></nvGrpSpPr>
          <grpSpPr>
            <xfrm>
              <off x="0" y="0"/><ext cx="914400" cy="914400"/>
              <chOff x="0" y="0"/><chExt cx="914400" cy="914400"/>
            </xfrm>
          </grpSpPr>
        </grpSp>
      `,
    }), 0, makeRels());
    expect(slide.nodes).toHaveLength(1);
    expect(slide.nodes[0].nodeType).toBe('group');
  });

  it('parses graphicFrame with table', () => {
    const slide = parseSlide(makeSlideXml({
      shapes: `
        <graphicFrame>
          <nvGraphicFramePr><cNvPr id="6" name="Table"/><nvPr/></nvGraphicFramePr>
          <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
          <graphic>
            <graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
              <tbl>
                <tblPr/>
                <tblGrid><gridCol w="914400"/></tblGrid>
                <tr h="457200"><tc><txBody><bodyPr/><p><r><t>Hello</t></r></p></txBody></tc></tr>
              </tbl>
            </graphicData>
          </graphic>
        </graphicFrame>
      `,
    }), 0, makeRels());
    expect(slide.nodes).toHaveLength(1);
    expect(slide.nodes[0].nodeType).toBe('table');
  });

  it('parses graphicFrame with chart', () => {
    const rels = makeRels([
      ['rId1', { type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart', target: '../charts/chart1.xml' }],
    ]);
    const slide = parseSlide(makeSlideXml({
      shapes: `
        <graphicFrame>
          <nvGraphicFramePr><cNvPr id="7" name="Chart"/><nvPr/></nvGraphicFramePr>
          <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
          <graphic>
            <graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
              <chart r:id="rId1"/>
            </graphicData>
          </graphic>
        </graphicFrame>
      `,
    }), 0, rels, 'ppt/slides/slide1.xml');
    expect(slide.nodes).toHaveLength(1);
    expect(slide.nodes[0].nodeType).toBe('chart');
  });

  it('finds layout relationship from rels', () => {
    const rels = makeRels([
      ['rId1', { type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout', target: '../slideLayouts/slideLayout1.xml' }],
    ]);
    const slide = parseSlide(makeSlideXml(), 0, rels);
    expect(slide.layoutIndex).toBe('../slideLayouts/slideLayout1.xml');
  });

  it('preserves slidePath', () => {
    const slide = parseSlide(makeSlideXml(), 5, makeRels(), 'ppt/slides/slide6.xml');
    expect(slide.index).toBe(5);
    expect(slide.slidePath).toBe('ppt/slides/slide6.xml');
  });

  it('skips unknown child tags', () => {
    const slide = parseSlide(makeSlideXml({
      shapes: '<unknownElement><foo/></unknownElement>',
    }), 0, makeRels());
    expect(slide.nodes).toHaveLength(0);
  });

  it('parses multiple shapes', () => {
    const slide = parseSlide(makeSlideXml({
      shapes: `
        <sp>
          <nvSpPr><cNvPr id="2" name="Shape1"/><nvPr/></nvSpPr>
          <spPr>
            <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
            <prstGeom prst="rect"><avLst/></prstGeom>
          </spPr>
        </sp>
        <sp>
          <nvSpPr><cNvPr id="3" name="Shape2"/><nvPr/></nvSpPr>
          <spPr>
            <xfrm><off x="914400" y="0"/><ext cx="914400" cy="914400"/></xfrm>
            <prstGeom prst="ellipse"><avLst/></prstGeom>
          </spPr>
        </sp>
      `,
    }), 0, makeRels());
    expect(slide.nodes).toHaveLength(2);
  });

  it('skips graphicFrame that is neither table, chart, diagram, nor OLE', () => {
    const slide = parseSlide(makeSlideXml({
      shapes: `
        <graphicFrame>
          <nvGraphicFramePr><cNvPr id="8" name="Unknown"/><nvPr/></nvGraphicFramePr>
          <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
          <graphic>
            <graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/unknown"/>
          </graphic>
        </graphicFrame>
      `,
    }), 0, makeRels());
    expect(slide.nodes).toHaveLength(0);
  });
});

describe('parseOleFrameAsPicture', () => {
  it('returns undefined for non-OLE graphicFrame', () => {
    const xml = parseXml(`
      <graphicFrame xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <nvGraphicFramePr><cNvPr id="1" name="Table"/><nvPr/></nvGraphicFramePr>
        <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
        <graphic>
          <graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
            <tbl/>
          </graphicData>
        </graphic>
      </graphicFrame>
    `);
    expect(parseOleFrameAsPicture(xml)).toBeUndefined();
  });

  it('extracts picture from OLE fallback', () => {
    const xml = parseXml(`
      <graphicFrame xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <nvGraphicFramePr><cNvPr id="10" name="OLE"/><nvPr/></nvGraphicFramePr>
        <xfrm><off x="914400" y="914400"/><ext cx="1828800" cy="1828800"/></xfrm>
        <graphic>
          <graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole">
            <AlternateContent>
              <Fallback>
                <oleObj>
                  <pic>
                    <nvPicPr><cNvPr id="11" name="OlePic"/><nvPr/></nvPicPr>
                    <blipFill><blip r:embed="rId5"/></blipFill>
                    <spPr/>
                  </pic>
                </oleObj>
              </Fallback>
            </AlternateContent>
          </graphicData>
        </graphic>
      </graphicFrame>
    `);
    const pic = parseOleFrameAsPicture(xml);
    expect(pic).toBeDefined();
    expect(pic!.nodeType).toBe('picture');
    expect(pic!.blipEmbed).toBe('rId5');
  });

  it('extracts picture from OLE Choice branch', () => {
    const xml = parseXml(`
      <graphicFrame xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <nvGraphicFramePr><cNvPr id="12" name="OLE2"/><nvPr/></nvGraphicFramePr>
        <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
        <graphic>
          <graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole">
            <AlternateContent>
              <Choice>
                <oleObj>
                  <pic>
                    <nvPicPr><cNvPr id="13" name="OlePic2"/><nvPr/></nvPicPr>
                    <blipFill><blip embed="rId6"/></blipFill>
                    <spPr/>
                  </pic>
                </oleObj>
              </Choice>
            </AlternateContent>
          </graphicData>
        </graphic>
      </graphicFrame>
    `);
    const pic = parseOleFrameAsPicture(xml);
    expect(pic).toBeDefined();
    expect(pic!.blipEmbed).toBe('rId6');
  });

  it('returns undefined when OLE has no pic with embed', () => {
    const xml = parseXml(`
      <graphicFrame xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <nvGraphicFramePr><cNvPr id="14" name="OLE3"/><nvPr/></nvGraphicFramePr>
        <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
        <graphic>
          <graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole">
            <AlternateContent>
              <Fallback>
                <oleObj>
                  <pic>
                    <nvPicPr><cNvPr id="15" name="NoPic"/><nvPr/></nvPicPr>
                    <blipFill><blip/></blipFill>
                    <spPr/>
                  </pic>
                </oleObj>
              </Fallback>
            </AlternateContent>
          </graphicData>
        </graphic>
      </graphicFrame>
    `);
    expect(parseOleFrameAsPicture(xml)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Diagram / SmartArt parsing
// ---------------------------------------------------------------------------

/**
 * Build a minimal diagram graphicFrame XML string.
 * The r:dm attribute on relIds points to the data relationship ID.
 */
function makeDiagramFrameXml(opts: {
  dmRId?: string;
  frameX?: number;
  frameY?: number;
  frameCx?: number;
  frameCy?: number;
} = {}): string {
  const { dmRId = 'rId1', frameX = 0, frameY = 0, frameCx = 9144000, frameCy = 6858000 } = opts;
  return `
    <graphicFrame
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <nvGraphicFramePr><cNvPr id="20" name="SmartArt"/><nvPr/></nvGraphicFramePr>
      <xfrm><off x="${frameX}" y="${frameY}"/><ext cx="${frameCx}" cy="${frameCy}"/></xfrm>
      <graphic>
        <graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram">
          <relIds r:dm="${dmRId}" r:lo="rId2" r:qs="rId3" r:cs="rId4"/>
        </graphicData>
      </graphic>
    </graphicFrame>
  `;
}

/**
 * Build a minimal dsp: diagram drawing XML string.
 * Each shape entry is a dsp:sp with a dsp:spPr > a:xfrm holding position/size in EMU.
 */
function makeDiagramDrawingXml(shapes: Array<{
  x: number;
  y: number;
  cx: number;
  cy: number;
  prst?: string;
}> = []): string {
  const spXml = shapes
    .map(
      (s) => `
      <sp xmlns="http://schemas.microsoft.com/office/drawing/2008/diagram"
          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <spPr>
          <a:xfrm>
            <a:off x="${s.x}" y="${s.y}"/>
            <a:ext cx="${s.cx}" cy="${s.cy}"/>
          </a:xfrm>
          ${s.prst ? `<a:prstGeom prst="${s.prst}"><a:avLst/></a:prstGeom>` : ''}
        </spPr>
      </sp>`,
    )
    .join('\n');

  return `
    <drawing xmlns="http://schemas.microsoft.com/office/drawing/2008/diagram"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <spTree>
        ${spXml}
      </spTree>
    </drawing>
  `;
}

describe('diagram/SmartArt parsing', () => {
  // -------------------------------------------------------------------------
  // Test 1: parseSlide recognises a diagram graphicFrame and returns a group
  // -------------------------------------------------------------------------
  it('parseSlide recognises diagram graphicFrame and produces a group node', () => {
    const drawingXml = makeDiagramDrawingXml([
      { x: 0, y: 0, cx: 914400, cy: 914400 },
    ]);

    const diagramDrawings = new Map<string, string>([
      ['ppt/diagrams/drawing1.xml', drawingXml],
    ]);

    const rels = makeRels([
      [
        'rId1',
        {
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData',
          target: '../diagrams/data1.xml',
        },
      ],
      [
        'rId5',
        {
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramDrawing',
          target: '../diagrams/drawing1.xml',
        },
      ],
    ]);

    const slide = parseSlide(
      makeSlideXml({ shapes: makeDiagramFrameXml({ dmRId: 'rId1' }) }),
      0,
      rels,
      'ppt/slides/slide1.xml',
      diagramDrawings,
    );

    expect(slide.nodes).toHaveLength(1);
    expect(slide.nodes[0].nodeType).toBe('group');
  });

  // -------------------------------------------------------------------------
  // Test 2: parseDiagramFrame resolves drawing via data-file number matching
  //         (strategy 1): data1.xml dm rel → drawing1.xml
  // -------------------------------------------------------------------------
  it('parseDiagramFrame resolves drawing via data file number matching (strategy 1)', () => {
    const drawingXml = makeDiagramDrawingXml([
      { x: 914400, y: 914400, cx: 1828800, cy: 1828800 },
    ]);

    // drawing1 is reachable via the diagrams/drawing1.xml key
    const diagramDrawings = new Map<string, string>([
      ['ppt/diagrams/drawing1.xml', drawingXml],
    ]);

    const rels = makeRels([
      // rId1 points to data1.xml — number "1" matches drawing1.xml
      [
        'rId1',
        {
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData',
          target: '../diagrams/data1.xml',
        },
      ],
      // diagramDrawing rel whose target contains "drawing1"
      [
        'rId6',
        {
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramDrawing',
          target: '../diagrams/drawing1.xml',
        },
      ],
    ]);

    const slide = parseSlide(
      makeSlideXml({ shapes: makeDiagramFrameXml({ dmRId: 'rId1' }) }),
      0,
      rels,
      'ppt/slides/slide1.xml',
      diagramDrawings,
    );

    expect(slide.nodes).toHaveLength(1);
    const group = slide.nodes[0];
    expect(group.nodeType).toBe('group');
    // The group children list should contain one shape node (parsed from drawing XML)
    expect((group as import('../../../src/model/nodes/GroupNode').GroupNodeData).children).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Test 3: parseDiagramFrame falls back to any diagramDrawing rel (strategy 2)
  //         when the data-file-number strategy cannot locate the drawing.
  // -------------------------------------------------------------------------
  it('parseDiagramFrame falls back to any diagramDrawing rel when strategy 1 fails', () => {
    const drawingXml = makeDiagramDrawingXml([
      { x: 0, y: 0, cx: 914400, cy: 914400 },
    ]);

    // The drawing is stored under a path that has NO numeric suffix — strategy 1 cannot match.
    const diagramDrawings = new Map<string, string>([
      ['ppt/diagrams/drawingSpecial.xml', drawingXml],
    ]);

    const rels = makeRels([
      // dm points to data2.xml (number 2), but there is no drawing2 candidate
      [
        'rId1',
        {
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData',
          target: '../diagrams/data2.xml',
        },
      ],
      // Only diagramDrawing rel available; target has no number → strategy 2
      [
        'rId7',
        {
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramDrawing',
          target: '../diagrams/drawingSpecial.xml',
        },
      ],
    ]);

    const slide = parseSlide(
      makeSlideXml({ shapes: makeDiagramFrameXml({ dmRId: 'rId1' }) }),
      0,
      rels,
      'ppt/slides/slide1.xml',
      diagramDrawings,
    );

    // Strategy 2 must still find the drawing and produce a group
    expect(slide.nodes).toHaveLength(1);
    expect(slide.nodes[0].nodeType).toBe('group');
  });

  // -------------------------------------------------------------------------
  // Test 4: parseDiagramFrame returns undefined (node skipped) when no
  //         diagramDrawings map entry is available for any candidate rel.
  // -------------------------------------------------------------------------
  it('parseDiagramFrame returns undefined when no drawing XML is available', () => {
    // diagramDrawings map is empty — no XML for any path
    const diagramDrawings = new Map<string, string>();

    const rels = makeRels([
      [
        'rId1',
        {
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData',
          target: '../diagrams/data1.xml',
        },
      ],
      [
        'rId8',
        {
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramDrawing',
          target: '../diagrams/drawing1.xml',
        },
      ],
    ]);

    const slide = parseSlide(
      makeSlideXml({ shapes: makeDiagramFrameXml({ dmRId: 'rId1' }) }),
      0,
      rels,
      'ppt/slides/slide1.xml',
      diagramDrawings,
    );

    // parseDiagramFrame returns undefined → the node is dropped → slide has no nodes
    expect(slide.nodes).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 5: buildDiagramGroup handles empty spTree (no child shapes)
  // -------------------------------------------------------------------------
  it('buildDiagramGroup produces a group with empty children when spTree has no shapes', () => {
    // Drawing XML with a spTree that has no sp/pic/etc. children
    const emptyDrawingXml = `
      <drawing xmlns="http://schemas.microsoft.com/office/drawing/2008/diagram">
        <spTree/>
      </drawing>
    `;

    const diagramDrawings = new Map<string, string>([
      ['ppt/diagrams/drawing1.xml', emptyDrawingXml],
    ]);

    const rels = makeRels([
      [
        'rId1',
        {
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData',
          target: '../diagrams/data1.xml',
        },
      ],
      [
        'rId9',
        {
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramDrawing',
          target: '../diagrams/drawing1.xml',
        },
      ],
    ]);

    const slide = parseSlide(
      makeSlideXml({ shapes: makeDiagramFrameXml({ dmRId: 'rId1', frameCx: 1828800, frameCy: 914400 }) }),
      0,
      rels,
      'ppt/slides/slide1.xml',
      diagramDrawings,
    );

    expect(slide.nodes).toHaveLength(1);
    const group = slide.nodes[0] as import('../../../src/model/nodes/GroupNode').GroupNodeData;
    expect(group.nodeType).toBe('group');
    expect(group.children).toHaveLength(0);
    // childExtent should fall back to the graphicFrame dimensions (in px)
    // frameCx=1828800 EMU → 1828800/914400*96 = 192 px
    expect(group.childExtent.w).toBeCloseTo(192, 1);
  });

  // -------------------------------------------------------------------------
  // Test 6: buildDiagramGroup computes bounding box from child shapes
  //         (non-circular preset, so origin-based coordinates apply)
  // -------------------------------------------------------------------------
  it('buildDiagramGroup computes bounding box coordinates from child shapes', () => {
    // Two rect shapes. Non-circular: childOffset should stay at (0,0) and
    // childExtent should match the graphicFrame size (origin-based mode).
    const drawingXml = makeDiagramDrawingXml([
      { x: 914400, y: 914400, cx: 914400, cy: 914400, prst: 'rect' },
      { x: 2743200, y: 914400, cx: 914400, cy: 914400, prst: 'rect' },
    ]);

    const diagramDrawings = new Map<string, string>([
      ['ppt/diagrams/drawing1.xml', drawingXml],
    ]);

    const rels = makeRels([
      [
        'rId1',
        {
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData',
          target: '../diagrams/data1.xml',
        },
      ],
      [
        'rId10',
        {
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramDrawing',
          target: '../diagrams/drawing1.xml',
        },
      ],
    ]);

    // Frame: 9144000 x 4572000 EMU → 960 x 480 px
    const slide = parseSlide(
      makeSlideXml({ shapes: makeDiagramFrameXml({ dmRId: 'rId1', frameCx: 9144000, frameCy: 4572000 }) }),
      0,
      rels,
      'ppt/slides/slide1.xml',
      diagramDrawings,
    );

    expect(slide.nodes).toHaveLength(1);
    const group = slide.nodes[0] as import('../../../src/model/nodes/GroupNode').GroupNodeData;
    expect(group.nodeType).toBe('group');
    expect(group.children).toHaveLength(2);
    // Non-circular: childOffset is always (0, 0)
    expect(group.childOffset.x).toBe(0);
    expect(group.childOffset.y).toBe(0);
    // childExtent matches the graphicFrame size: 9144000/914400*96 = 960, 4572000/914400*96 = 480
    expect(group.childExtent.w).toBeCloseTo(960, 1);
    expect(group.childExtent.h).toBeCloseTo(480, 1);
  });

  // -------------------------------------------------------------------------
  // Test 7: buildDiagramGroup handles circular presets (aspect ratio preservation)
  //         Circular shapes get tight bounding box with isotropic scale adjustment.
  // -------------------------------------------------------------------------
  it('buildDiagramGroup preserves aspect ratio for circular presets', () => {
    // A single donut shape — triggers the CIRCULAR_PRESETS path.
    // Shape placed at (0,0), 4572000 x 4572000 EMU (square bounding box).
    const drawingXml = makeDiagramDrawingXml([
      { x: 0, y: 0, cx: 4572000, cy: 4572000, prst: 'donut' },
    ]);

    const diagramDrawings = new Map<string, string>([
      ['ppt/diagrams/drawing1.xml', drawingXml],
    ]);

    const rels = makeRels([
      [
        'rId1',
        {
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData',
          target: '../diagrams/data1.xml',
        },
      ],
      [
        'rId11',
        {
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramDrawing',
          target: '../diagrams/drawing1.xml',
        },
      ],
    ]);

    // Non-square frame: 9144000 x 4572000 EMU → 960 x 480 px
    // Circular shape bbox (px): tight bbox 0,0..480,480. Frame aspect = 960/480 = 2.
    // scaleX = 960/480 = 2, scaleY = 480/480 = 1 → uniformScale = 1 (min).
    // newExtW = 960/1 = 960, newExtH = 480/1 = 480.
    // offX = 0 - (960-480)/2 = -240, offY = 0 - (480-480)/2 = 0.
    const slide = parseSlide(
      makeSlideXml({ shapes: makeDiagramFrameXml({ dmRId: 'rId1', frameCx: 9144000, frameCy: 4572000 }) }),
      0,
      rels,
      'ppt/slides/slide1.xml',
      diagramDrawings,
    );

    expect(slide.nodes).toHaveLength(1);
    const group = slide.nodes[0] as import('../../../src/model/nodes/GroupNode').GroupNodeData;
    expect(group.nodeType).toBe('group');
    // For circular presets the extent is expanded to match the frame aspect ratio
    expect(group.childExtent.w).toBeCloseTo(960, 1);
    expect(group.childExtent.h).toBeCloseTo(480, 1);
    // offX is shifted to center the content (negative value)
    expect(group.childOffset.x).toBeCloseTo(-240, 1);
    expect(group.childOffset.y).toBeCloseTo(0, 1);
  });

  // -------------------------------------------------------------------------
  // Test 8: buildDiagramGroup falls back to frame coordinates when shapes
  //         have significant negative coordinates.
  // -------------------------------------------------------------------------
  it('buildDiagramGroup falls back to frame coordinates when shapes have negative coordinates', () => {
    // Shape with a large negative x coordinate — triggers useFrameCoords path.
    // x = -9144000 EMU → -960 px (far negative), cx = 1828800 EMU → 192 px.
    const drawingXml = makeDiagramDrawingXml([
      { x: -9144000, y: 0, cx: 1828800, cy: 1828800, prst: 'donut' },
    ]);

    const diagramDrawings = new Map<string, string>([
      ['ppt/diagrams/drawing1.xml', drawingXml],
    ]);

    const rels = makeRels([
      [
        'rId1',
        {
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData',
          target: '../diagrams/data1.xml',
        },
      ],
      [
        'rId12',
        {
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramDrawing',
          target: '../diagrams/drawing1.xml',
        },
      ],
    ]);

    // Frame: 9144000 x 4572000 EMU → 960 x 480 px
    const slide = parseSlide(
      makeSlideXml({ shapes: makeDiagramFrameXml({ dmRId: 'rId1', frameCx: 9144000, frameCy: 4572000 }) }),
      0,
      rels,
      'ppt/slides/slide1.xml',
      diagramDrawings,
    );

    expect(slide.nodes).toHaveLength(1);
    const group = slide.nodes[0] as import('../../../src/model/nodes/GroupNode').GroupNodeData;
    expect(group.nodeType).toBe('group');
    // useFrameCoords=true: childOffset = (0,0), childExtent = frame size
    expect(group.childOffset.x).toBe(0);
    expect(group.childOffset.y).toBe(0);
    expect(group.childExtent.w).toBeCloseTo(960, 1);
    expect(group.childExtent.h).toBeCloseTo(480, 1);
  });
});
