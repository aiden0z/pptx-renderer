import { expect, test } from '@playwright/test';

test('OLE preview hidden flags survive the visible graphic frame wrapper', async ({ page }) => {
  await page.goto('/test/browser/blank.html');
  const counts = await page.evaluate(async () => {
    const { parseXml } = await import('/src/parser/XmlParser.ts');
    const { parseRenderableChild } = await import('/src/model/RenderableChild.ts');
    const { renderSlide } = await import('/src/renderer/SlideRenderer.ts');
    const { externalMediaPresentation } = await import('/test/fixtures/external-media-policy.ts');
    const counts = [];
    for (const hidden of ['1', '0']) {
      const p = externalMediaPresentation();
      p.slides[0].background = undefined;
      p.layouts.clear();
      p.masters.clear();
      const source = p.slides[0].nodes.at(-1)!.source.element!.cloneNode(true) as Element;
      source.getElementsByTagNameNS('*', 'cNvPr')[0].setAttribute('hidden', hidden);
      const xml = `<p:graphicFrame xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:nvGraphicFramePr><p:cNvPr id="20" name="OLE" hidden="0"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="952500"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole"><p:oleObj>${new XMLSerializer().serializeToString(source)}</p:oleObj></a:graphicData></a:graphic></p:graphicFrame>`;
      p.slides[0].nodes = [parseRenderableChild(parseXml(xml), { rels: p.slides[0].rels })!];
      const h = renderSlide(p, p.slides[0], { pdfjs: false });
      document.body.appendChild(h.element);
      await h.ready;
      counts.push(h.element.querySelectorAll('img').length);
    }
    return counts;
  });
  expect(counts).toEqual([0, 1]);
});

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
