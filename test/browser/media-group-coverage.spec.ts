import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

test.use({ channel: process.env.PLAYWRIGHT_CHANNEL });
const effects = {
  grayscale: '<a:grayscl/>',
  duotone: '<a:duotone><a:srgbClr val="000080"/><a:srgbClr val="FFFF00"/></a:duotone>',
  luminance: '<a:lum bright="30000" contrast="20000"/>',
  bilevel: '<a:biLevel thresh="50000"/>',
  alpha: '<a:alphaModFix amt="50000"/>',
  plain: '',
};
const custom =
  '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:pathLst><a:path w="200" h="200"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="200" y="0"/></a:lnTo><a:lnTo><a:pt x="200" y="200"/></a:lnTo><a:lnTo><a:pt x="0" y="200"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>';
for (const [effectName, effect] of Object.entries(effects)) {
  test(`clipped ${effectName} matches rectangular pixels with crop and flips`, async ({ page }) => {
    await page.goto('/test/browser/blank.html');
    const counts = await page.evaluate(
      async ({ effect, custom }) => {
        const { picture, presentation } = await import('/test/fixtures/media-group-coverage.ts');
        const { renderSlide } = await import('/src/renderer/SlideRenderer.ts');
        const canvas = document.createElement('canvas');
        canvas.width = 20;
        canvas.height = 20;
        const c = canvas.getContext('2d')!;
        for (const [x, y, color] of [
          [0, 0, '#ff0000'],
          [10, 0, '#00ff00'],
          [0, 10, '#0000ff'],
          [10, 10, '#ffff00'],
        ] as const) {
          c.fillStyle = color;
          c.fillRect(x, y, 10, 10);
        }
        const data = new Uint8Array(await (await fetch(canvas.toDataURL())).arrayBuffer());
        const counts = [];
        for (const geometry of ['rect', 'ellipse', 'diamond', custom]) {
          const p = presentation();
          p.width = 200;
          p.height = 200;
          p.media.set('ppt/media/poster.png', data);
          p.slides[0].nodes = [picture({ effect, geometry, crop: true, flip: true })];
          const h = renderSlide(p, p.slides[0]);
          h.element.style.display = 'inline-block';
          document.body.append(h.element);
          await h.ready;
          for (const img of h.element.querySelectorAll('img')) {
            try {
              await img.decode();
            } catch {
              await img.decode();
            }
          }
          counts.push(h.element.querySelectorAll('img, image').length);
        }
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return counts;
      },
      { effect, custom },
    );
    expect(counts).toEqual([1, 1, 1, 1]);
    const slides = page.locator('body > div');
    const pixels = [];
    for (let i = 0; i < 4; i++) {
      const png = PNG.sync.read(await slides.nth(i).screenshot());
      pixels.push(
        [75, 125].flatMap((n) => {
          const idx = (n * png.width + n) * 4;
          return [...png.data.subarray(idx, idx + 4)];
        }),
      );
    }
    for (const pixel of pixels.slice(1))
      for (let ch = 0; ch < 8; ch++)
        expect(Math.abs(pixel[ch] - pixels[0][ch])).toBeLessThanOrEqual(3);
    if (effectName === 'plain') expect(pixels[0]).toEqual([255, 255, 0, 255, 255, 0, 0, 255]);
    await page.screenshot({
      path: `docs/agent-tmp/render-coverage-20260907/task4-${effectName}.png`,
      fullPage: true,
    });
    if (effectName === 'grayscale')
      expect(Math.abs(pixels[0][0] - pixels[0][1])).toBeLessThanOrEqual(1);
  });
}
for (const fixture of ['test-audio.wav', 'test-video.webm', 'test-video.mp4'])
  for (const lazy of [false, true]) {
    test(`${lazy ? 'lazy' : 'eager'} ${fixture} decodes and advances playback`, async ({
      page,
    }) => {
      test.skip(
        fixture.endsWith('.mp4') && process.env.PLAYWRIGHT_CHANNEL !== 'chrome',
        'H264 is an additional branded Chrome codec check',
      );
      await page.goto('/test/browser/blank.html');
      const result = await page.evaluate(
        async ({ fixture, lazy }) => {
          const { picture, presentation } = await import('/test/fixtures/media-group-coverage.ts');
          const { renderSlide } = await import('/src/renderer/SlideRenderer.ts');
          const bytes = new Uint8Array(
            await (await fetch(`/test/fixtures/media/${fixture}`)).arrayBuffer(),
          );
          const canvas = document.createElement('canvas');
          canvas.width = 2;
          canvas.height = 2;
          canvas.getContext('2d')!.fillRect(0, 0, 2, 2);
          const poster = new Uint8Array(await (await fetch(canvas.toDataURL())).arrayBuffer());
          const p = presentation();
          const kind = fixture.endsWith('.wav') ? 'audio' : 'video';
          p.slides[0].nodes = [picture({ kind })];
          p.slides[0].rels.set('media', { type: 'media', target: `../media/${fixture}` });
          if (lazy)
            p.mediaResolver = {
              resolve: async (target) => ({
                mediaPath: target.includes('poster')
                  ? 'ppt/media/poster.png'
                  : `ppt/media/${fixture}`,
                data: target.includes('poster') ? poster : bytes,
              }),
            };
          else {
            p.media.set(`ppt/media/${fixture}`, bytes);
            p.media.set('ppt/media/poster.png', poster);
          }
          const h = renderSlide(p, p.slides[0]);
          document.body.append(h.element);
          await h.ready;
          const el = h.element.querySelector('audio,video') as HTMLMediaElement | null;
          if (!el) return { found: false };
          el.muted = true;
          el.preload = 'auto';
          el.load();
          await el.play();
          await new Promise<void>((resolve, reject) => {
            const start = performance.now();
            const tick = () => {
              if (el.currentTime > 0.05 && el.readyState >= 2) resolve();
              else if (performance.now() - start > 5000)
                reject(new Error('playback did not advance'));
              else requestAnimationFrame(tick);
            };
            tick();
          });
          const result = {
            found: true,
            readyState: el.readyState,
            time: el.currentTime,
            poster:
              kind === 'video'
                ? !!(el as HTMLVideoElement).poster
                : !!h.element.querySelector('img'),
            width: kind === 'video' ? (el as HTMLVideoElement).videoWidth : 0,
          };
          h.dispose();
          return result;
        },
        { fixture, lazy },
      );
      expect(result.found).toBe(true);
      expect(result.readyState).toBeGreaterThanOrEqual(2);
      expect(result.time).toBeGreaterThan(0.05);
      expect(result.poster).toBe(true);
      if (!fixture.endsWith('.wav')) expect(result.width).toBe(96);
    });
  }

