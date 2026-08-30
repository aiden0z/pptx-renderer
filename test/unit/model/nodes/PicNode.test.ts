import { describe, expect, it } from 'vitest';
import { parsePicNode } from '../../../../src/model/nodes/PicNode';
import { parseXml } from '../../../../src/parser/XmlParser';

function makePicXml(
  opts: {
    embed?: string;
    link?: string;
    svgEmbed?: string;
    srcRect?: { t?: number; b?: number; l?: number; r?: number };
    video?: boolean;
    audio?: boolean;
    solidFill?: boolean;
    gradFill?: boolean;
    line?: boolean;
    customGeometry?: boolean;
    mediaNamespaced?: boolean;
  } = {},
) {
  const embed = opts.embed ?? 'rId1';
  const blipAttrs = [embed ? `embed="${embed}"` : '', opts.link ? `link="${opts.link}"` : '']
    .filter(Boolean)
    .join(' ');
  const svgBlip = opts.svgEmbed
    ? `<extLst><ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip r:embed="${opts.svgEmbed}"/></ext></extLst>`
    : '';
  const srcRect = opts.srcRect
    ? `<srcRect ${Object.entries(opts.srcRect)
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ')}/>`
    : '';
  const mediaAttr = opts.mediaNamespaced ? 'r:link' : 'link';
  const media = opts.video
    ? `<videoFile ${mediaAttr}="rId5"/>`
    : opts.audio
      ? `<audioFile ${mediaAttr}="rId6"/>`
      : '';
  const spPrFill = opts.solidFill ? '<solidFill><srgbClr val="FF0000"/></solidFill>' : '';
  const spPrGradFill = opts.gradFill
    ? '<gradFill><gsLst><gs pos="0"><srgbClr val="000000"/></gs></gsLst></gradFill>'
    : '';
  const spPrLine = opts.line
    ? '<ln w="12700"><solidFill><srgbClr val="000000"/></solidFill></ln>'
    : '';
  const customGeometry = opts.customGeometry
    ? `<custGeom>
        <avLst/>
        <gdLst/>
        <ahLst/>
        <cxnLst/>
        <rect l="l" t="t" r="r" b="b"/>
        <pathLst>
          <path w="1828800" h="1371600">
            <moveTo><pt x="1828800" y="0"/></moveTo>
            <lnTo><pt x="0" y="0"/></lnTo>
            <lnTo><pt x="0" y="1371600"/></lnTo>
            <close/>
          </path>
        </pathLst>
      </custGeom>`
    : '';

  return parseXml(`
    <pic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
         xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
         xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main">
      <nvPicPr>
        <cNvPr id="5" name="Picture 1"/>
        <nvPr>${media}</nvPr>
      </nvPicPr>
      <blipFill>
        <blip ${blipAttrs}>${svgBlip}</blip>
        ${srcRect}
      </blipFill>
      <spPr>
        <xfrm>
          <off x="914400" y="914400"/>
          <ext cx="1828800" cy="1371600"/>
        </xfrm>
        ${spPrFill}
        ${spPrGradFill}
        ${spPrLine}
        ${customGeometry}
      </spPr>
    </pic>
  `);
}

