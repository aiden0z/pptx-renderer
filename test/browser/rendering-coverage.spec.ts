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
