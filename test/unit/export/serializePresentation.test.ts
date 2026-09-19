import { describe, expect, it } from 'vitest';
import { serializePresentation } from '../../../src/export/serializePresentation';
import { parseGroupNode } from '../../../src/model/nodes/GroupNode';
import { SafeXmlNode, parseXml } from '../../../src/parser/XmlParser';
import type { PresentationData } from '../../../src/model/Presentation';
import type { SlideData } from '../../../src/model/Slide';
import type { ShapeNodeData, TextBody } from '../../../src/model/nodes/ShapeNode';
import type { PicNodeData } from '../../../src/model/nodes/PicNode';
import type { TableNodeData } from '../../../src/model/nodes/TableNode';
import type { GroupNodeData } from '../../../src/model/nodes/GroupNode';
import type { ChartNodeData } from '../../../src/model/nodes/ChartNode';

const emptyXml = new SafeXmlNode(null);

function makeBase(overrides: Partial<ShapeNodeData> = {}) {
  return {
    id: '1',
    name: 'test',
    position: { x: 10, y: 20 },
    size: { w: 100, h: 50 },
    rotation: 0,
    flipH: false,
    flipV: false,
    source: emptyXml,
    ...overrides,
  };
}

function makeTextBody(text: string): TextBody {
  return {
    paragraphs: [
      {
        level: 0,
        runs: [{ text }],
      },
    ],
  };
}

function makePres(nodes: any[]): PresentationData {
  const slide: SlideData = {
    index: 0,
    nodes,
    rels: new Map(),
    slidePath: 'ppt/slides/slide1.xml',
    showMasterSp: true,
  };
  return {
    width: 960,
    height: 540,
    slides: [slide],
    layouts: new Map(),
    masters: new Map(),
    themes: new Map(),
    slideToLayout: new Map(),
    layoutToMaster: new Map(),
    masterToTheme: new Map(),
    media: new Map(),
    charts: new Map(),
    isWps: false,
  } as PresentationData;
}

function makeDiagramGraphicFrame(): SafeXmlNode {
  return parseXml(`
    <graphicFrame xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                  xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"
                  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <nvGraphicFramePr><cNvPr id="90" name="diagram-frame"/><nvPr/></nvGraphicFramePr>
      <xfrm><off x="0" y="0"/><ext cx="1828800" cy="914400"/></xfrm>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram">
          <dgm:relIds r:dm="rIdData"/>
        </a:graphicData>
      </a:graphic>
    </graphicFrame>
  `);
}

function diagramDrawingXml(): string {
  return `
    <dsp:drawing xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram"
                 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <dsp:spTree>
        <dsp:sp>
          <dsp:nvSpPr><dsp:cNvPr id="91" name="diagram-label"/><dsp:nvPr/></dsp:nvSpPr>
          <dsp:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          </dsp:spPr>
          <dsp:txBody>
            <a:bodyPr/><a:lstStyle/>
            <a:p><a:r><a:t>Serialized SmartArt label</a:t></a:r></a:p>
          </dsp:txBody>
        </dsp:sp>
      </dsp:spTree>
    </dsp:drawing>
  `;
}

function makeGroupedPlaceholderXml(): SafeXmlNode {
  return parseXml(`
    <sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <nvSpPr>
        <cNvPr id="92" name="grouped-placeholder"/>
        <cNvSpPr/>
        <nvPr><ph type="body" idx="1"/></nvPr>
      </nvSpPr>
      <spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </spPr>
      <txBody>
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p><a:r><a:t>Serialized inherited placeholder</a:t></a:r></a:p>
      </txBody>
    </sp>
  `);
}

function makeLayoutPlaceholderXml(): SafeXmlNode {
  return parseXml(`
    <sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <nvSpPr>
        <cNvPr id="93" name="layout-placeholder"/>
        <cNvSpPr/>
        <nvPr><ph type="body" idx="1"/></nvPr>
      </nvSpPr>
      <spPr>
        <a:xfrm><a:off x="952500" y="571500"/><a:ext cx="381000" cy="190500"/></a:xfrm>
      </spPr>
    </sp>
  `);
}

