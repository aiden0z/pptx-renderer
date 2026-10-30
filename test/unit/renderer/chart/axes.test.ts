import { describe, expect, it } from 'vitest';
import { applyAxisInfo, parseAxes } from '../../../../src/renderer/chart/axes';
import { parseXml } from '../../../../src/parser/XmlParser';
import { createMockRenderContext } from '../../helpers/mockContext';

describe('chart axis helpers', () => {
  it('parses axes by chart axId order and applies value-axis settings', () => {
    const plotArea = parseXml(`
      <c:plotArea xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:barChart>
          <c:axId val="cat1"/>
          <c:axId val="val1"/>
        </c:barChart>
        <c:catAx>
          <c:axId val="cat1"/>
          <c:tickLblPos val="none"/>
        </c:catAx>
        <c:valAx>
          <c:axId val="val1"/>
          <c:scaling>
            <c:orientation val="maxMin"/>
            <c:min val="0"/>
            <c:max val="1"/>
          </c:scaling>
          <c:numFmt formatCode="0.0%"/>
          <c:majorGridlines/>
        </c:valAx>
      </c:plotArea>
    `);

    const { valueAxis, categoryAxis } = parseAxes(
      plotArea,
      createMockRenderContext(),
      plotArea.child('barChart'),
    );

    expect(categoryAxis.tickLblPos).toBe('none');
    expect(valueAxis).toMatchObject({
      min: 0,
      max: 1,
      numFmt: '0.0%',
      orientation: 'maxMin',
      hasMajorGridlines: true,
    });

    const axisDef: Record<string, unknown> = {};
    applyAxisInfo(axisDef, valueAxis, 'value');

    expect(axisDef).toMatchObject({
      min: 0,
      max: 1,
      inverse: true,
      splitLine: { show: true },
    });
    const formatter = (axisDef.axisLabel as { formatter: (value: number) => string }).formatter;
    expect(formatter(0.125)).toBe('12.5%');
  });

  it('keeps the scaling of a deleted value axis', () => {
    const plotArea = parseXml(`
      <c:plotArea xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:barChart><c:axId val="cat1"/><c:axId val="val1"/></c:barChart>
        <c:catAx><c:axId val="cat1"/></c:catAx>
        <c:valAx>
          <c:axId val="val1"/>
          <c:scaling><c:orientation val="minMax"/><c:max val="961"/><c:min val="0"/></c:scaling>
          <c:delete val="1"/>
        </c:valAx>
      </c:plotArea>
    `);
    const { valueAxis } = parseAxes(
      plotArea,
      createMockRenderContext(),
      plotArea.child('barChart'),
    );

    const axisDef: Record<string, unknown> = {};
    applyAxisInfo(axisDef, valueAxis, 'value');

    expect(axisDef).toMatchObject({ min: 0, max: 961, axisLabel: { show: false } });
  });

  it('hides an axis line with an explicit noFill line', () => {
    const plotArea = parseXml(`
      <c:plotArea xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:barChart><c:axId val="cat1"/><c:axId val="val1"/></c:barChart>
        <c:catAx>
          <c:axId val="cat1"/>
          <c:delete val="0"/>
          <c:spPr><a:ln w="12700"><a:noFill/></a:ln></c:spPr>
        </c:catAx>
        <c:valAx><c:axId val="val1"/></c:valAx>
      </c:plotArea>
    `);
    const { categoryAxis } = parseAxes(
      plotArea,
      createMockRenderContext(),
      plotArea.child('barChart'),
    );

    const axisDef: Record<string, unknown> = {};
    applyAxisInfo(axisDef, categoryAxis, 'category');

    expect(axisDef.axisLine).toMatchObject({ show: false });
  });
});
