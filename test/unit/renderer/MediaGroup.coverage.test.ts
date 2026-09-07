import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { renderSlide } from '../../../src/renderer/SlideRenderer';
import { renderGroup } from '../../../src/renderer/GroupRenderer';
import { createRenderContext } from '../../../src/renderer/RenderContext';
import { PptxViewer } from '../../../src/core/Viewer';
import { parseXml } from '../../../src/parser/XmlParser';
import {
  picture,
  presentation,
  ordinaryCycleGroup,
  deferred,
} from '../../fixtures/media-group-coverage';
import type { ResolvedMedia } from '../../../src/utils/media';

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

for (const background of [false, true]) {
  for (const outcome of ['resolve', 'reject'] as const) {
    it(`disposed ${background ? 'background' : 'picture'} ignores late ${outcome}`, async () => {
      const p = presentation();
      const pending = deferred<ResolvedMedia | undefined>();
      p.mediaResolver = { resolve: () => pending.promise };
      if (background)
        p.slides[0].background = parseXml(
          '<p:bg xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:bgPr><a:blipFill><a:blip r:embed="poster"/><a:stretch/></a:blipFill></p:bgPr></p:bg>',
        );
      else p.slides[0].nodes = [picture()];
      const cache = new Map<string, string>();
      const handle = renderSlide(p, p.slides[0], { mediaUrlCache: cache });
      handle.dispose();
      const before = handle.element.outerHTML;
      if (outcome === 'resolve')
        pending.resolve({ mediaPath: 'ppt/media/poster.png', data: new Uint8Array([1]) });
      else pending.reject(new Error('missing'));
      await handle.ready;
      expect(cache.size).toBe(0);
      expect(handle.element.outerHTML).toBe(before);
    });
  }
}
for (const kind of ['audio', 'video'] as const) {
  for (const disposed of [false, true]) {
    it(`lazy ${kind} resolves media and poster; disposed=${disposed}`, async () => {
      const p = presentation();
      p.slides[0].nodes = [picture({ kind })];
      const pending = deferred<ResolvedMedia | undefined>();
      p.mediaResolver = {
        resolve: async (target) =>
          target.includes('poster')
            ? { mediaPath: 'ppt/media/poster.png', data: new Uint8Array([1]) }
            : pending.promise,
      };
      const handle = renderSlide(p, p.slides[0]);
      if (disposed) handle.dispose();
      const before = handle.element.outerHTML;
      pending.resolve({ mediaPath: 'ppt/media/clip.webm', data: new Uint8Array([1]) });
      await handle.ready;
      if (disposed) expect(handle.element.outerHTML).toBe(before);
      else {
        expect(handle.element.querySelector(kind)?.getAttribute('src')).toMatch(/^blob:/);
        expect(
          handle.element.querySelector(kind === 'video' ? 'video[poster]' : 'img'),
        ).not.toBeNull();
      }
      handle.dispose();
    });
  }
}
it('ordinary six-shape cycle-like group retains exact source order and coordinate mapping', () => {
  const p = presentation();
  const result: unknown[] = [];
  renderGroup(ordinaryCycleGroup(), createRenderContext(p, p.slides[0]), (node) => {
    result.push([node.id, node.position.x, node.position.y, node.size.w, node.size.h]);
    return document.createElement('div');
  });
  expect(result).toEqual(
    Array.from({ length: 6 }, (_, i) => [String(i + 1), i * 20, 20, (i + 1) * 20, 30]),
  );
});
it('caller-owned delayed image survives viewer reload without poisoning another document or sibling URL ownership', async () => {
  const viewer = new PptxViewer(document.createElement('div'));
  const p = presentation();
  const pending = deferred<ResolvedMedia | undefined>();
  p.slides[0].nodes = [picture()];
  p.mediaResolver = { resolve: () => pending.promise };
  viewer.load(p);
  const old = viewer.renderSlideToContainer(0, document.createElement('div'))!;
  const next = presentation();
  next.slides[0].nodes = [picture()];
  next.media.set('ppt/media/poster.png', new Uint8Array([2]));
  viewer.load(next);
  pending.resolve({ mediaPath: 'ppt/media/poster.png', data: new Uint8Array([1]) });
  await old.ready;
  const current = viewer.renderSlideToContainer(0, document.createElement('div'))!;
  await current.ready;
  const oldUrl = old.element.querySelector('img')!.src;
  const currentUrl = current.element.querySelector('img')!.src;
  expect(oldUrl).not.toBe(currentUrl);
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  viewer.destroy();
  expect(revoke).not.toHaveBeenCalledWith(oldUrl);
  expect(revoke).not.toHaveBeenCalledWith(currentUrl);
  old.dispose();
  expect(revoke).toHaveBeenCalledWith(oldUrl);
  expect(revoke).not.toHaveBeenCalledWith(currentUrl);
  current.dispose();
  expect(revoke).toHaveBeenCalledWith(currentUrl);
  revoke.mockRestore();
});

