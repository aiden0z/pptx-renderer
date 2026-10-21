import { expect, test } from '@playwright/test';

test('chart element font sizes use 96 dpi pixels without overriding inherited defaults', async ({
  page,
}) => {
  await page.goto('/test/browser/blank.html');
  const result = await page.evaluate(async () => {
    const { chartOption, cacheXml } = await import('/test/fixtures/chart-table-coverage.ts');
    const { echarts } = await import('/src/renderer/chart/echartsRuntime.ts');
    const txPr = `<c:txPr><a:p><a:pPr><a:defRPr sz="1000"/></a:pPr></a:p></c:txPr>`;
    const xml = `<c:chartSpace
      xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:barChart>
        <c:barDir val="col"/><c:grouping val="clustered"/>
        <c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Series</c:v></c:tx>
          <c:cat>${cacheXml('strLit', ['A', 'B'])}</c:cat>
          <c:val>${cacheXml('numLit', [10, 20])}</c:val>
          <c:dLbls>${txPr}<c:showVal val="1"/></c:dLbls>
        </c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart>
        <c:catAx><c:axId val="1"/><c:axPos val="b"/><c:crossAx val="2"/>${txPr}</c:catAx>
        <c:valAx><c:axId val="2"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
      </c:plotArea><c:legend><c:legendPos val="b"/>${txPr}</c:legend></c:chart>
      <c:txPr><a:p><a:pPr><a:defRPr sz="1800"/></a:pPr></a:p></c:txPr>
    </c:chartSpace>`;
    const option = chartOption(xml);
    const host = document.createElement('div');
    Object.assign(host.style, { width: '640px', height: '360px' });
    document.body.append(host);
    const chart = echarts.init(host, undefined, { renderer: 'canvas' });
    chart.setOption({ ...option, animation: false });
    chart.getZr().flush();
    const model = chart.getModel();
    const answer = {
      category: model.getComponent('xAxis').get(['axisLabel', 'fontSize']),
      value: model.getComponent('yAxis').get(['axisLabel', 'fontSize']),
      legend: model.getComponent('legend').get(['textStyle', 'fontSize']),
      label: model.getSeriesByIndex(0).get(['label', 'fontSize']),
    };
    chart.dispose();
    return answer;
  });
  // The chart's existing integer-pixel policy rounds 10pt * 96/72 to 13px.
  expect(result).toEqual({ category: 13, value: 24, legend: 13, label: 13 });
});
