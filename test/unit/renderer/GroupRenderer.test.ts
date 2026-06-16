/**
 * Unit tests for GroupRenderer — specifically the renderGroup function and the
 * parseGroupChild dispatch logic exercised through it.
 *
 * parseGroupChild is unexported, so every branch is reached via renderGroup by
 * supplying group nodes whose children[] array contains raw SafeXmlNode values
 * with the appropriate localName.
 */

import { describe, expect, it, vi } from 'vitest';
import { renderGroup } from '../../../src/renderer/GroupRenderer';
import { parseXml, SafeXmlNode } from '../../../src/parser/XmlParser';
import { createMockRenderContext } from '../helpers/mockContext';
import type { GroupNodeData } from '../../../src/model/nodes/GroupNode';
import type { RenderContext } from '../../../src/renderer/RenderContext';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Null-backed empty node – a safe XML wrapper around nothing. */
const emptyXml = new SafeXmlNode(null);

/**
 * Build a minimal GroupNodeData ready for renderGroup.
 * childOffset / childExtent default to a 1:1 mapping with groupW x groupH so
 * remapping arithmetic is trivially verifiable (scale factor = 1).
 */
function makeGroup(
  children: SafeXmlNode[],
  opts: {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    childOffsetX?: number;
    childOffsetY?: number;
    childExtentW?: number;
    childExtentH?: number;
    rotation?: number;
    flipH?: boolean;
    flipV?: boolean;
    source?: SafeXmlNode;
  } = {},
): GroupNodeData {
  const w = opts.w ?? 200;
  const h = opts.h ?? 100;
  return {
    id: 'grp1',
    name: 'Group 1',
    nodeType: 'group',
    position: { x: opts.x ?? 10, y: opts.y ?? 20 },
    size: { w, h },
    rotation: opts.rotation ?? 0,
    flipH: opts.flipH ?? false,
    flipV: opts.flipV ?? false,
    source: opts.source ?? emptyXml,
    childOffset: { x: opts.childOffsetX ?? 0, y: opts.childOffsetY ?? 0 },
    childExtent: { w: opts.childExtentW ?? w, h: opts.childExtentH ?? h },
    children,
    placeholder: undefined,
  };
}

/**
 * Parse a raw XML string and return the root as SafeXmlNode.
 * The string must declare any namespaces it uses.
 */
function xml(raw: string): SafeXmlNode {
  return parseXml(raw);
}

/**
 * A minimal shape XML child usable as a 'sp' group child.
 * Dimensions are in EMU (914400 EMU = 96 px at 96 dpi).
 */
function makeSpXml(id = '1', name = 'Shape'): SafeXmlNode {
  return xml(`
    <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:nvSpPr>
        <p:cNvPr id="${id}" name="${name}"/>
        <p:cNvSpPr/>
        <p:nvPr/>
      </p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </p:spPr>
    </p:sp>
  `);
}

function makePlaceholderSpXml(id = '101', name = 'Grouped Placeholder'): SafeXmlNode {
  return xml(`
    <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:nvSpPr>
        <p:cNvPr id="${id}" name="${name}"/>
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
        <a:p><a:r><a:t>Grouped placeholder text</a:t></a:r></a:p>
      </p:txBody>
    </p:sp>
  `);
}

function makeTxXfrmSpXml(
  id = '102',
  name = 'Grouped Diagram Shape',
  opts: { rot?: number } = {},
): SafeXmlNode {
  const rotAttr = opts.rot !== undefined ? ` rot="${opts.rot}"` : '';
  return xml(`
    <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
          xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram">
      <p:nvSpPr>
        <p:cNvPr id="${id}" name="${name}"/>
        <p:cNvSpPr/>
        <p:nvPr/>
      </p:nvSpPr>
      <p:spPr>
        <a:xfrm${rotAttr}><a:off x="0" y="0"/><a:ext cx="1828800" cy="914400"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </p:spPr>
      <dsp:txXfrm>
        <a:off x="457200" y="228600"/>
        <a:ext cx="914400" cy="457200"/>
      </dsp:txXfrm>
      <p:txBody>
        <a:bodyPr/><a:lstStyle/>
        <a:p><a:r><a:t>Grouped diagram label</a:t></a:r></a:p>
      </p:txBody>
    </p:sp>
  `);
}

function makeLayoutPlaceholderXml(): SafeXmlNode {
  return xml(`
    <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:nvSpPr>
        <p:cNvPr id="201" name="Layout Body"/>
        <p:cNvSpPr/>
        <p:nvPr><p:ph type="body" idx="1"/></p:nvPr>
      </p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="952500" y="571500"/><a:ext cx="381000" cy="190500"/></a:xfrm>
      </p:spPr>
      <p:txBody>
        <a:bodyPr anchor="ctr"/>
        <a:p><a:r><a:t/></a:r></a:p>
      </p:txBody>
    </p:sp>
  `);
}

function makeRotatedSpXml(opts: {
  id?: string;
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
}): SafeXmlNode {
  return xml(`
    <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:nvSpPr>
        <p:cNvPr id="${opts.id ?? '90'}" name="${opts.name ?? 'Rotated Shape'}"/>
        <p:cNvSpPr/>
        <p:nvPr/>
      </p:nvSpPr>
      <p:spPr>
        <a:xfrm rot="${opts.rot}">
          <a:off x="${opts.x}" y="${opts.y}"/>
          <a:ext cx="${opts.w}" cy="${opts.h}"/>
        </a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </p:spPr>
    </p:sp>
  `);
}

/**
 * A minimal connector (cxnSp) XML child.
 */
function makeCxnSpXml(id = '2'): SafeXmlNode {
  return xml(`
    <p:cxnSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:nvCxnSpPr>
        <p:cNvPr id="${id}" name="Connector ${id}"/>
        <p:cNvCxnSpPr/>
        <p:nvPr/>
      </p:nvCxnSpPr>
      <p:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="457200" cy="457200"/></a:xfrm>
        <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
      </p:spPr>
    </p:cxnSp>
  `);
}

/**
 * A minimal picture (p:pic) XML child.
 */
