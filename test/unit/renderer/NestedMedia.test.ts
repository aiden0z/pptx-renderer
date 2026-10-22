import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseZip, parseZipLazyMedia } from '../../../src/parser/ZipParser';
import { buildPresentation } from '../../../src/model/Presentation';
import { renderSlide } from '../../../src/renderer/SlideRenderer';

const p = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const namespaces = `xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"`;
const blipFill =
  '<a:blipFill><a:blip r:embed="image"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>';
const transform = '<a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>';
const shapes = `
  <p:sp><p:nvSpPr><p:cNvPr id="2" name="Picture fill"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr>${transform}<a:prstGeom prst="rect"/>${blipFill}</p:spPr>
    <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr>${blipFill}</a:rPr><a:t>Picture text</a:t></a:r></a:p></p:txBody></p:sp>
  <p:pic><p:nvPicPr><p:cNvPr id="3" name="Picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
    <p:blipFill><a:blip r:embed="image"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
    <p:spPr>${transform}<a:prstGeom prst="rect"/></p:spPr></p:pic>`;

function rels(inner: string): string {
  return `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${inner}</Relationships>`;
}

describe.each([
  ['eager', parseZip],
  ['lazy', parseZipLazyMedia],
] as const)('%s nested media rendering', (_mode, parse) => {
  it.each([
    ['sld', 'slides'],
    ['sldLayout', 'slideLayouts'],
    ['sldMaster', 'slideMasters'],
  ])('renders backgrounds, picture fills and pictures owned by %s', async (owner, folder) => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file(
      'ppt/presentation.xml',
      `<p:presentation ${namespaces}><p:sldIdLst><p:sldId id="256" r:id="slide"/></p:sldIdLst></p:presentation>`,
    );
    zip.file(
      'ppt/_rels/presentation.xml.rels',
      rels(`<Relationship Id="slide" Type="${r}/slide" Target="slides/slide1.xml"/>`),
    );
    for (const [tag, dir, name, parent] of [
      [
        'sld',
        'slides',
        'slide1',
        `<Relationship Id="layout" Type="${r}/slideLayout" Target="../slideLayouts/layout1.xml"/>`,
      ],
      [
        'sldLayout',
        'slideLayouts',
        'layout1',
        `<Relationship Id="master" Type="${r}/slideMaster" Target="../slideMasters/master1.xml"/>`,
      ],
      ['sldMaster', 'slideMasters', 'master1', ''],
    ]) {
      const content =
        tag === owner
          ? `<p:bg><p:bgPr>${blipFill}</p:bgPr></p:bg><p:spTree>${shapes}</p:spTree>`
          : '<p:spTree/>';
      zip.file(
        `ppt/${dir}/${name}.xml`,
        `<p:${tag} ${namespaces}><p:cSld>${content}</p:cSld></p:${tag}>`,
      );
      zip.file(
        `ppt/${dir}/_rels/${name}.xml.rels`,
        rels(
          parent + `<Relationship Id="image" Type="${r}/image" Target="media/image%20one.png"/>`,
        ),
      );
    }
    const mediaPath = `ppt/${folder}/media/image one.png`;
    zip.file(mediaPath, new Uint8Array([1, 2, 3]));
    // A same-named conventional image must never replace the owner's image.
    zip.file('ppt/media/image one.png', new Uint8Array([9]));
    const files = await parse(await zip.generateAsync({ type: 'arraybuffer' }));
    const presentation = buildPresentation(files);
    const cache = new Map<string, string>();
    const handle = renderSlide(presentation, presentation.slides[0], { mediaUrlCache: cache });
    try {
      await handle.ready;
      expect([...cache.keys()]).toEqual([mediaPath]);
      const url = cache.get(mediaPath)!;
      expect(handle.element.style.backgroundImage).toContain(url);
      expect(handle.element.querySelector('img')?.getAttribute('src')).toBe(url);
      expect(handle.element.querySelector('svg image')?.getAttribute('href')).toBe(url);
      const text = Array.from(handle.element.querySelectorAll('span')).find(
        (span) => span.textContent === 'Picture text',
      );
      expect(text?.style.backgroundImage).toContain(url);
    } finally {
      handle.dispose();
      for (const url of cache.values()) URL.revokeObjectURL(url);
    }
  });
});
