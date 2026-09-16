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
    const ctx = createMockRenderContext({ asyncTasks: [] });
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
      ctx,
      container,
    );
    document.body.append(container);
    await document.fonts.ready;
    await Promise.all(ctx.asyncTasks ?? []);

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

test('explicit tabs finish layout when ready is awaited before the slide is mounted', async ({
  page,
}) => {
  await page.goto('/test/browser/blank.html');
  const result = await page.evaluate(async () => {
    const { renderTextBody } = await import('/src/renderer/TextRenderer.ts');
    const { xmlNode } = await import('/test/unit/helpers/xmlNode.ts');
    const { createMockRenderContext } = await import('/test/unit/helpers/mockContext.ts');
    const container = document.createElement('div');
    container.style.width = '650px';
    const ctx = createMockRenderContext({ asyncTasks: [], measurementRoot: container });
    renderTextBody(
      {
        paragraphs: [
          {
            properties: xmlNode('<pPr><tabLst><tab pos="1828800" algn="l"/></tabLst></pPr>'),
            runs: [{ text: 'Prefix' }, { text: '\t' }, { text: 'TARGET' }],
            level: 0,
          },
        ],
      },
      undefined,
      ctx,
      container,
    );

    await Promise.all(ctx.asyncTasks ?? []);
    const marker = container.querySelector('[data-pptx-tab-stop]') as HTMLElement;
    const detachedWidth = parseFloat(marker.style.width);
    document.body.append(container);
    const paragraph = container.firstElementChild as HTMLElement;
    const target = Array.from(paragraph.querySelectorAll('span')).find(
      (span) => span.textContent === 'TARGET',
    ) as HTMLElement;
    return {
      detachedWidth,
      targetLeft: target.getBoundingClientRect().left - paragraph.getBoundingClientRect().left,
    };
  });

  expect(result.detachedWidth).toBeGreaterThan(0);
  expect(result.targetLeft).toBeCloseTo(1828800 / 9525, 0);
});

test('explicit left tab stops align inline, multiple, bullet, and mixed-run fields', async ({
  page,
}) => {
  await page.goto('/test/browser/blank.html');
  const result = await page.evaluate(async () => {
    const { renderTextBody } = await import('/src/renderer/TextRenderer.ts');
    const { xmlNode } = await import('/test/unit/helpers/xmlNode.ts');
    const { createMockRenderContext } = await import('/test/unit/helpers/mockContext.ts');

    const textLeft = (root: HTMLElement, text: string): number => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const index = node.data.indexOf(text);
        if (index < 0) continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + text.length);
        return range.getBoundingClientRect().left - root.getBoundingClientRect().left;
      }
      throw new Error(`Missing text: ${text}`);
    };

    const render = async (
      runs: string[],
      paragraphXml: string,
    ): Promise<{ paragraph: HTMLElement; container: HTMLElement }> => {
      const container = document.createElement('div');
      container.style.width = '700px';
      const ctx = createMockRenderContext({ asyncTasks: [] });
      renderTextBody(
        {
          bodyProperties: xmlNode('<bodyPr wrap="none" lIns="0" rIns="0"><noAutofit/></bodyPr>'),
          paragraphs: [
            {
              properties: xmlNode(paragraphXml),
              runs: runs.map((text) => ({ text })),
              level: 0,
            },
          ],
        },
        undefined,
        ctx,
        container,
      );
      document.body.append(container);
      await Promise.all(ctx.asyncTasks ?? []);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return { paragraph: container.firstElementChild as HTMLElement, container };
    };

    const inline = await render(
      ['Prefix', '\t', 'INLINE'],
      '<pPr><tabLst><tab pos="2743200" algn="l"/></tabLst></pPr>',
    );
    const multiple = await render(
      ['A', '\t', 'B', '\t', 'C'],
      '<pPr><tabLst><tab pos="1828800" algn="l"/><tab pos="3657600" algn="l"/></tabLst></pPr>',
    );
    const bullet = await render(
      ['\t', 'BULLET'],
      '<pPr marL="731520" indent="-274320"><buChar char="•"/><tabLst><tab pos="1371600" algn="l"/></tabLst></pPr>',
    );
    const mixed = await render(
      ['Same run prefix\tMIXED'],
      '<pPr><tabLst><tab pos="2743200" algn="l"/></tabLst></pPr>',
    );

    const measured = {
      inline: textLeft(inline.paragraph, 'INLINE'),
      multipleB: textLeft(multiple.paragraph, 'B'),
      multipleC: textLeft(multiple.paragraph, 'C'),
      bullet: textLeft(bullet.paragraph, 'BULLET'),
      mixed: textLeft(mixed.paragraph, 'MIXED'),
      markerCounts: [inline, multiple, bullet, mixed].map(
        ({ paragraph }) => paragraph.querySelectorAll('[data-pptx-tab-stop]').length,
      ),
    };
    inline.container.remove();
    multiple.container.remove();
    bullet.container.remove();
    mixed.container.remove();
    return measured;
  });

  expect(result.inline).toBeCloseTo(2743200 / 9525, 0);
  expect(result.multipleB).toBeCloseTo(1828800 / 9525, 0);
  expect(result.multipleC).toBeCloseTo(3657600 / 9525, 0);
  expect(result.bullet).toBeCloseTo(1371600 / 9525, 0);
  expect(result.mixed).toBeCloseTo(2743200 / 9525, 0);
  expect(result.markerCounts).toEqual([1, 2, 1, 1]);
});