function makePicXml(id = '3'): SafeXmlNode {
  return xml(`
    <p:pic xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
           xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
           xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:nvPicPr>
        <p:cNvPr id="${id}" name="Picture ${id}"/>
        <p:cNvPicPr/>
        <p:nvPr/>
      </p:nvPicPr>
      <p:blipFill>
        <a:blip r:embed="rId1"/>
        <a:stretch><a:fillRect/></a:stretch>
      </p:blipFill>
      <p:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>
      </p:spPr>
    </p:pic>
  `);
}

/**
 * A nested group (p:grpSp) child, with one sp inside.
 */
function makeNestedGrpSpXml(id = '4'): SafeXmlNode {
  return xml(`
    <p:grpSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:nvGrpSpPr>
        <p:cNvPr id="${id}" name="NestedGroup ${id}"/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/>
          <a:chOff x="0" y="0"/><a:chExt cx="914400" cy="914400"/>
        </a:xfrm>
      </p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="99" name="InnerShape"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="457200" cy="457200"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
      </p:sp>
    </p:grpSp>
  `);
}

function makeNestedGrpFillXml(id = '40'): SafeXmlNode {
  return xml(`
    <p:grpSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:nvGrpSpPr>
        <p:cNvPr id="${id}" name="Nested group fill ${id}"/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/>
          <a:chOff x="0" y="0"/><a:chExt cx="914400" cy="914400"/>
        </a:xfrm>
        <a:grpFill/>
      </p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="409" name="Inner grpFill shape"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="457200" cy="457200"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:grpFill/>
        </p:spPr>
      </p:sp>
    </p:grpSp>
  `);
}

/**
 * A graphicFrame containing a table (a:tbl).
 */
function makeTableFrameXml(id = '5'): SafeXmlNode {
  return xml(`
    <p:graphicFrame xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                   xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:nvGraphicFramePr>
        <p:cNvPr id="${id}" name="Table ${id}"/>
        <p:cNvGraphicFramePr/>
        <p:nvPr/>
      </p:nvGraphicFramePr>
      <p:xfrm>
        <a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/>
      </p:xfrm>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
          <a:tbl>
            <a:tblPr/>
            <a:tblGrid><a:gridCol w="914400"/></a:tblGrid>
            <a:tr h="457200">
              <a:tc><a:txBody><a:p/></a:txBody></a:tc>
            </a:tr>
          </a:tbl>
        </a:graphicData>
      </a:graphic>
    </p:graphicFrame>
  `);
}

/**
 * A graphicFrame referencing a chart via relationship rId.
 * The ctx.slide.rels must contain a matching chart relationship.
 */
function makeChartFrameXml(rId = 'rId10', id = '6'): SafeXmlNode {
  return xml(`
    <p:graphicFrame xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                   xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                   xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                   xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:nvGraphicFramePr>
        <p:cNvPr id="${id}" name="Chart ${id}"/>
        <p:cNvGraphicFramePr/>
        <p:nvPr/>
      </p:nvGraphicFramePr>
      <p:xfrm>
        <a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/>
      </p:xfrm>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
          <c:chart r:id="${rId}"/>
        </a:graphicData>
      </a:graphic>
    </p:graphicFrame>
  `);
}

/**
 * A graphicFrame with an OLE object that exposes a fallback picture.
 */
function makeOleFrameXml(rId = 'rId20', id = '7'): SafeXmlNode {
  return xml(`
    <p:graphicFrame xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                   xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                   xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
                   xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:nvGraphicFramePr>
        <p:cNvPr id="${id}" name="OLE ${id}"/>
        <p:cNvGraphicFramePr/>
        <p:nvPr/>
      </p:nvGraphicFramePr>
      <p:xfrm>
        <a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/>
      </p:xfrm>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole">
          <mc:AlternateContent>
            <mc:Fallback>
              <p:oleObj>
                <p:pic>
                  <p:nvPicPr>
                    <p:cNvPr id="88" name="OlePic"/>
                    <p:nvPr/>
                  </p:nvPicPr>
                  <p:blipFill>
                    <a:blip r:embed="${rId}"/>
                  </p:blipFill>
                  <p:spPr>
                    <a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>
                  </p:spPr>
                </p:pic>
              </p:oleObj>
            </mc:Fallback>
          </mc:AlternateContent>
        </a:graphicData>
      </a:graphic>
    </p:graphicFrame>
  `);
}

function makeDiagramFrameXml(id = '8'): SafeXmlNode {
  return xml(`
    <p:graphicFrame xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                    xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                    xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"
                    xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:nvGraphicFramePr>
        <p:cNvPr id="${id}" name="SmartArt ${id}"/>
        <p:cNvGraphicFramePr/>
        <p:nvPr/>
      </p:nvGraphicFramePr>
      <p:xfrm>
        <a:off x="0" y="0"/><a:ext cx="1828800" cy="914400"/>
      </p:xfrm>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram">
          <dgm:relIds r:dm="rIdData"/>
        </a:graphicData>
      </a:graphic>
    </p:graphicFrame>
  `);
}

function diagramDrawingXml(label = 'SmartArt child label'): string {
  return `
    <dsp:drawing xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram"
                 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <dsp:spTree>
        <dsp:sp>
          <dsp:nvSpPr><dsp:cNvPr id="81" name="Diagram Label"/><dsp:nvPr/></dsp:nvSpPr>
          <dsp:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          </dsp:spPr>
          <dsp:txBody>
            <a:bodyPr/><a:lstStyle/>
            <a:p><a:r><a:t>${label}</a:t></a:r></a:p>
          </dsp:txBody>
        </dsp:sp>
      </dsp:spTree>
    </dsp:drawing>
  `;
}

/**
 * An unrecognized XML element (e.g. sp:wsp — a WPS word-processing shape).
 * parseGroupChild returns undefined for unknown tags.
 */
function makeUnknownTagXml(): SafeXmlNode {
  return xml(`<unknownTag xmlns="http://example.com/ext"/>`);
}

/**
 * A stub renderNode callback that creates a minimal div bearing the nodeType
 * so tests can confirm which node type reached the callback.
 */
