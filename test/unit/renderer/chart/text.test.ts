import { describe, expect, it } from 'vitest';
import {
  extractTitleRichText,
  extractTitleText,
  extractTxPrStyle,
} from '../../../../src/renderer/chart/text';
import { EXPLICIT_FONT_SIZE } from '../../../../src/renderer/chart/types';
import { extractChartDefaultFontSize } from '../../../../src/renderer/chart/postProcess';
import { parseXml } from '../../../../src/parser/XmlParser';
import { createMockRenderContext } from '../../helpers/mockContext';

describe('chart text helpers', () => {
  it('extracts rich title text across runs, fields, breaks, and paragraphs', () => {
    const title = parseXml(`
      <c:title xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:tx>
          <c:rich>
            <a:p>
              <a:r><a:t>Revenue</a:t></a:r>
              <a:br/>
              <a:fld><a:t>FY26</a:t></a:fld>
            </a:p>
            <a:p><a:r><a:t>Plan</a:t></a:r></a:p>
          </c:rich>
        </c:tx>
      </c:title>
    `);

    expect(extractTitleText(title)).toBe('Revenue\nFY26\nPlan');
  });

  it('extracts color, explicit font size, bold flag, and font family from txPr', () => {
    const node = parseXml(`
      <c:legend xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:txPr>
          <a:p>
            <a:pPr>
              <a:defRPr sz="1400" b="1">
                <a:solidFill><a:srgbClr val="336699"/></a:solidFill>
                <a:latin typeface="Arial"/>
              </a:defRPr>
            </a:pPr>
          </a:p>
        </c:txPr>
      </c:legend>
    `);

    expect(extractTxPrStyle(node, createMockRenderContext())).toMatchObject({
      color: '#336699',
      fontSize: 19,
      bold: true,
      fontFamily: expect.stringContaining('Arial'),
    });
  });
});

describe('chart element font units (issue #40)', () => {
  const txPr = (size: string) =>
    `<c:txPr><a:p><a:pPr><a:defRPr sz="${size}"/></a:pPr></a:p></c:txPr>`;
  const wrap = (name: string, content: string) =>
    parseXml(`<c:${name}
    xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
    xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${content}</c:${name}>`);

  it.each([
    [600, 8],
    [900, 12],
    [1000, 13],
    [1050, 14],
    [1200, 16],
    [1800, 24],
  ])('converts %i hundredths of a point to %i px, consistently with chart defaults', (sz, px) => {
    const style = extractTxPrStyle(wrap('legend', txPr(String(sz))), createMockRenderContext());
    expect(style?.fontSize).toBe(px);
    expect(style?.[EXPLICIT_FONT_SIZE]).toBe(true);
    expect(style?.fontSize).toBe(extractChartDefaultFontSize(wrap('chartSpace', txPr(String(sz)))));
  });

  it.each(['0', '-100', 'invalid'])('does not turn invalid size %s into an explicit font', (sz) => {
    expect(extractTxPrStyle(wrap('legend', txPr(sz)), createMockRenderContext())).toBeUndefined();
  });

  it('converts rich title run and field fonts through the same path', () => {
    const title = wrap(
      'title',
      `<c:tx><c:rich><a:p>
      <a:r><a:rPr sz="1000"/><a:t>Run</a:t></a:r>
      <a:fld><a:rPr sz="1800"/><a:t>Field</a:t></a:fld>
      <a:r><a:t>Unstyled</a:t></a:r>
    </a:p></c:rich></c:tx>`,
    );
    const rich = extractTitleRichText(title, createMockRenderContext());
    expect(rich?.rich.r0.fontSize).toBe(13);
    expect(rich?.rich.r1.fontSize).toBe(24);
    expect(rich?.text).toBe('{r0|Run}{r1|Field}Unstyled');
  });
});
