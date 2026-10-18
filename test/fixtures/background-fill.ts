import { parseXml } from '../../src/parser/XmlParser';
import { parseRenderableChildren } from '../../src/model/RenderableChild';
import { presentation } from './media-group-coverage';

const ns =
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const emu = (value: number) => value * 9525;
export interface BackgroundFillCase {
  kind?: 'white' | 'solid' | 'gradient' | 'radial' | 'picture' | 'pattern';
  rotation?: number;
  flipH?: boolean;
  grouped?: boolean;
  lazy?: boolean;
  external?: boolean;
  origin?: 'slide' | 'layout' | 'master';
  localFill?: string;
  flag?: string;
  preset?: string;
}
export function backgroundFillPresentation(options: BackgroundFillCase = {}) {
  const p = presentation();
  p.width = 600;
  p.height = 300;
  p.layouts.clear();
  p.masters.clear();
  p.themes.clear();
  p.slideToLayout.clear();
  p.layoutToMaster.clear();
  p.masterToTheme.clear();
  p.media.clear();
  p.slides[0].rels.clear();
  const shape = (
    id: number,
    x: number,
    y: number,
    w: number,
    h: number,
    fill: string,
    attrs = '',
    transform = '',
    preset = 'rect',
  ) =>
    `<p:sp ${attrs}><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm ${transform}><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>${fill}<a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
  const solid = (color: string) => `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
  const green = shape(1, 0, 0, 600, 300, solid('00FF00'));
  let cutout = shape(
    2,
    100,
    80,
    200,
    120,
    options.localFill ? solid(options.localFill) : '',
    `useBgFill="${options.flag ?? '1'}"`,
    `rot="${(options.rotation ?? 0) * 60000}" flipH="${options.flipH ? 1 : 0}"`,
    options.preset ?? 'rect',
  );
  if (options.grouped)
    cutout = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="3" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm rot="1200000" flipH="1"><a:off x="${emu(50)}" y="${emu(20)}"/><a:ext cx="${emu(480)}" cy="${emu(240)}"/><a:chOff x="0" y="0"/><a:chExt cx="${emu(400)}" cy="${emu(300)}"/></a:xfrm></p:grpSpPr>${cutout}</p:grpSp>`;
  const tree = (content: string) => parseXml(`<p:spTree ${ns}>${content}</p:spTree>`);
  const rels = p.slides[0].rels;
  const kind = options.kind ?? 'white';
  let fill = '';
  if (kind === 'solid') fill = solid('FFCCAA');
  if (kind === 'gradient' || kind === 'radial')
    fill = `<a:gradFill><a:gsLst><a:gs pos="0">${'<a:srgbClr val="000000"/>'}</a:gs><a:gs pos="100000"><a:srgbClr val="FFFFFF"/></a:gs></a:gsLst>${kind === 'gradient' ? '<a:lin ang="0" scaled="0"/>' : '<a:path path="circle"><a:fillToRect l="50000" r="50000" t="50000" b="50000"/></a:path>'}</a:gradFill>`;
  if (kind === 'pattern')
    fill =
      '<a:pattFill prst="pct50"><a:fgClr><a:srgbClr val="000000"/></a:fgClr><a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr></a:pattFill>';
  if (kind === 'picture') {
    fill = '<a:blipFill><a:blip r:embed="bg"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>';
    rels.set('bg', {
      type: 'image',
      target: options.external
        ? 'https://external-media.example.test/background-fill.svg'
        : '../media/background-fill.svg',
      ...(options.external ? { targetMode: 'External' } : {}),
    });
    const data = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><path fill="#ff0000" d="M0 0h150v300H0z"/><path fill="#0000ff" d="M150 0h150v300H150z"/><path fill="#ffff00" d="M300 0h150v300H300z"/><path fill="#ff00ff" d="M450 0h150v300H450z"/></svg>',
    );
    if (options.lazy)
      p.mediaResolver = {
        resolve: async () => ({ mediaPath: 'ppt/media/background-fill.svg', data }),
      };
    else p.media.set('ppt/media/background-fill.svg', data);
  }
  p.slides[0].background = fill
    ? parseXml(`<p:bg ${ns}><p:bgPr>${fill}</p:bgPr></p:bg>`)
    : undefined;
  p.slides[0].nodes = tree(green + (options.origin && options.origin !== 'slide' ? '' : cutout))
    .allChildren()
    .flatMap((child) => parseRenderableChildren(child, { rels }));
  if (options.origin && options.origin !== 'slide') {
    // Template backgrounds retain the original slide relationship owner even when the shape
    // context uses template relationships with the same rId pointing elsewhere.
    p.slides[0].nodes = [];
    p.slideToLayout.set(0, 'layout');
    p.layoutToMaster.set('layout', 'master');
    const templateRels = new Map([
      [
        'bg',
        {
          type: 'image',
          target: 'https://external-media.example.test/wrong.svg',
          targetMode: 'External',
        },
      ],
    ]);
    p.layouts.set('layout', {
      placeholders: [],
      spTree: tree(options.origin === 'layout' ? green + cutout : ''),
      rels: templateRels,
      showMasterSp: true,
    });
    p.masters.set('master', {
      placeholders: [],
      spTree: tree(options.origin === 'master' ? green + cutout : ''),
      rels: templateRels,
      colorMap: new Map(),
      textStyles: {},
    });
  }
  return p;
}
