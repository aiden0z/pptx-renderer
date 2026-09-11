import { expect, test } from '@playwright/test';

// Set PLAYWRIGHT_CHANNEL=chrome on machines with Chrome but no downloaded Chromium.
test.use({ channel: process.env.PLAYWRIGHT_CHANNEL });

for (const hostWhiteSpace of ['normal', 'pre', 'nowrap']) {
  for (const wrap of ['square', 'none']) {
    test(`text wrap=${wrap} inside white-space:${hostWhiteSpace}`, async ({ page }) => {
      await page.goto('/test/browser/blank.html');
      const result = await page.evaluate(
        async ({ hostWhiteSpace, wrap }) => {
          const { renderTextFixture } = await import('/test/fixtures/text-coverage.ts');
          document.body.style.whiteSpace = hostWhiteSpace;
          const { element, span, para, container } = renderTextFixture(
            `<bodyPr wrap="${wrap}" lIns="0" tIns="0" rIns="0" bIns="0"><noAutofit/></bodyPr>`,
          );
          document.body.append(element);
          await document.fonts.ready;
          const range = document.createRange();
          range.selectNodeContents(span);
          return {
            whiteSpace: getComputedStyle(container).whiteSpace,
            lineCount: range.getClientRects().length,
            width: element.getBoundingClientRect().width,
            paragraphWidth: para.getBoundingClientRect().width,
            scale: container.style.transform,
            fontSize: getComputedStyle(span).fontSize,
          };
        },
        { hostWhiteSpace, wrap },
      );
      expect(result.whiteSpace).toBe(wrap === 'none' ? 'nowrap' : 'normal');
      expect(result.fontSize).toBe('32px');
      expect(result.scale).toBe('');
      expect(result.paragraphWidth).toBeLessThanOrEqual(result.width);
      if (wrap === 'none') expect(result.lineCount).toBe(1);
      else expect(result.lineCount).toBeGreaterThan(1);
    });
  }
}

for (const [x, y] of [
  ['clip', 'clip'],
  ['clip', 'overflow'],
  ['overflow', 'clip'],
  ['overflow', 'overflow'],
]) {
  test(`noAutofit clip hit-testing and parent geometry ${x}/${y}`, async ({ page }) => {
    await page.goto('/test/browser/blank.html');
    const result = await page.evaluate(
      async ({ x, y }) => {
        const { renderTextFixture } = await import('/test/fixtures/text-coverage.ts');
        const { element, container } = renderTextFixture(
          `<bodyPr wrap="none" horzOverflow="${x}" vertOverflow="${y}" lIns="0" tIns="0" rIns="0" bIns="0"><noAutofit/></bodyPr>`,
          '',
          '',
          '',
          '<a:r><a:rPr sz="2400"/><a:t>Alpha beta gamma delta epsilon</a:t></a:r><a:br/><a:r><a:rPr sz="2400"/><a:t>Second</a:t></a:r><a:br/><a:r><a:rPr sz="2400"/><a:t>Third</a:t></a:r><a:br/><a:r><a:rPr sz="2400"/><a:t>Fourth</a:t></a:r>',
        );
        const parent = document.createElement('div');
        Object.assign(parent.style, {
          position: 'relative',
          width: '500px',
          height: '300px',
          margin: '40px',
          whiteSpace: 'pre',
        });
        parent.append(element);
        document.body.append(parent);
        await document.fonts.ready;
        const rect = container.getBoundingClientRect();
        const hit = (px: number, py: number) =>
          container.contains(document.elementFromPoint(px, py));
        return {
          overflowX: getComputedStyle(container).overflowX,
          overflowY: getComputedStyle(container).overflowY,
          horizontalHit: hit(rect.right + 15, rect.top + 15),
          verticalHit: hit(rect.left + 15, rect.bottom + 25),
          shapeHeight: element.getBoundingClientRect().height,
          parentWidth: parent.getBoundingClientRect().width,
        };
      },
      { x, y },
    );
    expect(result.overflowX).toBe(x === 'clip' ? 'clip' : 'visible');
    expect(result.overflowY).toBe(y === 'clip' ? 'clip' : 'visible');
    expect(result.horizontalHit).toBe(x === 'overflow');
    expect(result.verticalHit).toBe(y === 'overflow');
    expect(result.shapeHeight).toBe(80);
    expect(result.parentWidth).toBe(500);
  });
}