describe('serializePresentation', () => {
  it('serializes empty presentation', () => {
    const result = serializePresentation(makePres([]));
    expect(result.width).toBe(960);
    expect(result.height).toBe(540);
    expect(result.slideCount).toBe(1);
    expect(result.slides).toHaveLength(1);
    expect(result.slides[0].index).toBe(0);
    expect(result.slides[0].nodes).toHaveLength(0);
  });

  it('serializes hidden slide metadata', () => {
    const pres = makePres([]);
    pres.slides[0].hidden = true;

    const result = serializePresentation(pres);

    expect(result.slides[0].hidden).toBe(true);
  });

  it('serializes shape node with text', () => {
    const shape: ShapeNodeData = {
      ...makeBase(),
      nodeType: 'shape',
      presetGeometry: 'rect',
      adjustments: new Map(),
      textBody: makeTextBody('Hello World'),
    };
    const result = serializePresentation(makePres([shape]));
    const node = result.slides[0].nodes[0];

    expect(node.nodeType).toBe('shape');
    expect(node.presetGeometry).toBe('rect');
    expect(node.textBody).toBeDefined();
    expect(node.textBody!.totalText).toBe('Hello World');
    expect(node.textBody!.paragraphs).toHaveLength(1);
    expect(node.textBody!.paragraphs[0].level).toBe(0);
    expect(node.textBody!.paragraphs[0].text).toBe('Hello World');
  });

  it('serializes shape with empty text body as undefined', () => {
    const shape: ShapeNodeData = {
      ...makeBase(),
      nodeType: 'shape',
      adjustments: new Map(),
      textBody: { paragraphs: [{ level: 0, runs: [{ text: '   ' }] }] },
    };
    const result = serializePresentation(makePres([shape]));
    expect(result.slides[0].nodes[0].textBody).toBeUndefined();
  });

  it('serializes shape without text body', () => {
    const shape: ShapeNodeData = {
      ...makeBase(),
      nodeType: 'shape',
      adjustments: new Map(),
    };
    const result = serializePresentation(makePres([shape]));
    expect(result.slides[0].nodes[0].textBody).toBeUndefined();
  });

  it('serializes multi-paragraph text', () => {
    const shape: ShapeNodeData = {
      ...makeBase(),
      nodeType: 'shape',
      adjustments: new Map(),
      textBody: {
        paragraphs: [
          { level: 0, runs: [{ text: 'Line 1' }] },
          { level: 1, runs: [{ text: 'Line 2' }] },
        ],
      },
    };
    const result = serializePresentation(makePres([shape]));
    const tb = result.slides[0].nodes[0].textBody!;
    expect(tb.totalText).toBe('Line 1\nLine 2');
    expect(tb.paragraphs[1].level).toBe(1);
  });

  it('serializes picture node', () => {
    const pic: PicNodeData = {
      ...makeBase(),
      nodeType: 'picture',
      blipEmbed: 'rId1',
    };
    const result = serializePresentation(makePres([pic]));
    const node = result.slides[0].nodes[0];
    expect(node.nodeType).toBe('picture');
    expect(node.blipEmbed).toBe('rId1');
  });

  it('serializes 3D observations without raw XML nodes', () => {
    const contourColorSource = parseXml('<contourClr><schemeClr val="lt1"/></contourClr>');
    const shape: ShapeNodeData = {
      ...makeBase(),
      nodeType: 'shape',
      adjustments: new Map(),
      shape3d: {
        scene: {
          cameraPreset: 'orthographicFront',
          lightRig: 'twoPt',
          lightDirection: 't',
          lightRotation: { latitude: 0, longitude: 0, revolution: 120 },
        },
        shape: {
          extrusionHeight: 0,
          contourWidth: 0,
          bevelTop: {
            preset: 'circle',
            presetExplicit: false,
            width: 8 / 3,
            height: 2,
          },
          contourColor: { type: 'schemeClr', value: 'lt1' },
          contourColorSource,
        },
        effectKinds: [],
        parseIssues: [],
      },
    };

    const serialized = serializePresentation(makePres([shape])).slides[0].nodes[0];
    expect(serialized.shape3d).toEqual({
      scene: {
        cameraPreset: 'orthographicFront',
        lightRig: 'twoPt',
        lightDirection: 't',
        lightRotation: { latitude: 0, longitude: 0, revolution: 120 },
      },
      shape: {
        extrusionHeight: 0,
        contourWidth: 0,
        bevelTop: {
          preset: 'circle',
          presetExplicit: false,
          width: 8 / 3,
          height: 2,
        },
        contourColor: { type: 'schemeClr', value: 'lt1' },
      },
      effectKinds: [],
      parseIssues: [],
    });
    expect(JSON.stringify(serialized)).not.toContain('contourColorSource');
  });

  it('serializes table node', () => {
    const table: TableNodeData = {
      ...makeBase(),
      nodeType: 'table',
      columns: [100, 200],
      rows: [
        {
          height: 30,
          cells: [
            { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false, textBody: makeTextBody('A1') },
            { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false, textBody: makeTextBody('B1') },
          ],
        },
      ],
      tableStyleId: '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}',
    };
    const result = serializePresentation(makePres([table]));
    const node = result.slides[0].nodes[0];
    expect(node.nodeType).toBe('table');
    expect(node.columns).toEqual([100, 200]);
    expect(node.rows).toHaveLength(1);
    expect(node.rows![0].height).toBe(30);
    expect(node.rows![0].cells).toHaveLength(2);
    expect(node.rows![0].cells[0].text).toBe('A1');
    expect(node.rows![0].cells[0].gridSpan).toBe(1);
    expect(node.rows![0].cells[1].text).toBe('B1');
    expect(node.tableStyleId).toBe('{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}');
  });

  it('serializes table cell without text body', () => {
    const table: TableNodeData = {
      ...makeBase(),
      nodeType: 'table',
      columns: [100],
      rows: [
        {
          height: 30,
          cells: [{ gridSpan: 2, rowSpan: 1, hMerge: true, vMerge: false }],
        },
      ],
    };
    const result = serializePresentation(makePres([table]));
    const cell = result.slides[0].nodes[0].rows![0].cells[0];
    expect(cell.text).toBe('');
    expect(cell.gridSpan).toBe(2);
  });

  it('serializes chart node', () => {
    const chart: ChartNodeData = {
      ...makeBase(),
      nodeType: 'chart',
      chartPath: 'ppt/charts/chart1.xml',
    };
    const result = serializePresentation(makePres([chart]));
    const node = result.slides[0].nodes[0];
    expect(node.nodeType).toBe('chart');
    expect(node.chartPath).toBe('ppt/charts/chart1.xml');
  });

  it('serializes group with shape children', () => {
    // Create a real XML for group children so parseGroupChild can parse them
    const xml = parseXml(`
      <grpSp xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <nvGrpSpPr>
          <cNvPr id="10" name="group"/>
          <nvPr/>
        </nvGrpSpPr>
        <grpSpPr>
          <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/>
            <chOff x="0" y="0"/><chExt cx="914400" cy="914400"/>
          </xfrm>
        </grpSpPr>
        <sp>
          <nvSpPr><cNvPr id="11" name="child-shape"/><nvPr/></nvSpPr>
          <spPr>
            <xfrm><off x="0" y="0"/><ext cx="457200" cy="457200"/></xfrm>
            <prstGeom prst="rect"><avLst/></prstGeom>
          </spPr>
        </sp>
      </grpSp>
    `);

    // Extract child <sp> node
    const childSp = xml.child('sp');

    const group: GroupNodeData = {
      ...makeBase({ id: '10', name: 'group' }),
      nodeType: 'group',
      childOffset: { x: 0, y: 0 },
      childExtent: { w: 96, h: 96 },
      children: [childSp],
    };
    const result = serializePresentation(makePres([group]));
    const node = result.slides[0].nodes[0];
    expect(node.nodeType).toBe('group');
    expect(node.children).toHaveLength(1);
    expect(node.children![0].nodeType).toBe('shape');
    expect(node.children![0].name).toBe('child-shape');
  });

  it('serializes retained group-level scene3d semantics without XML wrappers', () => {
    const groupXml = parseXml(`
      <grpSp xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <nvGrpSpPr><cNvPr id="10" name="camera group"/><nvPr/></nvGrpSpPr>
        <grpSpPr>
          <xfrm><off x="0" y="0"/><ext cx="914400" cy="457200"/></xfrm>
          <scene3d>
            <camera prst="perspectiveLeft" fov="5700000">
              <rot lat="0" lon="1500000" rev="0"/>
            </camera>
            <lightRig rig="threePt" dir="t"/>
          </scene3d>
        </grpSpPr>
      </grpSp>
    `);
    const group = parseGroupNode(groupXml);

    const serialized = serializePresentation(makePres([group])).slides[0].nodes[0];

    expect(serialized.shape3d).toEqual({
      scene: {
        cameraPreset: 'perspectiveLeft',
        fieldOfView: 95,
        cameraZoom: undefined,
        cameraRotation: { latitude: 0, longitude: 25, revolution: 0 },
        lightRig: 'threePt',
        lightDirection: 't',
        lightRotation: undefined,
      },
      shape: undefined,
      effectKinds: [],
      parseIssues: [],
    });
  });

  it('serializes group chart children', () => {
    const xml = parseXml(`
      <grpSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <graphicFrame>
          <nvGraphicFramePr><cNvPr id="12" name="child-chart"/><nvPr/></nvGraphicFramePr>
          <xfrm><off x="0" y="0"/><ext cx="914400" cy="457200"/></xfrm>
          <a:graphic>
            <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
              <c:chart r:id="rIdChart"/>
            </a:graphicData>
          </a:graphic>
        </graphicFrame>
      </grpSp>
    `);
    const chartFrame = xml.child('graphicFrame');
    const group: GroupNodeData = {
      ...makeBase({ id: '10', name: 'group' }),
      nodeType: 'group',
      childOffset: { x: 0, y: 0 },
      childExtent: { w: 96, h: 96 },
      children: [chartFrame],
    };
    const pres = makePres([group]);
    pres.slides[0].rels = new Map([
      ['rIdChart', { type: 'chart', target: '../charts/chart1.xml' }],
    ]);

    const result = serializePresentation(pres);
    const child = result.slides[0].nodes[0].children![0];
    expect(child.nodeType).toBe('chart');
    expect(child.chartPath).toBe('ppt/charts/chart1.xml');
  });

  it('serializes group OLE fallback picture children', () => {
    const xml = parseXml(`
      <grpSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <graphicFrame>
          <nvGraphicFramePr><cNvPr id="13" name="child-ole"/><nvPr/></nvGraphicFramePr>
          <xfrm><off x="0" y="0"/><ext cx="914400" cy="457200"/></xfrm>
          <a:graphic>
            <a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole">
              <mc:AlternateContent>
                <mc:Fallback>
                  <p:oleObj>
                    <p:pic>
                      <p:blipFill><a:blip r:embed="rIdPreview"/></p:blipFill>
                    </p:pic>
                  </p:oleObj>
                </mc:Fallback>
              </mc:AlternateContent>
            </a:graphicData>
          </a:graphic>
        </graphicFrame>
      </grpSp>
    `);
    const oleFrame = xml.child('graphicFrame');
    const group: GroupNodeData = {
      ...makeBase({ id: '10', name: 'group' }),
      nodeType: 'group',
      childOffset: { x: 0, y: 0 },
      childExtent: { w: 96, h: 96 },
      children: [oleFrame],
    };

    const result = serializePresentation(makePres([group]));
    const child = result.slides[0].nodes[0].children![0];
    expect(child.nodeType).toBe('picture');
    expect(child.blipEmbed).toBe('rIdPreview');
  });

  it('serializes group SmartArt fallback children', () => {
    const group: GroupNodeData = {
      ...makeBase({ id: '10', name: 'group' }),
      nodeType: 'group',
      childOffset: { x: 0, y: 0 },
      childExtent: { w: 96, h: 96 },
      children: [makeDiagramGraphicFrame()],
    };
    const pres = makePres([group]);
    pres.slides[0].rels = new Map([
      [
        'rIdData',
        {
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData',
          target: '../diagrams/data7.xml',
        },
      ],
      [
        'rIdDrawing',
        {
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramDrawing',
          target: '../diagrams/drawing7.xml',
        },
      ],
    ]);
    (pres as any).diagramDrawings = new Map([['ppt/diagrams/drawing7.xml', diagramDrawingXml()]]);

    const result = serializePresentation(pres);
    const child = result.slides[0].nodes[0].children![0];
    expect(child.nodeType).toBe('group');
    expect(child.children).toHaveLength(1);
    expect(child.children![0].textBody?.totalText).toBe('Serialized SmartArt label');
  });

  it('serializes inherited placeholder geometry for lazy group children', () => {
    const placeholder = makeGroupedPlaceholderXml();
    placeholder.child('spPr').child('xfrm').element!.remove();
    const group: GroupNodeData = {
      ...makeBase({
        id: '10',
        name: 'group',
        position: { x: 50, y: 30 },
        size: { w: 200, h: 100 },
      }),
      nodeType: 'group',
      childOffset: { x: 0, y: 0 },
      childExtent: { w: 400, h: 200 },
      children: [placeholder],
    };
    const pres = makePres([group]);
    const layoutPath = 'ppt/slideLayouts/slideLayout1.xml';
    pres.slideToLayout.set(0, layoutPath);
    pres.layouts.set(layoutPath, {
      placeholders: [
        {
          node: makeLayoutPlaceholderXml(),
          absoluteXfrm: { position: { x: 100, y: 60 }, size: { w: 40, h: 20 } },
        },
      ],
      spTree: emptyXml,
      rels: new Map(),
      showMasterSp: true,
    });

    const result = serializePresentation(pres);
    const child = result.slides[0].nodes[0].children![0];

    expect(child.textBody?.totalText).toBe('Serialized inherited placeholder');
    expect(child.position).toEqual({ x: 100, y: 60 });
    expect(child.size).toEqual({ w: 80, h: 40 });
  });
  it('serializes explicit zero geometry for lazy group placeholders', () => {
    const group: GroupNodeData = {
      ...makeBase({
        id: '10',
        name: 'group',
        position: { x: 50, y: 30 },
        size: { w: 200, h: 100 },
      }),
      nodeType: 'group',
      childOffset: { x: 0, y: 0 },
      childExtent: { w: 400, h: 200 },
      children: [makeGroupedPlaceholderXml()],
    };
    const pres = makePres([group]);
    const layoutPath = 'ppt/slideLayouts/slideLayout1.xml';
    pres.slideToLayout.set(0, layoutPath);
    pres.layouts.set(layoutPath, {
      placeholders: [
        {
          node: makeLayoutPlaceholderXml(),
          absoluteXfrm: { position: { x: 100, y: 60 }, size: { w: 40, h: 20 } },
        },
      ],
      spTree: emptyXml,
      rels: new Map(),
      showMasterSp: true,
    });

    const result = serializePresentation(pres);
    const child = result.slides[0].nodes[0].children![0];

    expect(child.textBody?.totalText).toBe('Serialized inherited placeholder');
    expect(child.position).toEqual({ x: 0, y: 0 });
    expect(child.size).toEqual({ w: 0, h: 0 });
  });

  it('serializes group with unparseable children gracefully', () => {
    // An unknown tag that parseGroupChild will skip
    const xml = parseXml(`<root><unknownElement/></root>`);
    const unknownChild = xml.child('unknownElement');

    const group: GroupNodeData = {
      ...makeBase(),
      nodeType: 'group',
      childOffset: { x: 0, y: 0 },
      childExtent: { w: 96, h: 96 },
      children: [unknownChild],
    };
    const result = serializePresentation(makePres([group]));
    expect(result.slides[0].nodes[0].children).toHaveLength(0);
  });

  it('preserves base node properties', () => {
    const shape: ShapeNodeData = {
      ...makeBase({
        id: '42',
        name: 'rotated-shape',
        position: { x: 100, y: 200 },
        size: { w: 300, h: 400 },
        rotation: 45,
        flipH: true,
        flipV: true,
      }),
      nodeType: 'shape',
      adjustments: new Map(),
    };
    const result = serializePresentation(makePres([shape]));
    const node = result.slides[0].nodes[0];
    expect(node.id).toBe('42');
    expect(node.name).toBe('rotated-shape');
    expect(node.position).toEqual({ x: 100, y: 200 });
    expect(node.size).toEqual({ w: 300, h: 400 });
    expect(node.rotation).toBe(45);
    expect(node.flipH).toBe(true);
    expect(node.flipV).toBe(true);
  });

  it('serializes multiple slides', () => {
    const pres = makePres([]);
    pres.slides.push({
      index: 1,
      nodes: [
        { ...makeBase({ id: '2' }), nodeType: 'shape', adjustments: new Map() } as ShapeNodeData,
      ],
      rels: new Map(),
      showMasterSp: true,
    });
    const result = serializePresentation(pres);
    expect(result.slideCount).toBe(2);
    expect(result.slides[1].index).toBe(1);
    expect(result.slides[1].nodes).toHaveLength(1);
  });
});

