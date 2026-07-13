import { describe, expect, it } from 'vitest';
import { buildTextIndex, searchPresentation, searchText } from '../../../src/search/TextSearch';
import type { PresentationData } from '../../../src/model/Presentation';
import type { LayoutData } from '../../../src/model/Layout';
import type { MasterData } from '../../../src/model/Master';
import type { ShapeNodeData, TextBody } from '../../../src/model/nodes/ShapeNode';
import type { TableNodeData } from '../../../src/model/nodes/TableNode';
import type { GroupNodeData } from '../../../src/model/nodes/GroupNode';
import { SafeXmlNode, parseXml } from '../../../src/parser/XmlParser';

const emptySource = new SafeXmlNode(null);

const textBody = (...paragraphs: string[]): TextBody => ({
  paragraphs: paragraphs.map((text) => ({
    level: 0,
    runs: [{ text }],
  })),
});

const shape = (id: string, text: string, slideOffset = 0): ShapeNodeData => ({
  id,
  name: id,
  nodeType: 'shape',
  position: { x: 10 + slideOffset, y: 20 },
  size: { w: 240, h: 80 },
  rotation: 0,
  flipH: false,
  flipV: false,
  adjustments: new Map(),
  textBody: textBody(text),
  source: emptySource,
});

const table = (id: string, cells: string[][]): TableNodeData => ({
  id,
  name: id,
  nodeType: 'table',
  position: { x: 40, y: 120 },
  size: { w: 400, h: 160 },
  rotation: 0,
  flipH: false,
  flipV: false,
  columns: [200, 200],
  rows: cells.map((row) => ({
    height: 40,
    cells: row.map((cellText) => ({
      gridSpan: 1,
      rowSpan: 1,
      hMerge: false,
      vMerge: false,
      textBody: textBody(cellText),
    })),
  })),
  source: emptySource,
});

const templateShape = (id: string, name: string, text: string, placeholder = false): string => `
  <sp>
    <nvSpPr>
      <cNvPr id="${id}" name="${name}"/>
      <nvPr>${placeholder ? '<ph type="body" idx="1"/>' : ''}</nvPr>
    </nvSpPr>
    <spPr>
      <xfrm>
        <off x="914400" y="457200"/>
        <ext cx="1828800" cy="457200"/>
      </xfrm>
    </spPr>
    <txBody>
      <bodyPr/>
      <lstStyle/>
      <p><r><t>${text}</t></r></p>
    </txBody>
  </sp>
`;

const diagramGraphicFrame = (): SafeXmlNode =>
  parseXml(`
    <graphicFrame xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                  xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"
                  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <nvGraphicFramePr><cNvPr id="71" name="diagram-frame"/><nvPr/></nvGraphicFramePr>
      <xfrm><off x="0" y="0"/><ext cx="1828800" cy="914400"/></xfrm>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram">
          <dgm:relIds r:dm="rIdData"/>
        </a:graphicData>
      </a:graphic>
    </graphicFrame>
  `);

const diagramDrawingXml = (): string => `
  <dsp:drawing xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram"
               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
    <dsp:spTree>
      <dsp:sp>
        <dsp:nvSpPr><dsp:cNvPr id="72" name="diagram-label"/><dsp:nvPr/></dsp:nvSpPr>
        <dsp:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </dsp:spPr>
        <dsp:txBody>
          <a:bodyPr/><a:lstStyle/>
          <a:p><a:r><a:t>Searchable SmartArt label</a:t></a:r></a:p>
        </dsp:txBody>
      </dsp:sp>
    </dsp:spTree>
  </dsp:drawing>
`;

const spTree = (...children: string[]): SafeXmlNode =>
  parseXml(`
    <spTree xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      ${children.join('\n')}
    </spTree>
  `);

const emu = (px: number): number => Math.round(px * 9525);