describe('parsePicNode', () => {
  it('parses basic picture node', () => {
    const node = parsePicNode(makePicXml());
    expect(node.nodeType).toBe('picture');
    expect(node.id).toBe('5');
    expect(node.name).toBe('Picture 1');
    expect(node.blipEmbed).toBe('rId1');
    expect(node.position.x).toBeGreaterThan(0);
    expect(node.size.w).toBeGreaterThan(0);
  });

  it('parses blip embed relationship attributes when the relationship prefix is not r', () => {
    const node = parsePicNode(
      parseXml(`
        <pic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <nvPicPr>
            <cNvPr id="5" name="Picture 1"/>
            <nvPr/>
          </nvPicPr>
          <blipFill>
            <blip rel:embed="rIdAlt"/>
          </blipFill>
          <spPr>
            <xfrm>
              <off x="914400" y="914400"/>
              <ext cx="1828800" cy="1371600"/>
            </xfrm>
          </spPr>
        </pic>
      `),
    );

    expect(node.blipEmbed).toBe('rIdAlt');
  });

  it('prefers the Office SVG relationship over the raster fallback', () => {
    const node = parsePicNode(
      makePicXml({ embed: 'rIdPng', svgEmbed: 'rIdSvg' }),
    );

    expect(node.blipEmbed).toBe('rIdSvg');
  });

  it('uses an Office SVG relationship when the raster relationship is absent', () => {
    const node = parsePicNode(makePicXml({ embed: '', svgEmbed: 'rIdSvg' }));

    expect(node.blipEmbed).toBe('rIdSvg');
  });

  it('parses crop rect', () => {
    const node = parsePicNode(
      makePicXml({
        srcRect: { t: 10000, b: 20000, l: 5000, r: 15000 },
      }),
    );
    expect(node.crop).toBeDefined();
    expect(node.crop!.top).toBeCloseTo(0.1);
    expect(node.crop!.bottom).toBeCloseTo(0.2);
    expect(node.crop!.left).toBeCloseTo(0.05);
    expect(node.crop!.right).toBeCloseTo(0.15);
  });

  it('parses partial crop rect values and defaults omitted sides to zero', () => {
    const node = parsePicNode(makePicXml({ srcRect: { t: 12500, l: 25000 } }));

    expect(node.crop).toEqual({
      top: 0.125,
      bottom: 0,
      left: 0.25,
      right: 0,
    });
  });

  it('parses bottom/right-only crop rect values and defaults top/left to zero', () => {
    const node = parsePicNode(makePicXml({ srcRect: { b: 30000, r: 40000 } }));

    expect(node.crop).toEqual({
      top: 0,
      bottom: 0.3,
      left: 0,
      right: 0.4,
    });
  });

  it('ignores empty srcRect with no crop attributes', () => {
    const node = parsePicNode(makePicXml({ srcRect: {} }));

    expect(node.crop).toBeUndefined();
  });

  it('handles no crop rect', () => {
    const node = parsePicNode(makePicXml());
    expect(node.crop).toBeUndefined();
  });

  it('detects video file', () => {
    const node = parsePicNode(makePicXml({ video: true }));
    expect(node.isVideo).toBe(true);
    expect(node.mediaRId).toBe('rId5');
    expect(node.isAudio).toBeUndefined();
  });

  it('detects video media relationship from r:link', () => {
    const node = parsePicNode(makePicXml({ video: true, mediaNamespaced: true }));

    expect(node.isVideo).toBe(true);
    expect(node.mediaRId).toBe('rId5');
  });

  it('detects audio file', () => {
    const node = parsePicNode(makePicXml({ audio: true }));
    expect(node.isAudio).toBe(true);
    expect(node.mediaRId).toBe('rId6');
    expect(node.isVideo).toBeUndefined();
  });

  it('detects audio media relationship from r:link', () => {
    const node = parsePicNode(makePicXml({ audio: true, mediaNamespaced: true }));

    expect(node.isAudio).toBe(true);
    expect(node.mediaRId).toBe('rId6');
  });

  it('parses blip link attribute', () => {
    const node = parsePicNode(makePicXml({ embed: '', link: 'rId3' }));
    expect(node.blipLink).toBe('rId3');
  });

  it('parses fill and line from spPr', () => {
    const node = parsePicNode(makePicXml({ solidFill: true, line: true }));
    expect(node.fill).toBeDefined();
    expect(node.fill!.exists()).toBe(true);
    expect(node.line).toBeDefined();
    expect(node.line!.exists()).toBe(true);
  });

  it('parses gradient fill from spPr when no solid fill is present', () => {
    const node = parsePicNode(makePicXml({ gradFill: true }));

    expect(node.fill).toBeDefined();
    expect(node.fill!.localName).toBe('gradFill');
  });

  it('preserves custom picture geometry for clipped image rendering (issue #3)', () => {
    const node = parsePicNode(makePicXml({ customGeometry: true }));

    expect(node.customGeometry?.exists()).toBe(true);
    expect(node.customGeometry?.localName).toBe('custGeom');
  });
});