describe('serializePresentation layout and master template shapes', () => {
  function templateXml(name: string, ph?: string) {
    const nvPr = ph ? `<p:nvPr>${ph}</p:nvPr>` : '<p:nvPr/>';
    return `
      <p:sp>
        <p:nvSpPr><p:cNvPr id="1" name="${name}"/><p:cNvSpPr/>${nvPr}</p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="914400"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
      </p:sp>
    `;
  }

  function spTreeXml(shapes: string) {
    return parseXml(`
      <p:spTree xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        ${shapes}
      </p:spTree>
    `);
  }

  function presWithTemplates(opts: { layout?: string; master?: string; showMasterSp?: boolean }) {
    const pres = makePres([]);
    pres.slides[0].showMasterSp = opts.showMasterSp ?? true;

    if (opts.layout !== undefined) {
      pres.layouts.set('ppt/slideLayouts/slideLayout1.xml', {
        placeholders: [],
        spTree: spTreeXml(opts.layout),
        rels: new Map(),
        showMasterSp: true,
      });
      pres.slideToLayout.set(0, 'ppt/slideLayouts/slideLayout1.xml');
    }
    if (opts.master !== undefined) {
      pres.masters.set('ppt/slideMasters/slideMaster1.xml', {
        colorMap: new Map(),
        textStyles: {},
        placeholders: [],
        spTree: spTreeXml(opts.master),
        rels: new Map(),
      });
      pres.layoutToMaster.set(
        'ppt/slideLayouts/slideLayout1.xml',
        'ppt/slideMasters/slideMaster1.xml',
      );
    }
    return pres;
  }

  it('emits empty collections for a presentation with no layouts or masters', () => {
    const result = serializePresentation(makePres([]));
    expect(result.layouts).toEqual([]);
    expect(result.masters).toEqual([]);
    expect(result.slides[0].layoutPath).toBeUndefined();
    expect(result.slides[0].masterPath).toBeUndefined();
  });

  it('serializes layout decoration shapes as typed nodes', () => {
    const result = serializePresentation(
      presWithTemplates({ layout: templateXml('Freeform 28') + templateXml('Oval 29') }),
    );
    expect(result.layouts).toHaveLength(1);
    expect(result.layouts[0].path).toBe('ppt/slideLayouts/slideLayout1.xml');
    expect(result.layouts[0].nodes.map((n) => n.name)).toEqual(['Freeform 28', 'Oval 29']);
    expect(result.layouts[0].nodes[0].nodeType).toBe('shape');
    expect(result.layouts[0].nodes[0].size).toEqual({ w: 192, h: 96 });
  });

  it('serializes master decoration shapes as typed nodes', () => {
    const result = serializePresentation(
      presWithTemplates({ layout: '', master: templateXml('Master logo') }),
    );
    expect(result.masters).toHaveLength(1);
    expect(result.masters[0].path).toBe('ppt/slideMasters/slideMaster1.xml');
    expect(result.masters[0].nodes.map((n) => n.name)).toEqual(['Master logo']);
  });

  it('omits placeholder shapes from both collections', () => {
    const result = serializePresentation(
      presWithTemplates({
        layout: templateXml('Title 1', '<p:ph type="title"/>') + templateXml('Rectangle 3'),
        master: templateXml('Body 2', '<p:ph type="body" idx="1"/>'),
      }),
    );
    expect(result.layouts[0].nodes.map((n) => n.name)).toEqual(['Rectangle 3']);
    expect(result.masters[0].nodes).toEqual([]);
  });

  it('links each slide to its layout and master', () => {
    const result = serializePresentation(
      presWithTemplates({ layout: templateXml('deco'), master: templateXml('logo') }),
    );
    expect(result.slides[0].layoutPath).toBe('ppt/slideLayouts/slideLayout1.xml');
    expect(result.slides[0].masterPath).toBe('ppt/slideMasters/slideMaster1.xml');
  });

  it('reports showMasterSp so a consumer can honor master suppression', () => {
    const result = serializePresentation(
      presWithTemplates({ layout: '', master: templateXml('logo'), showMasterSp: false }),
    );
    expect(result.slides[0].showMasterSp).toBe(false);
    expect(result.layouts[0].showMasterSp).toBe(true);
    // The master is still serialized; whether it draws is the consumer's decision.
    expect(result.masters[0].nodes).toHaveLength(1);
  });

  it('serializes a shared layout once, not once per slide', () => {
    const pres = presWithTemplates({ layout: templateXml('deco') });
    pres.slides.push({ index: 1, nodes: [], rels: new Map(), showMasterSp: true });
    pres.slideToLayout.set(1, 'ppt/slideLayouts/slideLayout1.xml');
    const result = serializePresentation(pres);
    expect(result.layouts).toHaveLength(1);
    expect(result.slides.map((s) => s.layoutPath)).toEqual([
      'ppt/slideLayouts/slideLayout1.xml',
      'ppt/slideLayouts/slideLayout1.xml',
    ]);
  });

  it('omits a layout no slide uses', () => {
    const pres = presWithTemplates({ layout: templateXml('deco') });
    pres.layouts.set('ppt/slideLayouts/slideLayout9.xml', {
      placeholders: [],
      spTree: spTreeXml(templateXml('unused')),
      rels: new Map(),
      showMasterSp: true,
    });
    const result = serializePresentation(pres);
    expect(result.layouts.map((l) => l.path)).toEqual(['ppt/slideLayouts/slideLayout1.xml']);
  });
});