test('center, right, and decimal explicit tabs align the following field', async ({ page }) => {
  await page.goto('/test/browser/blank.html');
  const result = await page.evaluate(async () => {
    const { renderTextBody } = await import('/src/renderer/TextRenderer.ts');
    const { xmlNode } = await import('/test/unit/helpers/xmlNode.ts');
    const { createMockRenderContext } = await import('/test/unit/helpers/mockContext.ts');

    const textRect = (root: HTMLElement, text: string): DOMRect => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const index = node.data.indexOf(text);
        if (index < 0) continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + text.length);
        return range.getBoundingClientRect();
      }
      throw new Error(`Missing text: ${text}`);
    };

    const render = async (alignment: string, targetRuns: string[]) => {
      const container = document.createElement('div');
      container.style.width = '700px';
      const ctx = createMockRenderContext({ asyncTasks: [] });
      renderTextBody(
        {
          bodyProperties: xmlNode('<bodyPr wrap="none" lIns="0" rIns="0"><noAutofit/></bodyPr>'),
          paragraphs: [
            {
              properties: xmlNode(
                `<pPr><tabLst><tab pos="3657600" algn="${alignment}"/></tabLst></pPr>`,
              ),
              runs: [{ text: 'Prefix' }, { text: '\t' }, ...targetRuns.map((text) => ({ text }))],
              level: 0,
            },
          ],
        },
        undefined,
        ctx,
        container,
      );
      document.body.append(container);
      await Promise.all(ctx.asyncTasks ?? []);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return { paragraph: container.firstElementChild as HTMLElement, container };
    };

    const center = await render('ctr', ['CEN', 'TER']);
    const right = await render('r', ['RI', 'GHT']);
    const decimal = await render('dec', ['123', '.', '45']);
    const centerLeftRect = textRect(center.paragraph, 'CEN');
    const centerRightRect = textRect(center.paragraph, 'TER');
    const rightRect = textRect(right.paragraph, 'GHT');
    const decimalRect = textRect(decimal.paragraph, '.');
    const measured = {
      center:
        (centerLeftRect.left + centerRightRect.right) / 2 -
        center.paragraph.getBoundingClientRect().left,
      right: rightRect.right - right.paragraph.getBoundingClientRect().left,
      decimal:
        (decimalRect.left + decimalRect.right) / 2 - decimal.paragraph.getBoundingClientRect().left,
    };
    center.container.remove();
    right.container.remove();
    decimal.container.remove();
    return measured;
  });

  const stop = 3657600 / 9525;
  expect(result.center).toBeCloseTo(stop, 0);
  expect(result.right).toBeCloseTo(stop, 0);
  expect(result.decimal).toBeCloseTo(stop, 0);
});

