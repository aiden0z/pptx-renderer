import { describe, expect, it } from 'vitest';
import { parseXml } from '../../../src/parser/XmlParser';
import { parseShapeNode } from '../../../src/model/nodes/ShapeNode';
import { renderShape } from '../../../src/renderer/ShapeRenderer';
import { createMockRenderContext } from '../helpers/mockContext';

function useBgFillShapeXml(): string {
  return `
    <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
          useBgFill="1">
      <p:nvSpPr><p:cNvPr id="700" name="Background Fill"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>
      </p:spPr>
    </p:sp>
  `;
}

function slideBackgroundXml(): string {
  return `<bg xmlns="http://schemas.openxmlformats.org/presentationml/2006/main"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <bgPr><a:solidFill><a:srgbClr val="112233"/></a:solidFill></bgPr>
    </bg>`;
}

describe('renderShape useBgFill', () => {
  it('parses the shape-level background fill flag', () => {
    const node = parseShapeNode(parseXml(useBgFillShapeXml()));

    expect(node.useBackgroundFill).toBe(true);
  });

  it('leaves the flag unset for ordinary shapes', () => {
    const node = parseShapeNode(parseXml(useBgFillShapeXml().replace(' useBgFill="1"', '')));

    expect(node.useBackgroundFill).toBeUndefined();
  });

  it('renders the resolved slide background instead of the shape style fill', () => {
    const node = parseShapeNode(parseXml(useBgFillShapeXml()));
    const ctx = createMockRenderContext({
      slide: { rels: new Map(), background: parseXml(slideBackgroundXml()) } as never,
    });

    const el = renderShape(node, ctx);

    expect(el.querySelector('svg > path')?.getAttribute('fill')).toBe('#112233');
  });

  it('occludes content behind it when the slide background is semi-transparent', () => {
    const node = parseShapeNode(parseXml(useBgFillShapeXml()));
    const background = parseXml(
      `<bg xmlns="http://schemas.openxmlformats.org/presentationml/2006/main"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <bgPr><a:solidFill><a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr></a:solidFill></bgPr>
    </bg>`,
    );
    const ctx = createMockRenderContext({
      slide: { rels: new Map(), background } as never,
    });

    const el = renderShape(node, ctx);
    const fill = el.querySelector('svg > path')?.getAttribute('fill') ?? '';

    expect(fill).not.toBe('');
    expect(fill).not.toBe('transparent');
    expect(fill).not.toBe('none');
    expect(fill).not.toMatch(/rgba\(/);
  });

  it('falls back to the layout background when the slide has none', () => {
    const node = parseShapeNode(parseXml(useBgFillShapeXml()));
    const ctx = createMockRenderContext({
      layout: {
        placeholders: [],
        spTree: parseXml('<spTree/>'),
        rels: new Map(),
        showMasterSp: true,
        background: parseXml(slideBackgroundXml()),
      } as never,
    });

    const el = renderShape(node, ctx);

    expect(el.querySelector('svg > path')?.getAttribute('fill')).toBe('#112233');
  });

  it('keeps the shape style fill when the flag is absent', () => {
    const node = parseShapeNode(parseXml(useBgFillShapeXml().replace(' useBgFill="1"', '')));
    const ctx = createMockRenderContext({
      slide: { rels: new Map(), background: parseXml(slideBackgroundXml()) } as never,
    });

    const el = renderShape(node, ctx);

    expect(el.querySelector('svg > path')?.getAttribute('fill')).toBe('#FF0000');
  });

  it('ignores the shape local gradient when the background is solid', () => {
    const node = parseShapeNode(
      parseXml(
        useBgFillShapeXml().replace(
          '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>',
          `<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs>` +
            `<a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs></a:gsLst>` +
            `<a:lin ang="5400000"/></a:gradFill>`,
        ),
      ),
    );
    const ctx = createMockRenderContext({
      slide: { rels: new Map(), background: parseXml(slideBackgroundXml()) } as never,
    });

    const el = renderShape(node, ctx);

    expect(el.querySelector('svg > path')?.getAttribute('fill')).toBe('#112233');
    expect(el.querySelector('svg defs linearGradient')).toBeNull();
  });
});
