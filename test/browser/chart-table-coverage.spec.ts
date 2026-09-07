import { expect, test } from '@playwright/test';

test.use({ channel: process.env.PLAYWRIGHT_CHANNEL });

for (const family of ['scatter', 'bubble']) {
  for (const mode of ['gap', 'span', 'zero']) {
    test(`real ECharts ${family} ${mode} retains pairs and blanks`, async ({ page }) => {
      await page.goto('/test/browser/blank.html');
      const result = await page.evaluate(
        async ({ family, mode }) => {
          const { chartOption, xyChartXml } =
            await import('/test/fixtures/chart-table-coverage.ts');
          const { echarts } = await import('/src/renderer/chart/echartsRuntime.ts');
          const host = document.createElement('div');
          Object.assign(host.style, { width: '640px', height: '360px' });
          document.body.append(host);
          const chart = echarts.init(host, undefined, { renderer: 'canvas' });
          chart.setOption({ ...chartOption(xyChartXml(family, mode)), animation: false });
          const model = chart.getModel().getSeriesByIndex(0);
          const data = model.getData();
          const points = Array.from({ length: data.count() }, (_, i) => data.getValues(i));
          const drawable = Array.from(
            { length: data.count() },
            (_, i) => !!data.getItemGraphicEl(i),
          );
          chart.getZr().flush();
          const canvas = host.querySelector('canvas')!;
          const pixels = canvas
            .getContext('2d')!
            .getImageData(0, 0, canvas.width, canvas.height).data;
          const painted = pixels.some((v, i) => i % 4 === 3 && v > 0);
          const polyline = chart
            .getZr()
            .storage.getDisplayList()
            .find((item) => item.type === 'ec-polyline');
          let segments = 0;
          if (polyline)
            polyline.buildPath(
              { moveTo: () => segments++, lineTo() {}, bezierCurveTo() {} },
              polyline.shape,
            );
          const connectNulls = model.get('connectNulls');
          chart.dispose();
          return { points, drawable, painted, connectNulls, segments };
        },
        { family, mode },
      );
      expect(result.points[0].slice(0, 2)).toEqual([1, 10]);
      expect(result.points[1].slice(0, 2)).toEqual([2, mode === 'zero' ? 0 : NaN]);
      expect(result.points[2].slice(0, 2)).toEqual([3, 0]);
      expect(result.points[3].slice(0, 2)).toEqual([mode === 'zero' ? 0 : NaN, 40]);
      expect(result.drawable[1]).toBe(mode === 'zero');
      expect(result.drawable[2]).toBe(true);
      expect(result.painted).toBe(true);
      if (family === 'scatter') expect(result.segments).toBe(mode === 'gap' ? 3 : 1);
      if (family === 'scatter') expect(result.connectNulls).toBe(mode === 'span');
    });
  }
}

test('browser table merged edges, explicit clearing, corners and direct precedence', async ({
  page,
}) => {
  await page.goto('/test/browser/blank.html');
  const result = await page.evaluate(async () => {
    const { tableFixture, borderXml, cornerStyles } =
      await import('/test/fixtures/chart-table-coverage.ts');
    const base = `<a:wholeTbl><a:tcStyle><a:tcBdr>${borderXml('bottom', 'FF0000')}${borderXml('right', 'FF0000')}${borderXml('insideH', '0000FF')}${borderXml('insideV', '0000FF')}</a:tcBdr></a:tcStyle></a:wholeTbl>`;
    const merged = tableFixture(base, '', [
      '<a:tc rowSpan="2" gridSpan="2"/><a:tc hMerge="1"/>',
      '<a:tc vMerge="1"/><a:tc vMerge="1"/>',
    ]);
    const cleared = tableFixture(
      base +
        '<a:firstRow><a:tcStyle><a:tcBdr><a:bottom><a:ln><a:noFill/></a:ln></a:bottom></a:tcBdr></a:tcStyle></a:firstRow>',
      'firstRow="1"',
      ['<a:tc/><a:tc/>'],
    );
    const corner = tableFixture(
      cornerStyles(),
      'firstRow="1" firstCol="1" lastRow="1" lastCol="1"',
    );
    for (const element of [merged, cleared, corner]) {
      const parent = document.createElement('div');
      Object.assign(parent.style, {
        position: 'relative',
        width: '420px',
        height: '220px',
        transform: 'scale(0.8)',
        transformOrigin: 'top left',
      });
      parent.append(element);
      document.body.append(parent);
    }
    const cell = merged.querySelector('td')!;
    return {
      bottom: getComputedStyle(cell).borderBottomColor,
      right: getComputedStyle(cell).borderRightColor,
      width: merged.getBoundingClientRect().width,
      clear: getComputedStyle(cleared.querySelector('td')!).borderBottomStyle,
      colors: Array.from(
        corner.querySelectorAll('td'),
        (td) => getComputedStyle(td).backgroundColor,
      ),
    };
  });
  expect(result.bottom).toBe('rgb(255, 0, 0)');
  expect(result.right).toBe('rgb(255, 0, 0)');
  expect(result.clear).toBe('none');
  expect(result.width).toBeCloseTo(320);
  expect(result.colors).toEqual([
    'rgb(255, 0, 0)',
    'rgb(0, 255, 0)',
    'rgb(0, 0, 255)',
    'rgb(255, 255, 0)',
  ]);
});

for (const invert of [
  '',
  '<c:invertIfNegative/>',
  '<c:invertIfNegative val="1"/>',
  '<c:invertIfNegative val="0"/>',
]) {
  test(`real ECharts literal negative bars ${invert || 'missing invertIfNegative'}`, async ({
    page,
  }) => {
    await page.goto('/test/browser/blank.html');
    const result = await page.evaluate(async (invert) => {
      const { chartOption, chartXml, cacheXml } =
        await import('/test/fixtures/chart-table-coverage.ts');
      const { echarts } = await import('/src/renderer/chart/echartsRuntime.ts');
      const xml = chartXml(
        `<c:barChart><c:barDir val="col"/><c:ser>${invert}<c:spPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></c:spPr><c:cat><c:strRef><c:strCache/></c:strRef>${cacheXml('strLit', ['A', 'B'])}</c:cat><c:val><c:numRef/>${cacheXml('numLit', [2, -3])}</c:val></c:ser></c:barChart>`,
      );
      const host = document.createElement('div');
      Object.assign(host.style, { width: '640px', height: '360px' });
      document.body.append(host);
      const chart = echarts.init(host);
      chart.setOption({ ...chartOption(xml), animation: false });
      chart.getZr().flush();
      const data = chart.getModel().getSeriesByIndex(0).getData();
      const bar = data.getItemGraphicEl(1);
      const answer = {
        categories: [data.getName(0), data.getName(1)],
        fill: bar?.style.fill ?? null,
        stroke: bar?.style.stroke ?? null,
        height: bar ? Math.abs(bar.shape.height) : 0,
        value: data.get('y', 1),
      };
      chart.dispose();
      return answer;
    }, invert);
    expect(result.categories).toEqual(['A', 'B']);
    expect(result.value).toBe(-3);
    expect(result.height).toBeGreaterThan(0);
    expect(result.fill).toBe(invert.includes('val="0"') ? '#FF0000' : '#FFFFFF');
    if (!invert.includes('val="0"')) expect(result.stroke).toBe('#000000');
  });
}
