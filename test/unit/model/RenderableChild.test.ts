import { describe, expect, it } from 'vitest';
import {
  expandCompatibleChildren,
  isPlaceholderNode,
  parseOleFrameAsPicture,
  parseRenderableChild,
  parseRenderableChildren,
} from '../../../src/model/RenderableChild';
import { parseXml } from '../../../src/parser/XmlParser';

const olePic = (blip = '<a:blip r:embed="rIdPic"/>'): string => `
  <p:pic>
    <p:nvPicPr><p:cNvPr id="99" name="Fallback pic"/><p:nvPr/></p:nvPicPr>
    <p:blipFill>${blip}</p:blipFill>
    <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm></p:spPr>
  </p:pic>
`;

const graphicFrame = (graphicDataInner: string, uri: string): string => `
  <p:graphicFrame xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                  xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                  xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"
                  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">
    <p:nvGraphicFramePr><p:cNvPr id="7" name="Frame"/><p:nvPr/></p:nvGraphicFramePr>
    <p:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="914400"/></p:xfrm>
    <a:graphic><a:graphicData uri="${uri}">${graphicDataInner}</a:graphicData></a:graphic>
  </p:graphicFrame>
`;

describe('RenderableChild parsing', () => {
  it.each(['nvSpPr', 'nvPicPr', 'nvGrpSpPr', 'nvGraphicFramePr', 'nvCxnSpPr'])(
    'detects placeholder wrapper %s',
    (wrapper) => {
      const node = parseXml(`
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:${wrapper}><p:nvPr><p:ph type="body"/></p:nvPr></p:${wrapper}>
        </p:sp>
      `);

      expect(isPlaceholderNode(node)).toBe(true);
    },
  );

  it('skips placeholder children when requested', () => {
    const node = parseXml(`
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:nvSpPr><p:cNvPr id="1" name="Placeholder"/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>
      </p:sp>
    `);

    expect(parseRenderableChild(node, { rels: new Map(), skipPlaceholders: true })).toBeUndefined();
  });

  it('uses direct OLE object fallback pictures when they expose a resolvable blip', () => {
    const frame = parseXml(
      graphicFrame(
        `<p:oleObj>${olePic()}</p:oleObj>`,
        'http://schemas.openxmlformats.org/presentationml/2006/ole',
      ),
    );

    const pic = parseOleFrameAsPicture(frame);

    expect(pic).toMatchObject({
      nodeType: 'picture',
      blipEmbed: 'rIdPic',
      id: '7',
    });
  });

  it('uses a supported AlternateContent Choice picture when Fallback is absent', () => {
    const frame = parseXml(
      graphicFrame(
        `<mc:AlternateContent><mc:Choice Requires="p"><p:oleObj>${olePic('<a:blip r:link="rIdLinked"/>')}</p:oleObj></mc:Choice></mc:AlternateContent>`,
        'http://schemas.openxmlformats.org/presentationml/2006/ole',
      ),
    );

    const pic = parseRenderableChild(frame, { rels: new Map() });

    expect(pic).toMatchObject({
      nodeType: 'picture',
      blipLink: 'rIdLinked',
      id: '7',
    });
  });

  it('selects one supported Choice and does not duplicate its Fallback', () => {
    const alternate = parseXml(`
      <mc:AlternateContent
        xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
        xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <mc:Choice Requires="p">
          <p:sp><p:nvSpPr><p:cNvPr id="1" name="Choice"/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp>
        </mc:Choice>
        <mc:Fallback>
          <p:sp><p:nvSpPr><p:cNvPr id="2" name="Fallback"/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp>
        </mc:Fallback>
      </mc:AlternateContent>
    `);

    const nodes = parseRenderableChildren(alternate, { rels: new Map() });

    expect(nodes).toHaveLength(1);
    expect(nodes[0].name).toBe('Choice');
  });

  it('uses ordinary Fallback children when Choice requires an unsupported namespace', () => {
    const alternate = parseXml(`
      <mc:AlternateContent
        xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
        xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
        xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">
        <mc:Choice Requires="p14"><p14:contentPart/></mc:Choice>
        <mc:Fallback>
          <p:sp><p:nvSpPr><p:cNvPr id="2" name="Fallback"/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp>
          <p:pic><p:nvPicPr><p:cNvPr id="3" name="Preview"/><p:nvPr/></p:nvPicPr><p:blipFill/><p:spPr/></p:pic>
          <p:grpSp>
            <p:nvGrpSpPr><p:cNvPr id="4" name="Group"/><p:nvPr/></p:nvGrpSpPr>
            <p:grpSpPr/>
          </p:grpSp>
          <p:graphicFrame>
            <p:nvGraphicFramePr><p:cNvPr id="5" name="Table"/><p:nvPr/></p:nvGraphicFramePr>
            <p:xfrm/>
            <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl/></a:graphicData></a:graphic>
          </p:graphicFrame>
          <p:graphicFrame>
            <p:nvGraphicFramePr><p:cNvPr id="6" name="Chart"/><p:nvPr/></p:nvGraphicFramePr>
            <p:xfrm/>
            <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rIdChart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></a:graphicData></a:graphic>
          </p:graphicFrame>
        </mc:Fallback>
      </mc:AlternateContent>
    `);

    const nodes = parseRenderableChildren(alternate, {
      rels: new Map([['rIdChart', { type: 'chart', target: '../charts/chart1.xml' }]]),
      partPath: 'ppt/slides/slide1.xml',
    });

    expect(nodes.map((node) => node.nodeType)).toEqual([
      'shape',
      'picture',
      'group',
      'table',
      'chart',
    ]);
  });

  it('selects compatible content nested inside a group', () => {
    const groupXml = parseXml(`
      <p:grpSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
               xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
               xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">
        <p:nvGrpSpPr><p:cNvPr id="10" name="Group"/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
        <mc:AlternateContent>
          <mc:Choice Requires="p14"><p14:contentPart/></mc:Choice>
          <mc:Fallback><p:sp><p:nvSpPr><p:cNvPr id="11" name="Nested fallback"/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp></mc:Fallback>
        </mc:AlternateContent>
      </p:grpSp>
    `);

    const group = parseRenderableChild(groupXml, { rels: new Map() });

    expect(group).toMatchObject({ nodeType: 'group' });
    expect(
      group?.nodeType === 'group' ? group.children.map((child) => child.localName) : [],
    ).toEqual(['sp']);
  });

  it('recursively selects nested AlternateContent while preserving draw order', () => {
    const root = parseXml(`
      <root xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
            xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">
        <mc:AlternateContent>
          <mc:Choice Requires="p14"><p14:contentPart/></mc:Choice>
          <mc:Fallback>
            <p:sp id="first"/>
            <mc:AlternateContent>
              <mc:Choice Requires="p"><p:pic id="second"/></mc:Choice>
              <mc:Fallback><p:sp id="duplicate"/></mc:Fallback>
            </mc:AlternateContent>
            <p:graphicFrame id="third"/>
          </mc:Fallback>
        </mc:AlternateContent>
      </root>
    `);

    const selected = expandCompatibleChildren(root.child('AlternateContent'));

    expect(selected.map((node) => node.attr('id'))).toEqual(['first', 'second', 'third']);
  });

  it('returns no content when no Choice is compatible and Fallback is absent', () => {
    const alternate = parseXml(`
      <mc:AlternateContent
        xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
        xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">
        <mc:Choice Requires="p14"><p14:contentPart/></mc:Choice>
      </mc:AlternateContent>
    `);

    expect(parseRenderableChildren(alternate, { rels: new Map() })).toEqual([]);
  });

  it('returns undefined for OLE frames without a resolvable fallback picture', () => {
    const noAlt = parseXml(
      graphicFrame('<p:oleObj/>', 'http://schemas.openxmlformats.org/presentationml/2006/ole'),
    );
    const noBlip = parseXml(
      graphicFrame(
        `<mc:AlternateContent><mc:Fallback><p:oleObj>${olePic('<a:blip/>')}</p:oleObj></mc:Fallback></mc:AlternateContent>`,
        'http://schemas.openxmlformats.org/presentationml/2006/ole',
      ),
    );

    expect(parseOleFrameAsPicture(noAlt)).toBeUndefined();
    expect(parseOleFrameAsPicture(noBlip)).toBeUndefined();
  });

  it('returns undefined for diagram frames when no diagram drawing map is available', () => {
    const frame = parseXml(
      graphicFrame(
        '<dgm:relIds r:dm="rIdData"/>',
        'http://schemas.openxmlformats.org/drawingml/2006/diagram',
      ),
    );

    expect(
      parseRenderableChild(frame, {
        rels: new Map([
          [
            'rIdData',
            {
              type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData',
              target: '../diagrams/data1.xml',
            },
          ],
        ]),
      }),
    ).toBeUndefined();
  });

  it('returns undefined for graphic frames without a typed graphicData URI', () => {
    const frame = parseXml(graphicFrame('<p:oleObj/>', ''));

    expect(parseRenderableChild(frame, { rels: new Map() })).toBeUndefined();
  });

  it('resolves diagram drawings when the source part path has no containing directory', () => {
    const frame = parseXml(
      graphicFrame('', 'http://schemas.openxmlformats.org/drawingml/2006/diagram'),
    );

    const group = parseRenderableChild(frame, {
      partPath: 'slide1.xml',
      rels: new Map([
        [
          'rIdDrawing',
          {
            type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramDrawing',
            target: 'drawing1.xml',
          },
        ],
      ]),
      diagramDrawings: new Map([
        [
          'drawing1.xml',
          `<dsp:drawing xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram"/>`,
        ],
      ]),
    });

    expect(group).toMatchObject({
      nodeType: 'group',
      children: [],
    });
  });

  it('resolves chart frames even when the source part path is omitted', () => {
    const frame = parseXml(
      graphicFrame(
        '<c:chart r:id="rIdChart"/>',
        'http://schemas.openxmlformats.org/drawingml/2006/chart',
      ),
    );
    const chart = parseRenderableChild(frame, {
      rels: new Map([['rIdChart', { type: 'chart', target: '../charts/chart1.xml' }]]),
    });

    expect(chart).toMatchObject({
      nodeType: 'chart',
      chartPath: 'charts/chart1.xml',
    });
  });
});