for (const missing of ['undefined', 'reject'] as const) {
  it(`lazy failed video ${missing} retains its available poster while sibling image succeeds`, async () => {
    const p = presentation();
    p.slides[0].nodes = [picture({ kind: 'video' }), picture()];
    p.mediaResolver = {
      resolve: async (target) => {
        if (target.includes('poster'))
          return { mediaPath: 'ppt/media/poster.png', data: new Uint8Array([1]) };
        if (missing === 'reject') throw new Error('missing');
        return undefined;
      },
    };
    const h = renderSlide(p, p.slides[0]);
    await h.ready;
    expect(h.element.querySelector('video')).toBeNull();
    expect(h.element.querySelectorAll('img')).toHaveLength(2);
    expect(h.element.textContent).toContain('▶');
    h.dispose();
  });
}
it('internal lazy blipLink resolves without admitting unsafe external media', async () => {
  const p = presentation();
  const linked = picture();
  linked.blipEmbed = undefined;
  linked.blipLink = 'poster';
  p.slides[0].nodes = [linked];
  p.mediaResolver = {
    resolve: async () => ({ mediaPath: 'ppt/media/poster.png', data: new Uint8Array([1]) }),
  };
  const h = renderSlide(p, p.slides[0]);
  await h.ready;
  expect(h.element.querySelector('img')?.src).toMatch(/^blob:/);
  h.dispose();
  p.slides[0].rels.set('poster', {
    type: 'image',
    target: 'javascript:alert(1)',
    targetMode: 'External',
  });
  const blocked = renderSlide(p, p.slides[0]);
  await blocked.ready;
  expect(blocked.element.querySelector('img')).toBeNull();
  blocked.dispose();
});
for (const disposed of [false, true]) {
  it(`lazy EMF bitmap ready includes delayed toBlob; disposed=${disposed}`, async () => {
    const emf = await import('../../../src/utils/emfParser');
    const spy = vi.spyOn(emf, 'parseEmfContent').mockReturnValue({
      type: 'bitmap',
      imageData: {
        width: 1,
        height: 1,
        data: new Uint8ClampedArray([255, 0, 0, 255]),
      } as ImageData,
    });
    const context = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ putImageData() {} } as any);
    let complete!: BlobCallback;
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => {
      complete = cb;
    });
    const p = presentation();
    p.slides[0].nodes = [picture()];
    p.slides[0].rels.set('poster', { type: 'image', target: '../media/poster.emf' });
    p.mediaResolver = {
      resolve: async () => ({ mediaPath: 'ppt/media/poster.emf', data: new Uint8Array([1]) }),
    };
    const cache = new Map<string, string>();
    const h = renderSlide(p, p.slides[0], { mediaUrlCache: cache });
    let ready = false;
    void h.ready.then(() => {
      ready = true;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(complete).toBeTypeOf('function');
    expect(ready).toBe(false);
    if (disposed) h.dispose();
    const before = h.element.outerHTML;
    complete(new Blob([new Uint8Array([1])]));
    await h.ready;
    if (disposed) {
      expect(cache.size).toBe(0);
      expect(h.element.outerHTML).toBe(before);
    } else expect(h.element.querySelector('img')).not.toBeNull();
    h.dispose();
    for (const url of cache.values()) URL.revokeObjectURL(url);
    spy.mockRestore();
    context.mockRestore();
    toBlob.mockRestore();
  });
}
it('only the diagram layout relationship identifies segmented-cycle compensation', async () => {
  const { parseRenderableChild } = await import('../../../src/model/RenderableChild');
  const group = ordinaryCycleGroup();
  const drawing = `<dsp:drawing xmlns:dsp="dsp"><dsp:spTree>${group.children.map((n) => n.element!.outerHTML).join('')}</dsp:spTree></dsp:drawing>`;
  const frame = parseXml(
    '<p:graphicFrame xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:xfrm><a:off x="0" y="0"/><a:ext cx="1905000" cy="952500"/></p:xfrm><a:graphic><a:graphicData uri="diagram"><dgm:relIds r:lo="layout"/></a:graphicData></a:graphic></p:graphicFrame>',
  );
  for (const id of ['urn:microsoft.com/office/officeart/2005/8/layout/cycle8', 'other-layout']) {
    const parsed = parseRenderableChild(frame, {
      partPath: 'ppt/slides/slide1.xml',
      rels: new Map([
        ['drawing', { type: 'diagramDrawing', target: '../diagrams/drawing1.xml' }],
        [
          'layout',
          {
            type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramLayout',
            target: '../diagrams/unrelated-name.xml',
            targetMode: 'Internal',
          },
        ],
      ]),
      diagramDrawings: new Map([
        ['ppt/diagrams/drawing1.xml', drawing],
        ['ppt/diagrams/unrelated-name.xml', `<layoutDef uniqueId="${id}"/>`],
      ]),
    })!;
    expect((parsed as any).diagramLayoutId).toBe(id);
    const p = presentation();
    const ids: string[] = [];
    renderGroup(parsed as any, createRenderContext(p, p.slides[0]), (n) => {
      ids.push(n.id);
      return document.createElement('div');
    });
    expect(ids).toEqual(
      id.endsWith('cycle8') ? ['4', '5', '6', '1', '2', '3'] : ['1', '2', '3', '4', '5', '6'],
    );
  }
});