for (const [own, inherited, expectedSize] of [
  ['<noAutofit/>', '<normAutofit fontScale="50000"/>', '32px'],
  ['<normAutofit fontScale="50%"/>', '<noAutofit/>', '16px'],
  ['<spAutoFit/>', '<normAutofit fontScale="50000"/>', '32px'],
  ['', '<normAutofit fontScale="50000"/>', '16px'],
]) {
  test(`autofit choice ${own || 'inherited'} supersedes ${inherited}`, async ({ page }) => {
    await page.goto('/test/browser/blank.html');
    const result = await page.evaluate(
      async ({ own, inherited }) => {
        const { renderTextFixture } = await import('/test/fixtures/text-coverage.ts');
        const { element, span, container } = renderTextFixture(
          `<bodyPr wrap="square" horzOverflow="overflow" vertOverflow="overflow" lIns="0" tIns="0" rIns="0" bIns="0">${own}</bodyPr>`,
          '',
          '',
          '',
          '<a:r><a:rPr sz="2400"/><a:t>Alpha</a:t></a:r>',
          `<bodyPr>${inherited}</bodyPr>`,
        );
        document.body.append(element);
        await document.fonts.ready;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        return {
          fontSize: getComputedStyle(span).fontSize,
          width: element.getBoundingClientRect().width,
          transform: container.style.transform,
        };
      },
      { own, inherited },
    );
    expect(result.fontSize).toBe(expectedSize);
    expect(result.width).toBe(160);
    expect(result.transform).toBe('');
  });
}

test('vertical text, adjacent runs, bullets and multiple paragraphs preserve container bounds', async ({
  page,
}) => {
  await page.goto('/test/browser/blank.html');
  const result = await page.evaluate(async () => {
    const { renderTextFixture } = await import('/test/fixtures/text-coverage.ts');
    const { element, node, ctx } = renderTextFixture(
      '<bodyPr vert="eaVert" wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"><noAutofit/></bodyPr>',
      '<buAutoNum type="arabicPeriod"/>',
      '<lvl1pPr><buChar char="•"/></lvl1pPr>',
      '',
      '<a:r><a:rPr sz="1200"/><a:t>Alpha</a:t></a:r><a:r><a:rPr sz="1200"/><a:t>乙</a:t></a:r>',
    );
    node.textBody!.paragraphs.push({ ...node.textBody!.paragraphs[0], runs: [{ text: 'Second' }] });
    const { renderShape } = await import('/src/renderer/ShapeRenderer.ts');
    const rendered = renderShape(node, ctx);
    element.remove();
    document.body.style.whiteSpace = 'pre';
    document.body.append(rendered);
    await document.fonts.ready;
    const span = [...rendered.querySelectorAll('span')].find((s) => s.textContent === 'Alpha')!;
    const container = span.closest('div')!.parentElement!;
    return {
      text: rendered.textContent,
      writingMode: getComputedStyle(container).writingMode,
      width: rendered.getBoundingClientRect().width,
      whiteSpace: getComputedStyle(container).whiteSpace,
    };
  });
  expect(result.text).toContain('1.');
  expect(result.text).toContain('2.');
  expect(result.text).not.toContain('•');
  expect(result.writingMode).toBe('vertical-rl');
  expect(result.whiteSpace).toBe('normal');
  expect(result.width).toBe(160);
});