function stubRenderNode(childNode: any, _ctx: RenderContext): HTMLElement {
  const div = document.createElement('div');
  div.setAttribute('data-node-type', childNode.nodeType ?? 'unknown');
  div.setAttribute('data-node-id', String(childNode.id ?? ''));
  div.style.position = 'absolute';
  div.style.left = `${childNode.position?.x ?? 0}px`;
  div.style.top = `${childNode.position?.y ?? 0}px`;
  div.style.width = `${childNode.size?.w ?? 0}px`;
  div.style.height = `${childNode.size?.h ?? 0}px`;
  return div;
}

/** Construct a RenderContext that includes a slidePath and a chart relationship. */
function makeCtxWithChart(rId = 'rId10', chartPath = 'ppt/charts/chart1.xml'): RenderContext {
  const ctx = createMockRenderContext();
  ctx.slide.rels.set(rId, { type: 'chart', target: '../charts/chart1.xml' });
  // slidePath is needed so parseChartNode can resolve relative targets
  (ctx.slide as any).slidePath = 'ppt/slides/slide1.xml';
  return ctx;
}

function makeCtxWithDiagram(): RenderContext {
  const ctx = createMockRenderContext();
  ctx.slide.slidePath = 'ppt/slides/slide1.xml';
  ctx.partPath = 'ppt/slides/slide1.xml';
  ctx.slide.rels.set('rIdData', {
    type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData',
    target: '../diagrams/data7.xml',
  });
  ctx.slide.rels.set('rIdDrawing', {
    type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramDrawing',
    target: '../diagrams/drawing7.xml',
  });
  (ctx.presentation as any).diagramDrawings = new Map([
    ['ppt/diagrams/drawing7.xml', diagramDrawingXml()],
  ]);
  return ctx;
}

// ---------------------------------------------------------------------------
// Wrapper structure
// ---------------------------------------------------------------------------

describe('renderGroup — wrapper element', () => {
  it('returns an absolutely positioned div with correct position and size', () => {
    const group = makeGroup([], { x: 50, y: 30, w: 300, h: 150 });
    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);

    expect(el.tagName.toLowerCase()).toBe('div');
    expect(el.style.position).toBe('absolute');
    expect(el.style.left).toBe('50px');
    expect(el.style.top).toBe('30px');
    expect(el.style.width).toBe('300px');
    expect(el.style.height).toBe('150px');
  });

  it('has no transform when rotation is 0 and no flips', () => {
    const group = makeGroup([]);
    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);
    expect(el.style.transform).toBe('');
  });

  it('applies rotation transform when rotation is non-zero', () => {
    const group = makeGroup([], { rotation: 45 });
    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);
    expect(el.style.transform).toContain('rotate(45deg)');
    expect(el.style.transformOrigin).toBe('center center');
  });

  it('applies scaleX(-1) when flipH is true', () => {
    const group = makeGroup([], { flipH: true });
    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);
    expect(el.style.transform).toContain('scaleX(-1)');
  });

  it('applies scaleY(-1) when flipV is true', () => {
    const group = makeGroup([], { flipV: true });
    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);
    expect(el.style.transform).toContain('scaleY(-1)');
  });

  it('combines rotation and flip transforms', () => {
    const group = makeGroup([], { rotation: 90, flipH: true, flipV: true });
    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);
    const t = el.style.transform;
    expect(t).toContain('rotate(90deg)');
    expect(t).toContain('scaleX(-1)');
    expect(t).toContain('scaleY(-1)');
  });

  it('renders no children when children array is empty', () => {
    const group = makeGroup([]);
    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);
    expect(el.children.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Group-level effects
// ---------------------------------------------------------------------------

describe('renderGroup — group-level effects', () => {
  it('applies grpSpPr outerShdw to the group wrapper', () => {
    const groupSource = xml(`
      <p:grpSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvGrpSpPr><p:cNvPr id="1" name="G"/><p:nvPr/></p:nvGrpSpPr>
        <p:grpSpPr>
          <a:xfrm>
            <a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/>
            <a:chOff x="0" y="0"/><a:chExt cx="914400" cy="914400"/>
          </a:xfrm>
          <a:effectLst>
            <a:outerShdw blurRad="12700" dist="25400" dir="0" rotWithShape="0">
              <a:srgbClr val="336699"><a:alpha val="50000"/></a:srgbClr>
            </a:outerShdw>
          </a:effectLst>
        </p:grpSpPr>
      </p:grpSp>
    `);
    const group = makeGroup([], { source: groupSource });

    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);

    expect(el.style.filter).toContain('drop-shadow');
    expect(el.style.filter).toContain('rgba(51,102,153,0.500)');
  });

  it('uses box-shadow spread for scaled outerShdw and falls back to default color', () => {
    const groupSource = xml(`
      <p:grpSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvGrpSpPr><p:cNvPr id="1" name="G"/><p:nvPr/></p:nvGrpSpPr>
        <p:grpSpPr>
          <a:xfrm>
            <a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/>
            <a:chOff x="0" y="0"/><a:chExt cx="914400" cy="914400"/>
          </a:xfrm>
          <a:effectLst>
            <a:outerShdw blurRad="9525" dist="19050" dir="5400000" sx="120000" sy="110000"/>
          </a:effectLst>
        </p:grpSpPr>
      </p:grpSp>
    `);
    const group = makeGroup([], { source: groupSource, w: 200, h: 100 });

    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);

    expect(el.style.boxShadow).toContain('rgba(0,0,0,1.000)');
    expect(el.style.boxShadow).toContain('px');
    expect(el.style.filter).toBe('');
  });

  it('applies grpSpPr reflection to the group wrapper', () => {
    const groupSource = xml(`
      <p:grpSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvGrpSpPr><p:cNvPr id="1" name="G"/><p:nvPr/></p:nvGrpSpPr>
        <p:grpSpPr>
          <a:xfrm>
            <a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/>
            <a:chOff x="0" y="0"/><a:chExt cx="914400" cy="914400"/>
          </a:xfrm>
          <a:effectLst>
            <a:reflection blurRad="12700" stA="37000" endA="0" endPos="55000"
                          dir="5400000" sy="-100000" algn="bl" rotWithShape="0"/>
          </a:effectLst>
        </p:grpSpPr>
      </p:grpSp>
    `);
    const group = makeGroup([], { source: groupSource });

    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);

    expect((el.style as any).webkitBoxReflect).toContain('linear-gradient');
    expect((el.style as any).webkitBoxReflect).toContain('below');
  });

  it('uses reflection defaults when optional alpha and position attributes are omitted', () => {
    const groupSource = xml(`
      <p:grpSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvGrpSpPr><p:cNvPr id="1" name="G"/><p:nvPr/></p:nvGrpSpPr>
        <p:grpSpPr>
          <a:xfrm>
            <a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/>
            <a:chOff x="0" y="0"/><a:chExt cx="914400" cy="914400"/>
          </a:xfrm>
          <a:effectLst>
            <a:reflection/>
          </a:effectLst>
        </p:grpSpPr>
      </p:grpSp>
    `);
    const group = makeGroup([], { source: groupSource });

    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);

    expect((el.style as any).webkitBoxReflect).toContain('below 0.0px');
    expect((el.style as any).webkitBoxReflect).toContain('0.500');
    expect((el.style as any).webkitBoxReflect).toContain('100.0%');
  });
});

