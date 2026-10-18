import { describe, expect, it, vi } from 'vitest';
import { parseXml } from '../../../src/parser/XmlParser';
import { createLazySlide, parseSlide } from '../../../src/model/Slide';
import { renderSlide } from '../../../src/renderer/SlideRenderer';
import { serializePresentation } from '../../../src/export/serializePresentation';
import { presentation } from '../../fixtures/media-group-coverage';
import { groupPlaceholderFiles, groupXml } from '../../fixtures/group-placeholder-transform';
import { buildPresentation } from '../../../src/model/Presentation';

const ns =
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const xfrm = '<a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="952500"/></a:xfrm>';
const flag = (hidden?: string) => (hidden === undefined ? '' : ` hidden="${hidden}"`);
const shape = (text: string, hidden?: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="${text}"${flag(hidden)}/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm}<a:prstGeom prst="rect"/></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
const group = (content: string, hidden?: string) =>
  `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="3" name="group"${flag(hidden)}/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1905000" cy="1905000"/><a:chOff x="0" y="0"/><a:chExt cx="952500" cy="952500"/></a:xfrm></p:grpSpPr>${content}</p:grpSp>`;
const picture = `<p:pic><p:nvPicPr><p:cNvPr id="4" name="hidden picture" hidden="1"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="poster"/></p:blipFill><p:spPr>${xfrm}</p:spPr></p:pic>`;

function fixture(origin: 'slide' | 'layout' | 'master', content: string, lazy = false) {
  const p = presentation();
  const tree = parseXml(`<p:spTree ${ns}>${content}</p:spTree>`);
  const xml = `<p:sld ${ns}><p:cSld><p:spTree>${origin === 'slide' ? content : ''}</p:spTree></p:cSld></p:sld>`;
  const rels = p.slides[0].rels;
  p.slides[0] = lazy
    ? createLazySlide(xml, 0, rels, 'ppt/slides/slide1.xml')
    : parseSlide(parseXml(xml), 0, rels, 'ppt/slides/slide1.xml');
  p.slideToLayout.set(0, 'layout');
  p.layoutToMaster.set('layout', 'master');
  p.layouts.set('layout', {
    placeholders: [],
    spTree: origin === 'layout' ? tree : parseXml('<spTree/>'),
    rels,
    showMasterSp: true,
  });
  p.masters.set('master', {
    placeholders: [],
    spTree: origin === 'master' ? tree : parseXml('<spTree/>'),
    rels,
    colorMap: new Map(),
    textStyles: {},
  });
  return p;
}

describe('hidden nodes (issue #36)', () => {
  it.each([
    [undefined, '1', true],
    ['0', 'true', true],
    ['false', '1', true],
    ['1', '0', true],
    ['true', undefined, true],
    [undefined, '0', false],
    ['0', undefined, false],
    [undefined, undefined, false],
  ] as const)(
    'combines OLE frame hidden=%s and preview hidden=%s',
    async (frameHidden, previewHidden, expectedHidden) => {
      const preview =
        previewHidden === undefined
          ? picture.replace(' hidden="1"', '')
          : picture.replace('hidden="1"', `hidden="${previewHidden}"`);
      const frame = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="20" name="OLE frame"${flag(frameHidden)}/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>${xfrm}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole"><p:oleObj>${preview}</p:oleObj></a:graphicData></a:graphic></p:graphicFrame>`;
      const p = fixture('slide', frame);
      p.media.set('ppt/media/poster.png', new Uint8Array([1]));
      expect(p.slides[0].nodes[0].hidden ?? false).toBe(expectedHidden);
      expect(serializePresentation(p).slides[0].nodes[0].hidden ?? false).toBe(expectedHidden);
      const h = renderSlide(p, p.slides[0], { pdfjs: false });
      await h.ready;
      expect(h.element.querySelectorAll('img')).toHaveLength(expectedHidden ? 0 : 1);
      h.dispose();
    },
  );

  for (const origin of ['slide', 'layout', 'master'] as const) {
    it.each([false, true])(
      `skips hidden ${origin} shapes and nested groups, lazySlides=%s`,
      async (lazy) => {
        const content =
          shape('hidden-one', '1') +
          shape('hidden-true', 'true') +
          shape('visible-zero', '0') +
          shape('visible-false', 'false') +
          shape('visible-absent') +
          group(group(shape('hidden-descendant', '0'), '1') + shape('visible-sibling'));
        const p = fixture(origin, content, lazy);
        const h = renderSlide(p, p.slides[0], { pdfjs: false });
        await h.ready;
        expect(h.element.textContent).not.toContain('hidden-');
        for (const text of ['visible-zero', 'visible-false', 'visible-absent', 'visible-sibling'])
          expect(h.element.textContent).toContain(text);
        h.dispose();
      },
    );

    it(`does not resolve media in hidden ${origin} pictures or groups`, async () => {
      const p = fixture(origin, picture + group(picture.replace(' hidden="1"', ''), 'true'));
      const resolve = vi.fn(async () => ({
        mediaPath: 'ppt/media/poster.png',
        data: new Uint8Array([1]),
      }));
      p.mediaResolver = { resolve };
      const h = renderSlide(p, p.slides[0], { pdfjs: false });
      await h.ready;
      expect(resolve).not.toHaveBeenCalled();
      expect(h.element.querySelector('img')).toBeNull();
      h.dispose();
    });
  }

  it('retains hidden metadata in the parsed and serialized model', () => {
    const p = fixture('slide', shape('hidden-object', 'true') + group(shape('child'), '1'));
    expect(p.slides[0].nodes).toHaveLength(2);
    expect(p.slides[0].nodes[0].hidden).toBe(true);
    const data = serializePresentation(p);
    expect(data.slides[0].nodes[0].hidden).toBe(true);
    expect(data.slides[0].nodes[1].hidden).toBe(true);
    expect(data.slides[0].nodes[1].children).toHaveLength(1);
  });

  it.each([false, true])(
    'keeps hidden layout placeholders available for visible slide inheritance, lazySlides=%s',
    async (lazySlides) => {
      const files = groupPlaceholderFiles(groupXml(null));
      const path = 'ppt/slideLayouts/slideLayout1.xml';
      files.slideLayouts.set(
        path,
        files.slideLayouts.get(path)!.replace('name="Template"', 'name="Template" hidden="1"'),
      );
      const p = buildPresentation(files, { lazySlides });
      const h = renderSlide(p, p.slides[0], { pdfjs: false });
      await h.ready;
      expect(p.slides[0].nodes[0].hidden).not.toBe(true);
      expect(p.slides[0].nodes[0].size).toEqual({ w: 600, h: 300 });
      expect(h.element.querySelectorAll('svg')).toHaveLength(2);
      h.dispose();
    },
  );
});
