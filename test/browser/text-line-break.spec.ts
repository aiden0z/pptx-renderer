import { expect, test } from '@playwright/test';

// Set PLAYWRIGHT_CHANNEL=chrome on machines with Chrome but no downloaded Chromium.
test.use({ channel: process.env.PLAYWRIGHT_CHANNEL });

test('eaLnBrk isolates East Asian line-breaking semantics from host CSS', async ({ page }) => {
  await page.goto('/test/browser/blank.html');
  const result = await page.evaluate(async () => {
    const { renderTextFixture } = await import('/test/fixtures/text-coverage.ts');
    document.body.style.lineBreak = 'strict';

    const disabled = renderTextFixture(undefined, '', '<a:lvl1pPr eaLnBrk="0"/>');
    const enabled = renderTextFixture(undefined, '', '<a:lvl1pPr eaLnBrk="1"/>');
    const omitted = renderTextFixture();
    document.body.append(disabled.element, enabled.element, omitted.element);

    return {
      disabled: getComputedStyle(disabled.para).lineBreak,
      enabled: getComputedStyle(enabled.para).lineBreak,
      omitted: getComputedStyle(omitted.para).lineBreak,
    };
  });

  expect(result).toEqual({
    disabled: 'anywhere',
    enabled: 'auto',
    omitted: 'auto',
  });
});

test('soft breaks preserve their own run metrics without changing visible text metrics', async ({
  page,
}) => {
  await page.goto('/test/browser/blank.html');
  const result = await page.evaluate(async () => {
    const { parseXml } = await import('/src/parser/XmlParser.ts');
    const { parseShapeNode } = await import('/src/model/nodes/ShapeNode.ts');
    const { renderShape } = await import('/src/renderer/ShapeRenderer.ts');
    const { createMockRenderContext } = await import('/test/unit/helpers/mockContext.ts');
    const shape = parseShapeNode(
      parseXml(`
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr><p:cNvPr id="1" name="Styled soft break"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="3810000" cy="1905000"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>
          </p:spPr>
          <p:txBody>
            <a:bodyPr lIns="0" tIns="0" rIns="0" bIns="0"><a:noAutofit/></a:bodyPr>
            <a:lstStyle/>
            <a:p>
              <a:pPr><a:lnSpc><a:spcPct val="100000"/></a:lnSpc></a:pPr>
              <a:br><a:rPr sz="3000"><a:latin typeface="Arial"/></a:rPr></a:br>
              <a:r><a:rPr sz="1000"><a:latin typeface="Courier New"/></a:rPr><a:t>Visible</a:t></a:r>
            </a:p>
          </p:txBody>
        </p:sp>`),
    );
    const rendered = renderShape(shape, createMockRenderContext());
    document.body.append(rendered);
    const textContainer = Array.from(rendered.children).find(
      (element) => element instanceof HTMLElement && element.textContent === 'Visible',
    ) as HTMLElement;
    const paragraph = textContainer.firstElementChild as HTMLElement;
    const breakSpan = paragraph.querySelector('br')?.parentElement as HTMLElement;
    const visibleSpan = Array.from(paragraph.querySelectorAll('span')).find(
      (element) => element.textContent === 'Visible',
    ) as HTMLElement;
    return {
      paragraphFontSize: getComputedStyle(paragraph).fontSize,
      breakParent: breakSpan.tagName,
      breakFontSize: getComputedStyle(breakSpan).fontSize,
      breakFontFamily: getComputedStyle(breakSpan).fontFamily,
      visibleFontSize: getComputedStyle(visibleSpan).fontSize,
      visibleFontFamily: getComputedStyle(visibleSpan).fontFamily,
    };
  });

  expect(result.paragraphFontSize).toBe('13.3333px');
  expect(result.breakParent).toBe('SPAN');
  expect(result.breakFontSize).toBe('40px');
  expect(result.breakFontFamily).toContain('Arial');
  expect(result.visibleFontSize).toBe('13.3333px');
  expect(result.visibleFontFamily).toContain('Courier New');
});

