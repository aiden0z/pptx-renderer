import { expect, test } from '@playwright/test';

test('zero arrow adjustments keep geometry and text when preset text guides are undefined', async ({
  page,
}) => {
  await page.goto('/test/browser/blank.html');
  const results = await page.evaluate(async () => {
    const { parseXml } = await import('/src/parser/XmlParser.ts');
    const { parseShapeNode } = await import('/src/model/nodes/ShapeNode.ts');
    const { renderSlide } = await import('/src/renderer/SlideRenderer.ts');
    const { presentation } = await import('/test/fixtures/media-group-coverage.ts');
    const results = [];
    for (const preset of ['leftUpArrow', 'leftRightUpArrow', 'quadArrow']) {
      const p = presentation();
      p.slides[0].nodes = [
        parseShapeNode(
          parseXml(
            `<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:nvSpPr><p:cNvPr id="1" name="arrow"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2743200" cy="1371600"/></a:xfrm><a:prstGeom prst="${preset}"><a:avLst><a:gd name="adj2" fmla="val 0"/></a:avLst></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Arrow label</a:t></a:r></a:p></p:txBody></p:sp>`,
          ),
        ),
      ];
      const h = renderSlide(p, p.slides[0], { pdfjs: false });
      document.body.appendChild(h.element);
      await h.ready;
      results.push({
        preset,
        geometry: !!h.element.querySelector('svg'),
        text: h.element.textContent,
      });
    }
    return results;
  });
  for (const result of results) {
    expect(result.geometry, result.preset).toBe(true);
    expect(result.text).toBe('Arrow label');
  }
});

test('document text follows its preset rectangle across heights, anchors and autofit (#37)', async ({
  page,
}) => {
  await page.goto('/test/browser/blank.html');
  const observations = await page.evaluate(async () => {
    const { parseXml } = await import('/src/parser/XmlParser.ts');
    const { parseShapeNode } = await import('/src/model/nodes/ShapeNode.ts');
    const { renderSlide } = await import('/src/renderer/SlideRenderer.ts');
    const { presentation } = await import('/test/fixtures/media-group-coverage.ts');
    const results = [];
    document.body.style.margin = '0';
    for (const height of [144, 240])
      for (const anchor of ['t', 'ctr', 'b'])
        for (const autofit of ['noAutofit', 'normAutofit', 'spAutoFit']) {
          const offsets = [];
          for (const preset of ['flowChartDocument', 'rect']) {
            const node = parseShapeNode(
              parseXml(
                `<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:nvSpPr><p:cNvPr id="1" name="${preset}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2743200" cy="${height * 9525}"/></a:xfrm><a:prstGeom prst="${preset}"/><a:solidFill><a:srgbClr val="EFF5FB"/></a:solidFill></p:spPr><p:txBody><a:bodyPr anchor="${anchor}" wrap="square"><a:${autofit}/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr sz="1800"><a:latin typeface="Arial"/></a:rPr><a:t>Sample text</a:t></a:r></a:p></p:txBody></p:sp>`,
              ),
            );
            const p = presentation();
            p.width = 288;
            p.height = height;
            p.slides[0].nodes = [node];
            const h = renderSlide(p, p.slides[0], { pdfjs: false });
            h.element.style.display = 'inline-block';
            document.body.appendChild(h.element);
            await h.ready;
            await document.fonts.ready;
            const text = h.element.querySelector('span')!.getBoundingClientRect();
            offsets.push(text.top - h.element.getBoundingClientRect().top);
          }
          results.push({ height, anchor, autofit, difference: offsets[1] - offsets[0] });
        }
    return results;
  });
  for (const row of observations) {
    const factor = row.anchor === 't' ? 0 : row.anchor === 'ctr' ? 0.5 : 1;
    const expectedShift = row.height * (1 - 17322 / 21600) * factor;
    expect(Math.abs(row.difference - expectedShift), JSON.stringify(row)).toBeLessThan(0.1);
  }
  await page.screenshot({
    path: 'docs/agent-tmp/issues-32-36-37-20261018/preset-text-rectangles-browser.png',
    fullPage: true,
  });
});
