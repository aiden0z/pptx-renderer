import { describe, expect, it } from 'vitest';
import {
  extractLegendInfo,
  getGridBottomPx,
  getGridTopPx,
  getLegendPlacement,
  lineLegendIconPath,
} from '../../../../src/renderer/chart/legend';
import { parseXml } from '../../../../src/parser/XmlParser';
import { createMockRenderContext } from '../../helpers/mockContext';

describe('chart legend helpers', () => {
  it('parses default right legend with manual layout and text style', () => {
    const chart = parseXml(`
      <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:legend>
          <c:layout><c:manualLayout>
            <c:x val="0.1"/><c:y val="0.2"/><c:w val="0.3"/><c:h val="0.4"/>
          </c:manualLayout></c:layout>
          <c:txPr><a:p><a:pPr><a:defRPr sz="900"/></a:pPr></a:p></c:txPr>
        </c:legend>
      </c:chart>
    `);

    const legend = extractLegendInfo(chart, createMockRenderContext());

    expect(legend?.position).toBe('r');
    expect(legend?.manualLayout).toEqual({
      left: '10%',
      top: '20%',
      width: '30%',
      height: '40%',
    });
    expect(legend?.textStyle?.fontSize).toBe(9);
    expect(getLegendPlacement(legend)).toBe('right');
    expect((legend?.option as { right?: string }).right).toBe('2%');
  });

  it('reserves bottom grid space for bottom legends and exposes line icon path', () => {
    const chart = parseXml(`
      <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:legend><c:legendPos val="b"/></c:legend>
      </c:chart>
    `);

    const legend = extractLegendInfo(chart, createMockRenderContext());

    expect(getGridTopPx(false, legend)).toBe(20);
    expect(getGridTopPx(false, legend, true)).toBe(9);
    expect(getGridTopPx(true, undefined, true)).toBe(57);
    expect(getGridBottomPx(legend)).toBe(35);
    expect(lineLegendIconPath()).toBe('path://M2 4.5 L22 4.5');
  });
});