// ---------------------------------------------------------------------------
// parseGroupChild dispatch — 'sp' tag
// ---------------------------------------------------------------------------

describe('renderGroup — parseGroupChild dispatch for sp', () => {
  it("parses 'sp' children and passes them to renderNode as nodeType 'shape'", () => {
    const group = makeGroup([makeSpXml('10', 'Rect')]);
    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);

    expect(el.children.length).toBe(1);
    const child = el.children[0] as HTMLElement;
    expect(child.getAttribute('data-node-type')).toBe('shape');
  });

  it("parses multiple 'sp' children and renders all of them", () => {
    const group = makeGroup([makeSpXml('1'), makeSpXml('2'), makeSpXml('3')]);
    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);
    expect(el.children.length).toBe(3);
  });

  it("preserves child id from 'sp' through to renderNode", () => {
    const group = makeGroup([makeSpXml('42', 'SpecificShape')]);
    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);
    const child = el.children[0] as HTMLElement;
    expect(child.getAttribute('data-node-id')).toBe('42');
  });

  it('resolves layout placeholder inheritance for lazy group children before remapping coordinates', () => {
    const group = makeGroup([makePlaceholderSpXml()], {
      x: 50,
      y: 30,
      w: 200,
      h: 100,
      childOffsetX: 0,
      childOffsetY: 0,
      childExtentW: 400,
      childExtentH: 200,
    });
    const layout = createMockRenderContext().layout;
    layout.placeholders = [
      {
        node: makeLayoutPlaceholderXml(),
        absoluteXfrm: {
          position: { x: 100, y: 60 },
          size: { w: 40, h: 20 },
        },
      },
    ];
    const ctx = createMockRenderContext({ layout });
    const renderNode = vi.fn((node) => {
      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.left = `${node.position.x}px`;
      el.style.top = `${node.position.y}px`;
      el.style.width = `${node.size.w}px`;
      el.style.height = `${node.size.h}px`;
      el.dataset.anchor = node.textBody?.layoutBodyProperties?.attr('anchor') ?? '';
      return el;
    });

    const el = renderGroup(group, ctx, renderNode);
    const child = el.firstElementChild as HTMLElement;

    expect(renderNode).toHaveBeenCalledOnce();
    expect(child.style.left).toBe('50px');
    expect(child.style.top).toBe('30px');
    expect(child.style.width).toBe('40px');
    expect(child.style.height).toBe('20px');
    expect(child.dataset.anchor).toBe('ctr');
  });

  it('remaps child textBoxBounds with group scale for diagram-like shapes', () => {
    const group = makeGroup([makeTxXfrmSpXml()], {
      w: 192,
      h: 96,
      childOffsetX: 0,
      childOffsetY: 0,
      childExtentW: 384,
      childExtentH: 192,
    });
    const renderNode = vi.fn((node) => {
      const el = document.createElement('div');
      el.dataset.textBoxBounds = JSON.stringify(node.textBoxBounds);
      return el;
    });

    renderGroup(group, createMockRenderContext(), renderNode);

    const shapeNode = renderNode.mock.calls[0][0];
    expect(shapeNode.position).toEqual({ x: 0, y: 0 });
    expect(shapeNode.size).toEqual({ w: 96, h: 48 });
    expect(shapeNode.textBoxBounds).toMatchObject({
      x: 24,
      y: 12,
      w: 48,
      h: 24,
    });
  });

  it('remaps child textBoxBounds with swapped scale axes for quarter-turn children', () => {
    const group = makeGroup([makeTxXfrmSpXml('103', 'Rotated Grouped Diagram Shape', { rot: 5400000 })], {
      w: 200,
      h: 100,
      childOffsetX: 0,
      childOffsetY: 0,
      childExtentW: 400,
      childExtentH: 100,
    });
    const renderNode = vi.fn((node) => {
      const el = document.createElement('div');
      el.dataset.textBoxBounds = JSON.stringify(node.textBoxBounds);
      return el;
    });

    renderGroup(group, createMockRenderContext(), renderNode);

    const shapeNode = renderNode.mock.calls[0][0];
    expect(shapeNode.size).toEqual({ w: 192, h: 48 });
    expect(shapeNode.textBoxBounds).toMatchObject({
      x: 48,
      y: 12,
      w: 96,
      h: 24,
    });
  });
});

// ---------------------------------------------------------------------------
// parseGroupChild dispatch — 'cxnSp' tag
// ---------------------------------------------------------------------------

describe('renderGroup — parseGroupChild dispatch for cxnSp', () => {
  it("parses 'cxnSp' children and passes them to renderNode as nodeType 'shape'", () => {
    // cxnSp uses parseShapeNode which produces nodeType 'shape'
    const group = makeGroup([makeCxnSpXml('20')]);
    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);

    expect(el.children.length).toBe(1);
    const child = el.children[0] as HTMLElement;
    expect(child.getAttribute('data-node-type')).toBe('shape');
  });
});

// ---------------------------------------------------------------------------
// parseGroupChild dispatch — 'pic' tag
// ---------------------------------------------------------------------------

