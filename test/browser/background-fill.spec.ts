import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import type { BackgroundFillCase } from '../fixtures/background-fill';

const cases: BackgroundFillCase[] = [
  { kind: 'white' },
  { kind: 'solid' },
  { kind: 'gradient' },
  { kind: 'gradient', rotation: 30 },
  { kind: 'gradient', flipH: true },
  { kind: 'gradient', grouped: true, rotation: 25 },
  { kind: 'radial', rotation: 30 },
  { kind: 'pattern' },
  { kind: 'picture' },
  { kind: 'picture', rotation: 30 },
  { kind: 'picture', lazy: true },
  { kind: 'picture', origin: 'layout' },
  { kind: 'picture', origin: 'master' },
];
for (const options of cases)
  test(`background paint samples slide coordinates ${JSON.stringify(options)}`, async ({
    page,
  }) => {
    await page.goto('/test/browser/blank.html');
    const points = await page.evaluate(async (options) => {
      const { backgroundFillPresentation } = await import('/test/fixtures/background-fill.ts');
      const { renderSlide } = await import('/src/renderer/SlideRenderer.ts');
      const { createRenderContext } = await import('/src/renderer/RenderContext.ts');
      const { renderBackground } = await import('/src/renderer/BackgroundRenderer.ts');
      document.body.style.margin = '0';
      const p = backgroundFillPresentation(options);
      const h = renderSlide(p, p.slides[0]);
      h.element.id = 'actual';
      document.body.append(h.element);
      await h.ready;
      const ref = document.createElement('div');
      ref.id = 'reference';
      ref.style.cssText = 'position:relative;width:600px;height:300px;background:white;';
      document.body.append(ref);
      const referencePresentation = backgroundFillPresentation({ ...options, origin: 'slide' });
      const ctx = createRenderContext(referencePresentation, referencePresentation.slides[0]);
      ctx.asyncTasks = [];
      renderBackground(ctx, ref);
      await Promise.all(ctx.asyncTasks);
      // The fixture's cutout is centred at (200,140). For the grouped case the existing
      // renderer remaps/mirrors its centre to (240,112), then rotates the group by 20°.
      let x = 200,
        y = 140;
      if (options.grouped) {
        const a = (20 * Math.PI) / 180;
        x = 50 + 240 + 8 * Math.sin(a);
        y = 20 + 120 - 8 * Math.cos(a);
      }
      return [
        { x: Math.round(x), y: Math.round(y) },
        { x: Math.round(x + 12), y: Math.round(y + 8) },
      ];
    }, options);
    await page.waitForLoadState('networkidle');
    const actual = PNG.sync.read(await page.locator('#actual').screenshot());
    const reference = PNG.sync.read(await page.locator('#reference').screenshot());
    for (const { x, y } of points) {
      const i = (y * actual.width + x) * 4;
      for (let channel = 0; channel < 3; channel++)
        expect(
          Math.abs(actual.data[i + channel] - reference.data[i + channel]),
        ).toBeLessThanOrEqual(3);
    }
    const outside = (270 * actual.width + 570) * 4;
    expect([...actual.data.slice(outside, outside + 3)]).toEqual([0, 255, 0]);
  });

test('background fills preserve local fill priority and explicit false', async ({ page }) => {
  await page.goto('/test/browser/blank.html');
  const fills = await page.evaluate(async () => {
    const { backgroundFillPresentation } = await import('/test/fixtures/background-fill.ts');
    const { renderSlide } = await import('/src/renderer/SlideRenderer.ts');
    const result = [];
    for (const flag of ['1', '0', 'false']) {
      const p = backgroundFillPresentation({ kind: 'gradient', localFill: 'FF0000', flag });
      const h = renderSlide(p, p.slides[0]);
      document.body.append(h.element);
      await h.ready;
      result.push(h.element.lastElementChild?.querySelector('svg > path')?.getAttribute('fill'));
      h.dispose();
    }
    return result;
  });
  expect(fills).toEqual(['#FF0000', '#FF0000', '#FF0000']);
});

test('background-fill reuse respects externalMedia block including lazy paths', async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route('https://external-media.example.test/**', async (route) => {
    requests.push(route.request().url());
    await route.fulfill({ status: 204 });
  });
  await page.goto('/test/browser/blank.html');
  await page.evaluate(async () => {
    const { backgroundFillPresentation } = await import('/test/fixtures/background-fill.ts');
    const { renderSlide } = await import('/src/renderer/SlideRenderer.ts');
    const p = backgroundFillPresentation({ kind: 'picture', external: true, lazy: true });
    const h = renderSlide(p, p.slides[0], { externalMedia: 'block' });
    document.body.append(h.element);
    await h.ready;
  });
  await page.waitForLoadState('networkidle');
  expect(requests).toEqual([]);
});

test('background clipping preserves an ellipse boundary and a donut hole', async ({ page }) => {
  await page.goto('/test/browser/blank.html');
  await page.evaluate(async () => {
    const { backgroundFillPresentation } = await import('/test/fixtures/background-fill.ts');
    const { renderSlide } = await import('/src/renderer/SlideRenderer.ts');
    document.body.style.margin = '0';
    for (const preset of ['ellipse', 'donut']) {
      const p = backgroundFillPresentation({ kind: 'white', preset });
      const h = renderSlide(p, p.slides[0]);
      h.element.id = preset;
      document.body.append(h.element);
      await h.ready;
    }
  });
  const ellipse = PNG.sync.read(await page.locator('#ellipse').screenshot());
  const donut = PNG.sync.read(await page.locator('#donut').screenshot());
  const pixel = (image: PNG, x: number, y: number) => [
    ...image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 3),
  ];
  expect(pixel(ellipse, 105, 85)).toEqual([0, 255, 0]);
  expect(pixel(ellipse, 200, 140)).toEqual([255, 255, 255]);
  expect(pixel(donut, 200, 140)).toEqual([0, 255, 0]);
  expect(pixel(donut, 115, 140)).toEqual([255, 255, 255]);
});

test('template background fills use their owner background before slide overrides', async ({
  page,
}) => {
  await page.goto('/test/browser/blank.html');
  const colors = await page.evaluate(async () => {
    const { backgroundFillPresentation } = await import('/test/fixtures/background-fill.ts');
    const { renderSlide } = await import('/src/renderer/SlideRenderer.ts');
    const { parseXml } = await import('/src/parser/XmlParser.ts');
    const bg = (hex: string) =>
      parseXml(
        `<p:bg xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:bgPr><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill></p:bgPr></p:bg>`,
      );
    const result = [];
    // Native PowerPoint owner-background probe: master=pink, layout=blue, slide=yellow.
    for (const origin of ['master', 'layout'] as const)
      for (const hasLayout of [false, true]) {
        const p = backgroundFillPresentation({ kind: 'solid', origin });
        p.slides[0].background = bg('FFFF00');
        p.masters.get('master')!.background = bg('FFCCAA');
        p.layouts.get('layout')!.background = hasLayout ? bg('0088FF') : undefined;
        const h = renderSlide(p, p.slides[0]);
        document.body.append(h.element);
        await h.ready;
        const surface = h.element.querySelector<HTMLElement>('[data-pptx-shape-background]')!;
        result.push(surface.style.backgroundColor);
        h.dispose();
      }
    return result;
  });
  expect(colors).toEqual([
    'rgb(255, 204, 170)',
    'rgb(255, 204, 170)',
    'rgb(255, 204, 170)',
    'rgb(0, 136, 255)',
  ]);
});
