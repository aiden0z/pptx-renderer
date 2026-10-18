import { expect, test } from '@playwright/test';

test('hidden pictures, groups and template artwork do not paint or request resources (#36)', async ({
  page,
}) => {
  const requested: string[] = [];
  await page.route('https://external-media.example.test/**', async (route) => {
    requested.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 204 });
  });
  await page.goto('/test/browser/blank.html');
  const result = await page.evaluate(async () => {
    const { externalMediaPresentation } = await import('/test/fixtures/external-media-policy.ts');
    const { parseRenderableChild } = await import('/src/model/RenderableChild.ts');
    const { renderSlide } = await import('/src/renderer/SlideRenderer.ts');
    const p = externalMediaPresentation();
    for (const index of [0, 4]) {
      const source = p.slides[0].nodes[index].source;
      source
        .child(index === 4 ? 'nvGrpSpPr' : 'nvPicPr')
        .child('cNvPr')
        .element!.setAttribute('hidden', 'true');
      p.slides[0].nodes[index] = parseRenderableChild(source, { rels: p.slides[0].rels })!;
    }
    for (const template of [...p.layouts.values(), ...p.masters.values()]) {
      template.spTree
        .child('pic')
        .child('nvPicPr')
        .child('cNvPr')
        .element!.setAttribute('hidden', '1');
    }
    const h = renderSlide(p, p.slides[0], { pdfjs: false });
    document.body.appendChild(h.element);
    await h.ready;
    return {
      hidden: p.slides[0].nodes[0].hidden,
      text: h.element.textContent,
      embedded: h.element.querySelectorAll('img[src^="blob:"]').length,
    };
  });
  await page.waitForLoadState('networkidle');
  expect(result.hidden).toBe(true);
  expect(result.text).toContain('Visible fill');
  expect(result.embedded).toBeGreaterThan(0);
  for (const name of ['picture', 'group', 'layout', 'master'])
    expect(requested).not.toContain(`/${name}.png`);
  expect(requested).toContain('/linked.png');
  expect(requested).toContain('/shape.png');
});