test('a leading explicit tab stop preserves the issue #23 CJK line on one row', async ({
  page,
}) => {
  await page.goto('/test/browser/blank.html');
  const result = await page.evaluate(async () => {
    const { renderTextBody } = await import('/src/renderer/TextRenderer.ts');
    const { xmlNode } = await import('/test/unit/helpers/xmlNode.ts');
    const { createMockRenderContext } = await import('/test/unit/helpers/mockContext.ts');
    const container = document.createElement('div');
    container.style.width = '650px';
    const runProperties = (bold = false, spacing = -90) =>
      xmlNode(
        `<rPr sz="1700" b="${bold ? 1 : 0}" spc="${spacing}"><ea typeface="微软雅黑"/></rPr>`,
      );
    renderTextBody(
      {
        bodyProperties: xmlNode('<bodyPr wrap="square" lIns="0" rIns="0"/>'),
        paragraphs: [
          {
            properties: xmlNode(`
              <pPr marL="424815" eaLnBrk="0">
                <tabLst><tab pos="536575" algn="l"/></tabLst>
              </pPr>`),
            runs: [
              { text: '\t', properties: runProperties() },
              { text: '配套保障：', properties: runProperties(true) },
              { text: '明确容错纠', properties: runProperties() },
              { text: '错、澄清正名机制，激励担当作为。', properties: runProperties(false, -100) },
            ],
            level: 0,
          },
        ],
      },
      undefined,
      createMockRenderContext(),
      container,
    );
    document.body.append(container);
    await document.fonts.ready;

    const paragraph = container.firstElementChild as HTMLElement;
    const tab = paragraph.querySelector('[data-pptx-tab-stop]') as HTMLElement;
    const textRects = Array.from(paragraph.querySelectorAll('span'))
      .filter((span) => span !== tab)
      .flatMap((span) => Array.from(span.getClientRects()))
      .filter((rect) => rect.width > 0);
    return {
      tabWidth: tab.getBoundingClientRect().width,
      lineTops: [...new Set(textRects.map((rect) => Math.round(rect.top)))],
    };
  });

  expect(result.tabWidth).toBeCloseTo((536575 - 424815) / 9525, 1);
  expect(result.lineTops).toHaveLength(1);
});

test('embedded picture text fill is clipped to glyphs in Chromium', async ({ page }) => {
  await page.goto('/test/browser/blank.html');
  const result = await page.evaluate(async () => {
    const { renderTextBody } = await import('/src/renderer/TextRenderer.ts');
    const { xmlNode } = await import('/test/unit/helpers/xmlNode.ts');
    const { createMockRenderContext } = await import('/test/unit/helpers/mockContext.ts');
    const ctx = createMockRenderContext();
    ctx.slide.rels.set('rId8', {
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
      target: '../media/gold.png',
    });
    ctx.presentation.media.set(
      'ppt/media/gold.png',
      new Uint8Array([
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
        0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 215, 99, 248, 207, 192, 240, 31,
        0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
      ]),
    );
    const container = document.createElement('div');
    renderTextBody(
      {
        paragraphs: [
          {
            runs: [
              {
                text: 'Picture text',
                properties: xmlNode(`
                  <rPr xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
                    <blipFill><blip r:embed="rId8"/><stretch><fillRect/></stretch></blipFill>
                  </rPr>`),
              },
            ],
            level: 0,
          },
        ],
      },
      undefined,
      ctx,
      container,
    );
    document.body.append(container);
    const span = container.querySelector('span') as HTMLElement;
    const style = getComputedStyle(span);
    return {
      backgroundImage: style.backgroundImage,
      backgroundSize: style.backgroundSize,
      backgroundRepeat: style.backgroundRepeat,
      backgroundClip: style.backgroundClip,
      color: style.color,
    };
  });

  expect(result.backgroundImage).toContain('blob:');
  expect(result.backgroundSize).toBe('100% 100%');
  expect(result.backgroundRepeat).toBe('no-repeat');
  expect(result.backgroundClip).toBe('text');
  expect(result.color).toBe('rgba(0, 0, 0, 0)');
});
