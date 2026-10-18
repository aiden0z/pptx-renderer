import { describe, expect, it } from 'vitest';
import { parseXml } from '../../../src/parser/XmlParser';
import { parseShapeNode } from '../../../src/model/nodes/ShapeNode';
import { renderShape } from '../../../src/renderer/ShapeRenderer';
import { renderSlide } from '../../../src/renderer/SlideRenderer';
import { parseRenderableChild } from '../../../src/model/RenderableChild';
import { createMockRenderContext } from '../helpers/mockContext';

const ns =
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
function shape(height: number, preset = 'flowChartDocument', anchor = 'ctr', txXfrm = '') {
  return `<p:sp ${ns}><p:nvSpPr><p:cNvPr id="1" name="document"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2743200" cy="${height * 9525}"/></a:xfrm><a:prstGeom prst="${preset}"/></p:spPr>${txXfrm}<p:txBody><a:bodyPr anchor="${anchor}" lIns="0" rIns="0" tIns="0" bIns="0"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr sz="1800"/><a:t>Sample text</a:t></a:r></a:p></p:txBody></p:sp>`;
}
function textBox(element: HTMLElement) {
  return [...element.querySelectorAll('div')].find((el) => el.style.display === 'flex')!;
}

describe('preset text box layout (issue #37)', () => {
  it.each(['leftUpArrow', 'leftRightUpArrow', 'quadArrow'])(
    'keeps %s geometry and labels when explicit zero makes the preset text guides degenerate',
    async (preset) => {
      const xml = shape(144, preset).replace(
        `<a:prstGeom prst="${preset}"/>`,
        `<a:prstGeom prst="${preset}"><a:avLst><a:gd name="adj2" fmla="val 0"/></a:avLst></a:prstGeom>`,
      );
      const ctx = createMockRenderContext();
      ctx.slide.nodes = [parseShapeNode(parseXml(xml))];
      const h = renderSlide(ctx.presentation, ctx.slide, { pdfjs: false });
      await h.ready;
      expect(h.element.querySelector('svg')).not.toBeNull();
      expect(h.element.textContent).toContain('Sample text');
      expect(h.element.textContent).not.toContain('Render Error');
      h.dispose();
    },
  );

  for (const height of [144, 240]) {
    it.each([
      ['t', 'flex-start'],
      ['ctr', 'center'],
      ['b', 'flex-end'],
    ])(`uses the document text rectangle for height=${height}, anchor=%s`, (anchor, alignment) => {
      const node = parseShapeNode(parseXml(shape(height, 'flowChartDocument', anchor)));
      const box = textBox(renderShape(node, createMockRenderContext()));
      expect(parseFloat(box.style.height)).toBeCloseTo((height * 17322) / 21600, 6);
      expect(box.style.justifyContent).toBe(alignment);
      expect(box.style.top).toBe('0px');
    });
  }

  it('preserves full-bounds rectangle behavior', () => {
    const box = textBox(
      renderShape(parseShapeNode(parseXml(shape(144, 'rect'))), createMockRenderContext()),
    );
    expect(box.style.width).toBe('100%');
    expect(box.style.height).toBe('100%');
  });

  it('gives explicit txXfrm priority over the preset text rectangle', () => {
    const tx =
      '<p:txXfrm><a:off x="114300" y="57150"/><a:ext cx="1143000" cy="571500"/></p:txXfrm>';
    const box = textBox(
      renderShape(
        parseShapeNode(parseXml(shape(144, 'flowChartDocument', 'ctr', tx))),
        createMockRenderContext(),
      ),
    );
    expect([box.style.left, box.style.top, box.style.width, box.style.height]).toEqual([
      '12px',
      '6px',
      '120px',
      '60px',
    ]);
  });

  it('uses the remapped shape extent for grouped preset text', async () => {
    const xml = parseXml(
      `<p:grpSp ${ns}><p:nvGrpSpPr><p:cNvPr id="2" name="group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="5486400" cy="2743200"/><a:chOff x="0" y="0"/><a:chExt cx="2743200" cy="1371600"/></a:xfrm></p:grpSpPr>${shape(144)}</p:grpSp>`,
    );
    const ctx = createMockRenderContext();
    ctx.slide.nodes = [parseRenderableChild(xml, { rels: ctx.slide.rels })!];
    const h = renderSlide(ctx.presentation, ctx.slide, { pdfjs: false });
    await h.ready;
    expect(parseFloat(textBox(h.element).style.height)).toBeCloseTo((288 * 17322) / 21600, 6);
    h.dispose();
  });
});