const presentation = (): PresentationData => ({
  width: 960,
  height: 540,
  slides: [
    {
      index: 0,
      nodes: [
        shape('title', 'GPU 算力 overview'),
        table('capacity-table', [
          ['Region', '算力池 A'],
          ['East', 'GPU capacity'],
        ]),
      ],
      layoutIndex: '',
      rels: new Map(),
      showMasterSp: true,
      slidePath: 'ppt/slides/slide1.xml',
    },
    {
      index: 1,
      nodes: [shape('detail', 'cpu capacity and gpu quota', 20)],
      layoutIndex: '',
      rels: new Map(),
      showMasterSp: true,
      slidePath: 'ppt/slides/slide2.xml',
    },
  ],
  layouts: new Map(),
  masters: new Map(),
  themes: new Map(),
  slideToLayout: new Map(),
  layoutToMaster: new Map(),
  masterToTheme: new Map(),
  media: new Map(),
  charts: new Map(),
  isWps: false,
});

const withTemplateText = (): PresentationData => {
  const pres = presentation();
  const layoutPath = 'ppt/slideLayouts/slideLayout1.xml';
  const masterPath = 'ppt/slideMasters/slideMaster1.xml';

  const layout: LayoutData = {
    spTree: spTree(
      templateShape('31', 'layout-footer', 'Visible layout footer'),
      templateShape('32', 'layout-placeholder', 'Hidden layout placeholder', true),
    ),
    placeholders: [],
    rels: new Map(),
    showMasterSp: true,
  };
  const master: MasterData = {
    colorMap: new Map(),
    textStyles: {},
    spTree: spTree(
      templateShape('41', 'master-brand', 'Visible master brand'),
      templateShape('42', 'master-placeholder', 'Hidden master placeholder', true),
    ),
    placeholders: [],
    rels: new Map(),
  };

  pres.slideToLayout.set(0, layoutPath);
  pres.layoutToMaster.set(layoutPath, masterPath);
  pres.layouts.set(layoutPath, layout);
  pres.masters.set(masterPath, master);
  return pres;
};

