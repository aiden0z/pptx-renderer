/**
 * Tests for ECharts instance lifecycle management (registration/disposal).
 * Separate file because the runtime mock must be hoisted and would affect other tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { echarts } from '../../../src/renderer/chart/echartsRuntime';
import type { EChartsType } from 'echarts/core';

// Mock the registered runtime before importing modules that use it.
const mockChartInstance = {
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  isDisposed: vi.fn(() => false),
  getDom: vi.fn(() => document.createElement('div')),
};

vi.mock('../../../src/renderer/chart/echartsRuntime', () => ({
  echarts: { init: vi.fn(() => mockChartInstance) },
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

function buildScatterLegendChartXml(): string {
  return `
    <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <c:chart>
        <c:plotArea>
          <c:scatterChart>
            <c:scatterStyle val="smoothMarker"/>
            <c:ser>
              <c:idx val="0"/><c:order val="0"/>
              <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Y 值</c:v></c:pt></c:strCache></c:strRef></c:tx>
              <c:marker><c:symbol val="none"/></c:marker>
              <c:xVal><c:numRef><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>0.7</c:v></c:pt><c:pt idx="1"><c:v>1.8</c:v></c:pt><c:pt idx="2"><c:v>2.6</c:v></c:pt></c:numCache></c:numRef></c:xVal>
              <c:yVal><c:numRef><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>2.7</c:v></c:pt><c:pt idx="1"><c:v>3.2</c:v></c:pt><c:pt idx="2"><c:v>0.8</c:v></c:pt></c:numCache></c:numRef></c:yVal>
              <c:smooth val="1"/>
            </c:ser>
            <c:axId val="1"/><c:axId val="2"/>
          </c:scatterChart>
          <c:valAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:valAx>
          <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
        </c:plotArea>
        <c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>
      </c:chart>
    </c:chartSpace>
  `;
}

function buildLineLegendChartXml(): string {
  return `
    <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <c:chart>
        <c:plotArea>
          <c:lineChart>
            <c:grouping val="standard"/>
            <c:ser>
              <c:idx val="0"/><c:order val="0"/>
              <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>系列 1</c:v></c:pt></c:strCache></c:strRef></c:tx>
              <c:marker><c:symbol val="none"/></c:marker>
              <c:spPr>
                <a:ln w="38100">
                  <a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>
                </a:ln>
              </c:spPr>
              <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
              <c:val><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt></c:numCache></c:numRef></c:val>
            </c:ser>
            <c:axId val="1"/><c:axId val="2"/>
          </c:lineChart>
          <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
          <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
        </c:plotArea>
        <c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>
      </c:chart>
    </c:chartSpace>
  `;
}

function buildBarLegendPaletteChartXml(): string {
  return `
    <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
                  xmlns:c14="http://schemas.microsoft.com/office/drawing/2007/8/2/chart">
      <mc:AlternateContent>
        <mc:Choice Requires="c14"><c14:style val="102"/></mc:Choice>
        <mc:Fallback><c:style val="2"/></mc:Fallback>
      </mc:AlternateContent>
      <c:chart>
        <c:plotArea>
          <c:barChart>
            <c:barDir val="col"/><c:grouping val="clustered"/>
            <c:ser>
              <c:idx val="0"/><c:order val="0"/>
              <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>系列 1</c:v></c:pt></c:strCache></c:strRef></c:tx>
              <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
              <c:val><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>1</c:v></c:pt></c:numCache></c:numRef></c:val>
            </c:ser>
            <c:ser>
              <c:idx val="1"/><c:order val="1"/>
              <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>系列 2</c:v></c:pt></c:strCache></c:strRef></c:tx>
              <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
              <c:val><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>2</c:v></c:pt></c:numCache></c:numRef></c:val>
            </c:ser>
            <c:ser>
              <c:idx val="2"/><c:order val="2"/>
              <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>系列 3</c:v></c:pt></c:strCache></c:strRef></c:tx>
              <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
              <c:val><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>3</c:v></c:pt></c:numCache></c:numRef></c:val>
            </c:ser>
            <c:axId val="1"/><c:axId val="2"/>
          </c:barChart>
          <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
          <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
        </c:plotArea>
        <c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>
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
    vi.mocked(echarts.init).mockClear();
    vi.mocked(echarts.init).mockImplementation(() => mockChartInstance as any);

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
    const chartInstances = new Set<EChartsType>();
    const ctx = createMockRenderContext({ chartInstances });
    ctx.presentation.charts = new Map([['ppt/charts/chart1.xml', parseXml(buildSimpleChartXml())]]);

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

  it('initializes chart when ResizeObserver is unavailable', () => {
    const originalResizeObserver = window.ResizeObserver;
    const chartInstances = new Set<EChartsType>();
    const ctx = createMockRenderContext({ chartInstances });
    ctx.presentation.charts = new Map([['ppt/charts/chart1.xml', parseXml(buildSimpleChartXml())]]);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      delete (window as any).ResizeObserver;

      const wrapper = renderChart(makeChartNode(), ctx);
      document.body.appendChild(wrapper);

      const chartDiv = wrapper.querySelector('div') as HTMLElement;
      Object.defineProperty(chartDiv, 'offsetWidth', { value: 400, configurable: true });
      Object.defineProperty(chartDiv, 'offsetHeight', { value: 300, configurable: true });

      for (const cb of rafCallbacks) cb();

      expect(mockChartInstance.setOption).toHaveBeenCalled();
      expect(chartInstances.has(mockChartInstance as any)).toBe(true);
      expect(wrapper.textContent).not.toBe('Chart render error');
      expect(warnSpy).not.toHaveBeenCalled();

      document.body.removeChild(wrapper);
    } finally {
      if (originalResizeObserver) {
        window.ResizeObserver = originalResizeObserver;
      } else {
        delete (window as any).ResizeObserver;
      }
      warnSpy.mockRestore();
    }
  });

  it('does not initialize deferred chart after the container is removed', () => {
    const originalResizeObserver = window.ResizeObserver;
    const chartInstances = new Set<EChartsType>();
    const ctx = createMockRenderContext({ chartInstances });
    ctx.presentation.charts = new Map([['ppt/charts/chart1.xml', parseXml(buildSimpleChartXml())]]);
    let roCallback: ResizeObserverCallback | undefined;
    const disconnectSpy = vi.fn();

    (window as any).ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        roCallback = callback;
      }
      observe = vi.fn();
      disconnect = disconnectSpy;
    };

    try {
      const wrapper = renderChart(makeChartNode(), ctx);
      document.body.appendChild(wrapper);

      const chartDiv = wrapper.querySelector('div') as HTMLElement;
      Object.defineProperty(chartDiv, 'offsetWidth', { value: 0, configurable: true });
      Object.defineProperty(chartDiv, 'offsetHeight', { value: 0, configurable: true });

      for (const cb of rafCallbacks) cb();
      document.body.removeChild(wrapper);
      roCallback?.(
        [{ contentRect: { width: 400, height: 300 } } as ResizeObserverEntry],
        {} as any,
      );

      expect(disconnectSpy).toHaveBeenCalled();
      expect(mockChartInstance.setOption).not.toHaveBeenCalled();
      expect(chartInstances.size).toBe(0);
    } finally {
      if (originalResizeObserver) {
        window.ResizeObserver = originalResizeObserver;
      } else {
        delete (window as any).ResizeObserver;
      }
    }
  });

  it('registered instances can be disposed via set iteration (disposeAllCharts pattern)', () => {
    const chartInstances = new Set<EChartsType>();
    const ctx = createMockRenderContext({ chartInstances });
    ctx.presentation.charts = new Map([['ppt/charts/chart1.xml', parseXml(buildSimpleChartXml())]]);

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
    ctx.presentation.charts = new Map([['ppt/charts/chart1.xml', parseXml(buildSimpleChartXml())]]);

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

  it('resizes while connected and disposes observer-owned charts after container removal', () => {
    const originalResizeObserver = window.ResizeObserver;
    const chartInstances = new Set<EChartsType>();
    const ctx = createMockRenderContext({ chartInstances });
    ctx.presentation.charts = new Map([['ppt/charts/chart1.xml', parseXml(buildSimpleChartXml())]]);
    const disconnectSpy = vi.fn();
    const roCallbacks: ResizeObserverCallback[] = [];

    (window as any).ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        roCallbacks.push(callback);
      }
      observe = vi.fn();
      disconnect = disconnectSpy;
    };

    try {
      const wrapper = renderChart(makeChartNode(), ctx);
      document.body.appendChild(wrapper);

      const chartDiv = wrapper.querySelector('div') as HTMLElement;
      Object.defineProperty(chartDiv, 'offsetWidth', { value: 400, configurable: true });
      Object.defineProperty(chartDiv, 'offsetHeight', { value: 300, configurable: true });

      for (const cb of rafCallbacks) cb();
      expect(chartInstances.has(mockChartInstance as any)).toBe(true);

      const initObserverCallback = roCallbacks.at(-1);
      expect(initObserverCallback).toBeDefined();
      initObserverCallback?.([], {} as any);
      expect(mockChartInstance.resize).toHaveBeenCalledTimes(1);

      document.body.removeChild(wrapper);
      initObserverCallback?.([], {} as any);

      expect(disconnectSpy).toHaveBeenCalled();
      expect(mockChartInstance.dispose).toHaveBeenCalled();
      expect(chartInstances.has(mockChartInstance as any)).toBe(false);
    } finally {
      if (originalResizeObserver) {
        window.ResizeObserver = originalResizeObserver;
      } else {
        delete (window as any).ResizeObserver;
      }
    }
  });

  it('shows chart render error fallback when echarts initialization throws', () => {
    const ctx = createMockRenderContext();
    ctx.presentation.charts = new Map([['ppt/charts/chart1.xml', parseXml(buildSimpleChartXml())]]);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(echarts.init).mockImplementationOnce(() => {
      throw new Error('init failed');
    });

    const wrapper = renderChart(makeChartNode(), ctx);
    document.body.appendChild(wrapper);

    const chartDiv = wrapper.querySelector('div') as HTMLElement;
    Object.defineProperty(chartDiv, 'offsetWidth', { value: 400, configurable: true });
    Object.defineProperty(chartDiv, 'offsetHeight', { value: 300, configurable: true });

    try {
      for (const cb of rafCallbacks) cb();

      expect(chartDiv.textContent).toBe('Chart render error');
      expect(chartDiv.style.display).toBe('flex');
      expect(chartDiv.style.alignItems).toBe('center');
      expect(warnSpy).toHaveBeenCalledWith('Failed to initialize ECharts:', expect.any(Error));
    } finally {
      document.body.removeChild(wrapper);
      warnSpy.mockRestore();
    }
  });

  it('renders custom side legend overlay and disables echarts legend for right-side scatter legends', () => {
    const ctx = createMockRenderContext();
    ctx.presentation.charts = new Map([
      ['ppt/charts/chart1.xml', parseXml(buildScatterLegendChartXml())],
    ]);

    const wrapper = renderChart(makeChartNode(), ctx);
    document.body.appendChild(wrapper);

    const chartDiv = wrapper.querySelector('div') as HTMLElement;
    Object.defineProperty(chartDiv, 'offsetWidth', { value: 400, configurable: true });
    Object.defineProperty(chartDiv, 'offsetHeight', { value: 300, configurable: true });

    for (const cb of rafCallbacks) cb();

    const overlay = wrapper.querySelector('.pptx-chart-custom-legend') as HTMLElement | null;
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain('Y 值');

    const option = mockChartInstance.setOption.mock.calls[0]?.[0] as any;
    expect(option?.legend?.show).toBe(false);

    document.body.removeChild(wrapper);
  });

  it('uses series line width for custom line legend icons', () => {
    const ctx = createMockRenderContext();
    ctx.presentation.charts = new Map([
      ['ppt/charts/chart1.xml', parseXml(buildLineLegendChartXml())],
    ]);

    const wrapper = renderChart(makeChartNode(), ctx);
    document.body.appendChild(wrapper);

    const chartDiv = wrapper.querySelector('div') as HTMLElement;
    Object.defineProperty(chartDiv, 'offsetWidth', { value: 400, configurable: true });
    Object.defineProperty(chartDiv, 'offsetHeight', { value: 300, configurable: true });

    for (const cb of rafCallbacks) cb();

    const iconPath = wrapper.querySelector(
      '.pptx-chart-custom-legend svg path',
    ) as SVGPathElement | null;
    expect(iconPath).not.toBeNull();
    expect(iconPath?.getAttribute('stroke-width')).toBe('3');

    document.body.removeChild(wrapper);
  });

  it('uses chart palette colors for custom bar legend icons when series styles are implicit', () => {
    const ctx = createMockRenderContext();
    ctx.presentation.charts = new Map([
      ['ppt/charts/chart1.xml', parseXml(buildBarLegendPaletteChartXml())],
    ]);

    const wrapper = renderChart(makeChartNode(), ctx);
    document.body.appendChild(wrapper);

    const chartDiv = wrapper.querySelector('div') as HTMLElement;
    Object.defineProperty(chartDiv, 'offsetWidth', { value: 400, configurable: true });
    Object.defineProperty(chartDiv, 'offsetHeight', { value: 300, configurable: true });

    for (const cb of rafCallbacks) cb();

    const iconRects = wrapper.querySelectorAll('.pptx-chart-custom-legend svg rect');
    const option = mockChartInstance.setOption.mock.calls[0]?.[0] as any;
    const palette = option?.color as string[] | undefined;
    expect(iconRects).toHaveLength(3);
    expect(Array.isArray(palette)).toBe(true);
    expect(iconRects[0]?.getAttribute('fill')).toBe(palette?.[0]);
    expect(iconRects[1]?.getAttribute('fill')).toBe(palette?.[1]);
    expect(iconRects[2]?.getAttribute('fill')).toBe(palette?.[2]);

    document.body.removeChild(wrapper);
  });
});
