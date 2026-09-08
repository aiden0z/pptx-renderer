import { describe, expect, it } from 'vitest';
import {
  buildPresentation,
  materializeSlideNodes,
  resolveNodePlaceholderInheritance,
} from '../../../src/model/Presentation';
import { parseBaseProps } from '../../../src/model/nodes/BaseNode';
import { parseXml } from '../../../src/parser/XmlParser';
import { serializePresentation } from '../../../src/export/serializePresentation';
import {
  groupPlaceholderFiles,
  groupXml,
  namespaces,
  transform,
} from '../../fixtures/group-placeholder-transform';

const cases = [
  {
    label: 'nonzero bounds',
    xml: transform(200, 100, 240, 120),
    position: { x: 200, y: 100 },
    size: { w: 240, h: 120 },
  },
  {
    label: 'zero position',
    xml: transform(0, 0, 240, 120),
    position: { x: 0, y: 0 },
    size: { w: 240, h: 120 },
  },
  {
    label: 'negative position',
    xml: transform(-40, -20, 240, 120),
    position: { x: -40, y: -20 },
    size: { w: 240, h: 120 },
  },
  {
    label: 'zero extents',
    xml: transform(200, 100, 0, 0),
    position: { x: 200, y: 100 },
    size: { w: 0, h: 0 },
  },
  { label: 'omitted transform', xml: null, position: { x: 10, y: 20 }, size: { w: 600, h: 300 } },
  {
    label: 'omitted offset',
    xml: '<a:ext cx="2286000" cy="1143000"/>',
    position: { x: 10, y: 20 },
    size: { w: 240, h: 120 },
  },
  {
    label: 'omitted extent',
    xml: '<a:off x="1905000" y="952500"/>',
    position: { x: 200, y: 100 },
    size: { w: 600, h: 300 },
  },
  {
    label: 'individually omitted attributes',
    xml: '<a:off x="0"/><a:ext cy="0"/>',
    position: { x: 0, y: 20 },
    size: { w: 600, h: 0 },
  },
];

for (const lazySlides of [false, true]) {
  describe(`${lazySlides ? 'lazy' : 'eager'} group placeholder transform`, () => {
    it.each(cases)('honors source presence for $label', ({ xml, position, size }) => {
      const p = buildPresentation(groupPlaceholderFiles(groupXml(xml)), { lazySlides });
      if (lazySlides) expect(p.slides[0].nodes).toEqual([]);
      materializeSlideNodes(p, p.slides[0]);
      const group = p.slides[0].nodes[0];
      expect({ position: group.position, size: group.size }).toEqual({ position, size });
      const serialized = serializePresentation(p).slides[0].nodes[0];
      expect({ position: serialized.position, size: serialized.size }).toEqual({ position, size });
      expect(serialized.children?.map((child) => child.id)).toEqual(['3', '4']);
      expect(
        serialized.children?.map((child) => ({ position: child.position, size: child.size })),
      ).toEqual([
        { position: { x: 20, y: 30 }, size: { w: 30, h: 10 } },
        { position: { x: 70, y: 50 }, size: { w: 30, h: 10 } },
      ]);
    });

    it('keeps non-placeholder group bounds despite the layout', () => {
      const p = buildPresentation(
        groupPlaceholderFiles(groupXml(transform(0, -20, 240, 120), false)),
        { lazySlides },
      );
      const group = serializePresentation(p).slides[0].nodes[0];
      expect({ position: group.position, size: group.size }).toEqual({
        position: { x: 0, y: -20 },
        size: { w: 240, h: 120 },
      });
      expect(group.children?.map((child) => child.id)).toEqual(['3', '4']);
    });

    it('serializes unmaterialized slides with explicit parent bounds and child order', () => {
      const p = buildPresentation(groupPlaceholderFiles(), { lazySlides });
      const group = serializePresentation(p).slides[0].nodes[0];
      expect({ position: group.position, size: group.size }).toEqual({
        position: { x: 200, y: 100 },
        size: { w: 240, h: 120 },
      });
      expect(group.children?.map((child) => child.id)).toEqual(['3', '4']);
    });
  });
}

it.each([
  ['sp', 'nvSpPr', 'spPr'],
  ['graphicFrame', 'nvGraphicFramePr', ''],
])('preserves ordinary %s transforms as a control', (tag, nv, props) => {
  const p = buildPresentation(groupPlaceholderFiles());
  const layout = [...p.layouts.values()][0];
  const xfrm = `<a:xfrm>${transform(0, -20, 240, 120)}</a:xfrm>`;
  const source = parseXml(
    `<p:${tag} ${namespaces}><p:${nv}><p:cNvPr id="2"/><p:nvPr><p:ph idx="7"/></p:nvPr></p:${nv}>${props ? `<p:${props}>${xfrm}</p:${props}>` : xfrm.replaceAll('a:xfrm', 'p:xfrm')}</p:${tag}>`,
  );
  const node = { ...parseBaseProps(source), nodeType: 'unknown' as const };
  resolveNodePlaceholderInheritance(node, layout, undefined);
  expect({ position: node.position, size: node.size }).toEqual({
    position: { x: 0, y: -20 },
    size: { w: 240, h: 120 },
  });
});
