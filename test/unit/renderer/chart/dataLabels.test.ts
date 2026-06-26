import { describe, expect, it } from 'vitest';
import {
  parseDataLabels,
  parsePointDataLabelOverrides,
} from '../../../../src/renderer/chart/dataLabels';
import { parseXml } from '../../../../src/parser/XmlParser';
import { createMockRenderContext } from '../../helpers/mockContext';

describe('chart data label helpers', () => {
  it('parses shared data label visibility, position, and text style', () => {
    const chartType = parseXml(`
      <c:barChart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:dLbls>
          <c:dLblPos val="outEnd"/>
          <c:showVal val="1"/>
          <c:showCatName val="0"/>
          <c:showSerName val="0"/>
          <c:showPercent val="0"/>
          <c:txPr>
            <a:p><a:pPr><a:defRPr sz="1100" b="1">
              <a:solidFill><a:srgbClr val="112233"/></a:solidFill>
            </a:defRPr></a:pPr></a:p>
          </c:txPr>
        </c:dLbls>
      </c:barChart>
    `);

    expect(parseDataLabels(chartType, createMockRenderContext())).toMatchObject({
      showVal: true,
      showCatName: false,
      showSerName: false,
      showPercent: false,
      position: 'outEnd',
      color: '#112233',
      fontSize: 11,
      bold: true,
    });
  });

  it('parses per-point data label overrides by index', () => {
    const dLbls = parseXml(`
      <c:dLbls xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:dLbl>
          <c:idx val="2"/>
          <c:dLblPos val="ctr"/>
          <c:showVal val="0"/>
          <c:showCatName val="1"/>
        </c:dLbl>
      </c:dLbls>
    `);

    const overrides = parsePointDataLabelOverrides(dLbls, createMockRenderContext());
    expect(overrides.get(2)).toMatchObject({
      position: 'ctr',
      showVal: false,
      showCatName: true,
    });
  });

  it('parses per-point deleted data labels as an explicit hidden override', () => {
    const dLbls = parseXml(`
      <c:dLbls xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:showVal val="1"/>
        <c:dLbl>
          <c:idx val="3"/>
          <c:delete val="1"/>
        </c:dLbl>
      </c:dLbls>
    `);

    const overrides = parsePointDataLabelOverrides(dLbls, createMockRenderContext());
    expect(overrides.get(3)).toMatchObject({
      deleted: true,
      showVal: false,
      showCatName: false,
      showSerName: false,
      showPercent: false,
    });
  });
});