for (const kind of ['image', 'audio', 'video', 'background'] as const) {
  test(`disposed delayed ${kind} never writes resources or DOM`, async ({ page }) => {
    await page.goto('/test/browser/blank.html');
    const result = await page.evaluate(async (kind) => {
      const { picture, presentation, deferred } =
        await import('/test/fixtures/media-group-coverage.ts');
      const { renderSlide } = await import('/src/renderer/SlideRenderer.ts');
      const { parseXml } = await import('/src/parser/XmlParser.ts');
      const p = presentation();
      const pending = deferred();
      p.mediaResolver = { resolve: () => pending.promise };
      if (kind === 'background')
        p.slides[0].background = parseXml(
          '<p:bg xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:bgPr><a:blipFill><a:blip r:embed="poster"/><a:stretch/></a:blipFill></p:bgPr></p:bg>',
        );
      else p.slides[0].nodes = [picture({ kind })];
      const cache = new Map();
      const h = renderSlide(p, p.slides[0], { mediaUrlCache: cache });
      document.body.append(h.element);
      h.dispose();
      const before = h.element.outerHTML;
      pending.resolve({ mediaPath: 'ppt/media/poster.png', data: new Uint8Array([1]) });
      await h.ready;
      return { unchanged: before === h.element.outerHTML, cache: cache.size };
    }, kind);
    expect(result).toEqual({ unchanged: true, cache: 0 });
  });
}
test('external image handle keeps old bytes and owns cleanup across new document and sibling', async ({
  page,
}) => {
  await page.goto('/test/browser/blank.html');
  const result = await page.evaluate(async () => {
    const { picture, presentation, deferred } =
      await import('/test/fixtures/media-group-coverage.ts');
    const { PptxViewer } = await import('/src/core/Viewer.ts');
    const colored = (color: string) =>
      new TextEncoder().encode(
        `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="${color}"/></svg>`,
      );
    const p = presentation();
    p.slides[0].nodes = [picture()];
    p.slides[0].rels.set('poster', { type: 'image', target: '../media/poster.svg' });
    const pending = deferred();
    p.mediaResolver = { resolve: () => pending.promise };
    const host = document.createElement('div');
    const external = document.createElement('div');
    document.body.append(host, external);
    const viewer = new PptxViewer(host, { fitMode: 'none' });
    viewer.load(p);
    const old = viewer.renderSlideToContainer(0, external)!;
    const next = presentation();
    next.slides[0].nodes = p.slides[0].nodes;
    next.slides[0].rels = p.slides[0].rels;
    next.media.set('ppt/media/poster.svg', colored('blue'));
    viewer.load(next);
    pending.resolve({ mediaPath: 'ppt/media/poster.svg', data: colored('red') });
    await old.ready;
    await viewer.renderSlide(0);
    const sibling = viewer.renderSlideToContainer(0, external)!;
    await sibling.ready;
    const oldUrl = old.element.querySelector('img')!.src;
    const siblingUrl = sibling.element.querySelector('img')!.src;
    const current = await (await fetch(host.querySelector('img')!.src)).text();
    viewer.destroy();
    const oldBytes = await (await fetch(oldUrl)).text();
    const siblingBytes = await (await fetch(siblingUrl)).text();
    old.dispose();
    const revoked = await fetch(oldUrl).then(
      () => false,
      () => true,
    );
    const siblingAlive = await fetch(siblingUrl).then((r) => r.ok);
    sibling.dispose();
    return { current, oldBytes, siblingBytes, revoked, siblingAlive };
  });
  expect(result.current).toContain('blue');
  expect(result.oldBytes).toContain('red');
  expect(result.siblingBytes).toContain('blue');
  expect(result.revoked).toBe(true);
  expect(result.siblingAlive).toBe(true);
});
for (const state of [
  'active',
  'before-frame',
  'hidden-resume',
  'hidden-dispose',
  'external',
] as const) {
  test(`real chart lifecycle ${state}`, async ({ page }) => {
    await page.goto('/test/browser/blank.html');
    const result = await page.evaluate(async (state) => {
      const { parseZip } = await import('/src/parser/ZipParser.ts');
      const { buildPresentation } = await import('/src/model/Presentation.ts');
      const { renderSlide } = await import('/src/renderer/SlideRenderer.ts');
      const { PptxViewer } = await import('/src/core/Viewer.ts');
      const { echarts } = await import('/src/renderer/chart/echartsRuntime.ts');
      const p = buildPresentation(
        await parseZip(
          await (await fetch('/docs/example/1-chart-and-complex/source.pptx')).arrayBuffer(),
        ),
      );
      const source = p.slides.find((s) => s.nodes.some((n) => n.nodeType === 'chart'))!;
      const slide = {
        ...source,
        nodes: source.nodes.filter((n) => n.nodeType === 'chart').slice(0, 1),
        showMasterSp: false,
      };
      p.slides = [slide];
      const host = document.createElement('div');
      document.body.append(host);
      if (state.startsWith('hidden')) host.style.display = 'none';
      const viewer = new PptxViewer(document.createElement('div'));
      viewer.load(p);
      const h =
        state === 'external' ? viewer.renderSlideToContainer(0, host)! : renderSlide(p, slide);
      if (state !== 'external') host.append(h.element);
      if (state === 'before-frame') h.dispose();
      await h.ready;
      if (state === 'hidden-dispose') h.dispose();
      if (state.startsWith('hidden')) host.style.display = 'block';
      if (state === 'external') viewer.destroy();
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
      const alive = () =>
        Array.from(h.element.querySelectorAll('div'))
          .map((el) => echarts.getInstanceByDom(el))
          .filter((c) => c && !c.isDisposed()).length;
      const before = alive();
      h.dispose();
      const after = alive();
      viewer.destroy();
      return { before, after };
    }, state);
    expect(result.before).toBe(state === 'before-frame' || state === 'hidden-dispose' ? 0 : 1);
    expect(result.after).toBe(0);
  });
}
for (const disposed of [false, true])
  test(`real lazy EMF bitmap waits for toBlob and honors dispose=${disposed}`, async ({ page }) => {
    await page.goto('/test/browser/blank.html');
    const result = await page.evaluate(async (disposed) => {
      const { picture, presentation, bitmapEmf } =
        await import('/test/fixtures/media-group-coverage.ts');
      const { renderSlide } = await import('/src/renderer/SlideRenderer.ts');
      const original = HTMLCanvasElement.prototype.toBlob;
      let release!: () => void;
      HTMLCanvasElement.prototype.toBlob = function (cb, ...args) {
        release = () => original.call(this, cb, ...args);
      };
      const p = presentation();
      p.slides[0].nodes = [picture()];
      p.slides[0].rels.set('poster', { type: 'image', target: '../media/poster.emf' });
      p.mediaResolver = {
        resolve: async () => ({ mediaPath: 'ppt/media/poster.emf', data: bitmapEmf() }),
      };
      const cache = new Map();
      const h = renderSlide(p, p.slides[0], { mediaUrlCache: cache });
      document.body.append(h.element);
      let ready = false;
      void h.ready.then(() => {
        ready = true;
      });
      await new Promise((r) => setTimeout(r, 0));
      const pending = !ready;
      if (disposed) h.dispose();
      const before = h.element.outerHTML;
      release();
      await h.ready;
      HTMLCanvasElement.prototype.toBlob = original;
      const img = h.element.querySelector('img');
      let pixel: number[] = [];
      if (img) {
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        canvas.getContext('2d')!.drawImage(img, 0, 0, 1, 1);
        pixel = [...canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data];
      }
      const result = {
        pending,
        pixel,
        cache: cache.size,
        unchanged: before === h.element.outerHTML,
      };
      h.dispose();
      for (const url of cache.values()) URL.revokeObjectURL(url);
      return result;
    }, disposed);
    expect(result.pending).toBe(true);
    expect(result.cache).toBe(disposed ? 0 : 1);
    if (disposed) expect(result.unchanged).toBe(true);
    else expect(result.pixel).toEqual([255, 0, 0, 255]);
  });
