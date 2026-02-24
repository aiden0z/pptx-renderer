/**
 * Tests for ECharts instance lifecycle management (registration/disposal).
 * Separate file because vi.mock('echarts') must be hoisted and would affect other tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ECharts } from 'echarts';

// Mock echarts before importing modules that use it
const mockChartInstance = {
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  isDisposed: vi.fn(() => false),
  getDom: vi.fn(() => document.createElement('div')),
};

vi.mock('echarts', () => ({
  init: vi.fn(() => mockChartInstance),
}));

import { renderChart } from '../../../src/renderer/ChartRenderer';
import { createMockRenderContext } from '../helpers/mockContext';
import { parseXml } from '../../../src/parser/XmlParser';
import type { ChartNodeData } from '../../../src/model/nodes/ChartNode';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSimpleChartXml(): string {
  return `
    <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <c:chart>
        <c:autoTitleDeleted val="1"/>
        <c:plotArea>
          <c:barChart>
            <c:grouping val="clustered"/>
            <c:ser>
              <c:idx val="0"/><c:order val="0"/>
              <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
              <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
              <c:val><c:numRef><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>1</c:v></c:pt></c:numCache></c:numRef></c:val>
            </c:ser>
          </c:barChart>
          <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
          <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
        </c:plotArea>
      </c:chart>
    </c:chartSpace>
  `;
}

function makeChartNode(): ChartNodeData {
  return {
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
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChartRenderer chartInstances lifecycle', () => {
  let rafCallbacks: (() => void)[];
  let rafSpy: any;

  beforeEach(() => {
    rafCallbacks = [];
    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb as () => void);
      return rafCallbacks.length;
    });

    // Reset mock state
    mockChartInstance.setOption.mockClear();
    mockChartInstance.resize.mockClear();
    mockChartInstance.dispose.mockClear();
    mockChartInstance.isDisposed.mockReturnValue(false);

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

  it('registers ECharts instance into chartInstances set', () => {
    const chartInstances = new Set<ECharts>();
    const ctx = createMockRenderContext({ chartInstances });
    ctx.presentation.charts = new Map([
      ['ppt/charts/chart1.xml', parseXml(buildSimpleChartXml())],
    ]);

    const wrapper = renderChart(makeChartNode(), ctx);
    document.body.appendChild(wrapper);

    const chartDiv = wrapper.querySelector('div') as HTMLElement;
    Object.defineProperty(chartDiv, 'offsetWidth', { value: 400, configurable: true });
    Object.defineProperty(chartDiv, 'offsetHeight', { value: 300, configurable: true });

    for (const cb of rafCallbacks) cb();

    expect(chartInstances.size).toBe(1);
    expect(chartInstances.has(mockChartInstance as any)).toBe(true);

    document.body.removeChild(wrapper);
  });

  it('registered instances can be disposed via set iteration (disposeAllCharts pattern)', () => {
    const chartInstances = new Set<ECharts>();
    const ctx = createMockRenderContext({ chartInstances });
    ctx.presentation.charts = new Map([
      ['ppt/charts/chart1.xml', parseXml(buildSimpleChartXml())],
    ]);

    const wrapper = renderChart(makeChartNode(), ctx);
    document.body.appendChild(wrapper);

    const chartDiv = wrapper.querySelector('div') as HTMLElement;
    Object.defineProperty(chartDiv, 'offsetWidth', { value: 400, configurable: true });
    Object.defineProperty(chartDiv, 'offsetHeight', { value: 300, configurable: true });

    for (const cb of rafCallbacks) cb();
    expect(chartInstances.size).toBe(1);

    // Simulate Renderer.disposeAllCharts()
    for (const chart of chartInstances) {
      if (!(chart as any).isDisposed()) (chart as any).dispose();
    }
    chartInstances.clear();

    expect(chartInstances.size).toBe(0);
    expect(mockChartInstance.dispose).toHaveBeenCalled();

    document.body.removeChild(wrapper);
  });

  it('does not register when chartInstances is undefined', () => {
    const ctx = createMockRenderContext(); // no chartInstances
    ctx.presentation.charts = new Map([
      ['ppt/charts/chart1.xml', parseXml(buildSimpleChartXml())],
    ]);

    const wrapper = renderChart(makeChartNode(), ctx);
    document.body.appendChild(wrapper);

    const chartDiv = wrapper.querySelector('div') as HTMLElement;
    Object.defineProperty(chartDiv, 'offsetWidth', { value: 400, configurable: true });
    Object.defineProperty(chartDiv, 'offsetHeight', { value: 300, configurable: true });

    for (const cb of rafCallbacks) cb();

    // Should not throw; echarts.init is still called but nothing registered
    expect(mockChartInstance.setOption).toHaveBeenCalled();

    document.body.removeChild(wrapper);
  });
});