test('vertical explicit tabs advance on the inline axis while anchor center keeps the column centered', async ({
  page,
}) => {
  await page.goto('/test/browser/blank.html');
  const result = await page.evaluate(async () => {
    const { parseXml } = await import('/src/parser/XmlParser.ts');
    const { parseShapeNode } = await import('/src/model/nodes/ShapeNode.ts');
    const { renderShape } = await import('/src/renderer/ShapeRenderer.ts');
    const { createMockRenderContext } = await import('/test/unit/helpers/mockContext.ts');

    const render = async (withTab: boolean, anchor = 'ctr') => {
      const ctx = createMockRenderContext({ asyncTasks: [] });
      const tabProperties = withTab
        ? '<a:pPr algn="l"><a:tabLst><a:tab pos="1828800" algn="l"/></a:tabLst></a:pPr>'
        : '<a:pPr algn="l"/>';
      const tabRun = withTab ? '<a:r><a:rPr sz="2800"/><a:t>\t</a:t></a:r>' : '';
      const shape = parseShapeNode(
        parseXml(`
          <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
            <p:nvSpPr><p:cNvPr id="1" name="Vertical tab"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
            <p:spPr>
              <a:xfrm><a:off x="0" y="0"/><a:ext cx="5715000" cy="1828800"/></a:xfrm>
              <a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>
            </p:spPr>
            <p:txBody>
              <a:bodyPr wrap="none" lIns="0" rIns="0" tIns="0" bIns="0" anchor="${anchor}" vert="eaVert"><a:noAutofit/></a:bodyPr>
              <a:lstStyle/>
              <a:p>${tabProperties}${tabRun}<a:r><a:rPr sz="2800"/><a:t>TARGET</a:t></a:r></a:p>
            </p:txBody>
          </p:sp>`),
      );
      const element = renderShape(shape, ctx);
      document.body.append(element);
      await document.fonts.ready;
      await Promise.all(ctx.asyncTasks ?? []);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const target = Array.from(element.querySelectorAll('span')).find(
        (span) => span.textContent === 'TARGET',
      ) as HTMLElement;
      const paragraph = target.closest('div') as HTMLElement;
      const container = paragraph.parentElement as HTMLElement;
      const marker = paragraph.querySelector('[data-pptx-tab-stop]') as HTMLElement | null;
      const elementRect = element.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const paragraphRect = paragraph.getBoundingClientRect();
      const markerRect = marker?.getBoundingClientRect();
      const measured = {
        targetCenterX: targetRect.left + targetRect.width / 2 - elementRect.left,
        targetTop: targetRect.top - elementRect.top,
        paragraphWidth: paragraphRect.width,
        paragraphTop: paragraphRect.top - elementRect.top,
        markerHeight: markerRect?.height ?? 0,
        writingMode: getComputedStyle(container).writingMode,
      };
      element.remove();
      return measured;
    };

    return {
      top: await render(false, 't'),
      withoutTab: await render(false),
      withTab: await render(true),
      bottom: await render(false, 'b'),
    };
  });

  expect(result.withoutTab.writingMode).toBe('vertical-rl');
  expect(result.top.targetCenterX).toBeGreaterThan(550);
  expect(result.withoutTab.targetCenterX).toBeCloseTo(300, 0);
  expect(result.bottom.targetCenterX).toBeLessThan(50);
  expect(result.withoutTab.targetTop).toBeCloseTo(0, 0);
  expect(result.withTab.targetCenterX).toBeCloseTo(300, 0);
  expect(result.withTab.targetTop).toBeCloseTo(192, 0);
  expect(result.withTab.markerHeight).toBeCloseTo(192, 0);
  expect(result.withTab.paragraphTop).toBeCloseTo(0, 0);
  expect(result.withTab.paragraphWidth).toBeLessThan(60);
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
