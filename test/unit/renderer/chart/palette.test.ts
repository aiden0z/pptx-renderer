import { describe, expect, it } from 'vitest';
import {
  buildChartPalette,
  createChartRenderContext,
  parseChartStyleId,
} from '../../../../src/renderer/chart/palette';
import { parseXml } from '../../../../src/parser/XmlParser';
import { resolveColor } from '../../../../src/renderer/StyleResolver';
import { createMockRenderContext } from '../../helpers/mockContext';

const schemeAccent1 = () => parseXml('<solidFill><schemeClr val="accent1"/></solidFill>');

function withColorMatrix() {
  const ctx = createMockRenderContext();
  ctx.theme.colorScheme = new Map([
    ['accent1', '#FF0000'],
    ['accent2', '#0000FF'],
    ['accent3', '#00FF00'],
  ]);
  ctx.master.colorMap = new Map([['accent1', 'accent1']]);
  return ctx;
}

describe('chart palette helpers', () => {
  it('extracts chart style ids from direct style and AlternateContent branches', () => {
    expect(
      parseChartStyleId(
        parseXml(`
          <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:style val="42"/>
          </c:chartSpace>
        `),
      ),
    ).toBe(42);

    const alt = parseXml(`
      <c:chartSpace xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:c14="http://schemas.microsoft.com/office/drawing/2007/8/2/chart">
        <mc:AlternateContent>
          <mc:Choice><c14:style val="103"/></mc:Choice>
        </mc:AlternateContent>
      </c:chartSpace>
    `);
    expect(parseChartStyleId(alt)).toBe(103);
  });

  it('creates chart-local render context for clrMapOvr without mutating parent cache', () => {
    const ctx = createMockRenderContext();
    const chartXml = parseXml(`
      <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:clrMapOvr tx1="lt1" bg1="dk1"/>
      </c:chartSpace>
    `);

    const chartCtx = createChartRenderContext(chartXml, ctx);

    expect(chartCtx).not.toBe(ctx);
    expect(chartCtx.layout.colorMapOverride?.get('tx1')).toBe('lt1');
    expect(chartCtx.colorCache).not.toBe(ctx.colorCache);
  });

  it('marks chart-local mappings as overrides when the parent layout resets to master', () => {
    const base = createMockRenderContext();
    const ctx = createMockRenderContext({
      layout: { ...base.layout, colorMapOverrideMode: 'master' },
    });
    const chartXml = parseXml(`
      <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:clrMapOvr><c:overrideClrMapping accent1="accent2"/></c:clrMapOvr>
      </c:chartSpace>
    `);

    const chartCtx = createChartRenderContext(chartXml, ctx);

    expect(chartCtx.layout.colorMapOverrideMode).toBe('override');
    expect(chartCtx.layout.colorMapOverride?.get('accent1')).toBe('accent2');
  });

  it.each([
    ['absent', undefined, undefined, '#FF0000'],
    ['master', 'master', undefined, '#FF0000'],
    ['override', 'override', new Map([['accent1', 'accent3']]), '#00FF00'],
  ] as const)(
    'gives chart-local colors precedence when the slide map is %s',
    (_label, mode, map, parentColor) => {
      const ctx = withColorMatrix();
      ctx.slide.colorMapOverrideMode = mode;
      ctx.slide.colorMapOverride = map;
      const originalSlide = ctx.slide;
      const chartXml = parseXml(`
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
          <c:clrMapOvr accent1="accent2"/>
        </c:chartSpace>
      `);

      const chartCtx = createChartRenderContext(chartXml, ctx);

      expect(resolveColor(schemeAccent1(), chartCtx).color).toBe('#0000FF');
      expect(resolveColor(schemeAccent1(), ctx).color).toBe(parentColor);
      expect(ctx.slide).toBe(originalSlide);
      expect(ctx.slide.colorMapOverrideMode).toBe(mode);
      expect(ctx.slide.colorMapOverride).toBe(map);
    },
  );

  it('keeps a chart identity mapping above non-identity slide and master mappings', () => {
    const ctx = withColorMatrix();
    ctx.master.colorMap = new Map([['accent1', 'accent2']]);
    ctx.slide.colorMapOverrideMode = 'override';
    ctx.slide.colorMapOverride = new Map([['accent1', 'accent3']]);
    const chartXml = parseXml(`
      <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:clrMapOvr accent1="accent1"/>
      </c:chartSpace>
    `);

    const chartCtx = createChartRenderContext(chartXml, ctx);

    expect(resolveColor(schemeAccent1(), chartCtx).color).toBe('#FF0000');
    expect(resolveColor(schemeAccent1(), ctx).color).toBe('#00FF00');
  });

  it('retains the parent slide mapping when a chart has no local color map', () => {
    const ctx = withColorMatrix();
    ctx.slide.colorMapOverrideMode = 'override';
    ctx.slide.colorMapOverride = new Map([['accent1', 'accent3']]);
    const chartXml = parseXml(
      '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>',
    );

    const chartCtx = createChartRenderContext(chartXml, ctx);

    expect(chartCtx).toBe(ctx);
    expect(resolveColor(schemeAccent1(), chartCtx).color).toBe('#00FF00');
  });

  it('builds implicit palette from theme accents', () => {
    expect(
      buildChartPalette(
        parseXml(
          '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>',
        ),
        createMockRenderContext(),
      ),
    ).toEqual(['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47']);
  });
});
