import { parseXml } from '../../src/parser/XmlParser';
import { parsePicNode } from '../../src/model/nodes/PicNode';
import type { PresentationData } from '../../src/model/Presentation';
import { parseGroupNode } from '../../src/model/nodes/GroupNode';

export function picture(
  options: {
    kind?: 'image' | 'audio' | 'video';
    effect?: string;
    geometry?: string;
    flip?: boolean;
    crop?: boolean;
  } = {},
) {
  const node = parsePicNode(
    parseXml(
      `<p:pic xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:nvPicPr><p:cNvPr id="1" name="media"/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="poster">${options.effect ?? ''}</a:blip>${options.crop ? '<a:srcRect l="10000" r="20000" t="10000" b="10000"/>' : ''}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm flipH="${options.flip ? 1 : 0}" flipV="${options.flip ? 1 : 0}"><a:off x="0" y="0"/><a:ext cx="1905000" cy="1905000"/></a:xfrm>${options.geometry?.startsWith('<') ? options.geometry : `<a:prstGeom prst="${options.geometry ?? 'rect'}"/>`}</p:spPr></p:pic>`,
    ),
  );
  if (options.kind === 'audio') node.isAudio = true;
  if (options.kind === 'video') node.isVideo = true;
  node.mediaRId = 'media';
  return node;
}
export function presentation(): PresentationData {
  return {
    width: 400,
    height: 300,
    slides: [
      {
        index: 0,
        nodes: [],
        rels: new Map([
          ['poster', { type: 'image', target: '../media/poster.png' }],
          ['media', { type: 'media', target: '../media/clip.webm' }],
        ]),
        slidePath: 'ppt/slides/slide1.xml',
        showMasterSp: true,
      },
    ],
    layouts: new Map(),
    masters: new Map(),
    themes: new Map(),
    slideToLayout: new Map(),
    layoutToMaster: new Map(),
    masterToTheme: new Map(),
    media: new Map(),
    charts: new Map(),
    isWps: false,
  };
}
export function ordinaryCycleGroup() {
  const children = Array.from(
    { length: 6 },
    (_, i) =>
      `<p:sp><p:nvSpPr><p:cNvPr id="${i + 1}" name="${i}"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${i * 95250}" y="190500"/><a:ext cx="${(i + 1) * 95250}" cy="285750"/></a:xfrm><a:prstGeom prst="${i < 3 ? 'pie' : 'circularArrow'}"/></p:spPr></p:sp>`,
  ).join('');
  return parseGroupNode(
    parseXml(
      `<p:grpSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1905000" cy="952500"/><a:chOff x="0" y="0"/><a:chExt cx="952500" cy="952500"/></a:xfrm></p:grpSpPr>${children}</p:grpSp>`,
    ),
  );
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
/** Original one-pixel red EMF: HEADER + STRETCHDIBITS with 24-bit BI_RGB. */
export function bitmapEmf(): Uint8Array {
  const data = new Uint8Array(212);
  const view = new DataView(data.buffer);
  view.setUint32(0, 1, true);
  view.setUint32(4, 88, true);
  view.setUint32(40, 0x464d4520, true);
  const start = 88;
  view.setUint32(start, 81, true);
  view.setUint32(start + 4, 124, true);
  view.setUint32(start + 48, 80, true);
  view.setUint32(start + 52, 40, true);
  view.setUint32(start + 56, 120, true);
  view.setUint32(start + 60, 4, true);
  view.setUint32(start + 80, 40, true);
  view.setInt32(start + 84, 1, true);
  view.setInt32(start + 88, 1, true);
  view.setUint16(start + 92, 1, true);
  view.setUint16(start + 94, 24, true);
  data[start + 122] = 255;
  return data;
}