describe('buildTextIndex', () => {
  it('extracts searchable text entries from shapes and table cells', () => {
    const index = buildTextIndex(presentation());

    expect(index.map((entry) => entry.text)).toEqual([
      'GPU 算力 overview',
      'Region',
      '算力池 A',
      'East',
      'GPU capacity',
      'cpu capacity and gpu quota',
    ]);
    expect(index[0]).toMatchObject({
      slideIndex: 0,
      nodeId: 'title',
      nodePath: 'slides/0/nodes/title',
      nodeType: 'shape',
      textKind: 'shape',
      bounds: { x: 10, y: 20, w: 240, h: 80 },
    });
    expect(index[2]).toMatchObject({
      nodeId: 'capacity-table',
      textKind: 'table-cell',
      rowIndex: 0,
      cellIndex: 1,
    });
  });

  it('indexes visible non-placeholder text from slide layouts and masters', () => {
    const index = buildTextIndex(withTemplateText());
    const slide0Texts = index.filter((entry) => entry.slideIndex === 0).map((entry) => entry.text);

    expect(slide0Texts).toContain('Visible layout footer');
    expect(slide0Texts).toContain('Visible master brand');
    expect(slide0Texts).not.toContain('Hidden layout placeholder');
    expect(slide0Texts).not.toContain('Hidden master placeholder');

    expect(searchPresentation(withTemplateText(), 'master brand')).toMatchObject([
      {
        slideIndex: 0,
        nodeId: '41',
        nodePath: 'slides/0/master/nodes/41',
      },
    ]);
  });

  it('respects template visibility flags when indexing slide text', () => {
    const hiddenSlideTemplates = withTemplateText();
    hiddenSlideTemplates.slides[0].showMasterSp = false;
    expect(buildTextIndex(hiddenSlideTemplates).map((entry) => entry.text)).not.toEqual(
      expect.arrayContaining(['Visible layout footer', 'Visible master brand']),
    );

    const hiddenMasterTemplates = withTemplateText();
    hiddenMasterTemplates.layouts.get('ppt/slideLayouts/slideLayout1.xml')!.showMasterSp = false;
    const texts = buildTextIndex(hiddenMasterTemplates).map((entry) => entry.text);
    expect(texts).toContain('Visible layout footer');
    expect(texts).not.toContain('Visible master brand');
  });

  it('reports group child text bounds in slide coordinates', () => {
    const child = parseXml(templateShape('51', 'grouped-label', 'Grouped label'));
    const group: GroupNodeData = {
      id: 'group',
      name: 'group',
      nodeType: 'group',
      position: { x: 50, y: 30 },
      size: { w: 384, h: 192 },
      rotation: 0,
      flipH: false,
      flipV: false,
      childOffset: { x: 0, y: 0 },
      childExtent: { w: 192, h: 96 },
      children: [child],
      source: emptySource,
    };
    const pres = presentation();
    pres.slides[0].nodes = [group];

    expect(buildTextIndex(pres).find((entry) => entry.text === 'Grouped label')).toMatchObject({
      nodePath: 'slides/0/nodes/group/children/0/51',
      bounds: { x: 242, y: 126, w: 384, h: 96 },
    });
  });

  it('keeps group child coordinates stable when childExtent is degenerate', () => {
    const child = parseXml(templateShape('52', 'degenerate-group-label', 'Degenerate group label'));
    const group: GroupNodeData = {
      id: 'degenerate-group',
      name: 'degenerate-group',
      nodeType: 'group',
      position: { x: 80, y: 60 },
      size: { w: 300, h: 180 },
      rotation: 0,
      flipH: false,
      flipV: false,
      childOffset: { x: 0, y: 0 },
      childExtent: { w: 0, h: 0 },
      children: [child],
      source: emptySource,
    };
    const pres = presentation();
    pres.slides[0].nodes = [group];

    const entry = buildTextIndex(pres).find((item) => item.text === 'Degenerate group label');

    expect(entry?.bounds).toMatchObject({ x: 176, y: 108, w: 192, h: 48 });
  });

  it('matches renderer bounds along the populated axis of a horizontal flat group', () => {
    const group: GroupNodeData = {
      id: 'horizontal-flat-group',
      name: 'horizontal-flat-group',
      nodeType: 'group',
      position: { x: 10, y: 20 },
      size: { w: 400, h: 0 },
      rotation: 0,
      flipH: false,
      flipV: false,
      childOffset: { x: 50, y: 25 },
      childExtent: { w: 200, h: 0 },
      children: [parseXml(templateShape('53', 'horizontal-flat-label', 'Horizontal flat label'))],
      source: emptySource,
    };
    const pres = presentation();
    pres.slides[0].nodes = [group];

    const entry = buildTextIndex(pres).find((item) => item.text === 'Horizontal flat label');

    expect(entry?.bounds).toMatchObject({ x: 102, y: 43, w: 384, h: 48 });
  });

  it('matches renderer bounds along the populated axis of a vertical flat group', () => {
    const group: GroupNodeData = {
      id: 'vertical-flat-group',
      name: 'vertical-flat-group',
      nodeType: 'group',
      position: { x: 10, y: 20 },
      size: { w: 0, h: 400 },
      rotation: 0,
      flipH: false,
      flipV: false,
      childOffset: { x: 50, y: 25 },
      childExtent: { w: 0, h: 200 },
      children: [parseXml(templateShape('54', 'vertical-flat-label', 'Vertical flat label'))],
      source: emptySource,
    };
    const pres = presentation();
    pres.slides[0].nodes = [group];

    const entry = buildTextIndex(pres).find((item) => item.text === 'Vertical flat label');

    expect(entry?.bounds).toMatchObject({ x: 56, y: 66, w: 192, h: 96 });
  });

  it('ignores shapes without a text body while continuing to index later nodes', () => {
    const noTextShape: ShapeNodeData = {
      ...shape('empty-shape', ''),
      textBody: undefined,
    };
    const pres = presentation();
    pres.slides[0].nodes = [noTextShape, shape('later-shape', 'Later searchable text')];

    const index = buildTextIndex(pres);

    expect(index.map((entry) => entry.nodeId)).toContain('later-shape');
    expect(index.map((entry) => entry.nodeId)).not.toContain('empty-shape');
  });

  it('indexes inherited placeholder bounds for lazy group children', () => {
    const child = parseXml(`
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="71" name="grouped-placeholder"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="body" idx="1"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:r><a:t>Inherited grouped placeholder</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    `);
    const layoutPlaceholder = parseXml(`
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="72" name="layout-placeholder"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="body" idx="1"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="${emu(100)}" y="${emu(60)}"/>
            <a:ext cx="${emu(40)}" cy="${emu(20)}"/>
          </a:xfrm>
        </p:spPr>
      </p:sp>
    `);
    const group: GroupNodeData = {
      id: 'placeholder-group',
      name: 'placeholder-group',
      nodeType: 'group',
      position: { x: 50, y: 30 },
      size: { w: 200, h: 100 },
      rotation: 0,
      flipH: false,
      flipV: false,
      childOffset: { x: 0, y: 0 },
      childExtent: { w: 400, h: 200 },
      children: [child],
      source: emptySource,
    };
    const pres = presentation();
    const layoutPath = 'ppt/slideLayouts/slideLayout1.xml';
    pres.slides[0].nodes = [group];
    pres.slideToLayout.set(0, layoutPath);
    pres.layouts.set(layoutPath, {
      placeholders: [
        {
          node: layoutPlaceholder,
          absoluteXfrm: { position: { x: 100, y: 60 }, size: { w: 40, h: 20 } },
        },
      ],
      spTree: emptySource,
      rels: new Map(),
      showMasterSp: true,
    });

    const result = buildTextIndex(pres).find(
      (entry) => entry.text === 'Inherited grouped placeholder',
    );

    expect(result?.bounds).toEqual({ x: 100, y: 60, w: 40, h: 20 });
  });

  it('matches renderer bounds for quarter-turn rotated group children', () => {
    const child = parseXml(`
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="61" name="rotated-grouped-label"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm rot="16200000">
            <a:off x="${emu(280)}" y="${emu(-280)}"/>
            <a:ext cx="${emu(40)}" cy="${emu(600)}"/>
          </a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:r><a:t>Rotated grouped label</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    `);
    const group: GroupNodeData = {
      id: 'rotated-group',
      name: 'rotated-group',
      nodeType: 'group',
      position: { x: 0, y: 0 },
      size: { w: 500, h: 40 },
      rotation: 0,
      flipH: false,
      flipV: false,
      childOffset: { x: 0, y: 0 },
      childExtent: { w: 600, h: 40 },
      children: [child],
      source: emptySource,
    };
    const pres = presentation();
    pres.slides[0].nodes = [group];

    const result = buildTextIndex(pres).find((entry) => entry.text === 'Rotated grouped label');
    expect(result?.bounds.x).toBeCloseTo(230);
    expect(result?.bounds.y).toBeCloseTo(-230);
    expect(result?.bounds.w).toBeCloseTo(40);
    expect(result?.bounds.h).toBeCloseTo(500);
  });

  it('indexes text from SmartArt fallback drawings inside slide groups', () => {
    const group: GroupNodeData = {
      id: 'smartart-group',
      name: 'smartart-group',
      nodeType: 'group',
      position: { x: 0, y: 0 },
      size: { w: 192, h: 96 },
      rotation: 0,
      flipH: false,
      flipV: false,
      childOffset: { x: 0, y: 0 },
      childExtent: { w: 192, h: 96 },
      children: [diagramGraphicFrame()],
      source: emptySource,
    };
    const pres = presentation();
    pres.slides[0].nodes = [group];
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

    expect(buildTextIndex(pres).map((entry) => entry.text)).toContain('Searchable SmartArt label');
  });

  it('respects includeShapes, includeTables, and includeGroups options independently', () => {
    const pres = presentation();
    pres.slides[0].nodes.push({
      id: 'group',
      name: 'group',
      nodeType: 'group',
      position: { x: 0, y: 0 },
      size: { w: 100, h: 100 },
      rotation: 0,
      flipH: false,
      flipV: false,
      childOffset: { x: 0, y: 0 },
      childExtent: { w: 100, h: 100 },
      children: [parseXml(templateShape('91', 'nested', 'Grouped search text'))],
      source: emptySource,
    });

    expect(buildTextIndex(pres, { includeShapes: false }).map((entry) => entry.text)).not.toContain(
      'GPU 算力 overview',
    );
    expect(buildTextIndex(pres, { includeTables: false }).map((entry) => entry.text)).not.toContain(
      'Region',
    );
    expect(buildTextIndex(pres, { includeGroups: false }).map((entry) => entry.text)).not.toContain(
      'Grouped search text',
    );
  });

  it('skips non-renderable group children without aborting text indexing', () => {
    const pres = presentation();
    pres.slides = [pres.slides[0]];
    pres.slides[0].nodes = [
      {
        id: 'mixed-group',
        name: 'mixed-group',
        nodeType: 'group',
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        rotation: 0,
        flipH: false,
        flipV: false,
        childOffset: { x: 0, y: 0 },
        childExtent: { w: 100, h: 100 },
        children: [
          parseXml('<unknown/>'),
          parseXml(templateShape('92', 'nested', 'Still indexed')),
        ],
        source: emptySource,
      },
    ];

    expect(buildTextIndex(pres).map((entry) => entry.text)).toEqual(['Still indexed']);
  });
});

