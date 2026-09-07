import { describe, expect, it } from 'vitest';
import {
  buildChartPalette,
  createChartRenderContext,
  parseChartStyleId,
} from '../../../../src/renderer/chart/palette';
import { parseXml } from '../../../../src/parser/XmlParser';
import { createMockRenderContext } from '../../helpers/mockContext';

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
