import { describe, expect, it } from 'vitest';
import { parsePicNode } from '../../../../src/model/nodes/PicNode';
import { parseXml } from '../../../../src/parser/XmlParser';

function makePicXml(opts: {
  embed?: string;
  link?: string;
  srcRect?: { t?: number; b?: number; l?: number; r?: number };
  video?: boolean;
  audio?: boolean;
  solidFill?: boolean;
  line?: boolean;
} = {}) {
  const embed = opts.embed ?? 'rId1';
  const blipAttrs = [
    embed ? `embed="${embed}"` : '',
    opts.link ? `link="${opts.link}"` : '',
  ].filter(Boolean).join(' ');
  const srcRect = opts.srcRect
    ? `<srcRect ${Object.entries(opts.srcRect).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`
    : '';
  const media = opts.video
    ? '<videoFile link="rId5"/>'
    : opts.audio
      ? '<audioFile link="rId6"/>'
      : '';
  const spPrFill = opts.solidFill ? '<solidFill><srgbClr val="FF0000"/></solidFill>' : '';
  const spPrLine = opts.line ? '<ln w="12700"><solidFill><srgbClr val="000000"/></solidFill></ln>' : '';

  return parseXml(`
    <pic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
         xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <nvPicPr>
        <cNvPr id="5" name="Picture 1"/>
        <nvPr>${media}</nvPr>
      </nvPicPr>
      <blipFill>
        <blip ${blipAttrs}/>
        ${srcRect}
      </blipFill>
      <spPr>
        <xfrm>
          <off x="914400" y="914400"/>
          <ext cx="1828800" cy="1371600"/>
        </xfrm>
        ${spPrFill}
        ${spPrLine}
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

  it('parses crop rect', () => {
    const node = parsePicNode(makePicXml({
      srcRect: { t: 10000, b: 20000, l: 5000, r: 15000 },
    }));
    expect(node.crop).toBeDefined();
    expect(node.crop!.top).toBeCloseTo(0.1);
    expect(node.crop!.bottom).toBeCloseTo(0.2);
    expect(node.crop!.left).toBeCloseTo(0.05);
    expect(node.crop!.right).toBeCloseTo(0.15);
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

  it('detects audio file', () => {
    const node = parsePicNode(makePicXml({ audio: true }));
    expect(node.isAudio).toBe(true);
    expect(node.mediaRId).toBe('rId6');
    expect(node.isVideo).toBeUndefined();
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
});