for (const lazy of [false, true])
  test(`failed ${lazy ? 'lazy' : 'eager'} video retains poster and sibling playback`, async ({
    page,
  }) => {
    await page.goto('/test/browser/blank.html');
    const result = await page.evaluate(async (lazy) => {
      const { picture, presentation } = await import('/test/fixtures/media-group-coverage.ts');
      const { renderSlide } = await import('/src/renderer/SlideRenderer.ts');
      const p = presentation();
      p.slides[0].nodes = [picture({ kind: 'video' }), picture({ kind: 'audio' })];
      p.slides[0].nodes[1].mediaRId = 'audio';
      p.slides[0].rels.set('audio', { type: 'media', target: '../media/good.wav' });
      const audio = new Uint8Array(
        await (await fetch('/test/fixtures/media/test-audio.wav')).arrayBuffer(),
      );
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const poster = new Uint8Array(await (await fetch(canvas.toDataURL())).arrayBuffer());
      const media = new Map([
        ['ppt/media/poster.png', poster],
        ['ppt/media/good.wav', audio],
      ]);
      if (lazy)
        p.mediaResolver = {
          resolve: async (target) => {
            const path = `ppt/media/${target.split('/').pop()}`;
            if (media.has(path)) return { mediaPath: path, data: media.get(path)! };
            throw new Error('missing video');
          },
        };
      else p.media = media;
      const h = renderSlide(p, p.slides[0]);
      document.body.append(h.element);
      await h.ready;
      const el = h.element.querySelector('audio')!;
      el.muted = true;
      await el.play();
      await new Promise<void>((resolve) => {
        const tick = () => (el.currentTime > 0.05 ? resolve() : requestAnimationFrame(tick));
        tick();
      });
      const result = {
        video: h.element.querySelectorAll('video').length,
        posters: h.element.querySelectorAll('img').length,
        time: el.currentTime,
        overlay: h.element.textContent!.includes('▶'),
      };
      h.dispose();
      return result;
    }, lazy);
    expect(result.video).toBe(0);
    expect(result.posters).toBe(2);
    expect(result.overlay).toBe(true);
    expect(result.time).toBeGreaterThan(0.05);
  });
