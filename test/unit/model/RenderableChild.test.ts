import { describe, expect, it } from 'vitest';
import {
  isPlaceholderNode,
  parseOleFrameAsPicture,
  parseRenderableChild,
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

  it('uses AlternateContent Choice fallback pictures when Fallback is absent', () => {
    const frame = parseXml(
      graphicFrame(
        `<mc:AlternateContent><mc:Choice Requires="x"><p:oleObj>${olePic('<a:blip r:link="rIdLinked"/>')}</p:oleObj></mc:Choice></mc:AlternateContent>`,
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
