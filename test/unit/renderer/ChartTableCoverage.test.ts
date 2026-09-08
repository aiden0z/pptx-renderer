import { describe, expect, it } from 'vitest';
import { parseXml } from '../../../src/parser/XmlParser';
import {
  extractNumericValuesWithBlanks,
  extractStringValues,
  extractFormatCode,
} from '../../../src/renderer/chart/format';
import {
  borderXml,
  cacheXml,
  chartOption,
  chartXml,
  cornerStyles,
  tableFixture,
  xyChartXml,
} from '../../fixtures/chart-table-coverage';

const firstSeries = (xml: string) => (chartOption(xml).series as any[])[0];
const dataNode = (xml: string) =>
  parseXml(
    `<c:val xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">${xml}</c:val>`,
  );

describe('chart source and paired blank semantics', () => {
  for (const kind of ['numLit', 'numCache']) {
    for (const prefix of [
      '',
      '<c:numRef/>',
      '<c:numRef><c:numCache><c:ptCount val="0"/></c:numCache></c:numRef>',
    ]) {
      it(`reads ${kind} after ${prefix || 'no ref'} without losing sparse zero`, () => {
        const node = dataNode(
          prefix +
            cacheXml(kind, [2, null, 0]).replace(
              `<c:${kind}>`,
              `<c:${kind}><c:formatCode>0.0%</c:formatCode>`,
            ),
        );
        expect(extractNumericValuesWithBlanks(node)).toEqual({
          values: [2, 0, 0],
          blankIndices: new Set([1]),
        });
        expect(extractFormatCode(node)).toBe('0.0%');
      });
    }
  }
  for (const kind of ['strLit', 'strCache']) {
    it(`reads ${kind} with empty strRef fallback`, () => {
      expect(
        extractStringValues(
          dataNode('<c:strRef><c:strCache/></c:strRef>' + cacheXml(kind, ['A', null, 'C'])),
        ),
      ).toEqual(['A', '', 'C']);
    });
  }
  it('uses numeric literal categories when the string reference cache is empty', () => {
    const node = dataNode(
      '<c:strRef><c:strCache><c:ptCount val="3"/></c:strCache></c:strRef>' +
        cacheXml('numLit', [1, null, 3]),
    );
    expect(extractStringValues(node)).toEqual(['1', '', '3']);
  });
  it('a populated string reference retains priority over numeric category literals', () => {
    const node = dataNode(
      `<c:strRef>${cacheXml('strCache', ['A', null])}</c:strRef>${cacheXml('numLit', [1, 2])}`,
    );
    expect(extractStringValues(node)).toEqual(['A', '']);
  });
  it('retains populated reference priority over literal and bare caches', () => {
    const node = dataNode(
      `<c:numRef>${cacheXml('numCache', [9, null])}</c:numRef>${cacheXml('numLit', [1, 2])}${cacheXml('numCache', [3, 4])}`,
    );
    expect(extractNumericValuesWithBlanks(node)).toEqual({
      values: [9, 0],
      blankIndices: new Set([1]),
    });
  });
  for (const family of ['scatter', 'bubble']) {
    for (const mode of ['gap', 'span', 'zero']) {
      it(`${family} ${mode} keeps matched indices, explicit zero and blank coordinates`, () => {
        const series = firstSeries(xyChartXml(family, mode));
        const blank = mode === 'zero' ? 0 : null;
        expect(series.data[0]).toEqual(family === 'bubble' ? [1, 10, 10] : [1, 10]);
        expect(series.data[1]).toEqual(family === 'bubble' ? [2, blank, 10000] : [2, blank]);
        expect(series.data[2]).toEqual(family === 'bubble' ? [3, 0, 30] : [3, 0]);
        expect(series.data[3]).toEqual(family === 'bubble' ? [blank, 40, 40] : [blank, 40]);
        if (family === 'scatter') expect(series.connectNulls).toBe(mode === 'span');
        else expect(series.data[4]).toEqual([5, 50, blank]);
      });
    }
  }
  for (const mode of ['gap', 'zero', 'span']) {
    it(`unequal x/y caches keep their original trailing indices (${mode})`, () => {
      const series = firstSeries(
        chartXml(
          `<c:scatterChart><c:ser><c:xVal>${cacheXml('numLit', [1])}</c:xVal><c:yVal>${cacheXml('numLit', [10, 20, 30])}</c:yVal></c:ser></c:scatterChart>`,
          mode,
        ),
      );
      expect(series.data).toEqual([
        [1, 10],
        [mode === 'zero' ? 0 : null, 20],
        [mode === 'zero' ? 0 : null, 30],
      ]);
    });
  }
  it('missing xVal keeps the existing ordinal fallback while unknown blank mode defaults to gap', () => {
    const series = firstSeries(
      chartXml(
        `<c:scatterChart><c:ser><c:yVal>${cacheXml('numLit', [10, null, 0])}</c:yVal></c:ser></c:scatterChart>`,
        'invalid',
      ),
    );
    expect(series.data).toEqual([
      [0, 10],
      [1, null],
      [2, 0],
    ]);
  });
  it('bubble scaling ignores large sizes at missing coordinates and keeps zero-size points', () => {
    const series = firstSeries(xyChartXml('bubble'));
    expect(series.symbolSize([3, 0, 30])).toBe(120);
    expect(series.symbolSize([3, 0, 0])).toBe(0);
  });
  it('smooth gap keeps a break instead of interpolating through the blank', () => {
    const series = firstSeries(xyChartXml('scatter', 'gap', true));
    expect(series.data).toContainEqual([2, null]);
    expect(series.connectNulls).toBe(false);
    expect(series.data.flat().every((v: unknown) => v === null || Number.isFinite(v))).toBe(true);
  });
  it('smooth span interpolates only complete paired points', () => {
    const series = firstSeries(xyChartXml('scatter', 'span', true));
    expect(series.connectNulls).toBe(true);
    expect(series.data[0]).toEqual([1, 10]);
    expect(series.data.at(-1)).toEqual([5, 50]);
    expect(series.data.flat().every((v: unknown) => Number.isFinite(v))).toBe(true);
  });
  for (const invert of [
    '',
    '<c:invertIfNegative/>',
    '<c:invertIfNegative val="true"/>',
    '<c:invertIfNegative val="false"/>',
  ]) {
    it(`literal negative bars preserve native inversion ${invert || 'missing'}`, () => {
      const series = firstSeries(
        chartXml(
          `<c:barChart><c:barDir val="col"/><c:ser>${invert}<c:spPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></c:spPr><c:cat>${cacheXml('strLit', ['A', 'B'])}</c:cat><c:val>${cacheXml('numLit', [2, -3])}</c:val></c:ser></c:barChart>`,
        ),
      );
      const point = series.data[1];
      expect(typeof point === 'number' ? point : point.value).toBe(-3);
      expect(point.itemStyle?.color ?? series.itemStyle.color).toBe(
        invert.includes('false') ? '#FF0000' : '#FFFFFF',
      );
      if (!invert.includes('false')) expect(point.itemStyle.borderColor).toBe('#000000');
    });
  }
});