describe('searchText', () => {
  it('returns case-insensitive matches with slide and node locations', () => {
    const results = searchText(buildTextIndex(presentation()), 'GPU');

    expect(results).toHaveLength(3);
    expect(results.map((result) => [result.slideIndex, result.nodeId])).toEqual([
      [0, 'title'],
      [0, 'capacity-table'],
      [1, 'detail'],
    ]);
    expect(results[0]).toMatchObject({
      matchStart: 0,
      matchEnd: 3,
      snippet: 'GPU 算力 overview',
    });
  });

  it('supports case-sensitive string searches when matchCase is enabled', () => {
    const results = searchText(buildTextIndex(presentation()), 'GPU', { matchCase: true });

    expect(results.map((result) => result.text)).toEqual(['GPU 算力 overview', 'GPU capacity']);
  });

  it('respects RegExp flags instead of applying matchCase options', () => {
    const index = buildTextIndex(presentation());

    expect(searchText(index, /GPU/, { matchCase: false }).map((result) => result.text)).toEqual([
      'GPU 算力 overview',
      'GPU capacity',
    ]);
    expect(searchText(index, /GPU/i, { matchCase: true })).toHaveLength(3);
  });

  it('supports CJK text search without word-boundary assumptions', () => {
    const results = searchPresentation(presentation(), '算力');

    expect(results.map((result) => result.text)).toEqual(['GPU 算力 overview', '算力池 A']);
  });

  it('supports whole-word searches for ASCII terms', () => {
    const results = searchPresentation(presentation(), 'cap', { wholeWord: true });

    expect(results).toEqual([]);
    expect(searchPresentation(presentation(), 'capacity', { wholeWord: true })).toHaveLength(2);
  });

  it('returns no results for an empty string query', () => {
    expect(searchText(buildTextIndex(presentation()), '')).toEqual([]);
  });

  it('advances zero-length regular expression matches without looping forever', () => {
    const index = buildTextIndex(presentation()).slice(0, 1);

    expect(searchText(index, /^/g)).toEqual([]);
  });

  it('supports regex strings and clipped snippets', () => {
    const results = searchText(buildTextIndex(presentation()), 'GPU|cpu', {
      useRegex: true,
      snippetRadius: 4,
    });

    expect(results.map((result) => result.matchStart)).toEqual([0, 0, 0, 17]);
    expect(results[3].snippet).toBe('...and gpu quo...');
  });
});
