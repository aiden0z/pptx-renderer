import { describe, expect, it } from 'vitest';
import {
  excelSerialToDateString,
  extractFormatCode,
  extractNumericValues,
  extractStringValues,
  formatValue,
} from '../../../../src/renderer/chart/format';
import { parseXml } from '../../../../src/parser/XmlParser';

describe('chart format helpers', () => {
  it('extracts sparse string cache values by idx and preserves declared gaps', () => {
    const node = parseXml(`
      <c:cat xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:strRef>
          <c:strCache>
            <c:ptCount val="3"/>
            <c:pt idx="2"><c:v>Gamma</c:v></c:pt>
            <c:pt idx="0"><c:v>Alpha</c:v></c:pt>
          </c:strCache>
        </c:strRef>
      </c:cat>
    `);

    expect(extractStringValues(node)).toEqual(['Alpha', '', 'Gamma']);
  });

  it('falls back to numeric cache values as category strings and formats date serials', () => {
    const node = parseXml(`
      <c:cat xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:numRef>
          <c:numCache>
            <c:formatCode>m/d/yyyy</c:formatCode>
            <c:ptCount val="2"/>
            <c:pt idx="0"><c:v>61</c:v></c:pt>
            <c:pt idx="1"><c:v>62</c:v></c:pt>
          </c:numCache>
        </c:numRef>
      </c:cat>
    `);

    expect(extractStringValues(node)).toEqual(['1900/3/1', '1900/3/2']);
  });

  it('extracts numeric values and format codes from numRef caches', () => {
    const node = parseXml(`
      <c:val xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:numRef>
          <c:numCache>
            <c:formatCode>0.0%</c:formatCode>
            <c:ptCount val="2"/>
            <c:pt idx="0"><c:v>0.125</c:v></c:pt>
            <c:pt idx="1"><c:v>not-a-number</c:v></c:pt>
          </c:numCache>
        </c:numRef>
      </c:val>
    `);

    expect(extractFormatCode(node)).toBe('0.0%');
    expect(extractNumericValues(node)).toEqual([0.125, 0]);
    expect(formatValue(0.125, extractFormatCode(node))).toBe('12.5%');
  });

  it('reads string values from strLit literal data when no cache exists', () => {
    const node = parseXml(`
      <c:cat xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:strLit>
          <c:ptCount val="3"/>
          <c:pt idx="0"><c:v>Alpha</c:v></c:pt>
          <c:pt idx="2"><c:v>Gamma</c:v></c:pt>
        </c:strLit>
      </c:cat>
    `);

    expect(extractStringValues(node)).toEqual(['Alpha', '', 'Gamma']);
  });

  it('reads numeric literal data and format codes from numLit', () => {
    const node = parseXml(`
      <c:val xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:numLit>
          <c:formatCode>0.0%</c:formatCode>
          <c:ptCount val="2"/>
          <c:pt idx="0"><c:v>0.125</c:v></c:pt>
          <c:pt idx="1"><c:v>0.5</c:v></c:pt>
        </c:numLit>
      </c:val>
    `);

    expect(extractFormatCode(node)).toBe('0.0%');
    expect(extractNumericValues(node)).toEqual([0.125, 0.5]);
  });

  it('falls back to numeric literal data as category strings and formats date serials', () => {
    const node = parseXml(`
      <c:cat xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:numLit>
          <c:formatCode>m/d/yyyy</c:formatCode>
          <c:ptCount val="2"/>
          <c:pt idx="0"><c:v>61</c:v></c:pt>
          <c:pt idx="1"><c:v>62</c:v></c:pt>
        </c:numLit>
      </c:cat>
    `);

    expect(extractStringValues(node)).toEqual(['1900/3/1', '1900/3/2']);
  });

  it('uses stable UTC Excel serial conversion', () => {
    expect(excelSerialToDateString(59)).toBe('1900/2/28');
    expect(excelSerialToDateString(61)).toBe('1900/3/1');
  });

  it('preserves Office thousands separators in whole-number chart formats', () => {
    expect(formatValue(1234567, '#,##0')).toBe('1,234,567');
    expect(formatValue(-1234567, '#,##0')).toBe('-1,234,567');
  });

  it('uses the negative format section for parenthesized Office number formats', () => {
    const officeFormat = '#,##0_);[Red]\\(#,##0\\)';

    expect(formatValue(1234567, officeFormat)).toBe('1,234,567');
    expect(formatValue(-1234567, officeFormat)).toBe('(1,234,567)');
  });
});