test('near-fit square-wrapped heading stays on one line with bounded scale', async ({ page }) => {
  await page.goto('/test/browser/blank.html');
  const result = await page.evaluate(async () => {
    const { parseXml } = await import('/src/parser/XmlParser.ts');
    const { parseShapeNode } = await import('/src/model/nodes/ShapeNode.ts');
    const { renderShape } = await import('/src/renderer/ShapeRenderer.ts');
    const { createMockRenderContext } = await import('/test/unit/helpers/mockContext.ts');
    const text = '发扬遵义会议精神自觉做到 “两个维护”';
    const shapeXml = (wrap: string, noAutofit: boolean) => `
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="248" name="Near-fit heading"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="28575000" cy="1905000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="${wrap}" lIns="0" tIns="0" rIns="0" bIns="0">${noAutofit ? '<a:noAutofit/>' : ''}</a:bodyPr>
          <a:lstStyle/>
          <a:p>
            <a:r><a:rPr sz="5400" b="1" spc="50"><a:latin typeface="Arial"/><a:ea typeface="Arial"/></a:rPr><a:t>发扬遵义会议精神自觉做到</a:t></a:r>
            <a:r><a:rPr sz="5400" spc="-1380"><a:latin typeface="Arial"/><a:ea typeface="Arial"/></a:rPr><a:t xml:space="preserve"> </a:t></a:r>
            <a:r><a:rPr sz="5400" b="1" spc="50"><a:latin typeface="Arial"/><a:ea typeface="Arial"/></a:rPr><a:t>“两个维护”</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>`;
    const findContainer = (element: HTMLElement) =>
      Array.from(element.querySelectorAll('div')).find(
        (candidate) => candidate.textContent === text && candidate.style.flexDirection === 'column',
      ) as HTMLElement;

    const referenceNode = parseShapeNode(parseXml(shapeXml('none', true)));
    const reference = renderShape(referenceNode, createMockRenderContext());
    document.body.append(reference);
    await document.fonts.ready;
    const referenceContainer = findContainer(reference);
    const range = document.createRange();
    const referenceSpans = referenceContainer.querySelectorAll('span');
    range.setStart(referenceSpans[0].firstChild!, 0);
    range.setEnd(
      referenceSpans[referenceSpans.length - 1].firstChild!,
      referenceSpans[referenceSpans.length - 1].textContent!.length,
    );
    const naturalRect = range.getBoundingClientRect();
    reference.remove();

    const targetNode = parseShapeNode(parseXml(shapeXml('square', false)));
    targetNode.size.w = naturalRect.width - 24;
    targetNode.size.h = naturalRect.height + 4;
    const target = renderShape(targetNode, createMockRenderContext());
    document.body.append(target);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const targetContainer = findContainer(target);
    const targetRange = document.createRange();
    const targetSpans = targetContainer.querySelectorAll('span');
    targetRange.setStart(targetSpans[0].firstChild!, 0);
    targetRange.setEnd(
      targetSpans[targetSpans.length - 1].firstChild!,
      targetSpans[targetSpans.length - 1].textContent!.length,
    );
    const lineCount = new Set(
      Array.from(targetRange.getClientRects(), (rect) => Math.round(rect.top)),
    ).size;
    const scale = Number(targetContainer.style.transform.match(/scale\(([^)]+)\)/)?.[1]);

    return {
      lineCount,
      naturalWidth: naturalRect.width,
      targetWidth: targetNode.size.w,
      scale,
    };
  });

  expect(result.naturalWidth - result.targetWidth).toBeCloseTo(24, 1);
  expect(result.lineCount).toBe(1);
  expect(result.scale).toBeGreaterThan(0.98);
  expect(result.scale).toBeLessThan(1);
});

test('headless renderSlide registers and releases host-provided font faces', async ({ page }) => {
  await page.goto('/test/browser/blank.html');
  const result = await page.evaluate(async () => {
    const { parseXml } = await import('/src/parser/XmlParser.ts');
    const { parseShapeNode } = await import('/src/model/nodes/ShapeNode.ts');
    const { renderSlide } = await import('/src/renderer/SlideRenderer.ts');
    const { createMockRenderContext } = await import('/test/unit/helpers/mockContext.ts');
    const ctx = createMockRenderContext();
    const node = parseShapeNode(
      parseXml(`
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr><p:cNvPr id="2" name="Configured font"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1524000" cy="762000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>
          <p:txBody>
            <a:bodyPr wrap="none"><a:noAutofit/></a:bodyPr><a:lstStyle/>
            <a:p><a:r><a:rPr sz="2400"><a:latin typeface="Configured Deck Face"/></a:rPr><a:t>Configured font</a:t></a:r></a:p>
          </p:txBody>
        </p:sp>`),
    );
    ctx.slide.nodes = [node];
    const config = [
      {
        family: 'Configured Deck Face',
        source: 'url("/test/browser/missing-font.woff2") format("woff2")',
        descriptors: { weight: '400' },
      },
    ];
    const handle = renderSlide(ctx.presentation, ctx.slide, { fontFaces: config });
    document.body.append(handle.element);
    const registeredFamilies = Array.from(document.fonts, (face) => face.family);
    const registeredImmediately = registeredFamilies.some((family) =>
      family.includes('Configured Deck Face'),
    );
    const family = getComputedStyle(handle.element.querySelector('span')!).fontFamily;
    await handle.ready;
    const registeredAfterReady = Array.from(document.fonts).some((face) =>
      face.family.includes('Configured Deck Face'),
    );
    handle.dispose();
    const registeredAfterDispose = Array.from(document.fonts).some((face) =>
      face.family.includes('Configured Deck Face'),
    );
    return {
      family,
      registeredFamilies,
      registeredImmediately,
      registeredAfterReady,
      registeredAfterDispose,
    };
  });

  expect(result).toEqual(expect.objectContaining({ registeredImmediately: true }));
  expect(result.family).toContain('Configured Deck Face');
  // The missing URL must remove the rejected face while keeping the slide usable.
  expect(result.registeredAfterReady).toBe(false);
  expect(result.registeredAfterDispose).toBe(false);
});