describe('renderGroup — parseGroupChild dispatch for pic', () => {
  it("parses 'pic' children and passes them to renderNode as nodeType 'picture'", () => {
    const group = makeGroup([makePicXml('30')]);
    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);

    expect(el.children.length).toBe(1);
    const child = el.children[0] as HTMLElement;
    expect(child.getAttribute('data-node-type')).toBe('picture');
  });

  it('preserves the pic child id', () => {
    const group = makeGroup([makePicXml('77')]);
    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);
    const child = el.children[0] as HTMLElement;
    expect(child.getAttribute('data-node-id')).toBe('77');
  });
});

// ---------------------------------------------------------------------------
// parseGroupChild dispatch — 'grpSp' tag (nested group)
// ---------------------------------------------------------------------------

describe('renderGroup — parseGroupChild dispatch for grpSp (nested group)', () => {
  it("parses 'grpSp' children and passes them to renderNode as nodeType 'group'", () => {
    const group = makeGroup([makeNestedGrpSpXml('40')]);
    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);

    expect(el.children.length).toBe(1);
    const child = el.children[0] as HTMLElement;
    expect(child.getAttribute('data-node-type')).toBe('group');
  });

  it('preserves nested group id', () => {
    const group = makeGroup([makeNestedGrpSpXml('55')]);
    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);
    const child = el.children[0] as HTMLElement;
    expect(child.getAttribute('data-node-id')).toBe('55');
  });

  it('composes parent and nested group coordinate scales when rendered recursively', () => {
    const group = makeGroup([makeNestedGrpSpXml('56')], {
      w: 384,
      h: 192,
      childExtentW: 192,
      childExtentH: 96,
    });

    const el = renderGroup(group, createMockRenderContext(), (childNode, ctx) => {
      if (childNode.nodeType === 'group') {
        return renderGroup(childNode as any, ctx, stubRenderNode);
      }
      return stubRenderNode(childNode, ctx);
    });
    const nestedGroup = el.children[0] as HTMLElement;
    const innerShape = nestedGroup.children[0] as HTMLElement;

    expect(nestedGroup.style.width).toBe('192px');
    expect(nestedGroup.style.height).toBe('192px');
    expect(innerShape.getAttribute('data-node-type')).toBe('shape');
    expect(innerShape.style.width).toBe('96px');
    expect(innerShape.style.height).toBe('96px');
  });
});

// ---------------------------------------------------------------------------
// parseGroupChild dispatch — 'graphicFrame' with table
// ---------------------------------------------------------------------------

describe('renderGroup — parseGroupChild dispatch for graphicFrame (table)', () => {
  it("parses graphicFrame containing a:tbl as nodeType 'table'", () => {
    const group = makeGroup([makeTableFrameXml('50')]);
    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);

    expect(el.children.length).toBe(1);
    const child = el.children[0] as HTMLElement;
    expect(child.getAttribute('data-node-type')).toBe('table');
  });

  it('preserves table frame id', () => {
    const group = makeGroup([makeTableFrameXml('51')]);
    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);
    const child = el.children[0] as HTMLElement;
    expect(child.getAttribute('data-node-id')).toBe('51');
  });
});

// ---------------------------------------------------------------------------
// parseGroupChild dispatch — 'graphicFrame' with chart
// ---------------------------------------------------------------------------

