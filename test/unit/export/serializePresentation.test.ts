import { describe, expect, it } from 'vitest';
import { serializePresentation } from '../../../src/export/serializePresentation';
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
      nodes: [{ ...makeBase({ id: '2' }), nodeType: 'shape', adjustments: new Map() } as ShapeNodeData],
      rels: new Map(),
      showMasterSp: true,
    });
    const result = serializePresentation(pres);
    expect(result.slideCount).toBe(2);
    expect(result.slides[1].index).toBe(1);
    expect(result.slides[1].nodes).toHaveLength(1);
  });
});
