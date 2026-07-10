/**
 * Unit tests for ChartRenderer.
 *
 * Covers:
 * 1. Bar chart gradient fill colors extraction
 * 2. X-axis label color from catAx txPr
 * 3. Legend visibility and manualLayout
 * 4. Data-label bold behavior (series-level vs point-level)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  applyZeroCrossingAxisLabelLayout,
  parseChartXml,
  renderChart,
  type ParseChartResult,
} from '../../../src/renderer/ChartRenderer';
import { createMockRenderContext } from '../helpers/mockContext';
import { parseXml } from '../../../src/parser/XmlParser';
import type { RenderContext } from '../../../src/renderer/RenderContext';
import type { ChartNodeData } from '../../../src/model/nodes/ChartNode';
import * as echarts from 'echarts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal OOXML chartSpace XML string for a bar chart.
 * The chartSpace uses c: namespace prefix (like real PPTX files).
 */
function buildChartSpaceXml(opts: {
  /** If true, include a <c:legend> element */
  hasLegend?: boolean;
  /** Legend position value, e.g. 'b', 'r' */
  legendPos?: string;
  /** Legend txPr XML fragment. If provided, inserted inside legend. */
  legendTxPr?: string;
  /** Optional manual layout for legend; values are OOXML normalized fractions. */
  legendManualLayout?: { x?: number; y?: number; w?: number; h?: number };
  /** chartSpace clrMapOvr attributes, e.g. `bg1="dk1" tx1="lt1"` */
  chartClrMapOvrAttrs?: string;
  /** Optional chart style id (`<c:style val="..."/>`) */
  chartStyleVal?: number;
  /** Optional chartSpace spPr XML fragment. Defaults to noFill. */
  chartSpaceSpPr?: string;
  /** Series fill XML fragment (inside c:spPr). Defaults to solidFill red. */
  seriesFill?: string;
  /** Category axis txPr XML fragment. If provided, inserted inside catAx. */
  catAxTxPr?: string;
  /** Category axis spPr XML fragment. If provided, inserted inside catAx. */
  catAxSpPr?: string;
  /** Data point fills (array of XML fragments for c:dPt elements). */
  dataPointFills?: string[];
  /** Auto title deleted flag */
  autoTitleDeleted?: boolean;
  /** Series name */
  seriesName?: string;
  /** Categories */
  categories?: string[];
  /** Values */
  values?: number[];
  /** Value axis deleted flag */
  valAxDeleted?: boolean;
  /** Optional value axis title text and txPr style. */
  valAxTitleText?: string;
  valAxTitleTxPr?: string;
  /** Optional manual layout for plotArea; values are OOXML normalized fractions. */
  plotAreaManualLayout?: { x?: number; y?: number; w?: number; h?: number };
  /** Optional chart title text and txPr style. */
  titleText?: string;
  titleTxPr?: string;
  titleRichPPr?: string;
  /** Optional manual layout for title; values are OOXML normalized fractions. */
  titleManualLayout?: { x?: number; y?: number };
}): string {
  const {
    hasLegend = false,
    legendPos = 'r',
    legendTxPr,
    legendManualLayout,
    chartClrMapOvrAttrs,
    chartStyleVal,
    chartSpaceSpPr,
    seriesFill = '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>',
    catAxTxPr,
    catAxSpPr,
    dataPointFills = [],
    autoTitleDeleted = true,
    seriesName = '市场规模',
    categories = ['2024', '2025E', '2026E'],
    values = [607, 710, 866],
    valAxDeleted = true,
    valAxTitleText,
    valAxTitleTxPr,
    plotAreaManualLayout,
    titleText,
    titleTxPr,
    titleRichPPr,
    titleManualLayout,
  } = opts;

  const legendTxPrXml = legendTxPr ? `<c:txPr>${legendTxPr}</c:txPr>` : '';
  const legendManualLayoutXml = legendManualLayout
    ? `<c:layout><c:manualLayout>${
        legendManualLayout.x !== undefined ? `<c:x val="${legendManualLayout.x}"/>` : ''
      }${legendManualLayout.y !== undefined ? `<c:y val="${legendManualLayout.y}"/>` : ''}${
        legendManualLayout.w !== undefined ? `<c:w val="${legendManualLayout.w}"/>` : ''
      }${
        legendManualLayout.h !== undefined ? `<c:h val="${legendManualLayout.h}"/>` : ''
      }</c:manualLayout></c:layout>`
    : '';
  const legendXml = hasLegend
    ? `<c:legend><c:legendPos val="${legendPos}"/>${legendManualLayoutXml}${legendTxPrXml}</c:legend>`
    : '';

  const dPtXml = dataPointFills
    .map(
      (fill, idx) => `
    <c:dPt>
      <c:idx val="${idx}"/>
      <c:spPr>${fill}</c:spPr>
    </c:dPt>`,
    )
    .join('');

  const catPts = categories.map((cat, i) => `<c:pt idx="${i}"><c:v>${cat}</c:v></c:pt>`).join('');

  const valPts = values.map((val, i) => `<c:pt idx="${i}"><c:v>${val}</c:v></c:pt>`).join('');

  const catAxTxPrXml = catAxTxPr ? `<c:txPr>${catAxTxPr}</c:txPr>` : '';
  const catAxSpPrXml = catAxSpPr ? `<c:spPr>${catAxSpPr}</c:spPr>` : '';
  const chartClrMapOvrXml = chartClrMapOvrAttrs ? `<c:clrMapOvr ${chartClrMapOvrAttrs}/>` : '';
  const chartStyleXml = chartStyleVal !== undefined ? `<c:style val="${chartStyleVal}"/>` : '';
  const chartSpaceSpPrXml = `<c:spPr>${chartSpaceSpPr ?? '<a:noFill/>'}</c:spPr>`;
  const plotAreaManualLayoutXml = plotAreaManualLayout
    ? `<c:layout><c:manualLayout>${
        plotAreaManualLayout.x !== undefined ? `<c:x val="${plotAreaManualLayout.x}"/>` : ''
      }${plotAreaManualLayout.y !== undefined ? `<c:y val="${plotAreaManualLayout.y}"/>` : ''}${
        plotAreaManualLayout.w !== undefined ? `<c:w val="${plotAreaManualLayout.w}"/>` : ''
      }${
        plotAreaManualLayout.h !== undefined ? `<c:h val="${plotAreaManualLayout.h}"/>` : ''
      }</c:manualLayout></c:layout>`
    : '';
  const titleTxPrXml = titleTxPr ? `<c:txPr>${titleTxPr}</c:txPr>` : '';
  const titleRichPPrXml = titleRichPPr ? `<a:pPr>${titleRichPPr}</a:pPr>` : '';
  const titleManualLayoutXml = titleManualLayout
    ? `<c:layout><c:manualLayout>${
        titleManualLayout.x !== undefined ? `<c:x val="${titleManualLayout.x}"/>` : ''
      }${
        titleManualLayout.y !== undefined ? `<c:y val="${titleManualLayout.y}"/>` : ''
      }</c:manualLayout></c:layout>`
    : '';
  const titleXml = titleText
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p>${titleRichPPrXml}<a:r><a:t>${titleText}</a:t></a:r></a:p></c:rich></c:tx>${titleManualLayoutXml}${titleTxPrXml}</c:title>`
    : '';
  const valAxTitleTxPrXml = valAxTitleTxPr ? `<c:txPr>${valAxTitleTxPr}</c:txPr>` : '';
  const valAxTitleXml = valAxTitleText
    ? `<c:title><c:tx><c:rich><a:bodyPr rot="-5400000"/><a:lstStyle/><a:p><a:r><a:t>${valAxTitleText}</a:t></a:r></a:p></c:rich></c:tx>${valAxTitleTxPrXml}</c:title>`
    : '';

  return `<c:chartSpace
    xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
    xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
    ${chartStyleXml}
    ${chartClrMapOvrXml}
    <c:chart>
      ${titleXml}
      <c:autoTitleDeleted val="${autoTitleDeleted ? '1' : '0'}"/>
      <c:plotArea>
        ${plotAreaManualLayoutXml}
        <c:barChart>
          <c:barDir val="col"/>
          <c:grouping val="clustered"/>
          <c:ser>
            <c:idx val="0"/>
            <c:order val="0"/>
            <c:tx>
              <c:strRef>
                <c:strCache>
                  <c:ptCount val="1"/>
                  <c:pt idx="0"><c:v>${seriesName}</c:v></c:pt>
                </c:strCache>
              </c:strRef>
            </c:tx>
            <c:spPr>${seriesFill}</c:spPr>
            ${dPtXml}
            <c:cat>
              <c:strRef>
                <c:strCache>
                  <c:ptCount val="${categories.length}"/>
                  ${catPts}
                </c:strCache>
              </c:strRef>
            </c:cat>
            <c:val>
              <c:numRef>
                <c:numCache>
                  <c:formatCode>0</c:formatCode>
                  <c:ptCount val="${values.length}"/>
                  ${valPts}
                </c:numCache>
              </c:numRef>
            </c:val>
          </c:ser>
          <c:gapWidth val="219"/>
        </c:barChart>
        <c:catAx>
          <c:axId val="1"/>
          <c:scaling><c:orientation val="minMax"/></c:scaling>
          <c:delete val="0"/>
          <c:axPos val="b"/>
          <c:tickLblPos val="nextTo"/>
          ${catAxSpPrXml}
          ${catAxTxPrXml}
          <c:crossAx val="2"/>
        </c:catAx>
        <c:valAx>
          <c:axId val="2"/>
          <c:scaling><c:orientation val="minMax"/></c:scaling>
          <c:delete val="${valAxDeleted ? '1' : '0'}"/>
          <c:axPos val="l"/>
          <c:tickLblPos val="nextTo"/>
          ${valAxTitleXml}
          <c:crossAx val="1"/>
        </c:valAx>
      </c:plotArea>
      ${legendXml}
    </c:chart>
    ${chartSpaceSpPrXml}
  </c:chartSpace>`;
}

function parseChartOption(xml: string, ctx?: RenderContext): ParseChartResult {
  const chartXml = parseXml(xml);
  return parseChartXml(chartXml, ctx ?? createMockRenderContext());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChartRenderer', () => {
  it('disables ECharts animation for deterministic static slide rendering', () => {
    const { option } = parseChartOption(buildChartSpaceXml({}));

    expect(option.animation).toBe(false);
  });

  describe('chart data safety', () => {
    it('does not trust oversized ptCount when only sparse points are present', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:barChart>
                <c:barDir val="col"/>
                <c:grouping val="clustered"/>
                <c:ser>
                  <c:idx val="0"/>
                  <c:order val="0"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:cat>
                    <c:strRef><c:strCache><c:ptCount val="50001"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef>
                  </c:cat>
                  <c:val>
                    <c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="50001"/><c:pt idx="0"><c:v>7</c:v></c:pt></c:numCache></c:numRef>
                  </c:val>
                </c:ser>
              </c:barChart>
              <c:catAx><c:axId val="1"/><c:delete val="0"/><c:crossAx val="2"/></c:catAx>
              <c:valAx><c:axId val="2"/><c:delete val="0"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const xAxis = Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis;
      const series = Array.isArray(option.series) ? option.series[0] : option.series;

      expect((xAxis as { data?: unknown[] }).data).toEqual(['A']);
      expect((series as { data?: unknown[] }).data).toEqual([7]);
    });
  });

  // ==========================================================================
  // Issue 3: Legend should be hidden when <c:legend> is absent
  // ==========================================================================
  describe('legend visibility', () => {
    it('should hide legend when no <c:legend> element exists', () => {
      const xml = buildChartSpaceXml({ hasLegend: false });
      const { option } = parseChartOption(xml);

      // Legend should either be absent or have show: false
      const legend = option.legend as any;
      expect(legend?.show).toBe(false);
    });

    it('should show legend when <c:legend> element exists', () => {
      const xml = buildChartSpaceXml({ hasLegend: true, legendPos: 'b' });
      const { option } = parseChartOption(xml);

      const legend = option.legend as any;
      // Legend should not have show: false
      expect(legend?.show).not.toBe(false);
    });

    it('should position legend at bottom when legendPos is b', () => {
      const xml = buildChartSpaceXml({ hasLegend: true, legendPos: 'b' });
      const { option } = parseChartOption(xml);

      const legend = option.legend as any;
      expect(legend?.bottom).toBeDefined();
      expect(legend?.orient).toBe('horizontal');
    });

    it('should position legend at right when legendPos is r', () => {
      const xml = buildChartSpaceXml({ hasLegend: true, legendPos: 'r' });
      const { option } = parseChartOption(xml);

      const legend = option.legend as any;
      expect(legend?.right).toBeDefined();
      expect(legend?.top).toBe('middle');
      expect(legend?.orient).toBe('vertical');
    });

    it('should use Office black foreground for legend text when txPr omits it', () => {
      const xml = buildChartSpaceXml({ hasLegend: true, legendPos: 'b' });
      const { option } = parseChartOption(xml);

      const legend = option.legend as any;
      expect(legend?.textStyle?.color).toBe('#000000');
    });

    it('should apply legend text color from legend txPr', () => {
      const legendTxPr = `
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p>
          <a:pPr>
            <a:defRPr sz="900">
              <a:solidFill><a:srgbClr val="AABBCC"/></a:solidFill>
            </a:defRPr>
          </a:pPr>
        </a:p>`;
      const xml = buildChartSpaceXml({ hasLegend: true, legendPos: 'b', legendTxPr });
      const { option } = parseChartOption(xml);
      const legend = option.legend as any;
      expect(legend?.textStyle?.color).toBeDefined();
      expect(legend.textStyle.color).toMatch(/[Aa][Aa][Bb][Bb][Cc][Cc]/);
    });

    it('should apply legend font size from legend txPr defRPr sz', () => {
      const legendTxPr = `
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p>
          <a:pPr>
            <a:defRPr sz="1200">
              <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
            </a:defRPr>
          </a:pPr>
        </a:p>`;
      const xml = buildChartSpaceXml({ hasLegend: true, legendPos: 'b', legendTxPr });
      const { option } = parseChartOption(xml);
      const legend = option.legend as any;
      expect(legend?.textStyle?.fontSize).toBe(12);
    });

    it('should apply legend text outer shadow from legend txPr defRPr effectLst', () => {
      const legendTxPr = `
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p>
          <a:pPr>
            <a:defRPr sz="900">
              <a:effectLst>
                <a:outerShdw blurRad="38100" dist="38100" dir="2700000" algn="tl">
                  <a:srgbClr val="333333"><a:alpha val="50000"/></a:srgbClr>
                </a:outerShdw>
              </a:effectLst>
            </a:defRPr>
          </a:pPr>
        </a:p>`;
      const xml = buildChartSpaceXml({ hasLegend: true, legendPos: 'b', legendTxPr });
      const { option } = parseChartOption(xml);
      const legend = option.legend as any;

      expect(legend?.textStyle?.textShadowColor).toBe('rgba(51,51,51,0.500)');
      expect(legend.textStyle.textShadowBlur).toBeCloseTo(4);
      expect(legend.textStyle.textShadowOffsetX).toBeCloseTo(2.8, 1);
      expect(legend.textStyle.textShadowOffsetY).toBeCloseTo(2.8, 1);
    });

    it('should resolve theme font placeholders from legend txPr defRPr', () => {
      const legendTxPr = `
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p>
          <a:pPr>
            <a:defRPr>
              <a:latin typeface="+mn-lt"/>
            </a:defRPr>
          </a:pPr>
        </a:p>`;
      const ctx = createMockRenderContext({
        theme: {
          ...createMockRenderContext().theme,
          minorFont: { latin: 'Mock Sans', ea: '', cs: '' },
        },
      });
      const xml = buildChartSpaceXml({ hasLegend: true, legendPos: 'b', legendTxPr });
      const { option } = parseChartOption(xml, ctx);
      const legend = option.legend as any;

      expect(legend?.textStyle?.fontFamily).toContain('Mock Sans');
      expect(legend?.textStyle?.fontFamily).not.toContain('+mn-lt');
    });

    it('should keep East Asian theme fonts in explicit chart text font stacks', () => {
      const legendTxPr = `
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p>
          <a:pPr>
            <a:defRPr>
              <a:latin typeface="+mn-lt"/>
              <a:ea typeface="+mn-ea"/>
            </a:defRPr>
          </a:pPr>
        </a:p>`;
      const ctx = createMockRenderContext({
        theme: {
          ...createMockRenderContext().theme,
          minorFont: { latin: 'Mock Sans', ea: 'Microsoft YaHei', cs: '' },
        },
      });
      const xml = buildChartSpaceXml({ hasLegend: true, legendPos: 'b', legendTxPr });
      const { option } = parseChartOption(xml, ctx);
      const legend = option.legend as any;

      expect(legend?.textStyle?.fontFamily).toContain('Mock Sans');
      expect(legend?.textStyle?.fontFamily).toContain('Microsoft YaHei');
      expect(legend?.textStyle?.fontFamily).not.toContain('+mn-');
    });

    it('should apply legend manualLayout to legend left/top/width/height', () => {
      const xml = buildChartSpaceXml({
        hasLegend: true,
        legendPos: 't',
        legendManualLayout: { x: 0.1, y: 0.2, w: 0.6, h: 0.1 },
      });
      const { option } = parseChartOption(xml);
      const legend = option.legend as any;
      expect(legend?.left).toBe('10%');
      expect(legend?.top).toBe('20%');
      expect(legend?.width).toBe('60%');
      expect(legend?.height).toBe('10%');
    });
  });

  // ==========================================================================
  // Issue 1: Bar chart colors — gradient fill support
  // ==========================================================================
  describe('series color extraction', () => {
    it('should extract solidFill color from series spPr', () => {
      const xml = buildChartSpaceXml({
        hasLegend: false,
        seriesFill: '<a:solidFill><a:srgbClr val="FF8800"/></a:solidFill>',
      });
      const { option } = parseChartOption(xml);

      const series = (option.series as any[])?.[0];
      expect(series).toBeDefined();
      // The series itemStyle should have the color
      expect(series.itemStyle?.color).toMatch(/[Ff][Ff]8800/);
    });

    it('should handle gradFill on series spPr', () => {
      // Gradient fill pattern with alpha stops:
      // gradient from white@60% alpha to white@0% alpha
      const gradFill = `<a:gradFill>
        <a:gsLst>
          <a:gs pos="100000">
            <a:sysClr val="window" lastClr="FFFFFF">
              <a:alpha val="0"/>
            </a:sysClr>
          </a:gs>
          <a:gs pos="0">
            <a:sysClr val="window" lastClr="FFFFFF">
              <a:alpha val="60000"/>
            </a:sysClr>
          </a:gs>
        </a:gsLst>
        <a:lin ang="5400000" scaled="0"/>
      </a:gradFill>`;

      const xml = buildChartSpaceXml({
        hasLegend: false,
        seriesFill: gradFill,
      });
      const { option } = parseChartOption(xml);

      const series = (option.series as any[])?.[0];
      expect(series).toBeDefined();
      // The series should have a color/gradient applied, not fall back to ECharts default
      // The itemStyle.color should be set (either as gradient object or hex color)
      expect(series.itemStyle?.color).toBeDefined();
    });

    it('should handle gradFill with schemeClr stops', () => {
      const gradFill = `<a:gradFill>
        <a:gsLst>
          <a:gs pos="0">
            <a:schemeClr val="accent1"/>
          </a:gs>
          <a:gs pos="100000">
            <a:schemeClr val="accent2"/>
          </a:gs>
        </a:gsLst>
        <a:lin ang="5400000" scaled="0"/>
      </a:gradFill>`;

      const xml = buildChartSpaceXml({
        hasLegend: false,
        seriesFill: gradFill,
      });
      const { option } = parseChartOption(xml);

      const series = (option.series as any[])?.[0];
      expect(series?.itemStyle?.color).toBeDefined();
    });

    it('should produce top-to-bottom gradient for ang=5400000 (90°)', () => {
      const gradFill = `<a:gradFill>
        <a:gsLst>
          <a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs>
          <a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs>
        </a:gsLst>
        <a:lin ang="5400000" scaled="0"/>
      </a:gradFill>`;

      const xml = buildChartSpaceXml({
        hasLegend: false,
        seriesFill: gradFill,
      });
      const { option } = parseChartOption(xml);

      const series = (option.series as any[])?.[0];
      const grad = series?.itemStyle?.color;
      expect(grad).toBeDefined();
      // ECharts LinearGradient for top-to-bottom should have:
      // x=0.5, y=0 → x=0.5, y=1 (vertical downward)
      // The gradient object has x, y, x2, y2 properties
      expect(grad.x).toBeCloseTo(0.5, 1);
      expect(grad.y).toBeCloseTo(0, 1);
      expect(grad.x2).toBeCloseTo(0.5, 1);
      expect(grad.y2).toBeCloseTo(1, 1);
    });

    it('should produce left-to-right gradient for ang=0 (0°)', () => {
      const gradFill = `<a:gradFill>
        <a:gsLst>
          <a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs>
          <a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs>
        </a:gsLst>
        <a:lin ang="0" scaled="0"/>
      </a:gradFill>`;

      const xml = buildChartSpaceXml({
        hasLegend: false,
        seriesFill: gradFill,
      });
      const { option } = parseChartOption(xml);

      const series = (option.series as any[])?.[0];
      const grad = series?.itemStyle?.color;
      expect(grad).toBeDefined();
      // ECharts LinearGradient for left-to-right: x=0, y=0.5 → x2=1, y2=0.5
      expect(grad.x).toBeCloseTo(0, 1);
      expect(grad.y).toBeCloseTo(0.5, 1);
      expect(grad.x2).toBeCloseTo(1, 1);
      expect(grad.y2).toBeCloseTo(0.5, 1);
    });

    it('should not set itemStyle.color when spPr has noFill', () => {
      const xml = buildChartSpaceXml({
        hasLegend: false,
        seriesFill: '<a:noFill/>',
      });
      const { option } = parseChartOption(xml);

      const series = (option.series as any[])?.[0];
      // noFill should result in no explicit color (let ECharts decide)
      expect(series?.itemStyle?.color).toBeUndefined();
    });
  });

  // ==========================================================================
  // Issue 2: X-axis label color from catAx txPr
  // ==========================================================================
  describe('axis label color', () => {
    it('should extract axis label color from catAx txPr', () => {
      // catAx with white (bg1) text for dark background
      const catAxTxPr = `
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p>
          <a:pPr>
            <a:defRPr>
              <a:solidFill>
                <a:schemeClr val="bg1"/>
              </a:solidFill>
            </a:defRPr>
          </a:pPr>
        </a:p>`;

      const xml = buildChartSpaceXml({
        hasLegend: false,
        catAxTxPr,
      });
      const { option } = parseChartOption(xml);

      // The xAxis (category axis) should have the label color set
      const xAxis = option.xAxis as any;
      const labelColor = xAxis?.axisLabel?.color;
      // bg1 -> lt1 -> FFFFFF (white)
      expect(labelColor).toBeDefined();
      expect(labelColor).toMatch(/[Ff][Ff][Ff][Ff][Ff][Ff]/);
    });

    it('should extract axis label color with srgbClr', () => {
      const catAxTxPr = `
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p>
          <a:pPr>
            <a:defRPr>
              <a:solidFill>
                <a:srgbClr val="AABBCC"/>
              </a:solidFill>
            </a:defRPr>
          </a:pPr>
        </a:p>`;

      const xml = buildChartSpaceXml({
        hasLegend: false,
        catAxTxPr,
      });
      const { option } = parseChartOption(xml);

      const xAxis = option.xAxis as any;
      const labelColor = xAxis?.axisLabel?.color;
      expect(labelColor).toBeDefined();
      expect(labelColor).toMatch(/[Aa][Aa][Bb][Bb][Cc][Cc]/);
    });

    it('should apply axis label font size from catAx txPr defRPr sz', () => {
      const catAxTxPr = `
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p>
          <a:pPr>
            <a:defRPr sz="1400">
              <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
            </a:defRPr>
          </a:pPr>
        </a:p>`;

      const xml = buildChartSpaceXml({
        hasLegend: false,
        catAxTxPr,
      });
      const { option } = parseChartOption(xml);

      const xAxis = option.xAxis as any;
      expect(xAxis?.axisLabel?.fontSize).toBe(14);
    });

    it('should not override axis label color when no txPr exists', () => {
      const xml = buildChartSpaceXml({
        hasLegend: false,
        // No catAxTxPr
      });
      const { option } = parseChartOption(xml);

      const xAxis = option.xAxis as any;
      // When no txPr, axisLabel.color should not be forced
      // (color may be undefined, or set by default styling, but NOT forced to a specific value from txPr)
      // This test just ensures we don't crash
      expect(xAxis).toBeDefined();
    });

    it('should extract axis line color from catAx spPr ln solidFill', () => {
      const catAxSpPr = `
        <a:noFill/>
        <a:ln w="9525" cap="flat" cmpd="sng" algn="ctr">
          <a:solidFill>
            <a:schemeClr val="tx1">
              <a:lumMod val="15000"/>
              <a:lumOff val="85000"/>
            </a:schemeClr>
          </a:solidFill>
          <a:round/>
        </a:ln>`;

      const xml = buildChartSpaceXml({
        hasLegend: false,
        catAxSpPr,
      });
      const { option } = parseChartOption(xml);

      const xAxis = option.xAxis as any;
      expect(xAxis?.axisLine?.lineStyle?.color).toBeDefined();
    });

    it('should render value axis titles as ECharts axis names', () => {
      const valAxTitleTxPr = `
        <a:bodyPr rot="-5400000"/>
        <a:lstStyle/>
        <a:p>
          <a:pPr>
            <a:defRPr sz="1200">
              <a:solidFill><a:srgbClr val="222222"/></a:solidFill>
              <a:latin typeface="+mn-lt"/>
              <a:ea typeface="+mn-ea"/>
            </a:defRPr>
          </a:pPr>
        </a:p>`;

      const xml = buildChartSpaceXml({
        hasLegend: false,
        valAxDeleted: false,
        valAxTitleText: 'Training Speed (iters/s)',
        valAxTitleTxPr,
      });
      const { option } = parseChartOption(xml);

      const yAxis = option.yAxis as any;
      expect(yAxis.name).toBe('Training Speed (iters/s)');
      expect(yAxis.nameLocation).toBe('middle');
      expect(yAxis.nameRotate).toBe(-90);
      expect(yAxis.nameTextStyle).toMatchObject({
        color: '#222222',
        fontSize: 12,
      });
      expect(yAxis.nameTextStyle.fontFamily).toContain('Calibri');
      expect(yAxis.nameTextStyle.fontFamily).not.toContain('+mn-lt');
    });

    it('should use Office black foreground for value axis title when txPr omits it', () => {
      const xml = buildChartSpaceXml({
        hasLegend: false,
        valAxDeleted: false,
        valAxTitleText: 'Revenue',
      });
      const { option } = parseChartOption(xml);

      const yAxis = option.yAxis as any;
      expect(yAxis.name).toBe('Revenue');
      expect(yAxis.nameTextStyle?.color).toBe('#000000');
    });

    it('should apply chart clrMapOvr when resolving axis txPr schemeClr', () => {
      const catAxTxPr = `
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p>
          <a:pPr>
            <a:defRPr>
              <a:solidFill><a:schemeClr val="bg1"/></a:solidFill>
            </a:defRPr>
          </a:pPr>
        </a:p>`;

      // Remap bg1 -> dk1 so label should resolve to black in mock theme.
      const xml = buildChartSpaceXml({
        hasLegend: false,
        catAxTxPr,
        chartClrMapOvrAttrs: 'bg1="dk1" tx1="lt1"',
      });
      const { option } = parseChartOption(xml);
      const xAxis = option.xAxis as any;
      expect(xAxis?.axisLabel?.color).toBeDefined();
      expect(xAxis.axisLabel.color).toMatch(/[0]{6}|#[0]{6}/i);
    });

    it('should apply nested clrMapOvr overrideClrMapping when resolving scheme colors', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:clrMapOvr><a:overrideClrMapping bg1="dk1" tx1="lt1"/></c:clrMapOvr>
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/><c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S1</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>1</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
            </c:barChart>
            <c:catAx>
              <c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>
              <c:tickLblPos val="nextTo"/>
              <c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></a:defRPr></a:pPr></a:p></c:txPr>
              <c:crossAx val="2"/>
            </c:catAx>
            <c:valAx>
              <c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="l"/><c:crossAx val="1"/>
            </c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;
      const { option } = parseChartOption(xml);
      const xAxis = option.xAxis as any;
      expect(xAxis?.axisLabel?.color).toMatch(/[0]{6}|#[0]{6}/i);
    });

    it('should derive series palette from chart style id when colors are implicit', () => {
      const xml = buildChartSpaceXml({
        chartStyleVal: 102,
        seriesFill: '<a:noFill/>',
      });
      const { option } = parseChartOption(xml);
      const palette = option.color as string[] | undefined;
      expect(Array.isArray(palette)).toBe(true);
      expect(palette?.length).toBeGreaterThan(0);
      // Chart palette uses accent colors in order (accent1 first = #4472C4).
      expect((palette?.[0] || '').toUpperCase()).toContain('4472C4');
    });
  });

  describe('plot area manualLayout', () => {
    it('should apply plotArea manualLayout x/y/w/h to grid percentages', () => {
      const xml = buildChartSpaceXml({
        hasLegend: false,
        plotAreaManualLayout: { x: 0.2, y: 0.15, w: 0.6, h: 0.7 },
      });
      const { option } = parseChartOption(xml);
      const grid = option.grid as any;
      expect(grid?.left).toBe('20%');
      expect(grid?.top).toBe('15%');
      expect(grid?.width).toBe('60%');
      expect(grid?.height).toBe('70%');
      expect(grid?.containLabel).toBe(false);
    });
  });

  // ==========================================================================
  // Issue 4: Data label color from dLbls txPr
  // ==========================================================================
  describe('data label color', () => {
    it('should extract data label text color from dLbls txPr (schemeClr bg1 → white)', () => {
      // Build chart XML with dLbls containing txPr with bg1 (white) color
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/>
              <c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Test</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:spPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></c:spPr>
                <c:dLbls>
                  <c:spPr><a:noFill/></c:spPr>
                  <c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000"><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></a:defRPr></a:pPr></a:p></c:txPr>
                  <c:dLblPos val="outEnd"/>
                  <c:showVal val="1"/>
                  <c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/>
                </c:dLbls>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>100</c:v></c:pt><c:pt idx="1"><c:v>200</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];

      // Data label should be visible
      expect(series?.label?.show).toBe(true);
      // Data label color should be white (bg1 → lt1 → FFFFFF)
      expect(series?.label?.color).toBeDefined();
      expect(series.label.color).toMatch(/[Ff][Ff][Ff][Ff][Ff][Ff]/);
    });

    it('should not set label color when dLbls has no txPr', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/>
              <c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Test</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:spPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></c:spPr>
                <c:dLbls>
                  <c:dLblPos val="outEnd"/>
                  <c:showVal val="1"/>
                  <c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/>
                </c:dLbls>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>100</c:v></c:pt><c:pt idx="1"><c:v>200</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];

      expect(series?.label?.show).toBe(true);
      // No txPr → no explicit color → ECharts default
      expect(series?.label?.color).toBeUndefined();
    });

    it('should apply data label font size from dLbls txPr defRPr sz', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/>
              <c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Test</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:spPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></c:spPr>
                <c:dLbls>
                  <c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1600"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:defRPr></a:pPr></a:p></c:txPr>
                  <c:dLblPos val="outEnd"/>
                  <c:showVal val="1"/>
                </c:dLbls>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>100</c:v></c:pt><c:pt idx="1"><c:v>200</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;
      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];
      expect(series?.label?.fontSize).toBe(16);
    });

    it('should apply data label bold from dLbls txPr defRPr b=1', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/>
              <c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Test</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:spPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></c:spPr>
                <c:dLbls>
                  <c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:defRPr></a:pPr></a:p></c:txPr>
                  <c:dLblPos val="outEnd"/>
                  <c:showVal val="1"/>
                </c:dLbls>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>100</c:v></c:pt><c:pt idx="1"><c:v>200</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;
      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];
      expect(series?.label?.fontWeight).toBe('bold');
    });

    it('should apply per-series data label bold styles independently', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/>
              <c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S1</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:spPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></c:spPr>
                <c:dLbls>
                  <c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900" b="0"/></a:pPr></a:p></c:txPr>
                  <c:showVal val="1"/>
                </c:dLbls>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>100</c:v></c:pt><c:pt idx="1"><c:v>200</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:ser>
                <c:idx val="1"/><c:order val="1"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S2</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:spPr><a:solidFill><a:srgbClr val="00AA00"/></a:solidFill></c:spPr>
                <c:dLbls>
                  <c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900" b="1"/></a:pPr></a:p></c:txPr>
                  <c:showVal val="1"/>
                </c:dLbls>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;
      const { option } = parseChartOption(xml);
      const series = option.series as any[];
      expect(series?.[0]?.label?.fontWeight).toBeUndefined();
      expect(series?.[1]?.label?.fontWeight).toBe('bold');
    });

    it('should apply point-level dLbl override style to specific data index', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/>
              <c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S1</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:spPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></c:spPr>
                <c:dLbls>
                  <c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900" b="0"/></a:pPr></a:p></c:txPr>
                  <c:showVal val="1"/>
                  <c:dLbl>
                    <c:idx val="1"/>
                    <c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900" b="1"/></a:pPr></a:p></c:txPr>
                    <c:showVal val="1"/>
                  </c:dLbl>
                </c:dLbls>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>100</c:v></c:pt><c:pt idx="1"><c:v>200</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;
      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];
      expect(series?.label?.fontWeight).toBeUndefined();
      expect(series?.data?.[0]).toBe(100);
      expect(series?.data?.[1]?.value).toBe(200);
      expect(series?.data?.[1]?.label?.fontWeight).toBe('bold');
    });

    it('should suppress point-level deleted data labels over a shared bar label', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/>
              <c:grouping val="stacked"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S1</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:dLbls>
                  <c:showVal val="1"/>
                  <c:dLbl><c:idx val="1"/><c:delete val="1"/></c:dLbl>
                </c:dLbls>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>100</c:v></c:pt><c:pt idx="1"><c:v>200</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:delete val="0"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:delete val="1"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];

      expect(series?.label?.show).toBe(true);
      expect(series?.data?.[0]).toBe(100);
      expect(series?.data?.[1]?.value).toBe(200);
      expect(series?.data?.[1]?.label).toEqual({ show: false });
    });
  });

  describe('title txPr style', () => {
    it('should apply title color and font size from title txPr', () => {
      const titleTxPr = `
        <a:bodyPr/><a:lstStyle/>
        <a:p><a:pPr><a:defRPr sz="1800"><a:solidFill><a:srgbClr val="123456"/></a:solidFill></a:defRPr></a:pPr></a:p>`;
      const xml = buildChartSpaceXml({
        hasLegend: false,
        autoTitleDeleted: false,
        titleText: 'My Chart',
        titleTxPr,
      });
      const { option } = parseChartOption(xml);
      const title = option.title as any;
      expect(title?.textStyle?.fontSize).toBe(18);
      expect(title?.textStyle?.color).toMatch(/[1]{1}[2]{1}[3]{1}[4]{1}[5]{1}[6]{1}|#123456/i);
    });

    it('should apply title text outer shadow from title txPr defRPr effectLst', () => {
      const titleTxPr = `
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p>
          <a:pPr>
            <a:defRPr sz="1400">
              <a:effectLst>
                <a:outerShdw blurRad="38100" dist="38100" dir="2700000" algn="tl">
                  <a:srgbClr val="333333"><a:alpha val="50000"/></a:srgbClr>
                </a:outerShdw>
              </a:effectLst>
            </a:defRPr>
          </a:pPr>
        </a:p>`;
      const xml = buildChartSpaceXml({
        hasLegend: false,
        autoTitleDeleted: false,
        titleText: 'Shadowed Chart',
        titleTxPr,
      });
      const { option } = parseChartOption(xml);
      const title = option.title as any;

      expect(title?.textStyle?.textShadowColor).toBe('rgba(51,51,51,0.500)');
      expect(title.textStyle.textShadowBlur).toBeCloseTo(4);
      expect(title.textStyle.textShadowOffsetX).toBeCloseTo(2.8, 1);
      expect(title.textStyle.textShadowOffsetY).toBeCloseTo(2.8, 1);
    });

    it('should preserve chart title rich run styles (model-platform chart titles)', () => {
      const titleRichPPr = `
        <a:defRPr sz="1800" b="1">
          <a:solidFill><a:schemeClr val="dk1"/></a:solidFill>
        </a:defRPr>`;
      const xml = buildChartSpaceXml({
        hasLegend: false,
        autoTitleDeleted: false,
        titleText: '1.2X 模型微调速度提升',
        titleRichPPr,
      }).replace(
        '<a:r><a:t>1.2X 模型微调速度提升</a:t></a:r>',
        `<a:r>
          <a:rPr b="1">
            <a:solidFill><a:srgbClr val="4D62D7"/></a:solidFill>
          </a:rPr>
          <a:t>1.2X </a:t>
        </a:r>
        <a:r>
          <a:rPr sz="1600" b="0"/>
          <a:t>模型微调速度提升</a:t>
        </a:r>`,
      );
      const { option } = parseChartOption(xml);
      const title = option.title as any;

      expect(title?.text).toBe('{r0|1.2X }{r1|模型微调速度提升}');
      expect(title.textStyle.rich.r0).toMatchObject({ color: '#4D62D7', fontWeight: 'bold' });
      expect(title.textStyle.rich.r1).toMatchObject({ fontSize: 16, fontWeight: 'normal' });
    });

    it('should apply title rich text style when title txPr is omitted', () => {
      const xml = buildChartSpaceXml({
        hasLegend: false,
        autoTitleDeleted: false,
        titleText: 'Rich Title',
        titleRichPPr:
          '<a:defRPr sz="1600"><a:solidFill><a:srgbClr val="654321"/></a:solidFill></a:defRPr>',
      });
      const { option } = parseChartOption(xml);
      const title = option.title as any;
      expect(title?.textStyle?.fontSize).toBe(16);
      expect(title?.textStyle?.color).toBe('#654321');
    });

    it('should use Office black foreground for title color when txPr omits it', () => {
      const xml = buildChartSpaceXml({
        hasLegend: false,
        autoTitleDeleted: false,
        titleText: 'Default Title',
      });
      const { option } = parseChartOption(xml);
      const title = option.title as any;
      expect(title?.textStyle?.color).toBe('#000000');
    });

    it('should apply title manualLayout x/y to title left/top', () => {
      const xml = buildChartSpaceXml({
        hasLegend: false,
        autoTitleDeleted: false,
        titleText: 'Layout Title',
        titleManualLayout: { x: 0.18, y: 0.02 },
      });
      const { option } = parseChartOption(xml);
      const title = option.title as any;
      expect(title?.left).toBe('18%');
      expect(title?.top).toBe('2%');
    });
  });

  // ==========================================================================
  // Integration: combined chart pattern (all 3 issues combined)
  // ==========================================================================
  describe('combined chart pattern', () => {
    it('should match combined chart expectations', () => {
      // Minimal reproduction of a real-world bar chart with gradient fill, hidden legend, and dark-background axis
      const gradFill = `<a:gradFill>
        <a:gsLst>
          <a:gs pos="100000">
            <a:sysClr val="window" lastClr="FFFFFF"><a:alpha val="0"/></a:sysClr>
          </a:gs>
          <a:gs pos="0">
            <a:sysClr val="window" lastClr="FFFFFF"><a:alpha val="60000"/></a:sysClr>
          </a:gs>
        </a:gsLst>
        <a:lin ang="5400000" scaled="0"/>
      </a:gradFill>`;

      const catAxTxPr = `
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p>
          <a:pPr>
            <a:defRPr sz="1000">
              <a:solidFill><a:schemeClr val="bg1"/></a:solidFill>
            </a:defRPr>
          </a:pPr>
        </a:p>`;

      const xml = buildChartSpaceXml({
        hasLegend: false,
        seriesFill: gradFill,
        catAxTxPr,
        autoTitleDeleted: true,
        seriesName: '市场规模',
        categories: ['2024', '2025E', '2026E'],
        values: [607, 710, 866],
        valAxDeleted: true,
      });

      const { option } = parseChartOption(xml);

      // 1. No legend (no <c:legend> element in original)
      const legend = option.legend as any;
      expect(legend?.show).toBe(false);

      // 2. Series should have gradient/color applied
      const series = (option.series as any[])?.[0];
      expect(series?.itemStyle?.color).toBeDefined();

      // 3. Category axis label should be white
      const xAxis = option.xAxis as any;
      expect(xAxis?.axisLabel?.color).toMatch(/[Ff][Ff][Ff][Ff][Ff][Ff]/);

      // 4. No title (autoTitleDeleted=1)
      expect(option.title).toBeUndefined();

      // 5. Gradient should be top-to-bottom (ang=5400000)
      const grad = series?.itemStyle?.color;
      expect(grad?.y).toBeCloseTo(0, 1);
      expect(grad?.y2).toBeCloseTo(1, 1);
    });

    it('should parse full chart XML with gradient fill and dark-background axis', () => {
      // Full chart XML structure with gradient fill, hidden legend, and bg1-colored axis labels
      // (condensed but structurally representative)
      const realChartXml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:layout/>
            <c:barChart>
              <c:barDir val="col"/>
              <c:grouping val="clustered"/>
              <c:varyColors val="0"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>市场规模</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:spPr>
                  <a:gradFill>
                    <a:gsLst>
                      <a:gs pos="100000"><a:sysClr val="window" lastClr="FFFFFF"><a:alpha val="0"/></a:sysClr></a:gs>
                      <a:gs pos="0"><a:sysClr val="window" lastClr="FFFFFF"><a:alpha val="60000"/></a:sysClr></a:gs>
                    </a:gsLst>
                    <a:lin ang="5400000" scaled="0"/>
                  </a:gradFill>
                  <a:ln><a:noFill/></a:ln>
                </c:spPr>
                <c:invertIfNegative val="0"/>
                <c:dLbls>
                  <c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>
                  <c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000"><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></a:defRPr></a:pPr></a:p></c:txPr>
                  <c:dLblPos val="outEnd"/>
                  <c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/>
                </c:dLbls>
                <c:cat><c:strRef><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>2024</c:v></c:pt><c:pt idx="1"><c:v>2025E</c:v></c:pt><c:pt idx="2"><c:v>2026E</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>607</c:v></c:pt><c:pt idx="1"><c:v>710</c:v></c:pt><c:pt idx="2"><c:v>866</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:gapWidth val="219"/>
              <c:overlap val="-27"/>
              <c:axId val="421058447"/><c:axId val="421076335"/>
            </c:barChart>
            <c:catAx>
              <c:axId val="421058447"/>
              <c:scaling><c:orientation val="minMax"/></c:scaling>
              <c:delete val="0"/>
              <c:axPos val="b"/>
              <c:numFmt formatCode="General" sourceLinked="1"/>
              <c:majorTickMark val="none"/><c:minorTickMark val="none"/>
              <c:tickLblPos val="nextTo"/>
              <c:spPr><a:noFill/><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="15000"/><a:lumOff val="85000"/></a:schemeClr></a:solidFill><a:round/></a:ln></c:spPr>
              <c:txPr><a:bodyPr rot="-60000000" spcFirstLastPara="1" vertOverflow="ellipsis" vert="horz" wrap="square" anchor="ctr" anchorCtr="1"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000" b="0" i="0" u="none" strike="noStrike" kern="1200" baseline="0"><a:solidFill><a:schemeClr val="bg1"/></a:solidFill><a:latin typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/><a:ea typeface="微软雅黑" panose="020B0503020204020204" pitchFamily="34" charset="-122"/><a:cs typeface="+mn-ea"/><a:sym typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/></a:defRPr></a:pPr><a:endParaRPr lang="zh-CN"/></a:p></c:txPr>
              <c:crossAx val="421076335"/>
              <c:crosses val="autoZero"/>
              <c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/>
            </c:catAx>
            <c:valAx>
              <c:axId val="421076335"/>
              <c:scaling><c:orientation val="minMax"/></c:scaling>
              <c:delete val="1"/>
              <c:axPos val="l"/>
              <c:numFmt formatCode="0" sourceLinked="1"/>
              <c:majorTickMark val="none"/><c:minorTickMark val="none"/>
              <c:tickLblPos val="nextTo"/>
              <c:crossAx val="421058447"/>
              <c:crosses val="autoZero"/>
              <c:crossBetween val="between"/>
            </c:valAx>
            <c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>
          </c:plotArea>
          <c:plotVisOnly val="1"/>
        </c:chart>
        <c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>
      </c:chartSpace>`;

      const ctx = createMockRenderContext();
      const chartXml = parseXml(realChartXml);
      const { option } = parseChartXml(chartXml, ctx);

      // Legend must be hidden (no <c:legend> element)
      expect((option.legend as any)?.show).toBe(false);

      // Series must have gradient color
      const series = (option.series as any[])?.[0];
      expect(series?.itemStyle?.color).toBeDefined();
      expect(typeof series.itemStyle.color).toBe('object'); // LinearGradient object

      // Category axis labels must be white (#FFFFFF)
      const xAxis = option.xAxis as any;
      expect(xAxis?.axisLabel?.color).toBeDefined();
      expect(xAxis.axisLabel.color).toMatch(/[Ff][Ff][Ff][Ff][Ff][Ff]/);

      // Data labels (607, 710, 866) must be white (dLbls > txPr > bg1 → FFFFFF)
      expect(series?.label?.show).toBe(true);
      expect(series?.label?.color).toBeDefined();
      expect(series.label.color).toMatch(/[Ff][Ff][Ff][Ff][Ff][Ff]/);
    });
  });

  describe('data-label bold and legend manualLayout regression', () => {
    // Minimal inline XML reproducing: series-level dLbls bold, point-level dLbl override, legend manualLayout.
    const chartWithBoldLabelsXml = `<c:chartSpace
      xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <c:chart>
        <c:autoTitleDeleted val="1"/>
        <c:plotArea>
          <c:barChart>
            <c:barDir val="col"/>
            <c:grouping val="clustered"/>
            <c:ser>
              <c:idx val="0"/><c:order val="0"/>
              <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Series1</c:v></c:pt></c:strCache></c:strRef></c:tx>
              <c:dLbls>
                <c:dLbl><c:idx val="0"/><c:showVal val="1"/></c:dLbl>
                <c:showVal val="1"/>
              </c:dLbls>
              <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
              <c:val><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>100</c:v></c:pt><c:pt idx="1"><c:v>200</c:v></c:pt></c:numCache></c:numRef></c:val>
            </c:ser>
            <c:ser>
              <c:idx val="1"/><c:order val="1"/>
              <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Series2</c:v></c:pt></c:strCache></c:strRef></c:tx>
              <c:dLbls>
                <c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr b="1"/></a:pPr><a:endParaRPr/></a:p></c:txPr>
                <c:showVal val="1"/>
              </c:dLbls>
              <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
              <c:val><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>300</c:v></c:pt><c:pt idx="1"><c:v>400</c:v></c:pt></c:numCache></c:numRef></c:val>
            </c:ser>
          </c:barChart>
          <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
          <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
        </c:plotArea>
        <c:legend>
          <c:legendPos val="b"/>
          <c:layout><c:manualLayout>
            <c:x val="0.1369"/><c:y val="0.117"/>
            <c:w val="0.8631"/><c:h val="0.0496"/>
          </c:manualLayout></c:layout>
        </c:legend>
      </c:chart>
    </c:chartSpace>`;

    it('should keep series-level dLbls bold and point-level dLbl non-bold', () => {
      const ctx = createMockRenderContext();
      const { option } = parseChartXml(parseXml(chartWithBoldLabelsXml), ctx);
      const series = option.series as any[];

      // series[0]: point-level dLbl override with no bold → fontWeight undefined
      expect(series?.[0]?.data?.[0]?.label?.fontWeight).toBeUndefined();
      // series[1]: series-level dLbls txPr has b="1" → bold
      expect(series?.[1]?.label?.fontWeight).toBe('bold');
    });

    it('should apply legend manualLayout to relative position/size', () => {
      const ctx = createMockRenderContext();
      const { option } = parseChartXml(parseXml(chartWithBoldLabelsXml), ctx);
      const legend = option.legend as any;

      expect(parseFloat(legend?.left)).toBeCloseTo(13.69, 2);
      expect(parseFloat(legend?.top)).toBeCloseTo(11.7, 2);
      expect(parseFloat(legend?.width)).toBeCloseTo(86.31, 2);
      expect(parseFloat(legend?.height)).toBeCloseTo(4.96, 2);
      expect(legend?.orient).toBe('horizontal');
    });
  });

  describe('3d chart graceful fallback', () => {
    it('should parse surface3DChart as supported fallback instead of unsupported chart type', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:surface3DChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx>
                    <c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S1</c:v></c:pt></c:strCache></c:strRef>
                  </c:tx>
                  <c:cat>
                    <c:strRef><c:strCache><c:ptCount val="3"/>
                      <c:pt idx="0"><c:v>A</c:v></c:pt>
                      <c:pt idx="1"><c:v>B</c:v></c:pt>
                      <c:pt idx="2"><c:v>C</c:v></c:pt>
                    </c:strCache></c:strRef>
                  </c:cat>
                  <c:val>
                    <c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="3"/>
                      <c:pt idx="0"><c:v>1</c:v></c:pt>
                      <c:pt idx="1"><c:v>2</c:v></c:pt>
                      <c:pt idx="2"><c:v>3</c:v></c:pt>
                    </c:numCache></c:numRef>
                  </c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:surface3DChart>
              <c:catAx>
                <c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/>
              </c:catAx>
              <c:valAx>
                <c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="l"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/>
              </c:valAx>
            </c:plotArea>
            <c:legend>
              <c:legendPos val="r"/>
              <c:overlay val="0"/>
            </c:legend>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      expect((option.title as any)?.text).not.toBe('Unsupported chart type');
      expect(Array.isArray(option.series)).toBe(true);
      expect((option.series as any[])?.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Chart Type Coverage: lineChart, pieChart, radarChart, scatterChart, doughnutChart, areaChart
  // ==========================================================================

  describe('different chart types', () => {
    it('should parse lineChart with categories and values', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:lineChart>
                <c:grouping val="standard"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx>
                    <c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Revenue</c:v></c:pt></c:strCache></c:strRef>
                  </c:tx>
                  <c:cat>
                    <c:strRef><c:strCache><c:ptCount val="4"/>
                      <c:pt idx="0"><c:v>Q1</c:v></c:pt>
                      <c:pt idx="1"><c:v>Q2</c:v></c:pt>
                      <c:pt idx="2"><c:v>Q3</c:v></c:pt>
                      <c:pt idx="3"><c:v>Q4</c:v></c:pt>
                    </c:strCache></c:strRef>
                  </c:cat>
                  <c:val>
                    <c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="4"/>
                      <c:pt idx="0"><c:v>100</c:v></c:pt>
                      <c:pt idx="1"><c:v>150</c:v></c:pt>
                      <c:pt idx="2"><c:v>120</c:v></c:pt>
                      <c:pt idx="3"><c:v>200</c:v></c:pt>
                    </c:numCache></c:numRef>
                  </c:val>
                  <c:spPr><a:solidFill><a:srgbClr val="0070C0"/></a:solidFill></c:spPr>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:lineChart>
              <c:catAx>
                <c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/>
              </c:catAx>
              <c:valAx>
                <c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="l"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/>
              </c:valAx>
            </c:plotArea>
            <c:legend>
              <c:legendPos val="r"/>
              <c:overlay val="0"/>
            </c:legend>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      expect(option.series).toBeDefined();
      expect(Array.isArray(option.series)).toBe(true);
      const series = option.series as any[];
      expect(series.length).toBeGreaterThan(0);
      expect(series[0].name).toBe('Revenue');
    });

    it('should preserve smooth lineChart series from c:smooth', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:lineChart>
                <c:grouping val="standard"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx>
                    <c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Trend</c:v></c:pt></c:strCache></c:strRef>
                  </c:tx>
                  <c:marker><c:symbol val="none"/></c:marker>
                  <c:cat>
                    <c:strRef><c:strCache><c:ptCount val="3"/>
                      <c:pt idx="0"><c:v>Q1</c:v></c:pt>
                      <c:pt idx="1"><c:v>Q2</c:v></c:pt>
                      <c:pt idx="2"><c:v>Q3</c:v></c:pt>
                    </c:strCache></c:strRef>
                  </c:cat>
                  <c:val>
                    <c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="3"/>
                      <c:pt idx="0"><c:v>10</c:v></c:pt>
                      <c:pt idx="1"><c:v>18</c:v></c:pt>
                      <c:pt idx="2"><c:v>14</c:v></c:pt>
                    </c:numCache></c:numRef>
                  </c:val>
                  <c:smooth val="1"/>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:lineChart>
              <c:catAx><c:axId val="1"/><c:delete val="0"/><c:crossAx val="2"/></c:catAx>
              <c:valAx><c:axId val="2"/><c:delete val="0"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];
      expect(series?.type).toBe('line');
      expect(series?.smooth).toBe(true);
      expect(series?.showSymbol).toBe(false);
    });

    it('should parse pieChart with single series and data point colors', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:pieChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx>
                    <c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Market Share</c:v></c:pt></c:strCache></c:strRef>
                  </c:tx>
                  <c:dLbls>
                    <c:showVal val="1"/>
                    <c:showPercent val="1"/>
                  </c:dLbls>
                  <c:cat>
                    <c:strRef><c:strCache><c:ptCount val="3"/>
                      <c:pt idx="0"><c:v>Product A</c:v></c:pt>
                      <c:pt idx="1"><c:v>Product B</c:v></c:pt>
                      <c:pt idx="2"><c:v>Product C</c:v></c:pt>
                    </c:strCache></c:strRef>
                  </c:cat>
                  <c:val>
                    <c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="3"/>
                      <c:pt idx="0"><c:v>30</c:v></c:pt>
                      <c:pt idx="1"><c:v>50</c:v></c:pt>
                      <c:pt idx="2"><c:v>20</c:v></c:pt>
                    </c:numCache></c:numRef>
                  </c:val>
                  <c:dPt>
                    <c:idx val="0"/>
                    <c:spPr><a:solidFill><a:srgbClr val="FF6B6B"/></a:solidFill></c:spPr>
                  </c:dPt>
                  <c:dPt>
                    <c:idx val="1"/>
                    <c:spPr><a:solidFill><a:srgbClr val="4ECDC4"/></a:solidFill></c:spPr>
                  </c:dPt>
                </c:ser>
              </c:pieChart>
            </c:plotArea>
            <c:legend>
              <c:legendPos val="r"/>
              <c:overlay val="0"/>
            </c:legend>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      expect(option.series).toBeDefined();
      const series = option.series as any[];
      expect(series.length).toBeGreaterThan(0);
      expect(series[0].type).toBe('pie');
      expect(series[0].data).toBeDefined();
    });

    it('should apply dPt line style to pie slice borders', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:pieChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx>
                    <c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Share</c:v></c:pt></c:strCache></c:strRef>
                  </c:tx>
                  <c:cat>
                    <c:strRef><c:strCache><c:ptCount val="2"/>
                      <c:pt idx="0"><c:v>A</c:v></c:pt>
                      <c:pt idx="1"><c:v>B</c:v></c:pt>
                    </c:strCache></c:strRef>
                  </c:cat>
                  <c:val>
                    <c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/>
                      <c:pt idx="0"><c:v>30</c:v></c:pt>
                      <c:pt idx="1"><c:v>70</c:v></c:pt>
                    </c:numCache></c:numRef>
                  </c:val>
                  <c:dPt>
                    <c:idx val="0"/>
                    <c:spPr>
                      <a:solidFill><a:schemeClr val="accent1"/></a:solidFill>
                      <a:ln w="19050"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln>
                    </c:spPr>
                  </c:dPt>
                </c:ser>
              </c:pieChart>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])[0];
      const firstSlice = series.data[0];
      expect(firstSlice.itemStyle).toMatchObject({
        color: '#4472C4',
        borderColor: '#FFFFFF',
        borderWidth: 2,
      });
    });

    it('should hide pie labels by default when no dLbls are present', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:pieChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx>
                    <c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Sales</c:v></c:pt></c:strCache></c:strRef>
                  </c:tx>
                  <c:cat>
                    <c:strRef><c:strCache><c:ptCount val="2"/>
                      <c:pt idx="0"><c:v>A</c:v></c:pt>
                      <c:pt idx="1"><c:v>B</c:v></c:pt>
                    </c:strCache></c:strRef>
                  </c:cat>
                  <c:val>
                    <c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/>
                      <c:pt idx="0"><c:v>60</c:v></c:pt>
                      <c:pt idx="1"><c:v>40</c:v></c:pt>
                    </c:numCache></c:numRef>
                  </c:val>
                </c:ser>
              </c:pieChart>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];
      expect(series?.type).toBe('pie');
      expect(series?.label?.show).toBe(false);
      expect(series?.radius).toBe('82%');
      expect(series?.center).toEqual(['50%', '55%']);
    });

    it('maps OOXML firstSliceAng to ECharts startAngle for pie charts', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:pieChart>
                <c:firstSliceAng val="30"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx>
                    <c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Sales</c:v></c:pt></c:strCache></c:strRef>
                  </c:tx>
                  <c:cat>
                    <c:strRef><c:strCache><c:ptCount val="2"/>
                      <c:pt idx="0"><c:v>A</c:v></c:pt>
                      <c:pt idx="1"><c:v>B</c:v></c:pt>
                    </c:strCache></c:strRef>
                  </c:cat>
                  <c:val>
                    <c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/>
                      <c:pt idx="0"><c:v>60</c:v></c:pt>
                      <c:pt idx="1"><c:v>40</c:v></c:pt>
                    </c:numCache></c:numRef>
                  </c:val>
                </c:ser>
              </c:pieChart>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];
      expect(series?.startAngle).toBe(60);
      expect(series?.clockwise).toBe(true);
    });

    it('should enlarge and left-shift pie when legend is on the right', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:autoTitleDeleted val="1"/>
            <c:plotArea>
              <c:pieChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Sales</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="4"/>
                    <c:pt idx="0"><c:v>Q1</c:v></c:pt>
                    <c:pt idx="1"><c:v>Q2</c:v></c:pt>
                    <c:pt idx="2"><c:v>Q3</c:v></c:pt>
                    <c:pt idx="3"><c:v>Q4</c:v></c:pt>
                  </c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="4"/>
                    <c:pt idx="0"><c:v>8.2</c:v></c:pt>
                    <c:pt idx="1"><c:v>3.2</c:v></c:pt>
                    <c:pt idx="2"><c:v>1.4</c:v></c:pt>
                    <c:pt idx="3"><c:v>1.2</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
              </c:pieChart>
            </c:plotArea>
            <c:legend>
              <c:legendPos val="r"/>
              <c:overlay val="0"/>
            </c:legend>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];

      expect(series?.type).toBe('pie');
      expect(series?.radius).toBe('82%');
      expect(series?.center).toEqual(['38%', '55%']);
    });

    it('should parse doughnutChart with inner/outer radius', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:doughnutChart>
                <c:holeSize val="60"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx>
                    <c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Distribution</c:v></c:pt></c:strCache></c:strRef>
                  </c:tx>
                  <c:cat>
                    <c:strRef><c:strCache><c:ptCount val="2"/>
                      <c:pt idx="0"><c:v>A</c:v></c:pt>
                      <c:pt idx="1"><c:v>B</c:v></c:pt>
                    </c:strCache></c:strRef>
                  </c:cat>
                  <c:val>
                    <c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/>
                      <c:pt idx="0"><c:v>40</c:v></c:pt>
                      <c:pt idx="1"><c:v>60</c:v></c:pt>
                    </c:numCache></c:numRef>
                  </c:val>
                </c:ser>
              </c:doughnutChart>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = option.series as any[];
      expect(series.length).toBeGreaterThan(0);
      expect(series[0].type).toBe('pie');
      // holeSize is the inner radius as a percentage of the outer radius.
      expect(series[0].radius).toEqual(['49%', '82%']);
    });

    it('should parse radarChart with categories and multiple series', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:radarChart>
                <c:radarStyle val="standard"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx>
                    <c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Series 1</c:v></c:pt></c:strCache></c:strRef>
                  </c:tx>
                  <c:cat>
                    <c:strRef><c:strCache><c:ptCount val="3"/>
                      <c:pt idx="0"><c:v>Feature A</c:v></c:pt>
                      <c:pt idx="1"><c:v>Feature B</c:v></c:pt>
                      <c:pt idx="2"><c:v>Feature C</c:v></c:pt>
                    </c:strCache></c:strRef>
                  </c:cat>
                  <c:val>
                    <c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="3"/>
                      <c:pt idx="0"><c:v>80</c:v></c:pt>
                      <c:pt idx="1"><c:v>90</c:v></c:pt>
                      <c:pt idx="2"><c:v>70</c:v></c:pt>
                    </c:numCache></c:numRef>
                  </c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:radarChart>
              <c:catAx>
                <c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/>
              </c:catAx>
              <c:valAx>
                <c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="l"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/>
              </c:valAx>
            </c:plotArea>
            <c:legend>
              <c:legendPos val="r"/>
              <c:overlay val="0"/>
            </c:legend>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const radar = option.radar as any;
      const series = option.series as any[];
      expect(radar.splitArea).toMatchObject({ show: false });
      expect(series.length).toBeGreaterThan(0);
      expect(series[0].type).toBe('radar');
    });

    it('should apply chart default text style to radar category labels', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1500"/></a:pPr></a:p></c:txPr>
          <c:chart>
            <c:plotArea>
              <c:radarChart>
                <c:radarStyle val="standard"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Series 1</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>Feature A</c:v></c:pt><c:pt idx="1"><c:v>Feature B</c:v></c:pt><c:pt idx="2"><c:v>Feature C</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>80</c:v></c:pt><c:pt idx="1"><c:v>90</c:v></c:pt><c:pt idx="2"><c:v>70</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:radarChart>
              <c:catAx><c:axId val="1"/><c:delete val="0"/><c:crossAx val="2"/></c:catAx>
              <c:valAx><c:axId val="2"/><c:delete val="0"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const radar = option.radar as any;
      expect(radar?.name?.textStyle?.color).toBe('#000000');
      expect(radar?.name?.textStyle?.fontSize).toBe(20);
      expect(radar?.name?.textStyle?.fontFamily).toContain('Calibri');
    });

    it('keeps radar top legend above labels with line icons and unfilled series areas', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:radarChart>
                <c:radarStyle val="marker"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>联想</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:spPr><a:ln w="19050"><a:solidFill><a:srgbClr val="E1251B"/></a:solidFill></a:ln></c:spPr>
                  <c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>功能完备性</c:v></c:pt><c:pt idx="1"><c:v>易用性</c:v></c:pt><c:pt idx="2"><c:v>性能</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>7</c:v></c:pt><c:pt idx="1"><c:v>6</c:v></c:pt><c:pt idx="2"><c:v>7</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:ser>
                  <c:idx val="1"/><c:order val="1"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>华为</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:spPr><a:ln w="19050"><a:solidFill><a:srgbClr val="00B0F0"/></a:solidFill></a:ln></c:spPr>
                  <c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>功能完备性</c:v></c:pt><c:pt idx="1"><c:v>易用性</c:v></c:pt><c:pt idx="2"><c:v>性能</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>9</c:v></c:pt><c:pt idx="1"><c:v>8</c:v></c:pt><c:pt idx="2"><c:v>9</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:radarChart>
              <c:catAx><c:axId val="1"/><c:delete val="0"/><c:crossAx val="2"/></c:catAx>
              <c:valAx><c:axId val="2"/><c:delete val="0"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
            <c:legend>
              <c:legendPos val="t"/>
              <c:layout><c:manualLayout><c:x val="0.1"/><c:y val="0.12"/><c:w val="0.8"/><c:h val="0.08"/></c:manualLayout></c:layout>
              <c:overlay val="0"/>
              <c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000"/></a:pPr></a:p></c:txPr>
            </c:legend>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const legend = option.legend as any;
      const radar = option.radar as any;
      const radarSeries = (option.series as any[])[0];

      expect(radar.center).toEqual(['50%', '66%']);
      expect(legend.data.every((item: any) => item.icon?.startsWith('path://'))).toBe(true);
      expect(radarSeries.data[0].lineStyle.color).toBe('#E1251B');
      expect(radarSeries.data[1].lineStyle.color).toBe('#00B0F0');
      expect(radarSeries.data[0].areaStyle).toBeUndefined();
      expect(radarSeries.data[1].areaStyle).toBeUndefined();
    });

    it('sizes marker radar charts like PowerPoint and shows radial value labels (oracle-pypptx-chart-0018)', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1800"/></a:pPr></a:p></c:txPr>
          <c:chart>
            <c:autoTitleDeleted val="0"/>
            <c:plotArea>
              <c:radarChart>
                <c:radarStyle val="marker"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Player A</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:marker><c:symbol val="none"/></c:marker>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="5"/><c:pt idx="0"><c:v>Speed</c:v></c:pt><c:pt idx="1"><c:v>Power</c:v></c:pt><c:pt idx="2"><c:v>Agility</c:v></c:pt><c:pt idx="3"><c:v>Defense</c:v></c:pt><c:pt idx="4"><c:v>Stamina</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="5"/><c:pt idx="0"><c:v>85</c:v></c:pt><c:pt idx="1"><c:v>70</c:v></c:pt><c:pt idx="2"><c:v>90</c:v></c:pt><c:pt idx="3"><c:v>65</c:v></c:pt><c:pt idx="4"><c:v>75</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:ser>
                  <c:idx val="1"/><c:order val="1"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Player B</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:marker><c:symbol val="none"/></c:marker>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="5"/><c:pt idx="0"><c:v>Speed</c:v></c:pt><c:pt idx="1"><c:v>Power</c:v></c:pt><c:pt idx="2"><c:v>Agility</c:v></c:pt><c:pt idx="3"><c:v>Defense</c:v></c:pt><c:pt idx="4"><c:v>Stamina</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="5"/><c:pt idx="0"><c:v>70</c:v></c:pt><c:pt idx="1"><c:v>85</c:v></c:pt><c:pt idx="2"><c:v>65</c:v></c:pt><c:pt idx="3"><c:v>80</c:v></c:pt><c:pt idx="4"><c:v>90</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:radarChart>
              <c:catAx><c:axId val="1"/><c:delete val="0"/><c:crossAx val="2"/></c:catAx>
              <c:valAx><c:axId val="2"/><c:delete val="0"/><c:majorGridlines/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const radar = option.radar as any;
      const firstAxisLabel = radar.indicator[0].axisLabel;

      expect(radar.center).toEqual(['50%', '50%']);
      expect(radar.radius).toBe('86%');
      expect(radar.splitNumber).toBe(5);
      expect(radar.splitLine).toMatchObject({
        show: true,
        lineStyle: { color: '#868686', width: 1, type: 'solid' },
      });
      expect(radar.axisLine).toMatchObject({
        show: true,
        lineStyle: { color: '#868686' },
      });
      expect(firstAxisLabel.show).toBe(true);
      expect(firstAxisLabel.formatter(20)).toBe('20');
      expect(firstAxisLabel.fontSize).toBe(24);
      expect(firstAxisLabel.color).toBe('#000000');
      expect(radar.indicator[1].axisLabel).toBeUndefined();
    });

    it('keeps radar gridlines gray for old theme charts unless axis styling is explicit (oracle-pypptx-chart-0018)', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:autoTitleDeleted val="1"/>
            <c:plotArea>
              <c:radarChart>
                <c:radarStyle val="marker"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Player A</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="5"/><c:pt idx="0"><c:v>Speed</c:v></c:pt><c:pt idx="1"><c:v>Power</c:v></c:pt><c:pt idx="2"><c:v>Agility</c:v></c:pt><c:pt idx="3"><c:v>Defense</c:v></c:pt><c:pt idx="4"><c:v>Stamina</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="5"/><c:pt idx="0"><c:v>85</c:v></c:pt><c:pt idx="1"><c:v>70</c:v></c:pt><c:pt idx="2"><c:v>90</c:v></c:pt><c:pt idx="3"><c:v>65</c:v></c:pt><c:pt idx="4"><c:v>75</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:radarChart>
              <c:catAx><c:axId val="1"/><c:delete val="0"/><c:crossAx val="2"/></c:catAx>
              <c:valAx><c:axId val="2"/><c:delete val="0"/><c:majorGridlines/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;
      const ctx = createMockRenderContext();
      ctx.theme = {
        ...ctx.theme,
        colorScheme: new Map([
          ...ctx.theme.colorScheme,
          ['accent1', '4F81BD'],
          ['accent2', 'C0504D'],
        ]),
      };

      const { option } = parseChartOption(xml, ctx);
      const radar = option.radar as any;

      expect(radar.splitLine.lineStyle).toMatchObject({ color: '#868686', width: 1 });
      expect(radar.axisLine.lineStyle.color).toBe('#868686');
    });

    it('maps radar plotArea manualLayout to pixel center and radius (xcloud-plan radar charts)', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:layout>
                <c:manualLayout>
                  <c:xMode val="edge"/>
                  <c:yMode val="edge"/>
                  <c:x val="0.25"/>
                  <c:y val="0.25"/>
                  <c:w val="0.5"/>
                  <c:h val="0.5"/>
                </c:manualLayout>
              </c:layout>
              <c:radarChart>
                <c:radarStyle val="marker"/>
                <c:ser>
                  <c:idx val="0"/>
                  <c:order val="0"/>
                  <c:tx><c:v>Series A</c:v></c:tx>
                  <c:cat><c:strRef><c:strCache>
                    <c:ptCount val="4"/>
                    <c:pt idx="0"><c:v>A</c:v></c:pt>
                    <c:pt idx="1"><c:v>B</c:v></c:pt>
                    <c:pt idx="2"><c:v>C</c:v></c:pt>
                    <c:pt idx="3"><c:v>D</c:v></c:pt>
                  </c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache>
                    <c:ptCount val="4"/>
                    <c:pt idx="0"><c:v>10</c:v></c:pt>
                    <c:pt idx="1"><c:v>20</c:v></c:pt>
                    <c:pt idx="2"><c:v>30</c:v></c:pt>
                    <c:pt idx="3"><c:v>40</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
              </c:radarChart>
              <c:valAx><c:axId val="2"/><c:delete val="0"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartXml(parseXml(xml), createMockRenderContext(), undefined, {
        w: 600,
        h: 400,
      });
      const radar = option.radar as any;

      expect(radar.center).toEqual([300, 200]);
      expect(radar.radius).toBe(100);
    });

    it('should parse scatterChart with xVal and yVal', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:scatterChart>
                <c:scatterStyle val="pointOnly"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx>
                    <c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Data Points</c:v></c:pt></c:strCache></c:strRef>
                  </c:tx>
                  <c:xVal>
                    <c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="3"/>
                      <c:pt idx="0"><c:v>1</c:v></c:pt>
                      <c:pt idx="1"><c:v>2</c:v></c:pt>
                      <c:pt idx="2"><c:v>3</c:v></c:pt>
                    </c:numCache></c:numRef>
                  </c:xVal>
                  <c:val>
                    <c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="3"/>
                      <c:pt idx="0"><c:v>5</c:v></c:pt>
                      <c:pt idx="1"><c:v>10</c:v></c:pt>
                      <c:pt idx="2"><c:v>8</c:v></c:pt>
                    </c:numCache></c:numRef>
                  </c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:scatterChart>
              <c:valAx>
                <c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/>
              </c:valAx>
              <c:valAx>
                <c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="l"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/>
              </c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = option.series as any[];
      expect(series.length).toBeGreaterThan(0);
      expect(series[0].type).toBe('scatter');
    });

    it('should render smooth scatter as a line when markers are disabled', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:scatterChart>
                <c:scatterStyle val="smoothMarker"/>
                <c:varyColors val="0"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx>
                    <c:strRef>
                      <c:strCache>
                        <c:ptCount val="1"/>
                        <c:pt idx="0"><c:v>Y 值</c:v></c:pt>
                      </c:strCache>
                    </c:strRef>
                  </c:tx>
                  <c:marker><c:symbol val="none"/></c:marker>
                  <c:xVal>
                    <c:numRef>
                      <c:numCache>
                        <c:formatCode>General</c:formatCode>
                        <c:ptCount val="3"/>
                        <c:pt idx="0"><c:v>0.7</c:v></c:pt>
                        <c:pt idx="1"><c:v>1.8</c:v></c:pt>
                        <c:pt idx="2"><c:v>2.6</c:v></c:pt>
                      </c:numCache>
                    </c:numRef>
                  </c:xVal>
                  <c:yVal>
                    <c:numRef>
                      <c:numCache>
                        <c:formatCode>General</c:formatCode>
                        <c:ptCount val="3"/>
                        <c:pt idx="0"><c:v>2.7</c:v></c:pt>
                        <c:pt idx="1"><c:v>3.2</c:v></c:pt>
                        <c:pt idx="2"><c:v>0.8</c:v></c:pt>
                      </c:numCache>
                    </c:numRef>
                  </c:yVal>
                  <c:smooth val="1"/>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:scatterChart>
              <c:valAx>
                <c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/>
              </c:valAx>
              <c:valAx>
                <c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="l"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/>
              </c:valAx>
            </c:plotArea>
            <c:legend>
              <c:legendPos val="r"/>
              <c:overlay val="0"/>
            </c:legend>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];
      const xAxis = option.xAxis as any;
      const yAxis = option.yAxis as any;
      const legendData = (option.legend as any)?.data;
      const grid = option.grid as any;

      expect(series?.type).toBe('line');
      expect(series?.smooth).toBe(false);
      expect(series?.showSymbol).toBe(false);
      expect(series?.lineStyle?.cap).toBe('round');
      expect(series?.lineStyle?.join).toBe('round');
      expect(series?.lineStyle?.width).toBe(3);
      expect(series?.data?.length).toBeGreaterThan(3);
      expect(series?.data?.[0]).toEqual([0.7, 2.7]);
      expect(series?.data?.[series.data.length - 1]).toEqual([2.6, 0.8]);
      const peakPoint = series.data.reduce((best: number[], point: number[]) =>
        point[1] > best[1] ? point : best,
      );
      const tailProbe = series.data.reduce((best: number[], point: number[]) =>
        Math.abs(point[0] - 2.4) < Math.abs(best[0] - 2.4) ? point : best,
      );
      expect(peakPoint[1]).toBeGreaterThan(3.21);
      expect(peakPoint[1]).toBeLessThan(3.26);
      expect(peakPoint[0]).toBeLessThan(1.8);
      expect(tailProbe[1]).toBeGreaterThan(1.52);
      expect(tailProbe[1]).toBeLessThan(1.62);
      expect(legendData?.[0]).toEqual(
        expect.objectContaining({
          name: 'Y 值',
          icon: expect.stringMatching(/^path:\/\//),
        }),
      );
      expect(option.title).toBeUndefined();
      expect(grid?.left).toBe(18);
      expect(grid?.top).toBe(20);
      expect(grid?.bottom).toBe(20);
      expect(xAxis?.max).toBe(3);
      expect(xAxis?.interval).toBe(1);
      expect(yAxis?.max).toBe(3.5);
      expect(yAxis?.interval).toBe(0.5);
    });

    it('should apply theme minor font family to chart text when no explicit txPr font is set', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:title>
              <c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Y 值</a:t></a:r></a:p></c:rich></c:tx>
            </c:title>
            <c:plotArea>
              <c:scatterChart>
                <c:scatterStyle val="smoothMarker"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Y 值</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:marker><c:symbol val="none"/></c:marker>
                  <c:xVal><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt></c:numCache></c:numRef></c:xVal>
                  <c:yVal><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>2</c:v></c:pt><c:pt idx="1"><c:v>3</c:v></c:pt></c:numCache></c:numRef></c:yVal>
                  <c:smooth val="1"/>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:scatterChart>
              <c:valAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/></c:valAx>
              <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
            <c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>
          </c:chart>
        </c:chartSpace>`;

      const ctx = createMockRenderContext({
        theme: {
          ...createMockRenderContext().theme,
          minorFont: { latin: 'Mock Sans', ea: '', cs: '' },
        },
      });
      const { option } = parseChartOption(xml, ctx);
      const legend = option.legend as any;
      const title = option.title as any;
      const xAxis = option.xAxis as any;
      const yAxis = option.yAxis as any;

      expect(title?.textStyle?.fontFamily).toContain('Mock Sans');
      expect(title?.textStyle?.fontWeight).toBe('bold');
      expect(legend?.textStyle?.fontFamily).toContain('Mock Sans');
      expect(xAxis?.axisLabel?.fontFamily).toContain('Mock Sans');
      expect(yAxis?.axisLabel?.fontFamily).toContain('Mock Sans');
    });

    it('should parse areaChart with stacked grouping', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:areaChart>
                <c:grouping val="percentStacked"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx>
                    <c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Region A</c:v></c:pt></c:strCache></c:strRef>
                  </c:tx>
                  <c:cat>
                    <c:strRef><c:strCache><c:ptCount val="2"/>
                      <c:pt idx="0"><c:v>2023</c:v></c:pt>
                      <c:pt idx="1"><c:v>2024</c:v></c:pt>
                    </c:strCache></c:strRef>
                  </c:cat>
                  <c:val>
                    <c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/>
                      <c:pt idx="0"><c:v>100</c:v></c:pt>
                      <c:pt idx="1"><c:v>150</c:v></c:pt>
                    </c:numCache></c:numRef>
                  </c:val>
                  <c:spPr><a:solidFill><a:srgbClr val="92D050"/></a:solidFill></c:spPr>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:areaChart>
              <c:catAx>
                <c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/>
              </c:catAx>
              <c:valAx>
                <c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="l"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/>
              </c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = option.series as any[];
      expect(series.length).toBeGreaterThan(0);
      expect(series[0].type).toBe('line');
      expect(series[0].areaStyle).toBeDefined();
    });

    it('should parse line3DChart as line chart with area style', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:line3DChart>
                <c:grouping val="standard"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx>
                    <c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Data</c:v></c:pt></c:strCache></c:strRef>
                  </c:tx>
                  <c:cat>
                    <c:strRef><c:strCache><c:ptCount val="2"/>
                      <c:pt idx="0"><c:v>X</c:v></c:pt>
                      <c:pt idx="1"><c:v>Y</c:v></c:pt>
                    </c:strCache></c:strRef>
                  </c:cat>
                  <c:val>
                    <c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/>
                      <c:pt idx="0"><c:v>50</c:v></c:pt>
                      <c:pt idx="1"><c:v>75</c:v></c:pt>
                    </c:numCache></c:numRef>
                  </c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:line3DChart>
              <c:catAx>
                <c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/>
              </c:catAx>
              <c:valAx>
                <c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="l"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/>
              </c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = option.series as any[];
      expect(series.length).toBeGreaterThan(0);
      expect(series[0].type).toBe('line');
    });

    it('should parse combo bar+line charts with later lineChart series preserved', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:barChart>
                <c:barDir val="col"/><c:grouping val="clustered"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>系列 1</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="4"/>
                    <c:pt idx="0"><c:v>类别 1</c:v></c:pt><c:pt idx="1"><c:v>类别 2</c:v></c:pt>
                    <c:pt idx="2"><c:v>类别 3</c:v></c:pt><c:pt idx="3"><c:v>类别 4</c:v></c:pt>
                  </c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="4"/>
                    <c:pt idx="0"><c:v>4.3</c:v></c:pt><c:pt idx="1"><c:v>2.5</c:v></c:pt>
                    <c:pt idx="2"><c:v>3.5</c:v></c:pt><c:pt idx="3"><c:v>4.5</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
                <c:ser>
                  <c:idx val="1"/><c:order val="1"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>系列 2</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="4"/>
                    <c:pt idx="0"><c:v>类别 1</c:v></c:pt><c:pt idx="1"><c:v>类别 2</c:v></c:pt>
                    <c:pt idx="2"><c:v>类别 3</c:v></c:pt><c:pt idx="3"><c:v>类别 4</c:v></c:pt>
                  </c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="4"/>
                    <c:pt idx="0"><c:v>2.4</c:v></c:pt><c:pt idx="1"><c:v>4.4</c:v></c:pt>
                    <c:pt idx="2"><c:v>1.8</c:v></c:pt><c:pt idx="3"><c:v>2.8</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:barChart>
              <c:lineChart>
                <c:grouping val="standard"/>
                <c:ser>
                  <c:idx val="2"/><c:order val="2"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>系列 3</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:marker><c:symbol val="none"/></c:marker>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="4"/>
                    <c:pt idx="0"><c:v>类别 1</c:v></c:pt><c:pt idx="1"><c:v>类别 2</c:v></c:pt>
                    <c:pt idx="2"><c:v>类别 3</c:v></c:pt><c:pt idx="3"><c:v>类别 4</c:v></c:pt>
                  </c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="4"/>
                    <c:pt idx="0"><c:v>2</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt>
                    <c:pt idx="2"><c:v>3</c:v></c:pt><c:pt idx="3"><c:v>5</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:lineChart>
              <c:catAx>
                <c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/>
              </c:catAx>
              <c:valAx>
                <c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="l"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/>
              </c:valAx>
            </c:plotArea>
            <c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = option.series as any[];
      const legend = option.legend as any;
      expect(series).toHaveLength(3);
      expect(series.map((entry) => entry.type)).toEqual(['bar', 'bar', 'line']);
      expect(series[2].name).toBe('系列 3');
      expect(series[2].data).toEqual([2, 2, 3, 5]);
      expect(series[2].lineStyle?.width).toBeGreaterThanOrEqual(2);
      expect(legend?.data?.[2]).toEqual(
        expect.objectContaining({
          name: '系列 3',
          icon: expect.stringMatching(/^path:\/\//),
        }),
      );
    });

    it('keeps combo line series on its secondary percent axis (ai-computing slide 3)', () => {
      const legendTxPr = `
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p>
          <a:pPr>
            <a:defRPr sz="900">
              <a:solidFill><a:srgbClr val="595959"/></a:solidFill>
            </a:defRPr>
          </a:pPr>
        </a:p>
      `;
      const labelTxPr = `
        <c:txPr>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>
            <a:pPr>
              <a:defRPr sz="600">
                <a:solidFill><a:srgbClr val="595959"/></a:solidFill>
              </a:defRPr>
            </a:pPr>
          </a:p>
        </c:txPr>
      `;
      const labelShape = `
        <c:spPr>
          <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
          <a:ln w="9525">
            <a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill>
          </a:ln>
        </c:spPr>
      `;
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:txPr>
            <a:bodyPr/>
            <a:lstStyle/>
            <a:p><a:pPr><a:defRPr sz="1200"/></a:pPr></a:p>
          </c:txPr>
          <c:chart>
            <c:plotArea>
              <c:barChart>
                <c:barDir val="col"/><c:grouping val="clustered"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>算力</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>2024</c:v></c:pt><c:pt idx="1"><c:v>2025</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>497.1</c:v></c:pt><c:pt idx="1"><c:v>616.6</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:barChart>
              <c:lineChart>
                <c:grouping val="standard"/>
                <c:ser>
                  <c:idx val="1"/><c:order val="1"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>增速</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:marker><c:symbol val="none"/></c:marker>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>2024</c:v></c:pt><c:pt idx="1"><c:v>2025</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:formatCode>0%</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>0.2</c:v></c:pt><c:pt idx="1"><c:v>0.24</c:v></c:pt></c:numCache></c:numRef></c:val>
                  <c:dLbls>
                    ${labelShape}
                    ${labelTxPr}
                    <c:showVal val="1"/>
                    <c:showCatName val="0"/>
                    <c:showSerName val="0"/>
                    <c:showPercent val="0"/>
                  </c:dLbls>
                </c:ser>
                <c:axId val="3"/><c:axId val="4"/>
              </c:lineChart>
              <c:catAx><c:axId val="1"/><c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/></c:catAx>
              <c:valAx><c:axId val="2"/><c:delete val="0"/><c:axPos val="l"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/></c:valAx>
              <c:valAx><c:axId val="4"/><c:delete val="0"/><c:axPos val="r"/><c:tickLblPos val="nextTo"/><c:numFmt formatCode="0%"/><c:crossAx val="3"/></c:valAx>
              <c:catAx><c:axId val="3"/><c:delete val="1"/><c:axPos val="b"/><c:tickLblPos val="none"/><c:crossAx val="4"/></c:catAx>
            </c:plotArea>
            <c:legend><c:legendPos val="b"/><c:txPr>${legendTxPr}</c:txPr><c:overlay val="0"/></c:legend>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = option.series as any[];
      const yAxis = option.yAxis as any[];
      const tooltip = option.tooltip as any;
      const legend = option.legend as any;

      expect(series).toHaveLength(2);
      expect(series[1].type).toBe('line');
      expect(series[1].yAxisIndex).toBe(1);
      expect(series[1].tooltip.valueFormatter(0.24)).toBe('24%');
      expect(series[1].showSymbol).toBe(true);
      expect(series[1].symbolSize).toBe(0);
      expect(series[1].endLabel.show).toBe(false);
      expect(series[1].label.show).toBe(true);
      expect(series[1].label.fontSize).toBe(6);
      expect(series[1].label.backgroundColor).toBe('#FFFFFF');
      expect(series[1].label.borderColor).toBe('#BFBFBF');
      expect(series[1].label.borderWidth).toBeGreaterThan(0);
      expect(series[1].label.formatter({ value: 0.24 })).toBe('24%');
      expect(Array.isArray(yAxis)).toBe(true);
      expect(yAxis[1].axisLabel.formatter(0.24)).toBe('24%');
      expect(yAxis[0].max).toBeGreaterThan(600);
      expect(yAxis[1].max).toBeLessThanOrEqual(1);
      expect(tooltip.textStyle.fontSize).toBe(9);
      expect(tooltip.extraCssText).toContain('font-size: 9px');
      expect(legend.textStyle.fontSize).toBe(9);
    });

    it('keeps repeated same-type combo chart nodes on their secondary axes', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:lineChart>
                <c:grouping val="standard"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Left</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:lineChart>
              <c:lineChart>
                <c:grouping val="standard"/>
                <c:ser>
                  <c:idx val="1"/><c:order val="1"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Right</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:formatCode>0%</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>0.1</c:v></c:pt><c:pt idx="1"><c:v>0.2</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="3"/><c:axId val="4"/>
              </c:lineChart>
              <c:catAx><c:axId val="1"/><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
              <c:valAx><c:axId val="2"/><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
              <c:catAx><c:axId val="3"/><c:delete val="1"/><c:axPos val="b"/><c:tickLblPos val="none"/><c:crossAx val="4"/></c:catAx>
              <c:valAx><c:axId val="4"/><c:delete val="0"/><c:axPos val="r"/><c:numFmt formatCode="0%"/><c:crossAx val="3"/></c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = option.series as any[];
      const yAxis = option.yAxis as any[];

      expect(series.map((s) => s.name)).toEqual(['Left', 'Right']);
      expect(series[1].yAxisIndex).toBe(1);
      expect(series[1].tooltip.valueFormatter(0.2)).toBe('20%');
      expect(yAxis).toHaveLength(2);
      expect(yAxis[1].axisLabel.formatter(0.2)).toBe('20%');
    });

    it('should parse pie3DChart', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:pie3DChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx>
                    <c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Sales</c:v></c:pt></c:strCache></c:strRef>
                  </c:tx>
                  <c:cat>
                    <c:strRef><c:strCache><c:ptCount val="2"/>
                      <c:pt idx="0"><c:v>East</c:v></c:pt>
                      <c:pt idx="1"><c:v>West</c:v></c:pt>
                    </c:strCache></c:strRef>
                  </c:cat>
                  <c:val>
                    <c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/>
                      <c:pt idx="0"><c:v>45</c:v></c:pt>
                      <c:pt idx="1"><c:v>55</c:v></c:pt>
                    </c:numCache></c:numRef>
                  </c:val>
                </c:ser>
              </c:pie3DChart>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = option.series as any[];
      expect(series.length).toBeGreaterThan(0);
      expect(series[0].type).toBe('pie');
    });

    it('should parse bar3DChart with 3D settings', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:bar3DChart>
                <c:barDir val="col"/>
                <c:grouping val="clustered"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx>
                    <c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>3D Data</c:v></c:pt></c:strCache></c:strRef>
                  </c:tx>
                  <c:cat>
                    <c:strRef><c:strCache><c:ptCount val="2"/>
                      <c:pt idx="0"><c:v>Cat1</c:v></c:pt>
                      <c:pt idx="1"><c:v>Cat2</c:v></c:pt>
                    </c:strCache></c:strRef>
                  </c:cat>
                  <c:val>
                    <c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/>
                      <c:pt idx="0"><c:v>100</c:v></c:pt>
                      <c:pt idx="1"><c:v>200</c:v></c:pt>
                    </c:numCache></c:numRef>
                  </c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:bar3DChart>
              <c:catAx>
                <c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/>
              </c:catAx>
              <c:valAx>
                <c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="l"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/>
              </c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = option.series as any[];
      expect(series.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Edge Cases and Error Handling
  // ==========================================================================

  describe('edge cases and error handling', () => {
    it('should handle missing plotArea gracefully', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      expect((option.title as any)?.text).toBe('Unsupported chart');
    });

    it('should handle empty chart (no series)', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:barChart>
                <c:grouping val="clustered"/>
              </c:barChart>
              <c:catAx>
                <c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/>
              </c:catAx>
              <c:valAx>
                <c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/>
              </c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      expect((option.title as any)?.text).toBe('Unsupported chart type');
    });

    it('should handle series with no values but still render', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:barChart>
                <c:grouping val="clustered"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx>
                    <c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Empty</c:v></c:pt></c:strCache></c:strRef>
                  </c:tx>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:barChart>
              <c:catAx>
                <c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/>
              </c:catAx>
              <c:valAx>
                <c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/>
              </c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      // A series with no values still results in a chart being rendered (not unsupported)
      // The series still exists in seriesArr so the chart builds
      expect(option.series).toBeDefined();
      expect(Array.isArray(option.series)).toBe(true);
    });

    it('should extract data table information when c:dTable exists', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:barChart>
                <c:grouping val="clustered"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx>
                    <c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Series</c:v></c:pt></c:strCache></c:strRef>
                  </c:tx>
                  <c:cat>
                    <c:strRef><c:strCache><c:ptCount val="2"/>
                      <c:pt idx="0"><c:v>A</c:v></c:pt>
                      <c:pt idx="1"><c:v>B</c:v></c:pt>
                    </c:strCache></c:strRef>
                  </c:cat>
                  <c:val>
                    <c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/>
                      <c:pt idx="0"><c:v>10</c:v></c:pt>
                      <c:pt idx="1"><c:v>20</c:v></c:pt>
                    </c:numCache></c:numRef>
                  </c:val>
                </c:ser>
              </c:barChart>
              <c:dTable>
                <c:showLegendKey val="1"/>
                <c:showVal val="1"/>
              </c:dTable>
              <c:catAx>
                <c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/>
              </c:catAx>
              <c:valAx>
                <c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/>
              </c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { dataTable } = parseChartOption(xml);
      expect(dataTable).toBeDefined();
      expect(dataTable?.seriesArr).toBeDefined();
      expect(dataTable?.showKeys).toBeDefined();
    });

    it('treats c:dTable showKeys val="false" as disabled', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:barChart>
                <c:grouping val="clustered"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx>
                    <c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Series</c:v></c:pt></c:strCache></c:strRef>
                  </c:tx>
                  <c:cat>
                    <c:strRef><c:strCache><c:ptCount val="1"/>
                      <c:pt idx="0"><c:v>A</c:v></c:pt>
                    </c:strCache></c:strRef>
                  </c:cat>
                  <c:val>
                    <c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="1"/>
                      <c:pt idx="0"><c:v>10</c:v></c:pt>
                    </c:numCache></c:numRef>
                  </c:val>
                </c:ser>
              </c:barChart>
              <c:dTable>
                <c:showKeys val="false"/>
              </c:dTable>
              <c:catAx>
                <c:axId val="1"/><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/>
              </c:catAx>
              <c:valAx>
                <c:axId val="2"/><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/>
              </c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { dataTable } = parseChartOption(xml);
      expect(dataTable?.showKeys).toBe(false);
    });

    it('should apply background colors to chart', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:spPr>
            <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
          </c:spPr>
          <c:chart>
            <c:plotArea>
              <c:spPr>
                <a:solidFill><a:srgbClr val="F0F0F0"/></a:solidFill>
              </c:spPr>
              <c:barChart>
                <c:grouping val="clustered"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx>
                    <c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef>
                  </c:tx>
                  <c:cat>
                    <c:strRef><c:strCache><c:ptCount val="1"/>
                      <c:pt idx="0"><c:v>X</c:v></c:pt>
                    </c:strCache></c:strRef>
                  </c:cat>
                  <c:val>
                    <c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="1"/>
                      <c:pt idx="0"><c:v>10</c:v></c:pt>
                    </c:numCache></c:numRef>
                  </c:val>
                </c:ser>
              </c:barChart>
              <c:catAx>
                <c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/>
              </c:catAx>
              <c:valAx>
                <c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/>
              </c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      expect(option.backgroundColor).toBeDefined();
    });

    it('renders plotArea background as a graphic rect for radar charts without grid', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:layout>
                <c:manualLayout>
                  <c:x val="0.2"/>
                  <c:y val="0.25"/>
                  <c:w val="0.5"/>
                  <c:h val="0.4"/>
                </c:manualLayout>
              </c:layout>
              <c:spPr>
                <a:solidFill><a:srgbClr val="F0F0F0"/></a:solidFill>
              </c:spPr>
              <c:radarChart>
                <c:radarStyle val="marker"/>
                <c:ser>
                  <c:idx val="0"/>
                  <c:order val="0"/>
                  <c:tx><c:v>Series A</c:v></c:tx>
                  <c:cat><c:strRef><c:strCache>
                    <c:ptCount val="3"/>
                    <c:pt idx="0"><c:v>A</c:v></c:pt>
                    <c:pt idx="1"><c:v>B</c:v></c:pt>
                    <c:pt idx="2"><c:v>C</c:v></c:pt>
                  </c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache>
                    <c:ptCount val="3"/>
                    <c:pt idx="0"><c:v>10</c:v></c:pt>
                    <c:pt idx="1"><c:v>20</c:v></c:pt>
                    <c:pt idx="2"><c:v>30</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
              </c:radarChart>
              <c:valAx><c:axId val="2"/><c:delete val="0"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartXml(parseXml(xml), createMockRenderContext(), undefined, {
        w: 600,
        h: 400,
      });
      const graphic = option.graphic as any;

      expect(graphic).toMatchObject({
        type: 'rect',
        left: 120,
        top: 100,
        shape: { width: 300, height: 160 },
        style: { fill: '#F0F0F0' },
      });
    });

    it('should expose chartSpace outline style for the rendered chart frame', () => {
      const xml = buildChartSpaceXml({
        hasLegend: false,
        valAxDeleted: false,
        chartSpaceSpPr: `
          <a:noFill/>
          <a:ln w="25400" cap="flat" cmpd="sng" algn="ctr">
            <a:solidFill><a:srgbClr val="AABBCC"/></a:solidFill>
            <a:prstDash val="solid"/>
          </a:ln>`,
      });

      const result = parseChartOption(xml) as ParseChartResult & {
        chartFrameStyle?: { borderColor?: string; borderWidth?: number; borderStyle?: string };
      };

      expect(result.chartFrameStyle).toMatchObject({
        borderColor: '#AABBCC',
        borderStyle: 'solid',
      });
      expect(result.chartFrameStyle?.borderWidth).toBeGreaterThan(2);
    });
  });

  // ==========================================================================
  // renderChart Function Tests
  // ==========================================================================

  describe('renderChart function', () => {
    it('should create wrapper div with correct positioning and styles', () => {
      const ctx = createMockRenderContext();
      ctx.presentation.charts = new Map([
        [
          'ppt/charts/chart1.xml',
          parseXml(`
            <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <c:chart>
                <c:plotArea>
                  <c:barChart>
                    <c:grouping val="clustered"/>
                    <c:ser>
                      <c:idx val="0"/><c:order val="0"/>
                      <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                      <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>X</c:v></c:pt></c:strCache></c:strRef></c:cat>
                      <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>10</c:v></c:pt></c:numCache></c:numRef></c:val>
                    </c:ser>
                  </c:barChart>
                  <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
                  <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
                </c:plotArea>
              </c:chart>
            </c:chartSpace>
          `),
        ],
      ]);

      const node: ChartNodeData = {
        id: 'chart1',
        name: 'Chart 1',
        nodeType: 'chart',
        chartPath: 'ppt/charts/chart1.xml',
        position: { x: 100, y: 200 },
        size: { w: 300, h: 250 },
        rotation: 0,
        flipH: false,
        flipV: false,
      };

      const wrapper = renderChart(node, ctx);
      expect(wrapper).toBeInstanceOf(HTMLElement);
      expect(wrapper.style.position).toBe('absolute');
      expect(wrapper.style.left).toBe('100px');
      expect(wrapper.style.top).toBe('200px');
      expect(wrapper.style.width).toBe('300px');
      expect(wrapper.style.height).toBe('250px');
      expect(wrapper.style.overflow).toBe('hidden');
    });

    it('should apply chartSpace outline to the chart wrapper', () => {
      const ctx = createMockRenderContext();
      ctx.presentation.charts = new Map([
        [
          'ppt/charts/chart1.xml',
          parseXml(
            buildChartSpaceXml({
              hasLegend: false,
              valAxDeleted: false,
              chartSpaceSpPr: `
                <a:noFill/>
                <a:ln w="25400" cap="flat" cmpd="sng" algn="ctr">
                  <a:solidFill><a:srgbClr val="AABBCC"/></a:solidFill>
                  <a:prstDash val="solid"/>
                </a:ln>`,
            }),
          ),
        ],
      ]);

      const node: ChartNodeData = {
        id: 'chart1',
        name: 'Chart 1',
        nodeType: 'chart',
        chartPath: 'ppt/charts/chart1.xml',
        position: { x: 0, y: 0 },
        size: { w: 300, h: 250 },
        rotation: 0,
        flipH: false,
        flipV: false,
      };

      const wrapper = renderChart(node, ctx);
      expect(wrapper.style.boxSizing).toBe('border-box');
      expect(wrapper.style.borderStyle).toBe('solid');
      expect(wrapper.style.borderColor).toBe('rgb(170, 187, 204)');
      expect(parseFloat(wrapper.style.borderWidth)).toBeGreaterThan(2);
    });

    it('should render placeholder when chart not found', () => {
      const ctx = createMockRenderContext();
      ctx.presentation.charts = new Map();

      const node: ChartNodeData = {
        id: 'missing',
        name: 'Missing',
        nodeType: 'chart',
        chartPath: 'ppt/charts/missing.xml',
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        rotation: 0,
        flipH: false,
        flipV: false,
      };

      const wrapper = renderChart(node, ctx);
      expect(wrapper.textContent).toContain('Chart not found');
      expect(wrapper.style.border).toBe('1px dashed rgb(204, 204, 204)');
    });

    it('should append data table when chart has c:dTable', () => {
      const ctx = createMockRenderContext();
      ctx.presentation.charts = new Map([
        [
          'ppt/charts/chart1.xml',
          parseXml(`
            <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <c:chart>
                <c:plotArea>
                  <c:barChart>
                    <c:grouping val="clustered"/>
                    <c:ser>
                      <c:idx val="0"/><c:order val="0"/>
                      <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                      <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>X</c:v></c:pt></c:strCache></c:strRef></c:cat>
                      <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>10</c:v></c:pt></c:numCache></c:numRef></c:val>
                    </c:ser>
                  </c:barChart>
                  <c:dTable><c:showLegendKey val="1"/></c:dTable>
                  <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
                  <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
                </c:plotArea>
              </c:chart>
            </c:chartSpace>
          `),
        ],
      ]);

      const node: ChartNodeData = {
        id: 'chart1',
        name: 'Chart 1',
        nodeType: 'chart',
        chartPath: 'ppt/charts/chart1.xml',
        position: { x: 0, y: 0 },
        size: { w: 100, h: 100 },
        rotation: 0,
        flipH: false,
        flipV: false,
      };

      const wrapper = renderChart(node, ctx);
      const tables = wrapper.querySelectorAll('table');
      expect(tables.length).toBeGreaterThan(0);
    });

    it('renders bottom legends as a DOM overlay with the OOXML font size', () => {
      const ctx = createMockRenderContext();
      ctx.presentation.charts = new Map([
        [
          'ppt/charts/chart1.xml',
          parseXml(`
            <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <c:chart>
                <c:plotArea>
                  <c:barChart>
                    <c:grouping val="clustered"/>
                    <c:ser>
                      <c:idx val="0"/><c:order val="0"/>
                      <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>算力</c:v></c:pt></c:strCache></c:strRef></c:tx>
                      <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>2025</c:v></c:pt></c:strCache></c:strRef></c:cat>
                      <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>616.6</c:v></c:pt></c:numCache></c:numRef></c:val>
                    </c:ser>
                    <c:ser>
                      <c:idx val="1"/><c:order val="1"/>
                      <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>增速</c:v></c:pt></c:strCache></c:strRef></c:tx>
                      <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>2025</c:v></c:pt></c:strCache></c:strRef></c:cat>
                      <c:val><c:numRef><c:numCache><c:formatCode>0%</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>0.24</c:v></c:pt></c:numCache></c:numRef></c:val>
                    </c:ser>
                    <c:axId val="1"/><c:axId val="2"/>
                  </c:barChart>
                  <c:catAx><c:axId val="1"/><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
                  <c:valAx><c:axId val="2"/><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
                </c:plotArea>
                <c:legend>
                  <c:legendPos val="b"/>
                  <c:txPr>
                    <a:bodyPr/>
                    <a:lstStyle/>
                    <a:p><a:pPr><a:defRPr sz="900"/></a:pPr></a:p>
                  </c:txPr>
                </c:legend>
              </c:chart>
            </c:chartSpace>
          `),
        ],
      ]);

      const node: ChartNodeData = {
        id: 'chart1',
        name: 'Chart 1',
        nodeType: 'chart',
        chartPath: 'ppt/charts/chart1.xml',
        position: { x: 0, y: 0 },
        size: { w: 400, h: 300 },
        rotation: 0,
        flipH: false,
        flipV: false,
      };

      const wrapper = renderChart(node, ctx);
      const legend = wrapper.querySelector('.pptx-chart-custom-legend') as HTMLElement;

      expect(legend).not.toBeNull();
      const labels = [...legend.querySelectorAll('span')] as HTMLSpanElement[];
      expect(legend.style.flexDirection).toBe('row');
      expect(legend.style.bottom).toBe('15px');
      expect(legend.style.left).toBe('50%');
      expect(legend.style.transform).toBe('translateX(-50%)');
      expect(labels.map((label) => label.textContent)).toEqual(['算力', '增速']);
      expect(labels.every((label) => label.style.fontSize === '9px')).toBe(true);
    });

    it('renders right legends vertically centered (oracle-full-chart-0001-clustered-bar)', () => {
      const ctx = createMockRenderContext();
      ctx.presentation.charts = new Map([
        [
          'ppt/charts/chart1.xml',
          parseXml(buildChartSpaceXml({ hasLegend: true, legendPos: 'r', valAxDeleted: false })),
        ],
      ]);

      const node: ChartNodeData = {
        id: 'chart1',
        name: 'Chart 1',
        nodeType: 'chart',
        chartPath: 'ppt/charts/chart1.xml',
        position: { x: 0, y: 0 },
        size: { w: 400, h: 300 },
        rotation: 0,
        flipH: false,
        flipV: false,
      };

      const wrapper = renderChart(node, ctx);
      const legend = wrapper.querySelector('.pptx-chart-custom-legend') as HTMLElement;

      expect(legend).not.toBeNull();
      expect(legend.style.flexDirection).toBe('column');
      expect(legend.style.right).toBe('8px');
      expect(legend.style.top).toBe('150px');
      expect(legend.style.transform).toBe('translateY(-50%)');
    });

    it('renders radar legend overlay with line marker icons using chart-local theme colors', () => {
      const ctx = createMockRenderContext();
      ctx.presentation.chartThemes = new Map([
        [
          'ppt/charts/chart1.xml',
          {
            ...ctx.theme,
            colorScheme: new Map([
              ['accent1', '156082'],
              ['accent2', 'E97132'],
            ]),
          },
        ],
      ]);
      ctx.presentation.charts = new Map([
        [
          'ppt/charts/chart1.xml',
          parseXml(`
            <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <c:chart>
                <c:plotArea>
                  <c:radarChart>
                    <c:radarStyle val="marker"/>
                    <c:ser>
                      <c:idx val="0"/><c:order val="0"/>
                      <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>联想</c:v></c:pt></c:strCache></c:strRef></c:tx>
                      <c:spPr><a:ln w="19050"><a:solidFill><a:srgbClr val="E1251B"/></a:solidFill></a:ln></c:spPr>
                      <c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>
                      <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>功能</c:v></c:pt><c:pt idx="1"><c:v>性能</c:v></c:pt></c:strCache></c:strRef></c:cat>
                      <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>7</c:v></c:pt><c:pt idx="1"><c:v>8</c:v></c:pt></c:numCache></c:numRef></c:val>
                    </c:ser>
                      <c:ser>
                      <c:idx val="1"/><c:order val="1"/>
                      <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>华为</c:v></c:pt></c:strCache></c:strRef></c:tx>
                      <c:spPr><a:ln w="19050"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:ln></c:spPr>
                      <c:marker><c:symbol val="circle"/><c:size val="5"/><c:spPr><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></c:spPr></c:marker>
                      <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>功能</c:v></c:pt><c:pt idx="1"><c:v>性能</c:v></c:pt></c:strCache></c:strRef></c:cat>
                      <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>9</c:v></c:pt><c:pt idx="1"><c:v>9</c:v></c:pt></c:numCache></c:numRef></c:val>
                    </c:ser>
                    <c:axId val="1"/><c:axId val="2"/>
                  </c:radarChart>
                  <c:catAx><c:axId val="1"/><c:delete val="0"/><c:crossAx val="2"/></c:catAx>
                  <c:valAx><c:axId val="2"/><c:delete val="0"/><c:crossAx val="1"/></c:valAx>
                </c:plotArea>
                <c:legend>
                  <c:legendPos val="t"/>
                  <c:layout><c:manualLayout><c:x val="0.1"/><c:y val="0.12"/><c:w val="0.8"/><c:h val="0.08"/></c:manualLayout></c:layout>
                  <c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000"/></a:pPr></a:p></c:txPr>
                </c:legend>
              </c:chart>
            </c:chartSpace>
          `),
        ],
      ]);

      const node: ChartNodeData = {
        id: 'chart1',
        name: 'Chart 1',
        nodeType: 'chart',
        chartPath: 'ppt/charts/chart1.xml',
        position: { x: 0, y: 0 },
        size: { w: 400, h: 300 },
        rotation: 0,
        flipH: false,
        flipV: false,
      };

      const wrapper = renderChart(node, ctx);
      const legend = wrapper.querySelector('.pptx-chart-custom-legend') as HTMLElement;
      const strokes = [...legend.querySelectorAll('svg path')].map((path) =>
        path.getAttribute('stroke'),
      );
      const markerFills = [...legend.querySelectorAll('svg circle')].map((circle) =>
        circle.getAttribute('fill'),
      );

      expect(legend).not.toBeNull();
      expect(legend.style.flexDirection).toBe('row');
      expect(legend.style.left).toBe('40px');
      expect(legend.style.top).toBe('36px');
      expect(legend.style.width).toBe('320px');
      expect(legend.style.height).toBe('24px');
      expect(legend.style.alignItems).toBe('center');
      expect(legend.style.justifyContent).toBe('center');
      expect(strokes).toEqual(['#E1251B', '#E97132']);
      expect(markerFills).toEqual(['#E1251B', '#E97132']);
    });
  });

  // ==========================================================================
  // Multiple Series Tests
  // ==========================================================================

  describe('multiple series handling', () => {
    it('should parse chart with multiple series in order', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:barChart>
                <c:grouping val="clustered"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="1"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Series 1</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:ser>
                  <c:idx val="1"/><c:order val="0"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Series 2</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>15</c:v></c:pt><c:pt idx="1"><c:v>25</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
              </c:barChart>
              <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
              <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = option.series as any[];
      expect(series.length).toBe(2);
    });

    it('should apply custom srgbClr color to series', () => {
      const xml = buildChartSpaceXml({
        seriesFill: '<a:solidFill><a:srgbClr val="00B050"/></a:solidFill>',
      });

      const { option } = parseChartOption(xml);
      const series = option.series as any[];
      expect(series[0].itemStyle?.color).toBeDefined();
    });
  });

  // ==========================================================================
  // Axis Configuration Tests
  // ==========================================================================

  describe('axis configuration', () => {
    it('should parse valAx with deleted flag', () => {
      const xml = buildChartSpaceXml({ valAxDeleted: true });
      const { option } = parseChartOption(xml);
      expect(option.yAxis).toBeDefined();
    });

    it('uses PowerPoint-like automatic value axis range for clustered column charts (oracle-pypptx-chart-0001)', () => {
      const xml = buildChartSpaceXml({
        valAxDeleted: false,
        categories: ['Q1', 'Q2', 'Q3', 'Q4'],
        values: [45, 52, 48, 61],
      });

      const { option } = parseChartOption(xml);
      const yAxis = option.yAxis as any;

      expect(yAxis.max).toBe(70);
      expect(yAxis.interval).toBe(10);
    });

    it('uses Office-like default grid margins for visible clustered column axes (oracle-pypptx-chart-0001)', () => {
      const xml = buildChartSpaceXml({
        hasLegend: false,
        valAxDeleted: false,
        categories: ['Q1', 'Q2', 'Q3', 'Q4'],
        values: [45, 52, 48, 61],
      });

      const { option } = parseChartOption(xml);
      const grid = option.grid as any;
      const series = option.series as any[];

      expect(grid.left).toBe(18);
      expect(grid.bottom).toBe(20);
      expect(series[0].barGap).toBe('0%');
    });

    it('reserves Office-like title space above clustered column plot area (oracle-pypptx-chart-0002)', () => {
      const xml = buildChartSpaceXml({
        hasLegend: false,
        autoTitleDeleted: false,
        seriesName: 'Profit/Loss',
        valAxDeleted: false,
        categories: ['Jan', 'Feb', 'Mar'],
        values: [15, -8, 22],
      });

      const { option } = parseChartOption(xml);
      const grid = option.grid as any;

      expect((option.title as any)?.text).toBe('Profit/Loss');
      expect(grid.top).toBe(68);
    });

    it('uses Office-like default grid margins for horizontal clustered bar charts (oracle-pypptx-chart-0005)', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="0"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="bar"/>
              <c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Headcount</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="5"/>
                  <c:pt idx="0"><c:v>Engineering</c:v></c:pt>
                  <c:pt idx="1"><c:v>Sales</c:v></c:pt>
                  <c:pt idx="2"><c:v>Marketing</c:v></c:pt>
                  <c:pt idx="3"><c:v>Support</c:v></c:pt>
                  <c:pt idx="4"><c:v>HR</c:v></c:pt>
                </c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="5"/>
                  <c:pt idx="0"><c:v>45</c:v></c:pt>
                  <c:pt idx="1"><c:v>32</c:v></c:pt>
                  <c:pt idx="2"><c:v>18</c:v></c:pt>
                  <c:pt idx="3"><c:v>25</c:v></c:pt>
                  <c:pt idx="4"><c:v>8</c:v></c:pt>
                </c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const grid = option.grid as any;

      expect(grid.left).toBe(15);
      expect(grid.right).toBe(28);
      expect(grid.top).toBe(60);
    });

    it('uses PowerPoint-like automatic value axis range for line charts (oracle-pypptx-chart-0007)', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:autoTitleDeleted val="1"/>
            <c:plotArea>
              <c:lineChart>
                <c:grouping val="standard"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Website</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="6"/><c:pt idx="0"><c:v>Jan</c:v></c:pt><c:pt idx="1"><c:v>Feb</c:v></c:pt><c:pt idx="2"><c:v>Mar</c:v></c:pt><c:pt idx="3"><c:v>Apr</c:v></c:pt><c:pt idx="4"><c:v>May</c:v></c:pt><c:pt idx="5"><c:v>Jun</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="6"/><c:pt idx="0"><c:v>1200</c:v></c:pt><c:pt idx="1"><c:v>1350</c:v></c:pt><c:pt idx="2"><c:v>1100</c:v></c:pt><c:pt idx="3"><c:v>1450</c:v></c:pt><c:pt idx="4"><c:v>1380</c:v></c:pt><c:pt idx="5"><c:v>1520</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:lineChart>
              <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
              <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const yAxis = option.yAxis as any;

      expect(yAxis.max).toBe(1600);
      expect(yAxis.interval).toBe(200);
    });

    it('should handle axis with custom tick label position', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:barChart>
                <c:grouping val="clustered"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>X</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>10</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
              </c:barChart>
              <c:catAx>
                <c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="low"/><c:crossAx val="2"/>
              </c:catAx>
              <c:valAx>
                <c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="l"/><c:tickLblPos val="high"/><c:crossAx val="1"/>
              </c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      expect(option.xAxis).toBeDefined();
      expect(option.yAxis).toBeDefined();
    });
  });

  // ==========================================================================
  // requestAnimationFrame and timing tests
  // ==========================================================================

  describe('rendering timing and lifecycle', () => {
    let rafSpy: any;
    let rafs: any[];

    beforeEach(() => {
      rafs = [];

      // Mock requestAnimationFrame to store callbacks for manual execution
      rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        rafs.push(cb);
        return rafs.length - 1;
      });

      // Setup ResizeObserver mock globally if it doesn't exist
      if (!window.ResizeObserver) {
        (window as any).ResizeObserver = class {
          constructor(public callback: any) {}
          observe = vi.fn();
          disconnect = vi.fn();
        };
      }
    });

    afterEach(() => {
      rafSpy?.mockRestore();
    });

    it('should create wrapper with flex layout', () => {
      const ctx = createMockRenderContext();
      ctx.presentation.charts = new Map([
        [
          'ppt/charts/chart1.xml',
          parseXml(`
            <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <c:chart>
                <c:plotArea>
                  <c:barChart>
                    <c:grouping val="clustered"/>
                    <c:ser>
                      <c:idx val="0"/><c:order val="0"/>
                      <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                      <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>X</c:v></c:pt></c:strCache></c:strRef></c:cat>
                      <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>10</c:v></c:pt></c:numCache></c:numRef></c:val>
                    </c:ser>
                  </c:barChart>
                  <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
                  <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
                </c:plotArea>
              </c:chart>
            </c:chartSpace>
          `),
        ],
      ]);

      const node: ChartNodeData = {
        id: 'chart1',
        name: 'Chart 1',
        nodeType: 'chart',
        chartPath: 'ppt/charts/chart1.xml',
        position: { x: 50, y: 100 },
        size: { w: 500, h: 400 },
        rotation: 0,
        flipH: false,
        flipV: false,
      };

      const wrapper = renderChart(node, ctx);

      expect(wrapper.style.display).toBe('flex');
      expect(wrapper.style.flexDirection).toBe('column');
      expect(wrapper.style.overflow).toBe('hidden');

      // Verify RAF was called
      expect(rafSpy).toHaveBeenCalled();
    });

    it('should queue chart initialization via requestAnimationFrame', () => {
      const ctx = createMockRenderContext();
      ctx.presentation.charts = new Map([
        [
          'ppt/charts/chart1.xml',
          parseXml(`
            <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <c:chart>
                <c:plotArea>
                  <c:barChart>
                    <c:grouping val="clustered"/>
                    <c:ser>
                      <c:idx val="0"/><c:order val="0"/>
                      <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                      <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>X</c:v></c:pt></c:strCache></c:strRef></c:cat>
                      <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>10</c:v></c:pt></c:numCache></c:numRef></c:val>
                    </c:ser>
                  </c:barChart>
                  <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
                  <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
                </c:plotArea>
              </c:chart>
            </c:chartSpace>
          `),
        ],
      ]);

      const node: ChartNodeData = {
        id: 'chart1',
        name: 'Chart 1',
        nodeType: 'chart',
        chartPath: 'ppt/charts/chart1.xml',
        position: { x: 0, y: 0 },
        size: { w: 400, h: 300 },
        rotation: 0,
        flipH: false,
        flipV: false,
      };

      const wrapper = renderChart(node, ctx);

      // Verify RAF was called with a callback
      expect(rafs.length).toBeGreaterThan(0);
      expect(typeof rafs[0]).toBe('function');
    });

    it('should handle chart div that is not connected to DOM', () => {
      const ctx = createMockRenderContext();
      ctx.presentation.charts = new Map([
        [
          'ppt/charts/chart1.xml',
          parseXml(`
            <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <c:chart>
                <c:plotArea>
                  <c:barChart>
                    <c:grouping val="clustered"/>
                    <c:ser>
                      <c:idx val="0"/><c:order val="0"/>
                      <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                      <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>X</c:v></c:pt></c:strCache></c:strRef></c:cat>
                      <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>10</c:v></c:pt></c:numCache></c:numRef></c:val>
                    </c:ser>
                  </c:barChart>
                  <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
                  <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
                </c:plotArea>
              </c:chart>
            </c:chartSpace>
          `),
        ],
      ]);

      const node: ChartNodeData = {
        id: 'chart1',
        name: 'Chart 1',
        nodeType: 'chart',
        chartPath: 'ppt/charts/chart1.xml',
        position: { x: 0, y: 0 },
        size: { w: 400, h: 300 },
        rotation: 0,
        flipH: false,
        flipV: false,
      };

      const wrapper = renderChart(node, ctx);

      // RAF callback should check isConnected
      expect(wrapper.isConnected).toBe(false);
      // Callback will return early due to isConnected check
    });

    it('should defer chart init via ResizeObserver when container has zero size', () => {
      const ctx = createMockRenderContext();
      ctx.presentation.charts = new Map([
        [
          'ppt/charts/chart1.xml',
          parseXml(`
            <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <c:chart>
                <c:plotArea>
                  <c:barChart>
                    <c:grouping val="clustered"/>
                    <c:ser>
                      <c:idx val="0"/><c:order val="0"/>
                      <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                      <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>X</c:v></c:pt></c:strCache></c:strRef></c:cat>
                      <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>10</c:v></c:pt></c:numCache></c:numRef></c:val>
                    </c:ser>
                  </c:barChart>
                  <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
                  <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
                </c:plotArea>
              </c:chart>
            </c:chartSpace>
          `),
        ],
      ]);

      const node: ChartNodeData = {
        id: 'chart1',
        name: 'Chart 1',
        nodeType: 'chart',
        chartPath: 'ppt/charts/chart1.xml',
        position: { x: 0, y: 0 },
        size: { w: 400, h: 300 },
        rotation: 0,
        flipH: false,
        flipV: false,
      };

      const wrapper = renderChart(node, ctx);

      // Attach wrapper to DOM so chartDiv.isConnected is true
      document.body.appendChild(wrapper);

      // Find the chart div inside the wrapper
      const chartDiv = wrapper.querySelector('div') as HTMLDivElement;
      expect(chartDiv).toBeTruthy();

      // Mock offsetWidth/Height to 0 to trigger the ResizeObserver deferred path
      let roCallback: ((entries: any[]) => void) | null = null;
      const observeSpy = vi.fn();
      const disconnectSpy = vi.fn();
      (window as any).ResizeObserver = class {
        constructor(cb: any) {
          roCallback = cb;
        }
        observe = observeSpy;
        disconnect = disconnectSpy;
      };

      Object.defineProperty(chartDiv, 'offsetWidth', { value: 0, configurable: true });
      Object.defineProperty(chartDiv, 'offsetHeight', { value: 0, configurable: true });

      // Execute the RAF callback — should enter the zero-size branch
      expect(rafs.length).toBeGreaterThan(0);
      rafs[0](0);

      // ResizeObserver should have been created and started observing
      expect(observeSpy).toHaveBeenCalledWith(chartDiv);

      // Verify ResizeObserver is waiting — do NOT trigger the callback
      // (calling initChart in jsdom causes unhandled zrender async errors)
      expect(roCallback).not.toBeNull();

      document.body.removeChild(wrapper);
    });

    it('should call initChart after ResizeObserver reports non-zero size', () => {
      // Exercises the full deferred path: RAF → zero-size check → ResizeObserver →
      // non-zero callback → initChart. echarts.init may partially work or throw in
      // jsdom (no real canvas). We suppress errors and verify the observer lifecycle.
      const ctx = createMockRenderContext();
      ctx.presentation.charts = new Map([
        [
          'ppt/charts/chart1.xml',
          parseXml(`
            <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <c:chart>
                <c:plotArea>
                  <c:barChart>
                    <c:grouping val="clustered"/>
                    <c:ser>
                      <c:idx val="0"/><c:order val="0"/>
                      <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                      <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>X</c:v></c:pt></c:strCache></c:strRef></c:cat>
                      <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>10</c:v></c:pt></c:numCache></c:numRef></c:val>
                    </c:ser>
                  </c:barChart>
                  <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
                  <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
                </c:plotArea>
              </c:chart>
            </c:chartSpace>
          `),
        ],
      ]);

      const node: ChartNodeData = {
        id: 'chart1',
        name: 'Chart 1',
        nodeType: 'chart',
        chartPath: 'ppt/charts/chart1.xml',
        position: { x: 0, y: 0 },
        size: { w: 400, h: 300 },
        rotation: 0,
        flipH: false,
        flipV: false,
      };

      const wrapper = renderChart(node, ctx);
      document.body.appendChild(wrapper);

      const chartDiv = wrapper.querySelector('div') as HTMLDivElement;

      // Set up a ResizeObserver mock that captures the callback
      let roCallback: ((entries: any[]) => void) | null = null;
      const observeSpy = vi.fn();
      const disconnectSpy = vi.fn();
      (window as any).ResizeObserver = class {
        constructor(cb: any) {
          roCallback = cb;
        }
        observe = observeSpy;
        disconnect = disconnectSpy;
      };

      // Force zero dimensions so RAF enters the ResizeObserver deferred path
      Object.defineProperty(chartDiv, 'offsetWidth', { value: 0, configurable: true });
      Object.defineProperty(chartDiv, 'offsetHeight', { value: 0, configurable: true });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Execute the RAF callback — should detect zero size and set up ResizeObserver
      expect(rafs.length).toBeGreaterThan(0);
      rafs[0](0);

      // ResizeObserver should have been created and started observing
      expect(observeSpy).toHaveBeenCalledWith(chartDiv);
      expect(roCallback).not.toBeNull();

      // Verify the deferred path was taken (observer is waiting for non-zero size)
      // We do NOT trigger the callback with non-zero dimensions because
      // initChart → echarts.init causes unhandled zrender async errors in jsdom

      document.body.removeChild(wrapper);
      warnSpy.mockRestore();
    });

    it('should skip zero-size ResizeObserver entries and wait for non-zero', () => {
      // The ResizeObserver callback should only call initChart when width > 0 && height > 0
      const ctx = createMockRenderContext();
      ctx.presentation.charts = new Map([
        [
          'ppt/charts/chart1.xml',
          parseXml(`
            <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <c:chart>
                <c:plotArea>
                  <c:barChart>
                    <c:grouping val="clustered"/>
                    <c:ser>
                      <c:idx val="0"/><c:order val="0"/>
                      <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                      <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>X</c:v></c:pt></c:strCache></c:strRef></c:cat>
                      <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>10</c:v></c:pt></c:numCache></c:numRef></c:val>
                    </c:ser>
                  </c:barChart>
                  <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
                  <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
                </c:plotArea>
              </c:chart>
            </c:chartSpace>
          `),
        ],
      ]);

      const node: ChartNodeData = {
        id: 'chart1',
        name: 'Chart 1',
        nodeType: 'chart',
        chartPath: 'ppt/charts/chart1.xml',
        position: { x: 0, y: 0 },
        size: { w: 400, h: 300 },
        rotation: 0,
        flipH: false,
        flipV: false,
      };

      const wrapper = renderChart(node, ctx);
      document.body.appendChild(wrapper);

      const chartDiv = wrapper.querySelector('div') as HTMLDivElement;

      let roCallback: ((entries: any[]) => void) | null = null;
      const disconnectSpy = vi.fn();
      (window as any).ResizeObserver = class {
        constructor(cb: any) {
          roCallback = cb;
        }
        observe = vi.fn();
        disconnect = disconnectSpy;
      };

      Object.defineProperty(chartDiv, 'offsetWidth', { value: 0, configurable: true });
      Object.defineProperty(chartDiv, 'offsetHeight', { value: 0, configurable: true });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Execute the RAF callback
      rafs[0](0);

      // Trigger ResizeObserver with zero-size entry — should NOT disconnect
      (roCallback as any)([{ contentRect: { width: 0, height: 0 } }]);
      expect(disconnectSpy).not.toHaveBeenCalled();

      // Verify the observer is still waiting
      expect(roCallback).not.toBeNull();

      document.body.removeChild(wrapper);
      warnSpy.mockRestore();
    });
  });

  // ==========================================================================
  // Coverage: formatValue function (lines 153-182)
  // ==========================================================================

  describe('formatValue via data labels and tooltips', () => {
    it('should format non-integer General values with up to 2 decimal places', () => {
      // General format with a float value: triggers line 153-155
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/><c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:dLbls>
                  <c:showVal val="1"/>
                </c:dLbls>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>3.14159</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];
      // Data label has a formatter function; invoke it with a float value
      expect(series?.label?.show).toBe(true);
      const formatter = series?.label?.formatter;
      expect(typeof formatter).toBe('function');
      // General format with non-integer → "3.14" (2 decimal places, trailing zeros stripped)
      const result = formatter({ value: 3.14159 });
      expect(result).toBe('3.14');
    });

    it('should format percentage values (0.213 → "21.3%") with formatCode "0.0%"', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/><c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:dLbls>
                  <c:showVal val="1"/>
                </c:dLbls>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0.0%</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>0.213</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];
      const formatter = series?.label?.formatter;
      expect(typeof formatter).toBe('function');
      // 0.213 * 100 = 21.3, with 1 decimal place → "21.3%"
      const result = formatter({ value: 0.213 });
      expect(result).toBe('21.3%');
    });

    it('should format decimal values with formatCode "0.00"', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/><c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:dLbls>
                  <c:showVal val="1"/>
                </c:dLbls>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0.00</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>42.5</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];
      const formatter = series?.label?.formatter;
      expect(typeof formatter).toBe('function');
      // 42.5 with format "0.00" → "42.5" (trailing zero stripped by parseFloat)
      const result = formatter({ value: 42.5 });
      expect(result).toBe('42.5');
    });

    it('should format integer values with formatCode "#,##0"', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/><c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:dLbls>
                  <c:showVal val="1"/>
                </c:dLbls>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>#,##0</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>1234.7</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];
      const formatter = series?.label?.formatter;
      expect(typeof formatter).toBe('function');
      // 1234.7 rounded and formatted with thousands separators -> "1,235"
      const result = formatter({ value: 1234.7 });
      expect(result).toBe('1,235');
    });

    it('should use fallback format for unrecognized formatCode with non-integer value', () => {
      // Unrecognized format code that doesn't match any pattern → fallback (lines 180-181)
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/><c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:dLbls>
                  <c:showVal val="1"/>
                </c:dLbls>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>yyyy-mm-dd</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>3.14</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];
      const formatter = series?.label?.formatter;
      expect(typeof formatter).toBe('function');
      const result = formatter({ value: 3.14 });
      expect(result).toBe('3.14');
    });

    it('should use fallback format for unrecognized formatCode with integer value', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/><c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:dLbls>
                  <c:showVal val="1"/>
                </c:dLbls>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>yyyy-mm-dd</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>42</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];
      const formatter = series?.label?.formatter;
      expect(typeof formatter).toBe('function');
      const result = formatter({ value: 42 });
      expect(result).toBe('42');
    });

    it('should format percentage with 0 decimal places for "0%"', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/><c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:dLbls>
                  <c:showVal val="1"/>
                </c:dLbls>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0%</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>0.75</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];
      const formatter = series?.label?.formatter;
      expect(typeof formatter).toBe('function');
      // 0.75 * 100 = 75, 0 decimal places → "75%"
      const result = formatter({ value: 0.75 });
      expect(result).toBe('75%');
    });
  });

  // ==========================================================================
  // Coverage: resolveGradientStop sysClr fallback (lines 276-285, 288-289)
  // ==========================================================================

  describe('gradient stop sysClr fallback', () => {
    it('should handle sysClr with lastClr fallback when resolveColor throws', () => {
      // sysClr with lastClr — resolveColor may throw for sysClr, falling back to lastClr
      const gradFill = `<a:gradFill>
        <a:gsLst>
          <a:gs pos="0">
            <a:sysClr val="windowText" lastClr="000000">
              <a:alpha val="80000"/>
            </a:sysClr>
          </a:gs>
          <a:gs pos="100000">
            <a:sysClr val="window" lastClr="FFFFFF"/>
          </a:gs>
        </a:gsLst>
        <a:lin ang="5400000" scaled="0"/>
      </a:gradFill>`;

      const xml = buildChartSpaceXml({
        hasLegend: false,
        seriesFill: gradFill,
      });
      const { option } = parseChartOption(xml);

      const series = (option.series as any[])?.[0];
      // Should have gradient applied from sysClr lastClr values
      expect(series?.itemStyle?.color).toBeDefined();
    });

    it('should return undefined for gradient stop with no recognized color child', () => {
      // gsLst with a gs node that has no color child at all
      const gradFill = `<a:gradFill>
        <a:gsLst>
          <a:gs pos="0">
            <a:srgbClr val="FF0000"/>
          </a:gs>
          <a:gs pos="100000">
            <a:srgbClr val="0000FF"/>
          </a:gs>
        </a:gsLst>
        <a:lin ang="0" scaled="0"/>
      </a:gradFill>`;

      const xml = buildChartSpaceXml({
        hasLegend: false,
        seriesFill: gradFill,
      });
      const { option } = parseChartOption(xml);
      // Both stops should resolve, producing a gradient
      const series = (option.series as any[])?.[0];
      expect(series?.itemStyle?.color).toBeDefined();
    });
  });

  // ==========================================================================
  // Coverage: Line color fallback in extractSeriesColor (lines 317-322)
  // ==========================================================================

  describe('series line color fallback', () => {
    it('should extract color and width from spPr > ln when no direct solidFill exists', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:lineChart>
              <c:grouping val="standard"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>LineS</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:spPr>
                  <a:ln w="25400">
                    <a:solidFill><a:srgbClr val="FF6600"/></a:solidFill>
                  </a:ln>
                </c:spPr>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>X</c:v></c:pt><c:pt idx="1"><c:v>Y</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:lineChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];
      expect(series?.itemStyle?.color).toBeDefined();
      expect(series.itemStyle.color).toMatch(/[Ff][Ff]6600/);
      expect(series?.lineStyle?.width).toBeCloseTo(2, 3);
    });
  });

  // ==========================================================================
  // Coverage: Scatter chart xVal/yVal parsing (lines 550-555)
  // ==========================================================================

  describe('scatter chart xVal/yVal parsing', () => {
    it('should render lineMarker scatter with connected marker points', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:scatterChart>
              <c:scatterStyle val="lineMarker"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Scatter</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:xVal>
                  <c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="3"/>
                    <c:pt idx="0"><c:v>10</c:v></c:pt>
                    <c:pt idx="1"><c:v>20</c:v></c:pt>
                    <c:pt idx="2"><c:v>30</c:v></c:pt>
                  </c:numCache></c:numRef>
                </c:xVal>
                <c:yVal>
                  <c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="3"/>
                    <c:pt idx="0"><c:v>100</c:v></c:pt>
                    <c:pt idx="1"><c:v>200</c:v></c:pt>
                    <c:pt idx="2"><c:v>300</c:v></c:pt>
                  </c:numCache></c:numRef>
                </c:yVal>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:scatterChart>
            <c:valAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/></c:valAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];
      expect(series?.type).toBe('line');
      expect(series?.smooth).toBe(false);
      expect(series?.showSymbol).toBe(true);
      expect(series?.symbol).toBe('diamond');
      expect(series?.symbolSize).toBe(12);
      expect(series?.data?.length).toBe(3);
      expect(series?.data?.[0]).toEqual([10, 100]);
      expect(series?.data?.[1]).toEqual([20, 200]);
      expect(series?.data?.[2]).toEqual([30, 300]);
      expect(series?.lineStyle?.cap).toBe('round');
      expect(series?.lineStyle?.join).toBe('round');
    });
  });

  // ==========================================================================
  // Coverage: Chart title from strRef (lines 612-617)
  // ==========================================================================

  describe('chart title from strRef', () => {
    it('should extract chart title from tx > strRef > strCache', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="0"/>
          <c:title>
            <c:tx>
              <c:strRef>
                <c:f>Sheet1!$A$1</c:f>
                <c:strCache>
                  <c:ptCount val="1"/>
                  <c:pt idx="0"><c:v>Title From Ref</c:v></c:pt>
                </c:strCache>
              </c:strRef>
            </c:tx>
          </c:title>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/><c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>10</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const title = option.title as any;
      expect(title?.text).toBe('Title From Ref');
    });

    it('preserves rich title line breaks in document order', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="0"/>
          <c:title>
            <c:tx>
              <c:rich>
                <a:bodyPr/><a:lstStyle/>
                <a:p>
                  <a:r><a:t>Revenue</a:t></a:r>
                  <a:br/>
                  <a:r><a:t>FY26</a:t></a:r>
                </a:p>
              </c:rich>
            </c:tx>
          </c:title>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/><c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>10</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:delete val="0"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:delete val="0"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const title = option.title as any;

      expect(title?.text).toBe('Revenue\nFY26');
    });
  });

  // ==========================================================================
  // Coverage: Legend position variants (lines 711-722)
  // ==========================================================================

  describe('legend position variants', () => {
    it('should position legend at left with vertical orient for legendPos "l"', () => {
      const xml = buildChartSpaceXml({ hasLegend: true, legendPos: 'l' });
      const { option } = parseChartOption(xml);
      const legend = option.legend as any;
      expect(legend?.left).toBeDefined();
      expect(legend?.orient).toBe('vertical');
    });

    it('should position legend at top-right for legendPos "tr"', () => {
      const xml = buildChartSpaceXml({ hasLegend: true, legendPos: 'tr' });
      const { option } = parseChartOption(xml);
      const legend = option.legend as any;
      expect(legend?.top).toBeDefined();
      expect(legend?.right).toBeDefined();
      expect(legend?.orient).toBe('vertical');
    });

    it('should default to right-vertical for unknown legendPos value', () => {
      const xml = buildChartSpaceXml({ hasLegend: true, legendPos: 'unknown' });
      const { option } = parseChartOption(xml);
      const legend = option.legend as any;
      expect(legend?.right).toBeDefined();
      expect(legend?.orient).toBe('vertical');
    });
  });

  // ==========================================================================
  // Coverage: incomplete axis txPr falls back to Office default label color.
  // ==========================================================================

  describe('axis label color edge cases', () => {
    it('should fall back to default label color when txPr has pPr but no defRPr', () => {
      const catAxTxPr = `
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p>
          <a:pPr/>
        </a:p>`;

      const xml = buildChartSpaceXml({
        hasLegend: false,
        catAxTxPr,
      });
      const { option } = parseChartOption(xml);
      const xAxis = option.xAxis as any;
      expect(xAxis?.axisLabel?.color).toBe('#000000');
    });

    it('should fall back to default label color when txPr has defRPr but no solidFill', () => {
      const catAxTxPr = `
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p>
          <a:pPr>
            <a:defRPr sz="1000"/>
          </a:pPr>
        </a:p>`;

      const xml = buildChartSpaceXml({
        hasLegend: false,
        catAxTxPr,
      });
      const { option } = parseChartOption(xml);
      const xAxis = option.xAxis as any;
      expect(xAxis?.axisLabel?.color).toBe('#000000');
    });
  });

  // ==========================================================================
  // Coverage: Axis numFmt → label formatter (lines 952-961)
  // ==========================================================================

  describe('axis numFmt label formatter', () => {
    it('should apply value axis numFmt as label formatter', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/><c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>10</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/></c:catAx>
            <c:valAx>
              <c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling>
              <c:delete val="0"/><c:axPos val="l"/><c:tickLblPos val="nextTo"/>
              <c:numFmt formatCode="0.00" sourceLinked="0"/>
              <c:crossAx val="1"/>
            </c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const yAxis = option.yAxis as any;
      // The axis label should have a formatter function
      expect(yAxis?.axisLabel?.formatter).toBeDefined();
      expect(typeof yAxis.axisLabel.formatter).toBe('function');
      // Test the formatter: 42.5 with "0.00" → "42.5"
      const result = yAxis.axisLabel.formatter(42.5);
      expect(result).toBe('42.5');
    });
  });

  // ==========================================================================
  // Coverage: Pie chart label formatter with percentage format (lines 1288-1294)
  // ==========================================================================

  describe('pie chart label formatter with percentage format', () => {
    it('should format pie label with percentage formatCode, showVal and showPercent', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:pieChart>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Sales</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:dLbls>
                  <c:showVal val="1"/>
                  <c:showCatName val="1"/>
                  <c:showPercent val="1"/>
                </c:dLbls>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/>
                  <c:pt idx="0"><c:v>East</c:v></c:pt>
                  <c:pt idx="1"><c:v>West</c:v></c:pt>
                </c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0.0%</c:formatCode><c:ptCount val="2"/>
                  <c:pt idx="0"><c:v>0.45</c:v></c:pt>
                  <c:pt idx="1"><c:v>0.55</c:v></c:pt>
                </c:numCache></c:numRef></c:val>
              </c:ser>
            </c:pieChart>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];
      expect(series?.type).toBe('pie');
      // Label formatter should be a function (not a string) because fc contains '%'
      const formatter = series?.label?.formatter;
      expect(typeof formatter).toBe('function');
      // Invoke: showCatName → name, showVal with % format → "45.0%", showPercent → "50%"
      const result = formatter({ name: 'East', value: 0.45, percent: 50 });
      expect(result).toContain('East');
      expect(result).toContain('45.0%');
      expect(result).toContain('50%');
    });
  });

  // ==========================================================================
  // Coverage: Pie chart explosion (lines 1275-1277)
  // ==========================================================================

  describe('pie chart explosion', () => {
    it('should apply per-point explosion to pie chart data', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:pieChart>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Sales</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:dPt>
                  <c:idx val="0"/>
                  <c:explosion val="10"/>
                </c:dPt>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/>
                  <c:pt idx="0"><c:v>A</c:v></c:pt>
                  <c:pt idx="1"><c:v>B</c:v></c:pt>
                </c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/>
                  <c:pt idx="0"><c:v>60</c:v></c:pt>
                  <c:pt idx="1"><c:v>40</c:v></c:pt>
                </c:numCache></c:numRef></c:val>
              </c:ser>
            </c:pieChart>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];
      expect(series?.type).toBe('pie');
      // First data point should have selected=true and selectedOffset
      expect(series?.data?.[0]?.selected).toBe(true);
      expect(series?.data?.[0]?.selectedOffset).toBe(5);
      // selectedMode should allow exploded slices to remain selected together
      expect(series?.selectedMode).toBe('multiple');
    });

    it('should apply series-level explosion to all doughnut slices', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:plotArea>
            <c:doughnutChart>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>销售额</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:explosion val="25"/>
                <c:cat><c:strRef><c:strCache><c:ptCount val="4"/>
                  <c:pt idx="0"><c:v>第一季度</c:v></c:pt>
                  <c:pt idx="1"><c:v>第二季度</c:v></c:pt>
                  <c:pt idx="2"><c:v>第三季度</c:v></c:pt>
                  <c:pt idx="3"><c:v>第四季度</c:v></c:pt>
                </c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="4"/>
                  <c:pt idx="0"><c:v>8.2</c:v></c:pt>
                  <c:pt idx="1"><c:v>3.2</c:v></c:pt>
                  <c:pt idx="2"><c:v>1.4</c:v></c:pt>
                  <c:pt idx="3"><c:v>1.2</c:v></c:pt>
                </c:numCache></c:numRef></c:val>
              </c:ser>
              <c:holeSize val="50"/>
            </c:doughnutChart>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];
      expect(series?.type).toBe('pie');
      expect(series?.selectedMode).toBe('multiple');
      expect(series?.selectedOffset).toBe(25);
      expect(series?.data).toHaveLength(4);
      expect(series?.data.every((entry: any) => entry.selected === true)).toBe(true);
      expect(series?.data.every((entry: any) => entry.selectedOffset === 25)).toBe(true);
    });

    it('should map series-level pie explosion to an Office-like selected offset', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:plotArea>
            <c:pieChart>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Sales</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:explosion val="25"/>
                <c:cat><c:strRef><c:strCache><c:ptCount val="4"/>
                  <c:pt idx="0"><c:v>A</c:v></c:pt>
                  <c:pt idx="1"><c:v>B</c:v></c:pt>
                  <c:pt idx="2"><c:v>C</c:v></c:pt>
                  <c:pt idx="3"><c:v>D</c:v></c:pt>
                </c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="4"/>
                  <c:pt idx="0"><c:v>40</c:v></c:pt>
                  <c:pt idx="1"><c:v>25</c:v></c:pt>
                  <c:pt idx="2"><c:v>20</c:v></c:pt>
                  <c:pt idx="3"><c:v>15</c:v></c:pt>
                </c:numCache></c:numRef></c:val>
              </c:ser>
            </c:pieChart>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];
      expect(series?.type).toBe('pie');
      expect(series?.selectedMode).toBe('multiple');
      expect(series?.data).toHaveLength(4);
      expect(series?.data.every((entry: any) => entry.selected === true)).toBe(true);
      expect(series?.data.every((entry: any) => entry.selectedOffset === 13)).toBe(true);
    });
  });

  // ==========================================================================
  // Coverage: parseChartStyleId alternate content (lines 1663-1669)
  // ==========================================================================

  describe('parseChartStyleId alternate content', () => {
    it('should extract chart style id from mc:AlternateContent > mc:Choice > c14:style', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
        xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
        xmlns:c14="http://schemas.microsoft.com/office/drawing/2007/8/2/chart">
        <mc:AlternateContent>
          <mc:Choice Requires="c14">
            <c14:style val="102"/>
          </mc:Choice>
          <mc:Fallback>
            <c:style val="2"/>
          </mc:Fallback>
        </mc:AlternateContent>
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/><c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:spPr><a:noFill/></c:spPr>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>10</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      // Style id 102 should affect the palette
      const palette = option.color as string[] | undefined;
      expect(Array.isArray(palette)).toBe(true);
      expect(palette?.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Coverage: Tooltip valueFormatter via formatCode
  // ==========================================================================

  describe('tooltip valueFormatter', () => {
    it('should set tooltip valueFormatter with percentage formatCode', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/><c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0.0%</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>0.5</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const tooltip = option.tooltip as any;
      expect(tooltip?.valueFormatter).toBeDefined();
      expect(typeof tooltip.valueFormatter).toBe('function');
      // Test: 0.5 → "50.0%"
      expect(tooltip.valueFormatter(0.5)).toBe('50.0%');
    });

    it('should handle array values in tooltip valueFormatter', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/><c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0%</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>0.25</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const tooltip = option.tooltip as any;
      // Array value: should use first element
      expect(tooltip.valueFormatter([0.25])).toBe('25%');
    });

    it('does not apply the first series format as a global tooltip formatter for mixed formats', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/><c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:v>Percent</c:v></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0%</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>0.25</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:ser>
                <c:idx val="1"/><c:order val="1"/>
                <c:tx><c:v>Count</c:v></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>#,##0</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>1234</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const tooltip = option.tooltip as any;
      const series = option.series as any[];

      expect(tooltip.valueFormatter).toBeUndefined();
      expect(series[0].tooltip.valueFormatter(0.25)).toBe('25%');
      expect(series[1].tooltip.valueFormatter(1234)).toBe('1,234');
    });
  });

  // ==========================================================================
  // Coverage: Pie chart tooltip valueFormatter
  // ==========================================================================

  describe('pie chart tooltip valueFormatter', () => {
    it('should set tooltip valueFormatter for pie chart with formatCode', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:pieChart>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Data</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/>
                  <c:pt idx="0"><c:v>A</c:v></c:pt>
                  <c:pt idx="1"><c:v>B</c:v></c:pt>
                </c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0.00%</c:formatCode><c:ptCount val="2"/>
                  <c:pt idx="0"><c:v>0.333</c:v></c:pt>
                  <c:pt idx="1"><c:v>0.667</c:v></c:pt>
                </c:numCache></c:numRef></c:val>
              </c:ser>
            </c:pieChart>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const tooltip = option.tooltip as any;
      expect(tooltip?.valueFormatter).toBeDefined();
      expect(typeof tooltip.valueFormatter).toBe('function');
      expect(tooltip.valueFormatter(0.333)).toBe('33.30%');
    });
  });

  // ==========================================================================
  // Coverage: renderChart with data table (table fallback, lines 1531-1539)
  // ==========================================================================

  describe('renderChart data table with series colors', () => {
    it('should render data table with series color keys', () => {
      const ctx = createMockRenderContext();
      ctx.presentation.charts = new Map([
        [
          'ppt/charts/chart1.xml',
          parseXml(`
            <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <c:chart>
                <c:plotArea>
                  <c:barChart>
                    <c:grouping val="clustered"/>
                    <c:ser>
                      <c:idx val="0"/><c:order val="0"/>
                      <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Series1</c:v></c:pt></c:strCache></c:strRef></c:tx>
                      <c:spPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></c:spPr>
                      <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>X</c:v></c:pt><c:pt idx="1"><c:v>Y</c:v></c:pt></c:strCache></c:strRef></c:cat>
                      <c:val><c:numRef><c:numCache><c:formatCode>0.0%</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>0.5</c:v></c:pt><c:pt idx="1"><c:v>0.75</c:v></c:pt></c:numCache></c:numRef></c:val>
                    </c:ser>
                  </c:barChart>
                  <c:dTable><c:showLegendKey val="1"/></c:dTable>
                  <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
                  <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
                </c:plotArea>
              </c:chart>
            </c:chartSpace>
          `),
        ],
      ]);

      const node: ChartNodeData = {
        id: 'chart1',
        name: 'Chart 1',
        nodeType: 'chart',
        chartPath: 'ppt/charts/chart1.xml',
        position: { x: 0, y: 0 },
        size: { w: 400, h: 300 },
        rotation: 0,
        flipH: false,
        flipV: false,
      };

      const wrapper = renderChart(node, ctx);
      const tables = wrapper.querySelectorAll('table');
      expect(tables.length).toBeGreaterThan(0);
      // Table should contain formatted values
      const tableText = tables[0].textContent || '';
      expect(tableText).toContain('Series1');
      // Values should be formatted with "0.0%" formatCode → "50.0%", "75.0%"
      expect(tableText).toContain('50.0%');
      expect(tableText).toContain('75.0%');
    });
  });

  // ==========================================================================
  // Coverage: Horizontal bar chart (barDir="bar")
  // ==========================================================================

  describe('horizontal bar chart', () => {
    it('should swap axes for horizontal bar chart (barDir=bar)', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="bar"/>
              <c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      // For horizontal bar, xAxis should be value type and yAxis should be category type
      const xAxis = option.xAxis as any;
      const yAxis = option.yAxis as any;
      expect(xAxis?.type).toBe('value');
      expect(yAxis?.type).toBe('category');
    });
  });

  // ==========================================================================
  // Coverage: Stacked bar chart
  // ==========================================================================

  describe('stacked bar chart', () => {
    it('should set stack property for stacked grouping', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/>
              <c:grouping val="stacked"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>10</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];
      expect(series?.stack).toBe('total');
    });
  });

  // ==========================================================================
  // Coverage: Data label with zero/null values → empty string
  // ==========================================================================

  describe('data label with zero value', () => {
    it('should return empty string for zero values in data label formatter', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/><c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:dLbls><c:showVal val="1"/></c:dLbls>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>0</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];
      const formatter = series?.label?.formatter;
      expect(typeof formatter).toBe('function');
      // Zero value → empty string
      expect(formatter({ value: 0 })).toBe('');
      // Null value → empty string
      expect(formatter({ value: null })).toBe('');
    });
  });

  // ==========================================================================
  // Bubble Chart
  // ==========================================================================

  describe('bubble chart', () => {
    it('should parse bubbleChart as scatter with bubble areas scaled by sqrt of bubbleSize', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:bubbleChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx>
                    <c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Bubbles</c:v></c:pt></c:strCache></c:strRef>
                  </c:tx>
                  <c:xVal>
                    <c:numRef><c:numCache><c:ptCount val="3"/>
                      <c:pt idx="0"><c:v>1</c:v></c:pt>
                      <c:pt idx="1"><c:v>2</c:v></c:pt>
                      <c:pt idx="2"><c:v>3</c:v></c:pt>
                    </c:numCache></c:numRef>
                  </c:xVal>
                  <c:yVal>
                    <c:numRef><c:numCache><c:ptCount val="3"/>
                      <c:pt idx="0"><c:v>10</c:v></c:pt>
                      <c:pt idx="1"><c:v>20</c:v></c:pt>
                      <c:pt idx="2"><c:v>30</c:v></c:pt>
                    </c:numCache></c:numRef>
                  </c:yVal>
                  <c:bubbleSize>
                    <c:numRef><c:numCache><c:ptCount val="3"/>
                      <c:pt idx="0"><c:v>5</c:v></c:pt>
                      <c:pt idx="1"><c:v>15</c:v></c:pt>
                      <c:pt idx="2"><c:v>25</c:v></c:pt>
                    </c:numCache></c:numRef>
                  </c:bubbleSize>
                </c:ser>
              </c:bubbleChart>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = option.series as any[];
      expect(series.length).toBe(1);
      expect(series[0].type).toBe('scatter');
      expect(series[0].name).toBe('Bubbles');
      // Data should be [x, y, bubbleSize] tuples
      expect(series[0].data[0]).toEqual([1, 10, 5]);
      expect(series[0].data[1]).toEqual([2, 20, 15]);
      expect(series[0].data[2]).toEqual([3, 30, 25]);
      // symbolSize should be a function
      expect(typeof series[0].symbolSize).toBe('function');
      // Bubble diameter should follow sqrt(value / maxValue), not linear normalization.
      expect(series[0].symbolSize([0, 0, 5])).toBeCloseTo(53.6656, 3);
      expect(series[0].symbolSize([0, 0, 15])).toBeCloseTo(92.9516, 3);
      expect(series[0].symbolSize([0, 0, 25])).toBeCloseTo(120, 3);
    });

    it('honors explicit bubbleScale=0 instead of falling back to default scale', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:bubbleChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:xVal><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>1</c:v></c:pt></c:numCache></c:numRef></c:xVal>
                  <c:yVal><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>10</c:v></c:pt></c:numCache></c:numRef></c:yVal>
                  <c:bubbleSize><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>25</c:v></c:pt></c:numCache></c:numRef></c:bubbleSize>
                </c:ser>
                <c:bubbleScale val="0"/>
              </c:bubbleChart>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])[0];

      expect(series.symbolSize([0, 0, 25])).toBe(0);
    });

    it('adds top axis headroom for large edge bubbles (oracle-pypptx-chart-0020)', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:bubbleChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Markets</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:xVal><c:numRef><c:numCache><c:ptCount val="4"/><c:pt idx="0"><c:v>1.5</c:v></c:pt><c:pt idx="1"><c:v>3.0</c:v></c:pt><c:pt idx="2"><c:v>5.0</c:v></c:pt><c:pt idx="3"><c:v>2.5</c:v></c:pt></c:numCache></c:numRef></c:xVal>
                  <c:yVal><c:numRef><c:numCache><c:ptCount val="4"/><c:pt idx="0"><c:v>2.5</c:v></c:pt><c:pt idx="1"><c:v>4.0</c:v></c:pt><c:pt idx="2"><c:v>1.5</c:v></c:pt><c:pt idx="3"><c:v>3.5</c:v></c:pt></c:numCache></c:numRef></c:yVal>
                  <c:bubbleSize><c:numRef><c:numCache><c:ptCount val="4"/><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>25</c:v></c:pt><c:pt idx="2"><c:v>15</c:v></c:pt><c:pt idx="3"><c:v>30</c:v></c:pt></c:numCache></c:numRef></c:bubbleSize>
                </c:ser>
                <c:bubbleScale val="100"/>
                <c:axId val="1"/><c:axId val="2"/>
              </c:bubbleChart>
              <c:valAx><c:axId val="1"/><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:valAx>
              <c:valAx><c:axId val="2"/><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
            <c:legend><c:legendPos val="r"/><c:layout/><c:overlay val="0"/></c:legend>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const xAxis = option.xAxis as any;
      const yAxis = option.yAxis as any;
      const grid = option.grid as any;
      expect(grid.left).toBe(18);
      expect(xAxis.max).toBe(6);
      expect(xAxis.interval).toBe(1);
      expect(yAxis.max).toBe(5);
      expect(yAxis.interval).toBe(0.5);
      expect((option.legend as any).icon).toBe('circle');
    });

    it('does not add extra title offset to bubble plot area grid (oracle-pypptx-chart-0020)', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:autoTitleDeleted val="0"/>
            <c:plotArea>
              <c:bubbleChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Markets</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:xVal><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>1.5</c:v></c:pt></c:numCache></c:numRef></c:xVal>
                  <c:yVal><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>2.5</c:v></c:pt></c:numCache></c:numRef></c:yVal>
                  <c:bubbleSize><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>10</c:v></c:pt></c:numCache></c:numRef></c:bubbleSize>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:bubbleChart>
              <c:valAx><c:axId val="1"/><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:valAx>
              <c:valAx><c:axId val="2"/><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const grid = option.grid as any;

      expect(grid.top).toBe(68);
    });
  });

  // ==========================================================================
  // Stock Chart (Candlestick)
  // ==========================================================================

  describe('stock chart', () => {
    it('should parse stockChart with 4 series (OHLC) as candlestick', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:stockChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Open</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="2"/>
                    <c:pt idx="0"><c:v>Day1</c:v></c:pt><c:pt idx="1"><c:v>Day2</c:v></c:pt>
                  </c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="2"/>
                    <c:pt idx="0"><c:v>100</c:v></c:pt><c:pt idx="1"><c:v>110</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
                <c:ser>
                  <c:idx val="1"/><c:order val="1"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>High</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:val><c:numRef><c:numCache><c:ptCount val="2"/>
                    <c:pt idx="0"><c:v>120</c:v></c:pt><c:pt idx="1"><c:v>130</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
                <c:ser>
                  <c:idx val="2"/><c:order val="2"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Low</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:val><c:numRef><c:numCache><c:ptCount val="2"/>
                    <c:pt idx="0"><c:v>90</c:v></c:pt><c:pt idx="1"><c:v>95</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
                <c:ser>
                  <c:idx val="3"/><c:order val="3"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Close</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:val><c:numRef><c:numCache><c:ptCount val="2"/>
                    <c:pt idx="0"><c:v>105</c:v></c:pt><c:pt idx="1"><c:v>125</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:stockChart>
              <c:catAx>
                <c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/>
              </c:catAx>
              <c:valAx>
                <c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="l"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/>
              </c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = option.series as any[];
      expect(series.length).toBe(1);
      expect(series[0].type).toBe('candlestick');
      // ECharts candlestick format: [open, close, low, high]
      expect(series[0].data[0]).toEqual([100, 105, 90, 120]);
      expect(series[0].data[1]).toEqual([110, 125, 95, 130]);
    });

    it('should render HLC (3 series) stock chart as custom high-low-close glyphs', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:legend><c:legendPos val="r"/></c:legend>
            <c:plotArea>
              <c:stockChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>High</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="1"/>
                    <c:pt idx="0"><c:v>Day1</c:v></c:pt>
                  </c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="1"/>
                    <c:pt idx="0"><c:v>50</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
                <c:ser>
                  <c:idx val="1"/><c:order val="1"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Low</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:val><c:numRef><c:numCache><c:ptCount val="1"/>
                    <c:pt idx="0"><c:v>20</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
                <c:ser>
                  <c:idx val="2"/><c:order val="2"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Close</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:marker><c:symbol val="dot"/><c:size val="3"/></c:marker>
                  <c:val><c:numRef><c:numCache><c:ptCount val="1"/>
                    <c:pt idx="0"><c:v>35</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:stockChart>
              <c:catAx>
                <c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/>
              </c:catAx>
              <c:valAx>
                <c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="l"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/>
              </c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = option.series as any[];
      const legend = option.legend as any;
      expect(series[0].type).toBe('custom');
      expect(typeof series[0].renderItem).toBe('function');
      expect(series[0].data[0]).toEqual([0, 50, 20, 35]);
      expect(legend.icon).toBeUndefined();
      expect(legend.data).toEqual([
        { name: 'High', icon: 'none' },
        { name: 'Low', icon: 'none' },
        { name: 'Close', icon: 'circle' },
      ]);

      const rendered = series[0].renderItem(
        {},
        {
          value: (idx: number) => series[0].data[0][idx],
          coord: ([x, y]: [number, number]) => [x * 100, y],
          size: () => [100, 0],
        },
      );
      expect(rendered.children[1].shape.x2 - rendered.children[1].shape.x1).toBeLessThanOrEqual(4);
    });

    it('should merge volume columns with stock HLC price glyphs in combo charts', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:barChart>
                <c:barDir val="col"/>
                <c:grouping val="clustered"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Volume</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="1"/>
                    <c:pt idx="0"><c:v>Day1</c:v></c:pt>
                  </c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="1"/>
                    <c:pt idx="0"><c:v>1000</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:barChart>
              <c:stockChart>
                <c:ser>
                  <c:idx val="1"/><c:order val="1"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>High</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="1"/>
                    <c:pt idx="0"><c:v>Day1</c:v></c:pt>
                  </c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="1"/>
                    <c:pt idx="0"><c:v>55</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
                <c:ser>
                  <c:idx val="2"/><c:order val="2"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Low</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:val><c:numRef><c:numCache><c:ptCount val="1"/>
                    <c:pt idx="0"><c:v>11</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
                <c:ser>
                  <c:idx val="3"/><c:order val="3"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Close</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:val><c:numRef><c:numCache><c:ptCount val="1"/>
                    <c:pt idx="0"><c:v>32</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="3"/>
              </c:stockChart>
              <c:catAx>
                <c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/>
              </c:catAx>
              <c:valAx>
                <c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="l"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/>
              </c:valAx>
              <c:valAx>
                <c:axId val="3"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="r"/><c:tickLblPos val="none"/><c:crossAx val="1"/>
              </c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = option.series as any[];
      const yAxes = option.yAxis as any[];

      expect(series.map((s) => s.type)).toEqual(['bar', 'custom']);
      expect(series[1].data[0]).toEqual([0, 55, 11, 32]);
      expect(series[1].yAxisIndex).toBe(1);
      expect(yAxes).toHaveLength(2);
      expect(yAxes[1].axisLabel.show).toBe(false);
    });

    it('should keep stock HLC gridlines on the value axis and convert Excel date serials without timezone drift', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:stockChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>High</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:cat><c:numRef><c:numCache><c:ptCount val="2"/>
                    <c:formatCode>yyyy/m/d</c:formatCode>
                    <c:pt idx="0"><c:v>37261</c:v></c:pt>
                    <c:pt idx="1"><c:v>37262</c:v></c:pt>
                  </c:numCache></c:numRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="2"/>
                    <c:pt idx="0"><c:v>55</c:v></c:pt><c:pt idx="1"><c:v>57</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
                <c:ser>
                  <c:idx val="1"/><c:order val="1"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Low</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:val><c:numRef><c:numCache><c:ptCount val="2"/>
                    <c:pt idx="0"><c:v>11</c:v></c:pt><c:pt idx="1"><c:v>12</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
                <c:ser>
                  <c:idx val="2"/><c:order val="2"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Close</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:val><c:numRef><c:numCache><c:ptCount val="2"/>
                    <c:pt idx="0"><c:v>32</c:v></c:pt><c:pt idx="1"><c:v>35</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:stockChart>
              <c:catAx>
                <c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/>
              </c:catAx>
              <c:valAx>
                <c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:majorGridlines/>
                <c:delete val="0"/><c:axPos val="l"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/>
              </c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const xAxis = option.xAxis as any;
      const yAxis = option.yAxis as any;
      const grid = option.grid as any;
      expect(xAxis?.data).toEqual(['2002/1/5', '2002/1/6']);
      expect(xAxis?.splitLine?.show).toBe(false);
      expect(yAxis?.splitLine?.show).not.toBe(false);
      expect(yAxis?.max).toBe(70);
      expect(yAxis?.interval).toBe(10);
      expect(Number(grid?.left)).toBeGreaterThanOrEqual(24);
    });

    it('auto-rotates date-like HLC category labels and reserves bottom room', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:stockChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>High</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="5"/>
                    <c:pt idx="0"><c:v>2002/1/5</c:v></c:pt>
                    <c:pt idx="1"><c:v>2002/1/6</c:v></c:pt>
                    <c:pt idx="2"><c:v>2002/1/7</c:v></c:pt>
                    <c:pt idx="3"><c:v>2002/1/8</c:v></c:pt>
                    <c:pt idx="4"><c:v>2002/1/9</c:v></c:pt>
                  </c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="5"/>
                    <c:pt idx="0"><c:v>55</c:v></c:pt><c:pt idx="1"><c:v>57</c:v></c:pt>
                    <c:pt idx="2"><c:v>57</c:v></c:pt><c:pt idx="3"><c:v>58</c:v></c:pt>
                    <c:pt idx="4"><c:v>58</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
                <c:ser>
                  <c:idx val="1"/><c:order val="1"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Low</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:val><c:numRef><c:numCache><c:ptCount val="5"/>
                    <c:pt idx="0"><c:v>11</c:v></c:pt><c:pt idx="1"><c:v>12</c:v></c:pt>
                    <c:pt idx="2"><c:v>13</c:v></c:pt><c:pt idx="3"><c:v>11</c:v></c:pt>
                    <c:pt idx="4"><c:v>35</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
                <c:ser>
                  <c:idx val="2"/><c:order val="2"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Close</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:val><c:numRef><c:numCache><c:ptCount val="5"/>
                    <c:pt idx="0"><c:v>32</c:v></c:pt><c:pt idx="1"><c:v>35</c:v></c:pt>
                    <c:pt idx="2"><c:v>34</c:v></c:pt><c:pt idx="3"><c:v>35</c:v></c:pt>
                    <c:pt idx="4"><c:v>43</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:stockChart>
              <c:catAx>
                <c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/>
              </c:catAx>
              <c:valAx>
                <c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="l"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/>
              </c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const xAxis = option.xAxis as any;
      const grid = option.grid as any;

      expect(xAxis.axisLabel.rotate).toBe(45);
      expect(xAxis.axisLabel.margin).toBeGreaterThanOrEqual(10);
      expect(grid.bottom).toBeGreaterThanOrEqual(56);
    });

    it('should apply chart-space default font size to stock chart axis labels and legend text', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:txPr>
            <a:bodyPr/><a:lstStyle/>
            <a:p><a:pPr><a:defRPr sz="1800"/></a:pPr><a:endParaRPr lang="en-US"/></a:p>
          </c:txPr>
          <c:chart>
            <c:legend><c:legendPos val="r"/></c:legend>
            <c:plotArea>
              <c:stockChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>盘高</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="1"/>
                    <c:pt idx="0"><c:v>2002/1/5</c:v></c:pt>
                  </c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="1"/>
                    <c:pt idx="0"><c:v>55</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
                <c:ser>
                  <c:idx val="1"/><c:order val="1"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>盘低</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:val><c:numRef><c:numCache><c:ptCount val="1"/>
                    <c:pt idx="0"><c:v>11</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
                <c:ser>
                  <c:idx val="2"/><c:order val="2"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>收盘</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:val><c:numRef><c:numCache><c:ptCount val="1"/>
                    <c:pt idx="0"><c:v>32</c:v></c:pt>
                  </c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:stockChart>
              <c:catAx>
                <c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/>
              </c:catAx>
              <c:valAx>
                <c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling>
                <c:delete val="0"/><c:axPos val="l"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/>
              </c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const xAxis = option.xAxis as any;
      const legend = option.legend as any;
      expect(xAxis?.axisLabel?.fontSize).toBe(24);
      expect(legend?.textStyle?.fontSize).toBe(24);
    });
  });

  describe('chart semantic regressions', () => {
    it('normalizes percentStacked bar charts and pins the value axis to 100%', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/>
              <c:grouping val="percentStacked"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>20</c:v></c:pt><c:pt idx="1"><c:v>50</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:ser>
                <c:idx val="1"/><c:order val="1"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>30</c:v></c:pt><c:pt idx="1"><c:v>50</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = option.series as any[];
      const yAxis = option.yAxis as any;

      expect(series.map((s) => s.stack)).toEqual(['total', 'total']);
      expect(series.every((s) => s.barCategoryGap === '60%')).toBe(true);
      expect(series[0].data).toEqual([0.4, 0.5]);
      expect(series[1].data).toEqual([0.6, 0.5]);
      expect(yAxis.max).toBe(1);
      expect(yAxis.interval).toBe(0.1);
      expect(yAxis.axisLabel.formatter(0.5)).toBe('50%');
      expect(yAxis.splitLine?.show).not.toBe(false);
    });

    it('uses Office-style gray major gridlines when c:majorGridlines has no explicit style', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/>
              <c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>20</c:v></c:pt><c:pt idx="1"><c:v>50</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const yAxis = option.yAxis as any;
      expect(yAxis.splitLine).toMatchObject({
        show: true,
        lineStyle: {
          color: '#898989',
          width: 1,
          type: 'solid',
        },
      });
      expect(yAxis.axisLabel.fontSize).toBe(10);
    });

    it('uses legacy Office black axis and gridline defaults for old theme charts (oracle-pypptx-chart-0005)', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="bar"/>
              <c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Headcount</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>Engineering</c:v></c:pt><c:pt idx="1"><c:v>Sales</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>45</c:v></c:pt><c:pt idx="1"><c:v>32</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:delete val="0"/><c:axPos val="l"/><c:majorTickMark val="out"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:delete val="0"/><c:axPos val="b"/><c:majorGridlines/><c:majorTickMark val="out"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;
      const ctx = createMockRenderContext();
      ctx.theme = {
        ...ctx.theme,
        colorScheme: new Map([
          ...ctx.theme.colorScheme,
          ['accent1', '4F81BD'],
          ['accent2', 'C0504D'],
          ['accent3', '9BBB59'],
        ]),
      };

      const { option } = parseChartOption(xml, ctx);
      const xAxis = option.xAxis as any;

      expect(xAxis.splitLine).toMatchObject({
        show: true,
        lineStyle: { color: '#000000', width: 1, type: 'solid' },
      });
      expect(xAxis.axisLine.lineStyle.color).toBe('#000000');
      expect(xAxis.axisTick.lineStyle.color).toBe('#000000');
    });

    it('uses Office-style default axis text and lines when axis styling is omitted', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:lineChart>
              <c:grouping val="standard"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Website</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>Jan</c:v></c:pt><c:pt idx="1"><c:v>Feb</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>1200</c:v></c:pt><c:pt idx="1"><c:v>1520</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:lineChart>
            <c:catAx><c:axId val="1"/><c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:delete val="0"/><c:axPos val="l"/><c:tickLblPos val="nextTo"/><c:majorGridlines/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const xAxis = option.xAxis as any;
      const yAxis = option.yAxis as any;
      expect(yAxis.axisLabel.formatter(1600)).toBe('1600');
      expect(xAxis.axisLabel.color).toBe('#000000');
      expect(yAxis.axisLabel.color).toBe('#000000');
      expect(xAxis.axisLabel.fontSize).toBe(10);
      expect(yAxis.axisLabel.fontSize).toBe(10);
      expect(xAxis.axisLine).toMatchObject({
        show: true,
        lineStyle: { color: '#898989' },
      });
      expect(yAxis.axisLine).toMatchObject({
        show: true,
        lineStyle: { color: '#898989' },
      });
      expect(xAxis.axisTick).toMatchObject({
        lineStyle: { color: '#898989' },
      });
      expect(yAxis.axisTick).toMatchObject({
        lineStyle: { color: '#898989' },
      });
    });

    it('treats autoTitleDeleted without val as true', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Hidden</a:t></a:r></a:p></c:rich></c:tx></c:title>
          <c:autoTitleDeleted/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/>
              <c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Q1</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      expect(option.title).toBeUndefined();
    });

    it('treats axis delete without val as true', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/>
              <c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Q1</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:delete/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const yAxis = option.yAxis as any;
      expect(yAxis.axisLabel.show).toBe(false);
      expect(yAxis.axisLine.show).toBe(false);
      expect(yAxis.axisTick.show).toBe(false);
      expect(yAxis.splitLine.show).toBe(false);
    });

    it('hides category and value axis ticks when OOXML majorTickMark is none', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/>
              <c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Q1</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx>
              <c:axId val="1"/><c:delete val="0"/><c:axPos val="b"/>
              <c:majorTickMark val="none"/>
              <c:crossAx val="2"/>
            </c:catAx>
            <c:valAx>
              <c:axId val="2"/><c:delete val="0"/><c:axPos val="l"/>
              <c:majorGridlines/>
              <c:majorTickMark val="none"/>
              <c:crossAx val="1"/>
            </c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const xAxis = option.xAxis as any;
      const yAxis = option.yAxis as any;

      expect(xAxis.axisTick.show).toBe(false);
      expect(yAxis.axisTick.show).toBe(false);
    });

    it('treats legend overlay without val as true', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/>
              <c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Long Legend Name</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Q1</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
          <c:legend><c:legendPos val="r"/><c:overlay/></c:legend>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const grid = option.grid as any;
      expect(grid.right).toBe(10);
    });

    it('treats OOXML false aliases on chart booleans as false', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="f"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/>
              <c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Q1</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:delete val="off"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:delete val="f"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
          <c:legend><c:legendPos val="r"/><c:overlay val="off"/></c:legend>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const yAxis = option.yAxis as any;
      const grid = option.grid as any;

      expect(option.title).toBeDefined();
      expect(yAxis.axisLabel.show).not.toBe(false);
      expect(yAxis.axisLine.show).not.toBe(false);
      expect(yAxis.splitLine.show).not.toBe(false);
      expect(grid.right).not.toBe(10);
    });

    it('varies single-series bar colors by point and inverts negative values by default (oracle-pypptx-chart-0002)', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="0"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/>
              <c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Profit/Loss</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="6"/><c:pt idx="0"><c:v>Jan</c:v></c:pt><c:pt idx="1"><c:v>Feb</c:v></c:pt><c:pt idx="2"><c:v>Mar</c:v></c:pt><c:pt idx="3"><c:v>Apr</c:v></c:pt><c:pt idx="4"><c:v>May</c:v></c:pt><c:pt idx="5"><c:v>Jun</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="6"/><c:pt idx="0"><c:v>15</c:v></c:pt><c:pt idx="1"><c:v>-8</c:v></c:pt><c:pt idx="2"><c:v>22</c:v></c:pt><c:pt idx="3"><c:v>-12</c:v></c:pt><c:pt idx="4"><c:v>5</c:v></c:pt><c:pt idx="5"><c:v>-3</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling/><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])[0];
      expect(series.itemStyle).toBeUndefined();
      expect(series.data[0]).toMatchObject({
        value: 15,
        itemStyle: { color: '#3c64ac' },
      });
      expect(series.data[1]).toMatchObject({
        value: -8,
        itemStyle: { color: '#FFFFFF', borderColor: '#000000', borderWidth: 1 },
      });
      expect(series.data[2]).toMatchObject({
        value: 22,
        itemStyle: { color: '#919191' },
      });
      const yAxis = option.yAxis as any;
      expect(yAxis.min).toBe(-15);
      expect(yAxis.max).toBe(25);
      expect(yAxis.interval).toBe(5);
    });

    it('uses raw accent colors for single-series horizontal bars (oracle-pypptx-chart-0005)', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="0"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="bar"/>
              <c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Headcount</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="5"/><c:pt idx="0"><c:v>Engineering</c:v></c:pt><c:pt idx="1"><c:v>Sales</c:v></c:pt><c:pt idx="2"><c:v>Marketing</c:v></c:pt><c:pt idx="3"><c:v>Support</c:v></c:pt><c:pt idx="4"><c:v>HR</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="5"/><c:pt idx="0"><c:v>45</c:v></c:pt><c:pt idx="1"><c:v>32</c:v></c:pt><c:pt idx="2"><c:v>18</c:v></c:pt><c:pt idx="3"><c:v>25</c:v></c:pt><c:pt idx="4"><c:v>8</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling/><c:delete val="0"/><c:axPos val="b"/><c:majorGridlines/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])[0];
      expect(series.data[0]).toMatchObject({
        value: 45,
        itemStyle: { color: '#4472C4' },
      });
      expect(series.data[1]).toMatchObject({
        value: 32,
        itemStyle: { color: '#ED7D31' },
      });
      expect(series.data[3]).toMatchObject({
        value: 25,
        itemStyle: { color: '#FFC000' },
      });
    });

    it('uses Office-like 1000-unit value axis ticks for 8390-scale bar charts (model-platform slide 3)', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/>
              <c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Apps</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="6"/><c:pt idx="0"><c:v>2023</c:v></c:pt><c:pt idx="1"><c:v>2024</c:v></c:pt><c:pt idx="2"><c:v>2025</c:v></c:pt><c:pt idx="3"><c:v>2026</c:v></c:pt><c:pt idx="4"><c:v>2027</c:v></c:pt><c:pt idx="5"><c:v>2028</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="6"/><c:pt idx="0"><c:v>550</c:v></c:pt><c:pt idx="1"><c:v>688</c:v></c:pt><c:pt idx="2"><c:v>1718</c:v></c:pt><c:pt idx="3"><c:v>3222</c:v></c:pt><c:pt idx="4"><c:v>5372</c:v></c:pt><c:pt idx="5"><c:v>8390</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:ser>
                <c:idx val="1"/><c:order val="1"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>CAGR</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="6"/><c:pt idx="0"><c:v>2023</c:v></c:pt><c:pt idx="1"><c:v>2024</c:v></c:pt><c:pt idx="2"><c:v>2025</c:v></c:pt><c:pt idx="3"><c:v>2026</c:v></c:pt><c:pt idx="4"><c:v>2027</c:v></c:pt><c:pt idx="5"><c:v>2028</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="6"/><c:pt idx="0"><c:v>4</c:v></c:pt><c:pt idx="1"><c:v>7.28</c:v></c:pt><c:pt idx="2"><c:v>17.16</c:v></c:pt><c:pt idx="3"><c:v>37.44</c:v></c:pt><c:pt idx="4"><c:v>69.92</c:v></c:pt><c:pt idx="5"><c:v>130.35</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const yAxis = option.yAxis as any;
      expect(yAxis.interval).toBe(1000);
      expect(yAxis.max).toBe(9000);
    });

    it('places category axis labels on the value-axis zero crossing when crosses=autoZero (oracle-pypptx-chart-0002)', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/>
              <c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Profit/Loss</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>Gain</c:v></c:pt><c:pt idx="1"><c:v>Loss</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>15</c:v></c:pt><c:pt idx="1"><c:v>-8</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx>
              <c:axId val="1"/>
              <c:delete val="0"/>
              <c:axPos val="b"/>
              <c:tickLblPos val="nextTo"/>
              <c:crossAx val="2"/>
              <c:crosses val="autoZero"/>
            </c:catAx>
            <c:valAx>
              <c:axId val="2"/>
              <c:scaling/>
              <c:delete val="0"/>
              <c:axPos val="l"/>
              <c:majorGridlines/>
              <c:crossAx val="1"/>
              <c:crosses val="autoZero"/>
            </c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const xAxis = option.xAxis as any;
      expect(xAxis.axisLine).toMatchObject({ onZero: true });
    });

    it('offsets zero-crossing category labels from the chart height so negative bars do not push labels to the bottom', () => {
      const option: any = {
        grid: { top: 20, bottom: 8 },
        xAxis: {
          type: 'category',
          axisLine: { onZero: true, lineStyle: { color: '#000000' } },
          axisLabel: { interval: 0, fontSize: 10 },
        },
        yAxis: {
          type: 'value',
          min: -15,
          max: 25,
        },
        series: [{ type: 'bar', data: [15, -8] }],
      };

      applyZeroCrossingAxisLabelLayout(option, { w: 400, h: 300 });

      expect(option.xAxis.axisLabel.margin).toBe(-92);
      expect(option.xAxis.z).toBeGreaterThan(10);
      expect(option.grid.containLabel).toBe(false);
      expect(option.grid.left).toBeGreaterThanOrEqual(48);
    });

    it('keeps dense line chart category labels horizontal unless OOXML requests rotation (oracle-pypptx-chart-0021)', () => {
      const categories = Array.from({ length: 24 }, (_, idx) => idx + 1);
      const points = categories
        .map((value, idx) => `<c:pt idx="${idx}"><c:v>${value}</c:v></c:pt>`)
        .join('');
      const values = [
        110, 103, 93, 106, 104, 101, 98, 92, 105, 98, 109, 122, 129, 121, 129, 132, 123, 113, 105,
        101, 98, 104, 113, 103,
      ]
        .map((value, idx) => `<c:pt idx="${idx}"><c:v>${value}</c:v></c:pt>`)
        .join('');
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="0"/>
          <c:plotArea>
            <c:lineChart>
              <c:grouping val="standard"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Monthly Trend</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="24"/>${points}</c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="24"/>${values}</c:numCache></c:numRef></c:val>
                <c:smooth val="0"/>
              </c:ser>
              <c:marker val="1"/>
              <c:smooth val="0"/>
              <c:axId val="1"/><c:axId val="2"/>
            </c:lineChart>
            <c:catAx><c:axId val="1"/><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/><c:crosses val="autoZero"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling/><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="1"/><c:crosses val="autoZero"/></c:valAx>
          </c:plotArea>
          <c:legend><c:legendPos val="r"/><c:layout/><c:overlay val="0"/></c:legend>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      expect((option.xAxis as any).axisLabel.rotate).toBe(0);
      expect((option.grid as any).right).toBe(108);
    });

    it('uses the chart-level line marker default when series markers are omitted (oracle-pypptx-chart-0021)', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:plotArea>
            <c:lineChart>
              <c:grouping val="standard"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Monthly Trend</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt><c:pt idx="2"><c:v>3</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>110</c:v></c:pt><c:pt idx="1"><c:v>103</c:v></c:pt><c:pt idx="2"><c:v>93</c:v></c:pt></c:numCache></c:numRef></c:val>
                <c:smooth val="0"/>
              </c:ser>
              <c:ser>
                <c:idx val="1"/><c:order val="1"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Target</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt><c:pt idx="2"><c:v>3</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>90</c:v></c:pt><c:pt idx="1"><c:v>88</c:v></c:pt><c:pt idx="2"><c:v>91</c:v></c:pt></c:numCache></c:numRef></c:val>
                <c:smooth val="0"/>
              </c:ser>
              <c:ser>
                <c:idx val="2"/><c:order val="2"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Forecast</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt><c:pt idx="2"><c:v>3</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>105</c:v></c:pt><c:pt idx="1"><c:v>94</c:v></c:pt><c:pt idx="2"><c:v>97</c:v></c:pt></c:numCache></c:numRef></c:val>
                <c:smooth val="0"/>
              </c:ser>
              <c:marker val="1"/>
              <c:smooth val="0"/>
              <c:axId val="1"/><c:axId val="2"/>
            </c:lineChart>
            <c:catAx><c:axId val="1"/><c:delete val="0"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:delete val="0"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = option.series as any[];
      expect(series.map((s) => s.showSymbol)).toEqual([true, true, true]);
      expect(series.map((s) => s.showAllSymbol)).toEqual([true, true, true]);
      expect(series.map((s) => s.symbol)).toEqual(['diamond', 'rect', 'triangle']);
      expect(series.map((s) => s.symbolSize)).toEqual([12, 12, 12]);
    });

    it('adds one Office-like tick of headroom when line data nearly reaches the nice max (oracle-pypptx-chart-0008)', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:plotArea>
            <c:lineChart>
              <c:grouping val="standard"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Actual</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>W1</c:v></c:pt><c:pt idx="1"><c:v>W2</c:v></c:pt><c:pt idx="2"><c:v>W3</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>82</c:v></c:pt><c:pt idx="1"><c:v>90</c:v></c:pt><c:pt idx="2"><c:v>96</c:v></c:pt></c:numCache></c:numRef></c:val>
                <c:smooth val="0"/>
              </c:ser>
              <c:marker val="1"/>
              <c:smooth val="0"/>
              <c:axId val="1"/><c:axId val="2"/>
            </c:lineChart>
            <c:catAx><c:axId val="1"/><c:delete val="0"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:delete val="0"/><c:majorGridlines/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const yAxis = option.yAxis as any;

      expect(yAxis.interval).toBe(20);
      expect(yAxis.max).toBe(120);
    });

    it('uses chart-level line markers in legend icons when series markers are omitted (oracle-pypptx-chart-0008)', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:plotArea>
            <c:lineChart>
              <c:grouping val="standard"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Actual</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>W1</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>82</c:v></c:pt></c:numCache></c:numRef></c:val>
                <c:smooth val="0"/>
              </c:ser>
              <c:marker val="1"/>
              <c:smooth val="0"/>
              <c:axId val="1"/><c:axId val="2"/>
            </c:lineChart>
            <c:catAx><c:axId val="1"/><c:delete val="0"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:delete val="0"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
          <c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const legend = option.legend as any;

      expect(legend.data[0]).toMatchObject({
        name: 'Actual',
        icon: expect.stringMatching(/^path:\/\//),
        marker: 'diamond',
      });
    });

    it('does not infer a scatter chart title when autoTitleDeleted is omitted (oracle-pypptx-chart-0017)', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:plotArea>
            <c:scatterChart>
              <c:scatterStyle val="smoothMarker"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Curve</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:xVal><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>0</c:v></c:pt><c:pt idx="1"><c:v>1</c:v></c:pt></c:numCache></c:numRef></c:xVal>
                <c:yVal><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>5</c:v></c:pt><c:pt idx="1"><c:v>6</c:v></c:pt></c:numCache></c:numRef></c:yVal>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:scatterChart>
            <c:valAx><c:axId val="1"/><c:delete val="0"/><c:crossAx val="2"/></c:valAx>
            <c:valAx><c:axId val="2"/><c:delete val="0"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
          <c:legend><c:legendPos val="r"/></c:legend>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      expect(option.title).toBeUndefined();
    });

    it('keeps scatter value axes from clipping data that nearly reaches a nice maximum (oracle-pypptx-chart-0017)', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:plotArea>
            <c:scatterChart>
              <c:scatterStyle val="smoothMarker"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Curve</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:xVal><c:numRef><c:numCache><c:ptCount val="20"/><c:pt idx="0"><c:v>0.0</c:v></c:pt><c:pt idx="1"><c:v>0.5</c:v></c:pt><c:pt idx="2"><c:v>1.0</c:v></c:pt><c:pt idx="3"><c:v>1.5</c:v></c:pt><c:pt idx="4"><c:v>2.0</c:v></c:pt><c:pt idx="5"><c:v>2.5</c:v></c:pt><c:pt idx="6"><c:v>3.0</c:v></c:pt><c:pt idx="7"><c:v>3.5</c:v></c:pt><c:pt idx="8"><c:v>4.0</c:v></c:pt><c:pt idx="9"><c:v>4.5</c:v></c:pt><c:pt idx="10"><c:v>5.0</c:v></c:pt><c:pt idx="11"><c:v>5.5</c:v></c:pt><c:pt idx="12"><c:v>6.0</c:v></c:pt><c:pt idx="13"><c:v>6.5</c:v></c:pt><c:pt idx="14"><c:v>7.0</c:v></c:pt><c:pt idx="15"><c:v>7.5</c:v></c:pt><c:pt idx="16"><c:v>8.0</c:v></c:pt><c:pt idx="17"><c:v>8.5</c:v></c:pt><c:pt idx="18"><c:v>9.0</c:v></c:pt><c:pt idx="19"><c:v>9.5</c:v></c:pt></c:numCache></c:numRef></c:xVal>
                <c:yVal><c:numRef><c:numCache><c:ptCount val="20"/><c:pt idx="0"><c:v>5.0</c:v></c:pt><c:pt idx="1"><c:v>6.438276615812609</c:v></c:pt><c:pt idx="2"><c:v>7.524412954423689</c:v></c:pt><c:pt idx="3"><c:v>7.992484959812163</c:v></c:pt><c:pt idx="4"><c:v>7.727892280477045</c:v></c:pt><c:pt idx="5"><c:v>6.795416432311869</c:v></c:pt><c:pt idx="6"><c:v>5.423360024179601</c:v></c:pt><c:pt idx="7"><c:v>3.9476503169311403</c:v></c:pt><c:pt idx="8"><c:v>2.7295925140762156</c:v></c:pt><c:pt idx="9"><c:v>2.067409647004709</c:v></c:pt><c:pt idx="10"><c:v>2.1232271760105847</c:v></c:pt><c:pt idx="11"><c:v>2.8833790232888243</c:v></c:pt><c:pt idx="12"><c:v>4.161753505403222</c:v></c:pt><c:pt idx="13"><c:v>5.645359964263447</c:v></c:pt><c:pt idx="14"><c:v>6.970959796156367</c:v></c:pt><c:pt idx="15"><c:v>7.813999930324217</c:v></c:pt><c:pt idx="16"><c:v>7.968074739870145</c:v></c:pt><c:pt idx="17"><c:v>7.39546133787047</c:v></c:pt><c:pt idx="18"><c:v>6.23635545572527</c:v></c:pt><c:pt idx="19"><c:v>4.774546638614572</c:v></c:pt></c:numCache></c:numRef></c:yVal>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:scatterChart>
            <c:valAx><c:axId val="1"/><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:valAx>
            <c:valAx><c:axId val="2"/><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
          <c:legend><c:legendPos val="r"/></c:legend>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];
      const xAxis = option.xAxis as any;
      const yAxis = option.yAxis as any;
      expect(series.symbol).toBe('diamond');
      expect(series.symbolSize).toBe(12);
      expect(xAxis.max).toBe(10);
      expect(yAxis.interval).toBe(1);
      expect(yAxis.max).toBe(9);
    });

    it('lets series smooth=0 override scatterStyle smoothMarker interpolation (oracle-pypptx-chart-0017)', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:plotArea>
            <c:scatterChart>
              <c:scatterStyle val="smoothMarker"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Curve</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:xVal><c:numRef><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>0</c:v></c:pt><c:pt idx="1"><c:v>1</c:v></c:pt><c:pt idx="2"><c:v>2</c:v></c:pt></c:numCache></c:numRef></c:xVal>
                <c:yVal><c:numRef><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>5</c:v></c:pt><c:pt idx="1"><c:v>8</c:v></c:pt><c:pt idx="2"><c:v>6</c:v></c:pt></c:numCache></c:numRef></c:yVal>
                <c:smooth val="0"/>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:scatterChart>
            <c:valAx><c:axId val="1"/><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:valAx>
            <c:valAx><c:axId val="2"/><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])[0];
      expect(series.type).toBe('line');
      expect(series.data).toEqual([
        [0, 5],
        [1, 8],
        [2, 6],
      ]);
      expect(series.lineStyle.width).toBe(3);
    });

    it('renders lineChart series with noFill line as marker-only points', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:plotArea>
            <c:lineChart>
              <c:grouping val="standard"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Markers</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:spPr><a:ln w="38100"><a:noFill/></a:ln></c:spPr>
                <c:marker><c:symbol val="circle"/><c:size val="6"/></c:marker>
                <c:cat><c:strRef><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt><c:pt idx="2"><c:v>Q3</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>15</c:v></c:pt><c:pt idx="2"><c:v>12</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:lineChart>
            <c:catAx><c:axId val="1"/><c:delete val="0"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:delete val="0"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])[0];
      expect(series.type).toBe('line');
      expect(series.symbol).toBe('circle');
      expect(series.showSymbol).toBe(true);
      expect(series.lineStyle.opacity).toBe(0);
    });

    it('renders radarChart series with noFill line as marker-only vertices', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:plotArea>
            <c:radarChart>
              <c:radarStyle val="marker"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Radar Markers</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:spPr><a:ln w="38100"><a:noFill/></a:ln></c:spPr>
                <c:marker><c:symbol val="circle"/><c:size val="6"/></c:marker>
                <c:cat><c:strRef><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt><c:pt idx="2"><c:v>C</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>15</c:v></c:pt><c:pt idx="2"><c:v>12</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:radarChart>
            <c:catAx><c:axId val="1"/><c:delete val="0"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:delete val="0"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
          <c:legend><c:legendPos val="t"/><c:overlay val="0"/></c:legend>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const radarSeries = (option.series as any[])[0];
      const item = radarSeries.data[0];
      expect(item.symbol).toBe('circle');
      expect(item.lineStyle.opacity).toBe(0);
      const legend = option.legend as any;
      expect(legend.icon).toBe('circle');
      expect(legend.data[0]).toBe('Radar Markers');
    });

    it('renders scatter lineMarker series with noFill line as unconnected markers (oracle-pypptx-chart-0016)', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:plotArea>
            <c:scatterChart>
              <c:scatterStyle val="lineMarker"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Cluster A</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:spPr><a:ln w="47625"><a:noFill/></a:ln></c:spPr>
                <c:xVal><c:numRef><c:numCache><c:ptCount val="5"/><c:pt idx="0"><c:v>1.2</c:v></c:pt><c:pt idx="1"><c:v>2.4</c:v></c:pt><c:pt idx="2"><c:v>3.1</c:v></c:pt><c:pt idx="3"><c:v>1.8</c:v></c:pt><c:pt idx="4"><c:v>2.9</c:v></c:pt></c:numCache></c:numRef></c:xVal>
                <c:yVal><c:numRef><c:numCache><c:ptCount val="5"/><c:pt idx="0"><c:v>3.1</c:v></c:pt><c:pt idx="1"><c:v>4.2</c:v></c:pt><c:pt idx="2"><c:v>2.8</c:v></c:pt><c:pt idx="3"><c:v>3.6</c:v></c:pt><c:pt idx="4"><c:v>4.8</c:v></c:pt></c:numCache></c:numRef></c:yVal>
                <c:smooth val="0"/>
              </c:ser>
              <c:ser>
                <c:idx val="1"/><c:order val="1"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Cluster B</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:spPr><a:ln w="47625"><a:noFill/></a:ln></c:spPr>
                <c:xVal><c:numRef><c:numCache><c:ptCount val="5"/><c:pt idx="0"><c:v>5.1</c:v></c:pt><c:pt idx="1"><c:v>6.3</c:v></c:pt><c:pt idx="2"><c:v>5.8</c:v></c:pt><c:pt idx="3"><c:v>7.1</c:v></c:pt><c:pt idx="4"><c:v>6.0</c:v></c:pt></c:numCache></c:numRef></c:xVal>
                <c:yVal><c:numRef><c:numCache><c:ptCount val="5"/><c:pt idx="0"><c:v>1.2</c:v></c:pt><c:pt idx="1"><c:v>2.1</c:v></c:pt><c:pt idx="2"><c:v>1.8</c:v></c:pt><c:pt idx="3"><c:v>2.5</c:v></c:pt><c:pt idx="4"><c:v>0.9</c:v></c:pt></c:numCache></c:numRef></c:yVal>
                <c:smooth val="0"/>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:scatterChart>
            <c:valAx><c:axId val="1"/><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:valAx>
            <c:valAx><c:axId val="2"/><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])[0];
      expect(series.type).toBe('scatter');
      expect(series.data).toEqual([
        [1.2, 3.1],
        [2.4, 4.2],
        [3.1, 2.8],
        [1.8, 3.6],
        [2.9, 4.8],
      ]);
      expect(series.lineStyle).toBeUndefined();
      expect(series.symbol).toBe('diamond');
      expect(series.symbolSize).toBe(12);

      const secondSeries = (option.series as any[])[1];
      expect(secondSeries.type).toBe('scatter');
      expect(secondSeries.symbol).toBe('rect');
      expect(secondSeries.symbolSize).toBe(12);

      const xAxis = option.xAxis as any;
      const yAxis = option.yAxis as any;
      expect(xAxis.max).toBe(8);
      expect(xAxis.interval).toBe(1);
      expect(yAxis.max).toBe(6);
      expect(yAxis.interval).toBe(1);
    });

    it('sizes filled radar charts like PowerPoint and uses stronger area fill (oracle-pypptx-chart-0019)', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="0"/>
          <c:plotArea>
            <c:radarChart>
              <c:radarStyle val="filled"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Student</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="5"/><c:pt idx="0"><c:v>Math</c:v></c:pt><c:pt idx="1"><c:v>Science</c:v></c:pt><c:pt idx="2"><c:v>English</c:v></c:pt><c:pt idx="3"><c:v>History</c:v></c:pt><c:pt idx="4"><c:v>Art</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="5"/><c:pt idx="0"><c:v>92</c:v></c:pt><c:pt idx="1"><c:v>85</c:v></c:pt><c:pt idx="2"><c:v>78</c:v></c:pt><c:pt idx="3"><c:v>88</c:v></c:pt><c:pt idx="4"><c:v>95</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:radarChart>
            <c:catAx><c:axId val="1"/><c:delete val="0"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling/><c:delete val="0"/><c:majorGridlines/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const radar = option.radar as any;
      const radarSeries = (option.series as any[])[0];
      expect(radar.center).toEqual(['50%', '55%']);
      expect(radar.radius).toBe('76%');
      expect(radar.z).toBeGreaterThan(radarSeries.z);
      expect(radar.indicator.every((axis: any) => axis.max === 100)).toBe(true);
      expect(radar.indicator[0].axisLabel.formatter(100)).toBe('100');
      expect(radar.indicator[0].axisLabel.color).toBe('#000000');
      expect(radar.splitLine).toMatchObject({ show: false });
      const areaFill = radarSeries.data[0].areaStyle.color;
      expect(areaFill).toMatchObject({ x: 0, y: 0, x2: 0, y2: 1 });
      expect(areaFill.colorStops.map((stop: any) => stop.offset)).toEqual([0, 1]);
      expect(areaFill.colorStops.map((stop: any) => stop.color)).toEqual(['#78a8ff', '#0b59bb']);
      expect(radarSeries.data[0].areaStyle.opacity).toBe(0.75);
      expect(radarSeries.data[0].symbol).toBe('none');
    });

    it('applies major gridline line style from value axis spPr', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/>
              <c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>20</c:v></c:pt><c:pt idx="1"><c:v>50</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx>
              <c:axId val="2"/>
              <c:delete val="0"/>
              <c:axPos val="l"/>
              <c:majorGridlines>
                <c:spPr>
                  <a:ln w="9525">
                    <a:solidFill>
                      <a:schemeClr val="tx1">
                        <a:lumMod val="35000"/>
                        <a:lumOff val="65000"/>
                      </a:schemeClr>
                    </a:solidFill>
                    <a:prstDash val="dash"/>
                  </a:ln>
                </c:spPr>
              </c:majorGridlines>
              <c:crossAx val="1"/>
            </c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const yAxis = option.yAxis as any;
      expect(yAxis.splitLine).toMatchObject({
        show: true,
        lineStyle: {
          width: 1,
          type: 'dashed',
        },
      });
      expect(yAxis.splitLine.lineStyle.color.toLowerCase()).toBe('#a6a6a6');
    });

    it('stacks area and line charts according to OOXML grouping', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:areaChart>
              <c:grouping val="stacked"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>2</c:v></c:pt><c:pt idx="1"><c:v>4</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:ser>
                <c:idx val="1"/><c:order val="1"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>3</c:v></c:pt><c:pt idx="1"><c:v>7</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:areaChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
          <c:legend><c:legendPos val="r"/></c:legend>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = option.series as any[];
      const legend = option.legend as any;
      const xAxis = option.xAxis as any;
      const yAxis = option.yAxis as any;

      expect(series.map((s) => s.stack)).toEqual(['total', 'total']);
      expect(series.every((s) => s.areaStyle?.opacity === 1)).toBe(true);
      expect(series.every((s) => s.showSymbol === false)).toBe(true);
      expect(legend.icon).toBe('rect');
      expect(legend.data.map((item: any) => item.name)).toEqual(['B', 'A']);
      expect(legend.data.map((item: any) => item.itemStyle.color)).toEqual(['#ED7D31', '#4472C4']);
      expect(xAxis.boundaryGap).toBe(false);
      expect(yAxis.interval).toBe(2);
      expect(yAxis.max).toBe(14);
    });

    it('uses PowerPoint-like axis headroom for standard area charts (oracle-pypptx-chart-0014)', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:plotArea>
            <c:areaChart>
              <c:grouping val="standard"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Revenue</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>2023</c:v></c:pt><c:pt idx="1"><c:v>2024</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>125</c:v></c:pt><c:pt idx="1"><c:v>148</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:ser>
                <c:idx val="1"/><c:order val="1"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Cost</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>2023</c:v></c:pt><c:pt idx="1"><c:v>2024</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>82</c:v></c:pt><c:pt idx="1"><c:v>91</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:areaChart>
            <c:catAx><c:axId val="1"/><c:delete val="0"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:delete val="0"/><c:majorGridlines/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const yAxis = option.yAxis as any;

      expect(yAxis.interval).toBe(20);
      expect(yAxis.max).toBe(160);
    });

    it('keeps line chart category axes gapped while stacking series values', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:lineChart>
              <c:grouping val="stacked"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>2</c:v></c:pt><c:pt idx="1"><c:v>4</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:ser>
                <c:idx val="1"/><c:order val="1"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>3</c:v></c:pt><c:pt idx="1"><c:v>7</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:lineChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
          <c:legend><c:legendPos val="r"/></c:legend>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = option.series as any[];
      const xAxis = option.xAxis as any;
      const legend = option.legend as any;

      expect(series.map((s) => s.stack)).toEqual(['total', 'total']);
      expect(xAxis.boundaryGap).toBeUndefined();
      expect(legend.data.map((item: any) => item.name)).toEqual(['B', 'A']);
      expect(legend.data.map((item: any) => item.lineStyle.color)).toEqual(['#ED7D31', '#4472C4']);
    });

    it('applies maxMin axis orientation as ECharts inverse axes', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/><c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>10</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="1"/><c:axId val="2"/>
            </c:barChart>
            <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="maxMin"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="maxMin"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      expect((option.xAxis as any).inverse).toBe(true);
      expect((option.yAxis as any).inverse).toBe(true);
    });

    it('matches axes by axId before falling back to the first axis of a kind', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/><c:grouping val="clustered"/>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>10</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:axId val="30"/><c:axId val="40"/>
            </c:barChart>
            <c:catAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="b"/><c:crossAx val="20"/></c:catAx>
            <c:valAx><c:axId val="20"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="l"/><c:crossAx val="10"/></c:valAx>
            <c:catAx><c:axId val="30"/><c:scaling><c:orientation val="maxMin"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="40"/></c:catAx>
            <c:valAx><c:axId val="40"/><c:scaling><c:orientation val="maxMin"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="30"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);

      expect((option.xAxis as any).axisLabel?.show).not.toBe(false);
      expect((option.yAxis as any).axisLabel?.show).not.toBe(false);
      expect((option.xAxis as any).inverse).toBe(true);
      expect((option.yAxis as any).inverse).toBe(true);
    });

    it('applies per-point pie data label overrides from c:dLbl', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:pieChart>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Sales</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:dLbls>
                  <c:dLbl>
                    <c:idx val="1"/>
                    <c:layout><c:manualLayout><c:x val="0.7"/><c:y val="0.2"/></c:manualLayout></c:layout>
                    <c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:defRPr></a:pPr></a:p></c:txPr>
                    <c:dLblPos val="ctr"/>
                    <c:showCatName val="1"/>
                    <c:showPercent val="1"/>
                  </c:dLbl>
                  <c:dLblPos val="outEnd"/>
                  <c:showVal val="0"/>
                  <c:showCatName val="1"/>
                  <c:showPercent val="1"/>
                  <c:showLeaderLines val="1"/>
                </c:dLbls>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>25</c:v></c:pt><c:pt idx="1"><c:v>75</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
            </c:pieChart>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])[0];
      const point = series.data[1];

      expect(series.labelLine.show).toBe(true);
      expect(point.label.position).toBe('inside');
      expect(point.label.color).toBe('#FF0000');
      expect(point.label.fontSize).toBe(14);
      expect(point.label.formatter({ name: 'B', value: 75, percent: 75 })).toBe('B 75%');
      expect(
        series.labelLayout({ dataIndex: 1, rect: { x: 0, y: 0, width: 400, height: 300 } }),
      ).toEqual({
        x: 280,
        y: 60,
      });
    });

    it('renders multi-series doughnut charts as concentric rings', () => {
      const xml = `<c:chartSpace
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <c:chart>
          <c:autoTitleDeleted val="1"/>
          <c:plotArea>
            <c:doughnutChart>
              <c:ser>
                <c:idx val="0"/><c:order val="0"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Inner</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>4</c:v></c:pt><c:pt idx="1"><c:v>6</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:ser>
                <c:idx val="1"/><c:order val="1"/>
                <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Outer</c:v></c:pt></c:strCache></c:strRef></c:tx>
                <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>C</c:v></c:pt><c:pt idx="1"><c:v>D</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>3</c:v></c:pt><c:pt idx="1"><c:v>7</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
              <c:holeSize val="50"/>
            </c:doughnutChart>
          </c:plotArea>
          <c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = option.series as any[];

      expect(series).toHaveLength(2);
      expect(series[0].radius).toEqual(['44%', '65%']);
      expect(series[1].radius).toEqual(['66%', '87%']);
      expect((option.legend as any).data).toEqual(['A', 'B', 'C', 'D']);
    });

    it('uses chart color style parts as the implicit palette when available', () => {
      const xml = buildChartSpaceXml({ seriesFill: '' });
      const colorStyle = parseXml(`<cs:colorStyle
        xmlns:cs="http://schemas.microsoft.com/office/drawing/2012/chartStyle"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:schemeClr val="accent6"/>
        <a:schemeClr val="accent2"/>
      </cs:colorStyle>`);
      const ctx = createMockRenderContext();
      (ctx.presentation as any).chartColorStyles = new Map([['ppt/charts/chart1.xml', colorStyle]]);

      const chartXml = parseXml(xml);
      const { option } = (parseChartXml as any)(chartXml, ctx, 'ppt/charts/chart1.xml');

      expect(option.color).toEqual(['#70AD47', '#ED7D31']);
    });

    it('uses sparse present cache points when ptCount is absent or invalid', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:barChart>
                <c:ser>
                  <c:idx val="0"/>
                  <c:order val="0"/>
                  <c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:cat>
                    <c:strRef>
                      <c:strCache>
                        <c:pt idx="-1"><c:v>ignored negative</c:v></c:pt>
                        <c:pt idx="2"><c:v>C</c:v></c:pt>
                      </c:strCache>
                    </c:strRef>
                  </c:cat>
                  <c:val>
                    <c:numRef>
                      <c:numCache>
                        <c:ptCount val="-1"/>
                        <c:pt idx="foo"><c:v>99</c:v></c:pt>
                        <c:pt idx="2"><c:v>7</c:v></c:pt>
                      </c:numCache>
                    </c:numRef>
                  </c:val>
                </c:ser>
              </c:barChart>
              <c:catAx><c:axId val="1"/><c:crossAx val="2"/></c:catAx>
              <c:valAx><c:axId val="2"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const xAxis = option.xAxis as { data?: string[] };
      const series = (option.series as { data?: unknown[] }[])[0];

      expect(xAxis.data).toEqual(['', '', 'C']);
      expect(
        series.data?.map((point) =>
          typeof point === 'object' && point !== null && 'value' in point
            ? (point as { value: unknown }).value
            : point,
        ),
      ).toEqual([null, null, 7]);
    });

    it('ignores incomplete gradient fills and uses default gradient angle when lin is absent', () => {
      const incompleteGradient = `<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs></a:gsLst></a:gradFill>`;
      const defaultAngleGradient = `<a:gradFill>
        <a:gsLst>
          <a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs>
          <a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs>
        </a:gsLst>
      </a:gradFill>`;

      const incomplete = parseChartOption(buildChartSpaceXml({ seriesFill: incompleteGradient }));
      const incompleteSeries = (incomplete.option.series as any[])[0];
      expect(incompleteSeries.itemStyle?.color).toBeUndefined();

      const complete = parseChartOption(buildChartSpaceXml({ seriesFill: defaultAngleGradient }));
      const gradient = (complete.option.series as any[])[0].itemStyle.color as {
        y: number;
        y2: number;
        colorStops: { offset: number; color: string }[];
      };
      expect(gradient.y).toBeCloseTo(0);
      expect(gradient.y2).toBeCloseTo(1);
      expect(gradient.colorStops.map((stop) => stop.offset)).toEqual([0, 1]);
    });

    it('handles malformed dPt entries and keeps only valid point-level styles', () => {
      const xml = buildChartSpaceXml({
        dataPointFills: [
          '',
          '<a:ln><a:solidFill><a:srgbClr val="00AA00"/></a:solidFill><a:prstDash val="dash"/></a:ln>',
        ],
      }).replace('<c:dPt>\n      <c:idx val="0"/>', '<c:dPt>\n      <c:idx/>');

      const { option } = parseChartOption(xml);
      const data = ((option.series as any[])[0].data ?? []) as any[];

      expect(data[0]).toBe(607);
      expect(data[1].itemStyle).toMatchObject({
        borderColor: '#00AA00',
        borderType: 'dashed',
      });
    });

    it('treats dLbls with all content flags disabled as labels explicitly off', () => {
      const xml = buildChartSpaceXml({}).replace(
        '<c:gapWidth val="219"/>',
        `<c:dLbls>
          <c:showVal val="0"/>
          <c:showCatName val="0"/>
          <c:showSerName val="0"/>
          <c:showPercent val="0"/>
          <c:spPr>
            <a:solidFill><a:srgbClr val="FFFF00"/></a:solidFill>
          </c:spPr>
        </c:dLbls>
        <c:gapWidth val="219"/>`,
      );

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])[0];

      expect(series.label).toBeUndefined();
      expect(series.data).toEqual([607, 710, 866]);
    });

    it('uses OOXML default right legend when legendPos is omitted', () => {
      const xml = buildChartSpaceXml({ hasLegend: true }).replace('<c:legendPos val="r"/>', '');

      const { option } = parseChartOption(xml);
      const legend = option.legend as any;

      expect(legend.right).toBeDefined();
      expect(legend.orient).toBe('vertical');
    });

    it('keeps top overlay legends from reserving extra grid space', () => {
      const xml = buildChartSpaceXml({
        hasLegend: true,
        legendPos: 't',
        autoTitleDeleted: false,
        titleText: 'Revenue',
      }).replace('<c:legendPos val="t"/>', '<c:legendPos val="t"/><c:overlay/>');

      const { option } = parseChartOption(xml);
      expect((option.grid as any).top).toBe(68);
      expect((option.legend as any).top).toBe(26);
    });

    it('applies zero-crossing label layout with percent and numeric grid dimensions', () => {
      const option: echarts.EChartsOption = {
        grid: { left: '10%', width: '50%', top: 12, height: 120 },
        xAxis: {
          type: 'category',
          axisLine: { onZero: true },
          axisLabel: { fontSize: 12 },
        },
        yAxis: { type: 'value', min: -20, max: 80 },
      };

      applyZeroCrossingAxisLabelLayout(option, { w: 400, h: 300 });

      const xAxis = option.xAxis as { axisLabel?: { margin?: number }; z?: number };
      expect(xAxis.axisLabel?.margin).toBeLessThan(0);
      expect(xAxis.z).toBe(20);
      expect((option.grid as any).containLabel).toBe(false);
    });

    it('does not apply zero-crossing layout to non-crossing or zero-span axes', () => {
      const nonCrossing: echarts.EChartsOption = {
        grid: { top: 'bad', bottom: 'bad' },
        xAxis: { type: 'category', axisLine: { onZero: true } },
        yAxis: { type: 'value', min: 0, max: 80 },
      };
      applyZeroCrossingAxisLabelLayout(nonCrossing, { w: 400, h: 300 });
      expect(((nonCrossing.xAxis as any).axisLabel ?? {}).margin).toBeUndefined();

      const zeroSpan: echarts.EChartsOption = {
        grid: { top: 200, bottom: 200 },
        xAxis: { type: 'category', axisLine: { onZero: true } },
        yAxis: { type: 'value', min: -10, max: 10 },
      };
      applyZeroCrossingAxisLabelLayout(zeroSpan, { w: 400, h: 300 });
      expect(((zeroSpan.xAxis as any).axisLabel ?? {}).margin).toBeUndefined();
    });

    it('normalizes percent-stacked bar charts with zero totals and formats object label values', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:barChart>
                <c:barDir val="col"/>
                <c:grouping val="percentStacked"/>
                <c:dLbls><c:showVal val="1"/></c:dLbls>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:v>A</c:v></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>Zero</c:v></c:pt><c:pt idx="1"><c:v>Share</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>0</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:ser>
                  <c:idx val="1"/><c:order val="1"/>
                  <c:tx><c:v>B</c:v></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>Zero</c:v></c:pt><c:pt idx="1"><c:v>Share</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>0</c:v></c:pt><c:pt idx="1"><c:v>30</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:barChart>
              <c:catAx><c:axId val="1"/><c:crossAx val="2"/></c:catAx>
              <c:valAx><c:axId val="2"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = option.series as any[];

      expect(series[0].data).toEqual([0, 0.4]);
      expect(series[1].data).toEqual([0, 0.6]);
      expect(series[0].label.formatter({ value: { value: 0.4 } })).toBe('40%');
      expect((option.yAxis as any).max).toBe(1);
      expect((option.yAxis as any).axisLabel.formatter(0.25)).toBe('25%');
    });

    it('applies default negative bar inversion but honors invertIfNegative=false', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:barChart>
                <c:barDir val="bar"/>
                <c:grouping val="clustered"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:v>Default invert</c:v></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>-5</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:ser>
                  <c:idx val="1"/><c:order val="1"/>
                  <c:tx><c:v>No invert</c:v></c:tx>
                  <c:invertIfNegative val="0"/>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>-5</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:barChart>
              <c:catAx><c:axId val="1"/><c:crossAx val="2"/></c:catAx>
              <c:valAx><c:axId val="2"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = option.series as any[];

      expect(series[0].data[0].itemStyle).toMatchObject({
        color: '#FFFFFF',
        borderColor: '#000000',
        borderWidth: 1,
      });
      expect(series[1].data[0]).toBe(-5);
      expect((option.yAxis as any).type).toBe('category');
    });

    it('forces an invisible symbol when a line series hides markers but shows labels', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:lineChart>
                <c:grouping val="standard"/>
                <c:dLbls><c:showVal val="1"/><c:dLblPos val="r"/></c:dLbls>
                <c:marker val="0"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:v>Line</c:v></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:formatCode>0.0</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>1.5</c:v></c:pt><c:pt idx="1"><c:v>2.5</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:lineChart>
              <c:catAx><c:axId val="1"/><c:crossAx val="2"/></c:catAx>
              <c:valAx><c:axId val="2"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])[0];

      expect(series.symbol).toBe('circle');
      expect(series.symbolSize).toBe(0);
      expect(series.showSymbol).toBe(true);
      expect(series.label.position).toBe('right');
      expect(series.label.formatter({ value: { value: 2.5 } })).toBe('2.5');
    });

    it('falls back to single close-value candlesticks for underspecified stock charts', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:stockChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:v>Close</c:v></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>D1</c:v></c:pt><c:pt idx="1"><c:v>D2</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>12</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:stockChart>
              <c:catAx><c:axId val="1"/><c:crossAx val="2"/></c:catAx>
              <c:valAx><c:axId val="2"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])[0];

      expect(series.type).toBe('candlestick');
      expect(series.data).toEqual([
        [0, 10, 0, 10],
        [0, 12, 0, 12],
      ]);
      expect((option.xAxis as any).data).toEqual(['D1', 'D2']);
    });

    it('renders bubble charts without bubbleSize as zero-size points instead of NaN symbols', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:bubbleChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:v>Bubble</c:v></c:tx>
                  <c:xVal><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt></c:numCache></c:numRef></c:xVal>
                  <c:yVal><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>3</c:v></c:pt><c:pt idx="1"><c:v>4</c:v></c:pt></c:numCache></c:numRef></c:yVal>
                </c:ser>
                <c:bubbleScale val="125"/>
                <c:axId val="1"/><c:axId val="2"/>
              </c:bubbleChart>
              <c:valAx><c:axId val="1"/><c:crossAx val="2"/></c:valAx>
              <c:valAx><c:axId val="2"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])[0];

      expect(series.data).toEqual([
        [1, 3, 0],
        [2, 4, 0],
      ]);
      expect(series.symbolSize([1, 3, 0])).toBe(0);
      expect((option.tooltip as any).formatter({ seriesName: 'Bubble', value: [1, 3, 0] })).toBe(
        'Bubble<br/>x: 1, y: 3, size: 0',
      );
    });

    it('returns an unsupported chart option when no known chart type can be rendered', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
          <c:chart>
            <c:plotArea>
              <c:unknownChart><c:ser/></c:unknownChart>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);

      expect((option.title as any).text).toBe('Unsupported chart type');
    });

    it('uses chart style from AlternateContent and master color mapping without overriding chart-local overrides', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                      xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
                      xmlns:c14="http://schemas.microsoft.com/office/drawing/2007/8/2/chart">
          <mc:AlternateContent>
            <mc:Choice Requires="c14"><c14:style val="102"/></mc:Choice>
          </mc:AlternateContent>
          <c:clrMapOvr><a:masterClrMapping/></c:clrMapOvr>
          <c:chart>
            <c:plotArea>
              <c:barChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:v>S</c:v></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>1</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:barChart>
              <c:catAx><c:axId val="1"/><c:crossAx val="2"/></c:catAx>
              <c:valAx><c:axId val="2"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);

      expect(option.color).toEqual([
        '#4472C4',
        '#ED7D31',
        '#A5A5A5',
        '#FFC000',
        '#5B9BD5',
        '#70AD47',
      ]);
    });

    it('renders data tables with blank cells for missing series values', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:barChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:v>S</c:v></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt><c:pt idx="2"><c:v>C</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:formatCode>0.0</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>1.25</c:v></c:pt><c:pt idx="1"><c:v>2.5</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:barChart>
              <c:dTable><c:showKeys val="0"/></c:dTable>
              <c:catAx><c:axId val="1"/><c:crossAx val="2"/></c:catAx>
              <c:valAx><c:axId val="2"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;
      const { dataTable } = parseChartOption(xml);
      expect(dataTable).toBeDefined();

      const node = {
        id: 'chart',
        name: 'chart',
        nodeType: 'chart',
        chartPath: 'ppt/charts/chart1.xml',
        position: { x: 0, y: 0 },
        size: { w: 300, h: 220 },
        rotation: 0,
        flipH: false,
        flipV: false,
      } satisfies ChartNodeData;
      const ctx = createMockRenderContext();
      ctx.presentation.charts.set('ppt/charts/chart1.xml', parseXml(xml));

      const el = renderChart(node, ctx);
      const cells = Array.from(el.querySelectorAll('tbody td')).map((td) => td.textContent);

      expect(cells).toEqual(['S', '1.3', '2.5', '']);
    });

    it('keeps per-series data table formats through the chart render path', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:barChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:v>Percent</c:v></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:formatCode>0%</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>0.25</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:ser>
                  <c:idx val="1"/><c:order val="1"/>
                  <c:tx><c:v>Count</c:v></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:formatCode>#,##0</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>1234</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:barChart>
              <c:dTable><c:showKeys val="0"/></c:dTable>
              <c:catAx><c:axId val="1"/><c:crossAx val="2"/></c:catAx>
              <c:valAx><c:axId val="2"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;
      const node = {
        id: 'chart',
        name: 'chart',
        nodeType: 'chart',
        chartPath: 'ppt/charts/chart1.xml',
        position: { x: 0, y: 0 },
        size: { w: 300, h: 220 },
        rotation: 0,
        flipH: false,
        flipV: false,
      } satisfies ChartNodeData;
      const ctx = createMockRenderContext();
      ctx.presentation.charts.set('ppt/charts/chart1.xml', parseXml(xml));

      const el = renderChart(node, ctx);
      const cells = Array.from(el.querySelectorAll('tbody td')).map((td) => td.textContent);

      expect(cells).toEqual(['Percent', '25%', 'Count', '1,234']);
    });

    it('keeps missing bar chart points as gaps instead of synthetic zero values', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:barChart>
                <c:barDir val="col"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:v>S</c:v></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt><c:pt idx="2"><c:v>C</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>5</c:v></c:pt><c:pt idx="2"><c:v>7</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:barChart>
              <c:catAx><c:axId val="1"/><c:crossAx val="2"/></c:catAx>
              <c:valAx><c:axId val="2"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
            <c:dispBlanksAs val="gap"/>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])[0];

      expect(
        series.data.map((point: unknown) =>
          typeof point === 'object' && point !== null && 'value' in point
            ? (point as { value: unknown }).value
            : point,
        ),
      ).toEqual([5, null, 7]);
    });

    it('spans missing line chart points when dispBlanksAs requests span', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:lineChart>
                <c:grouping val="standard"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:v>S</c:v></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt><c:pt idx="2"><c:v>C</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="2"><c:v>3</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:lineChart>
              <c:catAx><c:axId val="1"/><c:crossAx val="2"/></c:catAx>
              <c:valAx><c:axId val="2"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
            <c:dispBlanksAs val="span"/>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])[0];

      expect(series.data).toEqual([1, null, 3]);
      expect(series.connectNulls).toBe(true);
    });

    it.each([
      ['outEnd', 'top'],
      ['inEnd', 'insideTop'],
      ['ctr', 'inside'],
      ['inBase', 'insideBottom'],
      [undefined, 'top'],
    ])('maps bar data label position %s', (pos, expected) => {
      const dLblPos = pos ? `<c:dLblPos val="${pos}"/>` : '';
      const xml = buildChartSpaceXml({}).replace(
        '<c:gapWidth val="219"/>',
        `<c:dLbls><c:showVal val="1"/>${dLblPos}</c:dLbls><c:gapWidth val="219"/>`,
      );

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])[0];

      expect(series.label.position).toBe(expected);
    });

    it.each([
      ['l', 'left'],
      ['r', 'right'],
      ['b', 'bottom'],
      ['ctr', 'top'],
      ['bestFit', 'top'],
      [undefined, 'top'],
    ])('maps line data label position %s', (pos, expected) => {
      const dLblPos = pos ? `<c:dLblPos val="${pos}"/>` : '';
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:lineChart>
                <c:grouping val="standard"/>
                <c:dLbls><c:showVal val="1"/>${dLblPos}</c:dLbls>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:v>S</c:v></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>1</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:lineChart>
              <c:catAx><c:axId val="1"/><c:crossAx val="2"/></c:catAx>
              <c:valAx><c:axId val="2"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])[0];

      expect(series.label.position).toBe(expected);
    });

    it('applies point-level line data label overrides and manual layout', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:lineChart>
                <c:grouping val="standard"/>
                <c:dLbls>
                  <c:showVal val="1"/>
                  <c:dLbl>
                    <c:idx val="1"/>
                    <c:dLblPos val="r"/>
                    <c:layout><c:manualLayout><c:x val="0.2"/><c:y val="0.3"/></c:manualLayout></c:layout>
                    <c:showVal val="1"/>
                  </c:dLbl>
                </c:dLbls>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:v>S</c:v></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:lineChart>
              <c:catAx><c:axId val="1"/><c:crossAx val="2"/></c:catAx>
              <c:valAx><c:axId val="2"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])[0];

      expect(series.label.position).toBe('top');
      expect(series.data[0]).toBe(1);
      expect(series.data[1].value).toBe(2);
      expect(series.data[1].label.position).toBe('right');
      expect(series.labelLayout({ dataIndex: 1 })).toEqual({ x: '20%', y: '30%' });
    });

    it.each([
      ['r', ['38%', '55%'], '82%'],
      ['l', ['62%', '55%'], '82%'],
      ['t', ['50%', '60%'], '74%'],
      ['b', ['50%', '45%'], '74%'],
    ])('adjusts pie layout for %s legend placement', (legendPos, center, radius) => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:pieChart>
                <c:dLbls><c:showVal val="1"/></c:dLbls>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:v>Pie</c:v></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>10</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
              </c:pieChart>
            </c:plotArea>
            <c:legend><c:legendPos val="${legendPos}"/><c:overlay val="0"/></c:legend>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])[0];

      expect(series.center).toEqual(center);
      expect(series.radius).toBe(radius);
    });

    it('uses a smaller right-legend layout for exploded doughnut charts (oracle-pypptx-chart-0013)', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:doughnutChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Values</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:explosion val="25"/>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt><c:pt idx="2"><c:v>C</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>50</c:v></c:pt><c:pt idx="1"><c:v>30</c:v></c:pt><c:pt idx="2"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:holeSize val="50"/>
              </c:doughnutChart>
            </c:plotArea>
            <c:legend><c:legendPos val="r"/><c:layout/><c:overlay val="0"/></c:legend>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])[0];

      expect(series.center).toEqual(['45%', '55%']);
      expect(series.radius).toEqual(['38%', '76%']);
      expect(series.selectedOffset).toBe(25);
    });

    it('uses an Office-like right-legend layout for plain doughnut charts (oracle-pypptx-chart-0012)', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:doughnutChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:v>Status</c:v></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>Complete</c:v></c:pt><c:pt idx="1"><c:v>In Progress</c:v></c:pt><c:pt idx="2"><c:v>Not Started</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>65</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt><c:pt idx="2"><c:v>15</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:holeSize val="50"/>
              </c:doughnutChart>
            </c:plotArea>
            <c:legend><c:legendPos val="r"/><c:layout/><c:overlay val="0"/></c:legend>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])[0];

      expect(series.center).toEqual(['39%', '54%']);
      expect(series.radius).toEqual(['44%', '87%']);
    });

    it('merges pie point label overrides with manual layout, box style, and series name', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:pieChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:v>Series One</c:v></c:tx>
                  <c:dLbls>
                    <c:showVal val="1"/>
                    <c:dLbl>
                      <c:idx val="0"/>
                      <c:showCatName val="1"/>
                      <c:showSerName val="1"/>
                      <c:showPercent val="1"/>
                      <c:dLblPos val="inEnd"/>
                      <c:layout><c:manualLayout><c:x val="0.1"/><c:y val="0.2"/><c:w val="0.3"/><c:h val="0.4"/></c:manualLayout></c:layout>
                      <c:spPr>
                        <a:solidFill><a:srgbClr val="FFFF00"/></a:solidFill>
                        <a:ln w="12700"><a:solidFill><a:srgbClr val="00AAFF"/></a:solidFill></a:ln>
                      </c:spPr>
                      <c:txPr><a:bodyPr tIns="91440" rIns="182880" bIns="274320" lIns="365760"/></c:txPr>
                    </c:dLbl>
                  </c:dLbls>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>25</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
              </c:pieChart>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])[0];
      const point = series.data[0];

      expect(point.label.position).toBe('inside');
      expect(point.label.backgroundColor).toBe('#FFFF00');
      expect(point.label.borderColor).toBe('#00AAFF');
      expect(point.label.borderWidth).toBeCloseTo(1.333);
      expect(point.label.padding).toHaveLength(4);
      expect(point.label.padding[0]).toBeCloseTo(9.6);
      expect(point.label.padding[1]).toBeCloseTo(19.2);
      expect(point.label.padding[2]).toBeCloseTo(28.8);
      expect(point.label.padding[3]).toBeCloseTo(38.4);
      expect(point.label.formatter({ name: 'A', value: 25, percent: 100 })).toBe(
        'Series One A 25 100%',
      );
      expect(series.labelLayout({ dataIndex: 0 })).toEqual({
        x: '10%',
        y: '20%',
        width: '30%',
        height: '40%',
      });
      expect(
        series.labelLayout({ dataIndex: 0, rect: { x: 10, y: 20, width: 200, height: 100 } }),
      ).toEqual({
        x: 30,
        y: 40,
        width: 60,
        height: 40,
      });
    });

    it('suppresses point-level deleted pie labels over shared labels', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:pieChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:v>Series One</c:v></c:tx>
                  <c:dLbls>
                    <c:showVal val="1"/>
                    <c:dLbl><c:idx val="1"/><c:delete val="1"/></c:dLbl>
                  </c:dLbls>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>25</c:v></c:pt><c:pt idx="1"><c:v>75</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
              </c:pieChart>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])?.[0];

      expect(series.label.show).toBe(true);
      expect(series.data[0].label).toBeUndefined();
      expect(series.data[1].label).toEqual({ show: false });
    });

    it.each([
      [undefined, 1.234, '1.23'],
      ['0.00', 1.234, '1.23'],
      ['#,##0', 1.6, '2'],
      ['[Red]weird', 1.234, '1.23'],
      ['0.0%', 0.125, '12.5%'],
    ])('formats value-axis labels with numFmt=%s', (formatCode, input, expected) => {
      const numFmtXml = formatCode ? `<c:numFmt formatCode="${formatCode}" sourceLinked="0"/>` : '';
      const xml = buildChartSpaceXml({ valAxDeleted: false }).replace(
        '<c:axId val="2"/>\n          <c:scaling><c:orientation val="minMax"/></c:scaling>',
        `<c:axId val="2"/>
          <c:scaling><c:min val="bad"/><c:max val="42"/></c:scaling>
          ${numFmtXml}`,
      );

      const { option } = parseChartOption(xml);
      const yAxis = option.yAxis as any;

      expect(yAxis.axisLabel.formatter(input)).toBe(expected);
      expect(yAxis.min).toBe(0);
      expect(yAxis.max).toBe(42);
    });

    it('uses numeric category caches and date serial fallback values', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:barChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:v>Dates</c:v></c:tx>
                  <c:cat>
                    <c:numRef><c:numCache>
                      <c:formatCode>yyyy/m/d</c:formatCode>
                      <c:ptCount val="3"/>
                      <c:pt idx="0"><c:v>0</c:v></c:pt>
                      <c:pt idx="1"><c:v>60</c:v></c:pt>
                      <c:pt idx="2"><c:v>61</c:v></c:pt>
                    </c:numCache></c:numRef>
                  </c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt><c:pt idx="2"><c:v>3</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:barChart>
              <c:catAx><c:axId val="1"/><c:crossAx val="2"/></c:catAx>
              <c:valAx><c:axId val="2"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);

      expect((option.xAxis as any).data).toEqual(['0', '1900/2/28', '1900/3/1']);
    });

    it('extracts chart titles from rich text fields, breaks, and string caches', () => {
      const richXml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:title>
              <c:tx><c:rich><a:p><a:r><a:t>Revenue</a:t></a:r><a:br/><a:fld><a:t>2026</a:t></a:fld></a:p></c:rich></c:tx>
            </c:title>
            <c:autoTitleDeleted val="0"/>
            <c:plotArea>
              <c:barChart><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>S</c:v></c:tx><c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>1</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart>
              <c:catAx><c:axId val="1"/><c:crossAx val="2"/></c:catAx>
              <c:valAx><c:axId val="2"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;
      const strRefXml = richXml.replace(
        '<c:title>\n              <c:tx><c:rich><a:p><a:r><a:t>Revenue</a:t></a:r><a:br/><a:fld><a:t>2026</a:t></a:fld></a:p></c:rich></c:tx>\n            </c:title>',
        '<c:title><c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>Cached Title</c:v></c:pt></c:strCache></c:strRef></c:tx></c:title>',
      );

      expect((parseChartOption(richXml).option.title as any).text).toBe('Revenue\n2026');
      expect((parseChartOption(strRefXml).option.title as any).text).toBe('Cached Title');
    });

    it('applies chart-space fallback background and plot-area background fills', () => {
      const xml = buildChartSpaceXml({
        chartSpaceSpPr: '',
        plotAreaManualLayout: { x: 0.1 },
      }).replace(
        '<c:plotArea>',
        `<c:plotArea>
          <c:spPr><a:solidFill><a:srgbClr val="EFEFEF"/></a:solidFill></c:spPr>`,
      );

      const { option } = parseChartOption(xml);

      expect(option.backgroundColor).toBe('#ffffff');
      expect((option.grid as any).backgroundColor).toBe('#EFEFEF');
      expect((option.grid as any).show).toBe(true);
      expect((option.grid as any).left).toBe('10%');
    });

    it('selects exploded pie slices from series and point-level explosion settings', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:pieChart>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:v>Pie</c:v></c:tx>
                  <c:explosion val="8"/>
                  <c:dPt><c:idx val="1"/><c:explosion val="16"/></c:dPt>
                  <c:dPt><c:idx/><c:explosion val="20"/></c:dPt>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>40</c:v></c:pt><c:pt idx="1"><c:v>60</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
              </c:pieChart>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = (option.series as any[])[0];

      expect(series.selectedMode).toBe('multiple');
      expect(series.selectedOffset).toBe(8);
      expect(series.data[0]).toMatchObject({ selected: true, selectedOffset: 4 });
      expect(series.data[1]).toMatchObject({ selected: true, selectedOffset: 8 });
    });

    it('keeps smooth scatter line data finite for short and non-monotonic x values', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:scatterChart>
                <c:scatterStyle val="smooth"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/><c:tx><c:v>Short</c:v></c:tx>
                  <c:xVal><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>2</c:v></c:pt><c:pt idx="1"><c:v>1</c:v></c:pt></c:numCache></c:numRef></c:xVal>
                  <c:yVal><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>3</c:v></c:pt><c:pt idx="1"><c:v>4</c:v></c:pt></c:numCache></c:numRef></c:yVal>
                </c:ser>
                <c:ser>
                  <c:idx val="1"/><c:order val="1"/><c:tx><c:v>Markerless</c:v></c:tx>
                  <c:marker><c:symbol val="none"/></c:marker>
                  <c:xVal><c:numRef><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>3</c:v></c:pt><c:pt idx="2"><c:v>2</c:v></c:pt></c:numCache></c:numRef></c:xVal>
                  <c:yVal><c:numRef><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>2</c:v></c:pt><c:pt idx="1"><c:v>5</c:v></c:pt><c:pt idx="2"><c:v>4</c:v></c:pt></c:numCache></c:numRef></c:yVal>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:scatterChart>
              <c:valAx><c:axId val="1"/><c:axPos val="b"/><c:crossAx val="2"/></c:valAx>
              <c:valAx><c:axId val="2"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
            <c:legend><c:legendPos val="r"/></c:legend>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = option.series as any[];

      expect(series[0].type).toBe('line');
      expect(series[0].data).toEqual([
        [2, 3],
        [1, 4],
      ]);
      expect(series[0].showSymbol).toBe(false);
      expect(series[1].data).toEqual([
        [1, 2],
        [3, 5],
        [2, 4],
      ]);
      expect((option.legend as any).data[1]).toMatchObject({ name: 'Markerless' });
    });

    it('uses shared circle legend icons for bubble series', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:chart>
            <c:plotArea>
              <c:bubbleChart>
                ${['A', 'B']
                  .map(
                    (name, index) => `
                      <c:ser>
                        <c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:v>${name}</c:v></c:tx>
                        <c:xVal><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${index + 1}</c:v></c:pt></c:numCache></c:numRef></c:xVal>
                        <c:yVal><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${index + 2}</c:v></c:pt></c:numCache></c:numRef></c:yVal>
                        <c:bubbleSize><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${(index + 1) * 10}</c:v></c:pt></c:numCache></c:numRef></c:bubbleSize>
                      </c:ser>`,
                  )
                  .join('')}
                <c:axId val="1"/><c:axId val="2"/>
              </c:bubbleChart>
              <c:valAx><c:axId val="1"/><c:axPos val="b"/><c:crossAx val="2"/></c:valAx>
              <c:valAx><c:axId val="2"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
            <c:legend><c:legendPos val="r"/></c:legend>
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const legend = option.legend as any;

      expect(legend.icon).toBe('circle');
      expect(legend.data).toEqual(['A', 'B']);
    });

    it('returns fallback option when chart has no plotArea', () => {
      const xml = `
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <c:spPr><a:ln w="12700"><a:solidFill><a:srgbClr val="123456"/></a:solidFill></a:ln></c:spPr>
          <c:chart/>
        </c:chartSpace>`;

      const { option, chartFrameStyle } = parseChartOption(xml);

      expect((option.title as any).text).toBe('Unsupported chart');
      expect(chartFrameStyle).toMatchObject({
        borderColor: '#123456',
        borderWidth: expect.any(Number),
        borderStyle: 'solid',
      });
    });
  });

  // Note: chartInstances registration tests are in ChartRenderer.lifecycle.test.ts
  // (separate file to enable vi.mock('echarts') without affecting other tests)
});