describe('renderGroup — parseGroupChild dispatch for graphicFrame (chart)', () => {
  it("parses graphicFrame with chart URI as nodeType 'chart' when rel exists", () => {
    const rId = 'rId10';
    const ctx = makeCtxWithChart(rId);
    const group = makeGroup([makeChartFrameXml(rId, '60')]);

    const el = renderGroup(group, ctx, stubRenderNode);

    expect(el.children.length).toBe(1);
    const child = el.children[0] as HTMLElement;
    expect(child.getAttribute('data-node-type')).toBe('chart');
  });

  it('silently skips chart graphicFrame when chart relationship is missing', () => {
    // ctx.slide.rels has no entry for rId10 — parseChartNode returns undefined
    const ctx = createMockRenderContext();
    (ctx.slide as any).slidePath = 'ppt/slides/slide1.xml';
    const group = makeGroup([makeChartFrameXml('rId10', '61')]);

    const el = renderGroup(group, ctx, stubRenderNode);
    // No child rendered because parseChartNode returns undefined
    expect(el.children.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// parseGroupChild dispatch — 'graphicFrame' with OLE object
// ---------------------------------------------------------------------------

describe('renderGroup — parseGroupChild dispatch for graphicFrame (OLE)', () => {
  it("parses OLE graphicFrame with fallback picture as nodeType 'picture'", () => {
    const ctx = createMockRenderContext();
    // The OLE frame itself has a blip embed; we just need a valid context
    const group = makeGroup([makeOleFrameXml('rId20', '70')]);

    const el = renderGroup(group, ctx, stubRenderNode);

    expect(el.children.length).toBe(1);
    const child = el.children[0] as HTMLElement;
    expect(child.getAttribute('data-node-type')).toBe('picture');
  });
});

// ---------------------------------------------------------------------------
// parseGroupChild dispatch — unknown / unrecognised tags
// ---------------------------------------------------------------------------

describe('renderGroup — parseGroupChild dispatch for unknown tags', () => {
  it('silently skips elements with unrecognized tag names (returns undefined)', () => {
    const group = makeGroup([makeUnknownTagXml()]);
    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);
    // Unknown child produces no rendered element
    expect(el.children.length).toBe(0);
  });

  it('skips multiple unknown children leaving an empty wrapper', () => {
    const group = makeGroup([makeUnknownTagXml(), makeUnknownTagXml()]);
    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);
    expect(el.children.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Coordinate remapping
// ---------------------------------------------------------------------------

describe('renderGroup — child coordinate remapping', () => {
  it('remaps child position from child space to group space (1:1 scale)', () => {
    // childExtent == groupSize → scale factor = 1, no position shift
    const group = makeGroup([makeSpXml()], {
      x: 0, y: 0, w: 200, h: 100,
      childOffsetX: 0, childOffsetY: 0,
      childExtentW: 200, childExtentH: 100,
    });

    let capturedNode: any;
    const capture = (childNode: any, ctx: RenderContext): HTMLElement => {
      capturedNode = childNode;
      return stubRenderNode(childNode, ctx);
    };

    renderGroup(group, createMockRenderContext(), capture);
    // sp at EMU (0,0) with cx=914400 → 96px. Scale: 200/200 = 1, offset: 0.
    expect(capturedNode.position.x).toBeCloseTo(0);
    expect(capturedNode.position.y).toBeCloseTo(0);
  });

  it('scales child position by the ratio groupSize/childExtent', () => {
    // Group is 400x200 px but child space is 800x400 → scale = 0.5
    const group = makeGroup([makeSpXml()], {
      x: 0, y: 0, w: 400, h: 200,
      childOffsetX: 0, childOffsetY: 0,
      childExtentW: 800, childExtentH: 400,
    });

    let capturedNode: any;
    const capture = (childNode: any, ctx: RenderContext): HTMLElement => {
      capturedNode = childNode;
      return stubRenderNode(childNode, ctx);
    };

    renderGroup(group, createMockRenderContext(), capture);
    // original size 96px × scale 0.5 = 48px
    expect(capturedNode.size.w).toBeCloseTo(48);
    expect(capturedNode.size.h).toBeCloseTo(48);
  });

  it('shifts child position by childOffset before scaling', () => {
    // The sp XML has <a:off x="0" y="0"/> → parsed position is (0, 0) px.
    // childOffset = (50, 25), groupSize = childExtent = (200, 100) → scale = 1.
    // Remapping: (childPos.x - chOff.x) / chExt.w * groupW
    //            = (0 - 50) / 200 * 200 = -50
    const group = makeGroup([makeSpXml()], {
      x: 0, y: 0, w: 200, h: 100,
      childOffsetX: 50, childOffsetY: 25,
      childExtentW: 200, childExtentH: 100,
    });

    let capturedNode: any;
    const capture = (childNode: any, ctx: RenderContext): HTMLElement => {
      capturedNode = childNode;
      return stubRenderNode(childNode, ctx);
    };

    renderGroup(group, createMockRenderContext(), capture);
    // (0 - 50) / 200 * 200 = -50
    expect(capturedNode.position.x).toBeCloseTo(-50);
    // (0 - 25) / 100 * 100 = -25
    expect(capturedNode.position.y).toBeCloseTo(-25);
  });

  it('swaps size scale axes for quarter-turn rotated children in non-uniform groups (ai-computing slide 23)', () => {
    // 1 px = 9525 EMU. This mirrors the slide 23 group pattern:
    // group child space is wider than the rendered group, and a 270° child uses
    // its local height as the visible horizontal bar width after rotation.
    const emu = (px: number) => Math.round(px * 9525);
    const group = makeGroup(
      [
        makeRotatedSpXml({
          x: emu(280),
          y: emu(-280),
          w: emu(40),
          h: emu(600),
          rot: 16200000, // 270°
        }),
      ],
      {
        x: 0,
        y: 0,
        w: 500,
        h: 40,
        childOffsetX: 0,
        childOffsetY: 0,
        childExtentW: 600,
        childExtentH: 40,
      },
    );

    let capturedNode: any;
    const capture = (childNode: any, ctx: RenderContext): HTMLElement => {
      capturedNode = childNode;
      return stubRenderNode(childNode, ctx);
    };

    renderGroup(group, createMockRenderContext(), capture);

    // For 270° rotation, the child's local height becomes visible width. Under
    // the group affine transform it must use the group's X scale (500/600), not
    // the Y scale (40/40), otherwise the rotated bar overflows into neighbours.
    expect(capturedNode.rotation).toBe(270);
    expect(capturedNode.position.x).toBeCloseTo(230);
    expect(capturedNode.position.y).toBeCloseTo(-230);
    expect(capturedNode.size.w).toBeCloseTo(40);
    expect(capturedNode.size.h).toBeCloseTo(500);
  });

  it('skips coordinate remapping when childExtent is 0 in either dimension', () => {
    const group = makeGroup([makeSpXml()], {
      childExtentW: 0, childExtentH: 0,
    });
    // When chExt is zero the remapping block is skipped — no crash expected
    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);
    expect(el.children.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Error isolation — per-child try/catch
// ---------------------------------------------------------------------------

describe('renderGroup — per-child error isolation', () => {
  it('renders an error placeholder div when renderNode throws', () => {
    const group = makeGroup([makeSpXml()]);
    const throwingRender = (_childNode: any, _ctx: RenderContext): HTMLElement => {
      throw new Error('render boom');
    };

    const el = renderGroup(group, createMockRenderContext(), throwingRender);
    // Error placeholder is appended instead of crashing
    expect(el.children.length).toBe(1);
    const placeholder = el.children[0] as HTMLElement;
    expect(placeholder.textContent).toContain('Group child error');
    expect(placeholder.style.border).toContain('dashed');
  });

  it('continues rendering subsequent valid children after one fails', () => {
    // Two sp children — renderNode throws for the first, succeeds for the second
    let callCount = 0;
    const conditionalRender = (childNode: any, _ctx: RenderContext): HTMLElement => {
      callCount++;
      if (callCount === 1) throw new Error('first child boom');
      return stubRenderNode(childNode, _ctx);
    };

    const group = makeGroup([makeSpXml('1'), makeSpXml('2')]);
    const el = renderGroup(group, createMockRenderContext(), conditionalRender);

    // Both slots produce a child element: error placeholder + valid child
    expect(el.children.length).toBe(2);
    const first = el.children[0] as HTMLElement;
    const second = el.children[1] as HTMLElement;
    expect(first.textContent).toContain('Group child error');
    expect(second.getAttribute('data-node-type')).toBe('shape');
  });

  it('produces an error placeholder with the expected dashed border style', () => {
    const group = makeGroup([makeSpXml()]);
    const el = renderGroup(group, createMockRenderContext(), () => {
      throw new Error('boom');
    });
    const placeholder = el.children[0] as HTMLElement;
    expect(placeholder.style.border).toMatch(/dashed/);
    expect(placeholder.style.backgroundColor).toBeTruthy();
    expect(placeholder.style.color).toBe('rgb(204, 0, 0)');
  });
});

// ---------------------------------------------------------------------------
// Group fill propagation
// ---------------------------------------------------------------------------

describe('renderGroup — group fill propagation via grpSpPr', () => {
  it('propagates groupFillNode to childCtx when group has solidFill in grpSpPr', () => {
    const groupSource = xml(`
      <p:grpSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvGrpSpPr>
          <p:cNvPr id="1" name="G"/>
          <p:nvPr/>
        </p:nvGrpSpPr>
        <p:grpSpPr>
          <a:xfrm>
            <a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/>
            <a:chOff x="0" y="0"/><a:chExt cx="914400" cy="914400"/>
          </a:xfrm>
          <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>
        </p:grpSpPr>
      </p:grpSp>
    `);

    const group = makeGroup([makeSpXml()], { source: groupSource });

    let receivedCtx: RenderContext | undefined;
    const capture = (childNode: any, ctx: RenderContext): HTMLElement => {
      receivedCtx = ctx;
      return stubRenderNode(childNode, ctx);
    };

    renderGroup(group, createMockRenderContext(), capture);
    expect(receivedCtx?.groupFillNode).toBeDefined();
    expect(receivedCtx?.groupFillNode?.exists()).toBe(true);
  });

  it('does not set groupFillNode when grpSpPr has no fill child', () => {
    // Source has grpSpPr with only xfrm, no fill
    const groupSource = xml(`
      <p:grpSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvGrpSpPr>
          <p:cNvPr id="1" name="G"/>
          <p:nvPr/>
        </p:nvGrpSpPr>
        <p:grpSpPr>
          <a:xfrm>
            <a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/>
          </a:xfrm>
        </p:grpSpPr>
      </p:grpSp>
    `);

    const group = makeGroup([makeSpXml()], { source: groupSource });

    let receivedCtx: RenderContext | undefined;
    renderGroup(group, createMockRenderContext(), (childNode, ctx) => {
      receivedCtx = ctx;
      return stubRenderNode(childNode, ctx);
    });

    expect(receivedCtx?.groupFillNode).toBeUndefined();
  });

  it('propagates parent groupFillNode to child when grpSpPr uses grpFill', () => {
    const groupSource = xml(`
      <p:grpSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvGrpSpPr>
          <p:cNvPr id="1" name="G"/>
          <p:nvPr/>
        </p:nvGrpSpPr>
        <p:grpSpPr>
          <a:xfrm>
            <a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/>
          </a:xfrm>
          <a:grpFill/>
        </p:grpSpPr>
      </p:grpSp>
    `);

    // Simulate a parent fill node already in ctx
    const parentFillNode = xml(
      `<a:grpSpPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:solidFill><a:srgbClr val="00FF00"/></a:solidFill>
      </a:grpSpPr>`,
    );

    const baseCtx = createMockRenderContext({ groupFillNode: parentFillNode });
    const group = makeGroup([makeSpXml()], { source: groupSource });

    let receivedCtx: RenderContext | undefined;
    renderGroup(group, baseCtx, (childNode, ctx) => {
      receivedCtx = ctx;
      return stubRenderNode(childNode, ctx);
    });

    // Child ctx should carry the parent's groupFillNode through
    expect(receivedCtx?.groupFillNode).toBe(parentFillNode);
  });

  it('recursively propagates a parent group fill through a nested grpFill group', () => {
    const groupSource = xml(`
      <p:grpSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvGrpSpPr>
          <p:cNvPr id="1" name="Outer G"/>
          <p:nvPr/>
        </p:nvGrpSpPr>
        <p:grpSpPr>
          <a:xfrm>
            <a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/>
          </a:xfrm>
          <a:solidFill><a:srgbClr val="7030A0"/></a:solidFill>
        </p:grpSpPr>
      </p:grpSp>
    `);
    const group = makeGroup([makeNestedGrpFillXml()], { source: groupSource });

    let innerShapeCtx: RenderContext | undefined;
    const recursiveRender = (childNode: any, ctx: RenderContext): HTMLElement => {
      if (childNode.nodeType === 'group') {
        return renderGroup(childNode, ctx, (innerNode, innerCtx) => {
          innerShapeCtx = innerCtx;
          return stubRenderNode(innerNode, innerCtx);
        });
      }
      return stubRenderNode(childNode, ctx);
    };

    renderGroup(group, createMockRenderContext(), recursiveRender);

    expect(innerShapeCtx?.groupFillNode).toBeDefined();
    expect(innerShapeCtx?.groupFillNode?.child('solidFill').exists()).toBe(true);
    expect(innerShapeCtx?.groupFillNode?.child('solidFill').child('srgbClr').attr('val')).toBe(
      '7030A0',
    );
  });
});

// ---------------------------------------------------------------------------
// Mixed children
// ---------------------------------------------------------------------------

describe('renderGroup — mixed child types', () => {
  it('renders sp, cxnSp, pic, and grpSp children in the same group', () => {
    const children = [
      makeSpXml('1'),
      makeCxnSpXml('2'),
      makePicXml('3'),
      makeNestedGrpSpXml('4'),
    ];
    const group = makeGroup(children);
    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);

    expect(el.children.length).toBe(4);
    const types = Array.from(el.children).map((c) =>
      (c as HTMLElement).getAttribute('data-node-type'),
    );
    expect(types).toContain('shape');
    expect(types).toContain('picture');
    expect(types).toContain('group');
  });

  it('renders SmartArt diagram graphicFrame children from fallback drawing XML', () => {
    const group = makeGroup([makeDiagramFrameXml()]);
    let capturedNode: any;

    const el = renderGroup(group, makeCtxWithDiagram(), (childNode, ctx) => {
      capturedNode = childNode;
      return stubRenderNode(childNode, ctx);
    });

    expect(el.children.length).toBe(1);
    expect(capturedNode?.nodeType).toBe('group');
    expect(capturedNode?.children).toHaveLength(1);
    expect(capturedNode?.children[0].localName).toBe('sp');
  });

  it('selects the diagram drawing whose number matches the diagram data relationship', () => {
    const ctx = makeCtxWithDiagram();
    ctx.slide.rels.set('rIdDrawing6', {
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramDrawing',
      target: '../diagrams/drawing6.xml',
    });
    ctx.slide.rels.set('rIdDrawing7', {
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramDrawing',
      target: '../diagrams/drawing7.xml',
    });
    (ctx.presentation as any).diagramDrawings = new Map([
      ['ppt/diagrams/drawing6.xml', diagramDrawingXml('Wrong diagram drawing')],
      ['ppt/diagrams/drawing7.xml', diagramDrawingXml('Matched diagram drawing')],
    ]);
    const group = makeGroup([makeDiagramFrameXml()]);
    let capturedNode: any;

    renderGroup(group, ctx, (childNode, childCtx) => {
      capturedNode = childNode;
      return stubRenderNode(childNode, childCtx);
    });

    const text = capturedNode?.children?.[0]?.child('txBody').child('p').child('r').child('t').text();
    expect(text).toBe('Matched diagram drawing');
  });

  it('skips unknown children while rendering known ones in the same group', () => {
    const children = [
      makeUnknownTagXml(),
      makeSpXml('10'),
      makeUnknownTagXml(),
      makePicXml('11'),
    ];
    const group = makeGroup(children);
    const el = renderGroup(group, createMockRenderContext(), stubRenderNode);

    // Only the two known children produce rendered elements
    expect(el.children.length).toBe(2);
    const types = Array.from(el.children).map((c) =>
      (c as HTMLElement).getAttribute('data-node-type'),
    );
    expect(types).toEqual(['shape', 'picture']);
  });

  it('remaps table, chart, and picture children with the same non-uniform group scale', () => {
    const group = makeGroup(
      [makeTableFrameXml('31'), makeChartFrameXml('rId10', '32'), makePicXml('33')],
      {
        w: 384,
        h: 144,
        childExtentW: 192,
        childExtentH: 96,
      },
    );
    const capturedNodes: any[] = [];

    renderGroup(group, makeCtxWithChart(), (childNode, ctx) => {
      capturedNodes.push(childNode);
      return stubRenderNode(childNode, ctx);
    });

    expect(capturedNodes.map((node) => node.nodeType)).toEqual(['table', 'chart', 'picture']);
    expect(capturedNodes[0].size).toMatchObject({ w: 192, h: 72 });
    expect(capturedNodes[1].size).toMatchObject({ w: 192, h: 144 });
    expect(capturedNodes[2].size).toMatchObject({ w: 192, h: 144 });
  });
});

// ---------------------------------------------------------------------------
// Cycle diagram layout — pie + circularArrow special case
// ---------------------------------------------------------------------------

describe('renderGroup — cycle diagram (3 pie + 3 circularArrow reordering)', () => {
  /**
   * Build a graphicFrame wrapping an sp with the given preset.
   * We inline real sp elements here since the cycle-diagram branch reads
   * childXml.child('spPr').child('prstGeom').attr('prst') directly on
   * the raw SafeXmlNode children, not on the parsed node.
   */
  function makeSpWithPreset(prst: string, id: string): SafeXmlNode {
    return xml(`
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr>
          <p:cNvPr id="${id}" name="${prst}-${id}"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>
          <a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>
        </p:spPr>
      </p:sp>
    `);
  }

  it('renders exactly 6 children for a 3-pie + 3-circularArrow group', () => {
    const children = [
      makeSpWithPreset('pie', '1'),
      makeSpWithPreset('pie', '2'),
      makeSpWithPreset('pie', '3'),
      makeSpWithPreset('circularArrow', '4'),
      makeSpWithPreset('circularArrow', '5'),
      makeSpWithPreset('circularArrow', '6'),
    ];

    const group = makeGroup(children, {
      w: 200, h: 200,
      childOffsetX: 0, childOffsetY: 0,
      childExtentW: 200, childExtentH: 200,
    });

    const renderOrder: string[] = [];
    const trackingRender = (childNode: any, ctx: RenderContext): HTMLElement => {
      renderOrder.push(childNode.id);
      return stubRenderNode(childNode, ctx);
    };

    const el = renderGroup(group, createMockRenderContext(), trackingRender);
    expect(el.children.length).toBe(6);
    // circularArrows (indices 3,4,5) must be rendered before pies (indices 0,1,2)
    const arrowIds = ['4', '5', '6'];
    const pieIds = ['1', '2', '3'];
    const arrowEnd = Math.max(...arrowIds.map((id) => renderOrder.indexOf(id)));
    const pieStart = Math.min(...pieIds.map((id) => renderOrder.indexOf(id)));
    expect(arrowEnd).toBeLessThan(pieStart);
  });

  it('rescales text box bounds for overlapped cycle pie sectors', () => {
    const children = [
      makeTxXfrmSpXml('1', 'pie-1'),
      makeSpWithPreset('pie', '2'),
      makeSpWithPreset('pie', '3'),
      makeSpWithPreset('circularArrow', '4'),
      makeSpWithPreset('circularArrow', '5'),
      makeSpWithPreset('circularArrow', '6'),
    ];
    const firstPie = children[0].child('spPr').child('prstGeom');
    firstPie.element?.setAttribute('prst', 'pie');
    const group = makeGroup(children, {
      w: 200, h: 200,
      childOffsetX: 0, childOffsetY: 0,
      childExtentW: 200, childExtentH: 200,
    });

    let capturedPie: any;
    renderGroup(group, createMockRenderContext(), (childNode, ctx) => {
      if (childNode.id === '1') capturedPie = childNode;
      return stubRenderNode(childNode, ctx);
    });

    expect(capturedPie.textBoxBounds).toMatchObject({
      x: 24,
      y: 24,
      w: 48,
      h: 48,
    });
  });

  it('does not reorder children when pattern is not 3-pie + 3-circularArrow', () => {
    // Only 2 pies + 1 circularArrow — no cycle diagram special case
    const children = [
      makeSpWithPreset('pie', '1'),
      makeSpWithPreset('pie', '2'),
      makeSpWithPreset('circularArrow', '3'),
    ];
    const group = makeGroup(children, {
      w: 200, h: 200,
      childOffsetX: 0, childOffsetY: 0,
      childExtentW: 200, childExtentH: 200,
    });

    const renderOrder: string[] = [];
    renderGroup(group, createMockRenderContext(), (childNode, ctx) => {
      renderOrder.push(childNode.id);
      return stubRenderNode(childNode, ctx);
    });

    // No reordering → natural order
    expect(renderOrder).toEqual(['1', '2', '3']);
  });
});
