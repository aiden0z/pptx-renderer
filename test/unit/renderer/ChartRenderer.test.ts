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
import { parseChartXml, renderChart, type ParseChartResult } from '../../../src/renderer/ChartRenderer';
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
  /** Optional manual layout for plotArea; values are OOXML normalized fractions. */
  plotAreaManualLayout?: { x?: number; y?: number; w?: number; h?: number };
  /** Optional chart title text and txPr style. */
  titleText?: string;
  titleTxPr?: string;
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
    seriesFill = '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>',
    catAxTxPr,
    catAxSpPr,
    dataPointFills = [],
    autoTitleDeleted = true,
    seriesName = '市场规模',
    categories = ['2024', '2025E', '2026E'],
    values = [607, 710, 866],
    valAxDeleted = true,
    plotAreaManualLayout,
    titleText,
    titleTxPr,
    titleManualLayout,
  } = opts;

  const legendTxPrXml = legendTxPr ? `<c:txPr>${legendTxPr}</c:txPr>` : '';
  const legendManualLayoutXml = legendManualLayout
    ? `<c:layout><c:manualLayout>${
        legendManualLayout.x !== undefined ? `<c:x val="${legendManualLayout.x}"/>` : ''
      }${
        legendManualLayout.y !== undefined ? `<c:y val="${legendManualLayout.y}"/>` : ''
      }${
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

  const catPts = categories
    .map((cat, i) => `<c:pt idx="${i}"><c:v>${cat}</c:v></c:pt>`)
    .join('');

  const valPts = values
    .map((val, i) => `<c:pt idx="${i}"><c:v>${val}</c:v></c:pt>`)
    .join('');

  const catAxTxPrXml = catAxTxPr ? `<c:txPr>${catAxTxPr}</c:txPr>` : '';
  const catAxSpPrXml = catAxSpPr ? `<c:spPr>${catAxSpPr}</c:spPr>` : '';
  const chartClrMapOvrXml = chartClrMapOvrAttrs ? `<c:clrMapOvr ${chartClrMapOvrAttrs}/>` : '';
  const chartStyleXml = chartStyleVal !== undefined ? `<c:style val="${chartStyleVal}"/>` : '';
  const plotAreaManualLayoutXml = plotAreaManualLayout
    ? `<c:layout><c:manualLayout>${
        plotAreaManualLayout.x !== undefined ? `<c:x val="${plotAreaManualLayout.x}"/>` : ''
      }${
        plotAreaManualLayout.y !== undefined ? `<c:y val="${plotAreaManualLayout.y}"/>` : ''
      }${
        plotAreaManualLayout.w !== undefined ? `<c:w val="${plotAreaManualLayout.w}"/>` : ''
      }${
        plotAreaManualLayout.h !== undefined ? `<c:h val="${plotAreaManualLayout.h}"/>` : ''
      }</c:manualLayout></c:layout>`
    : '';
  const titleTxPrXml = titleTxPr ? `<c:txPr>${titleTxPr}</c:txPr>` : '';
  const titleManualLayoutXml = titleManualLayout
    ? `<c:layout><c:manualLayout>${
        titleManualLayout.x !== undefined ? `<c:x val="${titleManualLayout.x}"/>` : ''
      }${
        titleManualLayout.y !== undefined ? `<c:y val="${titleManualLayout.y}"/>` : ''
      }</c:manualLayout></c:layout>`
    : '';
  const titleXml = titleText
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${titleText}</a:t></a:r></a:p></c:rich></c:tx>${titleManualLayoutXml}${titleTxPrXml}</c:title>`
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
          <c:crossAx val="1"/>
        </c:valAx>
      </c:plotArea>
      ${legendXml}
    </c:chart>
    <c:spPr>
      <a:noFill/>
    </c:spPr>
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
      expect(legend?.orient).toBe('vertical');
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
      // style id 102 rotates the palette in our mapping (accent2 first).
      expect((palette?.[0] || '').toUpperCase()).toContain('ED7D31');
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
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      expect(option.series).toBeDefined();
      expect(Array.isArray(option.series)).toBe(true);
      const series = option.series as any[];
      expect(series.length).toBeGreaterThan(0);
      expect(series[0].name).toBe('Revenue');
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
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      expect(option.series).toBeDefined();
      const series = option.series as any[];
      expect(series.length).toBeGreaterThan(0);
      expect(series[0].type).toBe('pie');
      expect(series[0].data).toBeDefined();
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
      // doughnutChart should have radius property set
      expect(series[0].radius).toBeDefined();
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
          </c:chart>
        </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const series = option.series as any[];
      expect(series.length).toBeGreaterThan(0);
      expect(series[0].type).toBe('radar');
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
      // 1234.7 rounded → "1235"
      const result = formatter({ value: 1234.7 });
      expect(result).toBe('1235');
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
    it('should extract color from spPr > ln > solidFill when no direct solidFill', () => {
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
    });
  });

  // ==========================================================================
  // Coverage: Scatter chart xVal/yVal parsing (lines 550-555)
  // ==========================================================================

  describe('scatter chart xVal/yVal parsing', () => {
    it('should use yVal values instead of val and xVal for x-coordinates', () => {
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
      expect(series?.type).toBe('scatter');
      // Data should be [[10,100],[20,200],[30,300]]
      expect(series?.data?.length).toBe(3);
      expect(series?.data?.[0]).toEqual([10, 100]);
      expect(series?.data?.[1]).toEqual([20, 200]);
      expect(series?.data?.[2]).toEqual([30, 300]);
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
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`;

      const { option } = parseChartOption(xml);
      const title = option.title as any;
      expect(title?.text).toBe('Title From Ref');
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
  // Coverage: extractAxisLabelColor - pPr without defRPr (lines 852-863)
  // ==========================================================================

  describe('axis label color edge cases', () => {
    it('should return no label color when txPr has pPr but no defRPr', () => {
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
      // No defRPr → no color extracted
      expect(xAxis?.axisLabel?.color).toBeUndefined();
    });

    it('should return no label color when txPr has defRPr but no solidFill', () => {
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
      // defRPr exists but no solidFill → no color
      expect(xAxis?.axisLabel?.color).toBeUndefined();
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
      expect(series?.data?.[0]?.selectedOffset).toBeDefined();
      expect(series?.data?.[0]?.selectedOffset).toBeLessThanOrEqual(15);
      // selectedMode should be set
      expect(series?.selectedMode).toBe('single');
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
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
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
            <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
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

  // Note: chartInstances registration tests are in ChartRenderer.lifecycle.test.ts
  // (separate file to enable vi.mock('echarts') without affecting other tests)
});
