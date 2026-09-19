import { describe, expect, it } from 'vitest';
import { parseTemplateShapes } from '../../../src/model/TemplateShapes';
import { SafeXmlNode, parseXml } from '../../../src/parser/XmlParser';

function shapeXml(opts: { id: string; name: string; ph?: string; cx?: string; cy?: string }) {
  const ph = opts.ph ? `<p:nvPr>${opts.ph}</p:nvPr>` : '<p:nvPr/>';
  return `
    <p:sp>
      <p:nvSpPr><p:cNvPr id="${opts.id}" name="${opts.name}"/><p:cNvSpPr/>${ph}</p:nvSpPr>
      <p:spPr>
        <a:xfrm>
          <a:off x="914400" y="457200"/>
          <a:ext cx="${opts.cx ?? '1828800'}" cy="${opts.cy ?? '914400'}"/>
        </a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </p:spPr>
    </p:sp>
  `;
}

function spTree(shapes: string) {
  return parseXml(`
    <p:spTree xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">
      ${shapes}
    </p:spTree>
  `);
}

describe('parseTemplateShapes', () => {
  it('returns nothing for an empty shape tree', () => {
    expect(parseTemplateShapes(spTree(''))).toHaveLength(0);
  });

  it('returns nothing for a missing shape tree', () => {
    expect(parseTemplateShapes(new SafeXmlNode(null))).toHaveLength(0);
  });

  it('collects a layout decoration shape', () => {
    const nodes = parseTemplateShapes(spTree(shapeXml({ id: '2', name: 'Freeform 28' })));
    expect(nodes).toHaveLength(1);
    expect(nodes[0].name).toBe('Freeform 28');
    expect(nodes[0].nodeType).toBe('shape');
  });

  it('collects a master decoration shape', () => {
    const nodes = parseTemplateShapes(spTree(shapeXml({ id: '3', name: 'Master logo' })));
    expect(nodes.map((n) => n.name)).toEqual(['Master logo']);
  });

  it('excludes placeholder shapes, which are inheritance templates', () => {
    const nodes = parseTemplateShapes(
      spTree(
        shapeXml({ id: '4', name: 'Title 1', ph: '<p:ph type="title"/>' }) +
          shapeXml({ id: '5', name: 'Rectangle 3' }) +
          shapeXml({ id: '6', name: 'Body 2', ph: '<p:ph type="body" idx="1"/>' }),
      ),
    );
    expect(nodes.map((n) => n.name)).toEqual(['Rectangle 3']);
  });

  it('keeps source draw order', () => {
    const nodes = parseTemplateShapes(
      spTree(
        shapeXml({ id: '7', name: 'first' }) +
          shapeXml({ id: '8', name: 'second' }) +
          shapeXml({ id: '9', name: 'third' }),
      ),
    );
    expect(nodes.map((n) => n.name)).toEqual(['first', 'second', 'third']);
  });

  it('drops a shape with no area', () => {
    const nodes = parseTemplateShapes(
      spTree(shapeXml({ id: '10', name: 'zero', cx: '0', cy: '0' })),
    );
    expect(nodes).toHaveLength(0);
  });

  it('expands a compatible AlternateContent branch', () => {
    const nodes = parseTemplateShapes(
      spTree(`
        <mc:AlternateContent>
          <mc:Choice Requires="p">${shapeXml({ id: '11', name: 'chosen' })}</mc:Choice>
          <mc:Fallback>${shapeXml({ id: '12', name: 'fallback' })}</mc:Fallback>
        </mc:AlternateContent>
      `),
    );
    expect(nodes.map((n) => n.name)).toEqual(['chosen']);
  });

  it('ignores children that are not renderable shapes', () => {
    const nodes = parseTemplateShapes(
      spTree(`<p:nvGrpSpPr/><p:grpSpPr/>${shapeXml({ id: '13', name: 'kept' })}`),
    );
    expect(nodes.map((n) => n.name)).toEqual(['kept']);
  });
});
