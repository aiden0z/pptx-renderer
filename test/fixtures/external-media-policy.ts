import { parseXml } from '../../src/parser/XmlParser';
import { parseRenderableChildren } from '../../src/model/RenderableChild';
import { presentation } from './media-group-coverage';

export const externalMediaOrigin = 'https://external-media.example.test';
const ns =
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const xfrm = '<a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="952500"/></a:xfrm>';
const fill = (id: string) =>
  `<a:blipFill><a:blip r:link="${id}"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>`;
const picture = (id: string, linked = false, media = '') =>
  `<p:pic><p:nvPicPr><p:cNvPr id="1" name="${id}"/><p:cNvPicPr/><p:nvPr>${media}</p:nvPr></p:nvPicPr><p:blipFill><a:blip r:${linked ? 'link' : 'embed'}="${id}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm}</p:spPr></p:pic>`;
const shape = (id: string, pictureText = false) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm}<a:prstGeom prst="rect"/>${pictureText ? '' : fill(id)}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1800">${pictureText ? fill(id) : ''}</a:rPr><a:t>Visible fill</a:t></a:r></a:p></p:txBody></p:sp>`;
const tree = (content: string) => parseXml(`<p:spTree ${ns}>${content}</p:spTree>`);

/** A model fixture shared by DOM tests and browser network interception tests. */
export function externalMediaPresentation(lazy = false) {
  const p = presentation();
  const rels = p.slides[0].rels;
  rels.clear();
  for (const id of [
    'picture',
    'linked',
    'background',
    'shape',
    'text',
    'group',
    'layout',
    'master',
    'poster',
    'video',
    'audio',
    'svg',
  ]) {
    rels.set(id, {
      type: 'image',
      target: `${externalMediaOrigin}/${id}.png`,
      targetMode: 'External',
    });
  }
  rels.set('embedded', { type: 'image', target: '../media/embedded.png' });
  // A complete 1x1 PNG; do not make the embedded control depend on external data.
  const png = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQ0AAAAASUVORK5CYII=',
    ),
    (c) => c.charCodeAt(0),
  );
  if (lazy)
    p.mediaResolver = { resolve: async () => ({ mediaPath: 'ppt/media/embedded.png', data: png }) };
  else p.media.set('ppt/media/embedded.png', png);
  const group = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="9" name="group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="952500"/><a:chOff x="0" y="0"/><a:chExt cx="952500" cy="952500"/></a:xfrm></p:grpSpPr>${picture('group')}</p:grpSp>`;
  const svgPicture = picture('embedded').replace(
    '<a:blip r:embed="embedded"/>',
    '<a:blip r:embed="embedded"><a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="svg"/></a:ext></a:extLst></a:blip>',
  );
  const content =
    picture('picture') +
    picture('linked', true) +
    shape('shape') +
    shape('text', true) +
    group +
    picture('poster', false, '<a:videoFile r:link="video"/>') +
    picture('poster', false, '<a:audioFile r:link="audio"/>') +
    svgPicture +
    picture('embedded');
  p.slides[0].nodes = tree(content)
    .allChildren()
    .flatMap((child) => parseRenderableChildren(child, { rels }));
  p.slides[0].background = parseXml(`<p:bg ${ns}><p:bgPr>${fill('background')}</p:bgPr></p:bg>`);
  p.slideToLayout.set(0, 'ppt/slideLayouts/slideLayout1.xml');
  p.layoutToMaster.set('ppt/slideLayouts/slideLayout1.xml', 'ppt/slideMasters/slideMaster1.xml');
  p.layouts.set('ppt/slideLayouts/slideLayout1.xml', {
    placeholders: [],
    spTree: tree(picture('layout')),
    rels,
    showMasterSp: true,
  });
  p.masters.set('ppt/slideMasters/slideMaster1.xml', {
    placeholders: [],
    spTree: tree(picture('master')),
    rels,
    colorMap: new Map(),
    textStyles: {},
  });
  return p;
}