for (const replacement of ['destroy', 'load', 'windowed-unmount'] as const)
  test(`mounted lazy image ignores late completion after ${replacement}`, async ({ page }) => {
    await page.goto('/test/browser/blank.html');
    const result = await page.evaluate(async (replacement) => {
      const { picture, presentation, deferred } =
        await import('/test/fixtures/media-group-coverage.ts');
      const { PptxViewer } = await import('/src/core/Viewer.ts');
      const p = presentation();
      p.slides[0].nodes = [picture()];
      if (replacement === 'windowed-unmount')
        p.slides = Array.from({ length: 8 }, (_, index) => ({
          ...p.slides[0],
          index,
          nodes: index === 0 ? [picture()] : [],
        }));
      const pending = deferred();
      p.mediaResolver = { resolve: () => pending.promise };
      const host = document.createElement('div');
      Object.assign(host.style, { width: '400px', height: '220px', overflow: 'auto' });
      document.body.append(host);
      const viewer = new PptxViewer(host, { fitMode: 'none', scrollContainer: host });
      let old: HTMLElement | undefined;
      viewer.addEventListener('sliderendered', ((e: CustomEvent) => {
        if (e.detail.index === 0 && !old) old = e.detail.element;
      }) as EventListener);
      viewer.load(p);
      if (replacement === 'windowed-unmount') {
        await viewer.renderList({ windowed: true, initialSlides: 1, overscanViewport: 0.1 });
        host.scrollTop = 2200;
        await new Promise<void>((resolve, reject) => {
          const start = performance.now();
          const tick = () => {
            if (!viewer.getMountedSlides().includes(0)) resolve();
            else if (performance.now() - start > 4000)
              reject(new Error('first slide not unmounted'));
            else requestAnimationFrame(tick);
          };
          tick();
        });
      } else {
        await viewer.renderSlide(0);
        if (replacement === 'destroy') viewer.destroy();
        else viewer.load(presentation());
      }
      const before = old!.outerHTML;
      pending.resolve({ mediaPath: 'ppt/media/poster.png', data: new Uint8Array([1]) });
      await new Promise((r) => setTimeout(r, 0));
      const result = {
        unchanged: before === old!.outerHTML,
        mounted: viewer.getMountedSlides().includes(0),
      };
      viewer.destroy();
      return result;
    }, replacement);
    expect(result.unchanged).toBe(true);
    expect(result.mounted).toBe(false);
  });