describe('table merged edges and conditional styles', () => {
  const base = `<a:wholeTbl><a:tcStyle><a:tcBdr>${borderXml('bottom', 'FF0000')}${borderXml('right', 'FF0000')}${borderXml('insideH', '0000FF')}${borderXml('insideV', '0000FF')}</a:tcBdr></a:tcStyle></a:wholeTbl>`;
  it('uses bottom/right outside border at merged end, retaining interior borders', () => {
    const vertical = tableFixture(base, '', [
      '<a:tc rowSpan="2"/><a:tc/>',
      '<a:tc vMerge="1"/><a:tc/>',
    ]);
    expect(vertical.querySelector('td')!.style.borderBottomColor).toBe('rgb(255, 0, 0)');
    expect(vertical.querySelector('td')!.style.borderRightColor).toBe('rgb(0, 0, 255)');
    const horizontal = tableFixture(base, '', [
      '<a:tc gridSpan="2"/><a:tc hMerge="1"/>',
      '<a:tc/><a:tc/>',
    ]);
    expect(horizontal.querySelector('td')!.style.borderRightColor).toBe('rgb(255, 0, 0)');
    expect(horizontal.querySelector('td')!.style.borderBottomColor).toBe('rgb(0, 0, 255)');
  });
  it('merged cells ending inside the table keep inside borders', () => {
    const element = tableFixture(
      base,
      '',
      [
        '<a:tc rowSpan="2" gridSpan="2"/><a:tc hMerge="1"/><a:tc/>',
        '<a:tc vMerge="1"/><a:tc vMerge="1"/><a:tc/>',
        '<a:tc/><a:tc/><a:tc/>',
      ],
      3,
    );
    const cell = element.querySelector('td')!;
    expect(cell.style.borderBottomColor).toBe('rgb(0, 0, 255)');
    expect(cell.style.borderRightColor).toBe('rgb(0, 0, 255)');
  });
  it('a direct border overrides a conditional border clear', () => {
    const styles =
      base +
      '<a:firstRow><a:tcStyle><a:tcBdr><a:bottom><a:lnRef idx="0"/></a:bottom></a:tcBdr></a:tcStyle></a:firstRow>';
    const element = tableFixture(styles, 'firstRow="1"', [
      '<a:tc><a:tcPr><a:lnB w="38100"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></a:lnB></a:tcPr></a:tc><a:tc/>',
    ]);
    expect(element.querySelector('td')!.style.borderBottomColor).toBe('rgb(0, 255, 0)');
  });
  for (const clear of ['<a:ln><a:noFill/></a:ln>', '<a:lnRef idx="0"/>', '']) {
    it(`conditional border ${clear || 'absent'} clears or inherits`, () => {
      const element = tableFixture(
        base +
          `<a:firstRow><a:tcStyle><a:tcBdr><a:bottom>${clear}</a:bottom></a:tcBdr></a:tcStyle></a:firstRow>`,
        'firstRow="1"',
      );
      expect(element.querySelector('td')!.style.borderBottomColor).toBe(
        clear ? '' : 'rgb(0, 0, 255)',
      );
    });
  }
  for (const [flags, colors] of [
    [
      'firstRow="1" lastRow="1" firstCol="1" lastCol="1"',
      ['rgb(255, 0, 0)', 'rgb(0, 255, 0)', 'rgb(0, 0, 255)', 'rgb(255, 255, 0)'],
    ],
    [
      'firstRow="0" lastRow="0" firstCol="1" lastCol="1"',
      ['rgb(204, 204, 204)', 'rgb(221, 221, 221)', 'rgb(204, 204, 204)', 'rgb(221, 221, 221)'],
    ],
    [
      'firstRow="1" lastRow="1" firstCol="0" lastCol="0"',
      ['rgb(170, 170, 170)', 'rgb(170, 170, 170)', 'rgb(187, 187, 187)', 'rgb(187, 187, 187)'],
    ],
  ] as const) {
    it(`corner flags ${flags}`, () => {
      expect(
        Array.from(
          tableFixture(cornerStyles(), flags).querySelectorAll('td'),
          (td) => td.style.backgroundColor,
        ),
      ).toEqual(colors);
    });
  }
  it('direct formatting overrides corners and direct noFill clears border', () => {
    const element = tableFixture(base + cornerStyles(), 'firstRow="1" firstCol="1"', [
      '<a:tc><a:tcPr><a:solidFill><a:srgbClr val="123456"/></a:solidFill><a:lnB><a:noFill/></a:lnB></a:tcPr></a:tc><a:tc/>',
    ]);
    expect(element.querySelector('td')!.style.backgroundColor).toBe('rgb(18, 52, 86)');
    expect(element.querySelector('td')!.style.borderBottomColor).toBe('');
  });
  it('one row and one column apply only enabled corner intersections', () => {
    expect(
      Array.from(
        tableFixture(cornerStyles(), 'firstRow="1" firstCol="1" lastCol="1"', [
          '<a:tc/><a:tc/>',
        ]).querySelectorAll('td'),
        (td) => td.style.backgroundColor,
      ),
    ).toEqual(['rgb(255, 0, 0)', 'rgb(0, 255, 0)']);
    expect(
      Array.from(
        tableFixture(
          cornerStyles(),
          'firstRow="1" lastRow="1" firstCol="1"',
          ['<a:tc/>', '<a:tc/>'],
          1,
        ).querySelectorAll('td'),
        (td) => td.style.backgroundColor,
      ),
    ).toEqual(['rgb(255, 0, 0)', 'rgb(0, 0, 255)']);
  });
  it('a one-cell table uses later east/south corner sections when several intersections coincide', () => {
    const withoutSE = cornerStyles().replace(/<a:seCell>[\s\S]*?<\/a:seCell>/, '');
    const flags = 'firstRow="1" lastRow="1" firstCol="1" lastCol="1"';
    expect(
      tableFixture(withoutSE, flags, ['<a:tc/>'], 1).querySelector('td')!.style.backgroundColor,
    ).toBe('rgb(0, 255, 0)');
    expect(
      tableFixture(cornerStyles(), flags, ['<a:tc/>'], 1).querySelector('td')!.style
        .backgroundColor,
    ).toBe('rgb(255, 255, 0)');
  });
});
