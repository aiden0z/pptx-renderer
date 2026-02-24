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