for (const effect of [
  '<a:duotone><a:srgbClr val="000000"/><a:srgbClr val="FFFFFF"/></a:duotone>',
  '<a:lum bright="50000"/>',
  '<a:biLevel thresh="50000"/>',
])
  it(`disposed picture ignores pending pixel-effect image load ${effect}`, async () => {
    const p = presentation();
    p.media.set('ppt/media/poster.png', new Uint8Array([1]));
    p.slides[0].nodes = [picture({ effect })];
    const h = renderSlide(p, p.slides[0]);
    const img = h.element.querySelector('img')!;
    Object.defineProperty(img, 'naturalWidth', { value: 1 });
    Object.defineProperty(img, 'naturalHeight', { value: 1 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage() {},
      getImageData() {
        return { data: new Uint8ClampedArray([255, 0, 0, 255]) };
      },
      putImageData() {},
    } as any);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,AA==',
    );
    h.dispose();
    const before = h.element.outerHTML;
    img.dispatchEvent(new Event('load'));
    expect(h.element.outerHTML).toBe(before);
  });
it('concurrent EMF bitmap completions retain a single owned cache URL', async () => {
  const emf = await import('../../../src/utils/emfParser');
  vi.spyOn(emf, 'parseEmfContent').mockReturnValue({
    type: 'bitmap',
    imageData: { width: 1, height: 1, data: new Uint8ClampedArray(4) } as ImageData,
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ putImageData() {} } as any);
  const callbacks: BlobCallback[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => callbacks.push(cb));
  const p = presentation();
  p.slides[0].nodes = [picture(), picture()];
  p.slides[0].rels.set('poster', { type: 'image', target: '../media/poster.emf' });
  p.media.set('ppt/media/poster.emf', new Uint8Array([1]));
  const h = renderSlide(p, p.slides[0]);
  callbacks.forEach((cb) => cb(new Blob([new Uint8Array([1])])));
  await h.ready;
  const images = Array.from(h.element.querySelectorAll('img'));
  expect(images).toHaveLength(2);
  expect(images[0].src).toBe(images[1].src);
  h.dispose();
});
it('concurrent EMF PDF completions revoke redundant output and share the owned URL', async () => {
  const emf = await import('../../../src/utils/emfParser');
  const pdf = await import('../../../src/utils/pdfRenderer');
  vi.spyOn(emf, 'parseEmfContent').mockReturnValue({ type: 'pdf', data: new Uint8Array([1]) });
  const outputs = [URL.createObjectURL(new Blob(['a'])), URL.createObjectURL(new Blob(['b']))];
  let index = 0;
  vi.spyOn(pdf, 'renderPdfToImage').mockImplementation(async () => outputs[index++]);
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const p = presentation();
  p.slides[0].nodes = [picture(), picture()];
  p.slides[0].rels.set('poster', { type: 'image', target: '../media/poster.emf' });
  p.media.set('ppt/media/poster.emf', new Uint8Array([1]));
  const h = renderSlide(p, p.slides[0]);
  await h.ready;
  const images = Array.from(h.element.querySelectorAll('img'));
  expect(images).toHaveLength(2);
  expect(images[0].src).toBe(images[1].src);
  expect(revoke).toHaveBeenCalledWith(outputs[1]);
  h.dispose();
  expect(revoke).toHaveBeenCalledWith(outputs[0]);
});
