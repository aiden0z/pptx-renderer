/**
 * Tests for standalone renderSlide() chart disposal.
 *
 * Separate file because the ECharts runtime mock must be hoisted before SlideRenderer
 * imports ChartRenderer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EChartsType } from 'echarts/core';

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

import { renderSlide } from '../../../src/renderer/SlideRenderer';
import { parseXml } from '../../../src/parser/XmlParser';
import type { PresentationData } from '../../../src/model/Presentation';
import type { SlideData } from '../../../src/model/Slide';
import type { ChartNodeData } from '../../../src/model/nodes/ChartNode';

function makePresentation(): PresentationData {
  const slide: SlideData = {
    index: 0,
    nodes: [],
    rels: new Map(),
    slidePath: 'ppt/slides/slide1.xml',
    showMasterSp: true,
  };
  return {
    width: 960,
    height: 540,
    slides: [slide],
    layouts: new Map(),
    masters: new Map(),
    themes: new Map(),
    slideToLayout: new Map(),
    layoutToMaster: new Map(),
    masterToTheme: new Map(),
    media: new Map(),
    charts: new Map([
      [
        'ppt/charts/chart1.xml',
        parseXml(`
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
          <c:chart>
            <c:autoTitleDeleted val="1"/>
            <c:plotArea>
              <c:barChart>
                <c:barDir val="col"/>
                <c:grouping val="clustered"/>
                <c:ser>
                  <c:idx val="0"/><c:order val="0"/>
                  <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>S</c:v></c:pt></c:strCache></c:strRef></c:tx>
                  <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
                  <c:val><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>1</c:v></c:pt></c:numCache></c:numRef></c:val>
                </c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:barChart>
              <c:catAx><c:axId val="1"/><c:delete val="1"/><c:crossAx val="2"/></c:catAx>
              <c:valAx><c:axId val="2"/><c:delete val="1"/><c:crossAx val="1"/></c:valAx>
            </c:plotArea>
          </c:chart>
        </c:chartSpace>
      `),
      ],
    ]),
    isWps: false,
  };
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

describe('renderSlide standalone chart lifecycle', () => {
  let rafCallbacks: (() => void)[];
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    rafCallbacks = [];
    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb as () => void);
      return rafCallbacks.length;
    });
    mockChartInstance.setOption.mockClear();
    mockChartInstance.dispose.mockClear();
    mockChartInstance.isDisposed.mockReturnValue(false);
    mockChartInstance.getDom.mockReset();

    if (!window.ResizeObserver) {
      (window as any).ResizeObserver = class {
        observe = vi.fn();
        disconnect = vi.fn();
      };
    }
  });

  afterEach(() => {
    rafSpy.mockRestore();
    document.body.innerHTML = '';
  });

  it('disposes ECharts instances created by standalone renderSlide()', () => {
    const pres = makePresentation();
    const slide = pres.slides[0];
    slide.nodes = [makeChartNode()];

    const handle = renderSlide(pres, slide);
    const chartWrapper = handle.element.firstElementChild as HTMLElement;
    const chartDiv = chartWrapper.firstElementChild as HTMLElement;
    mockChartInstance.getDom.mockReturnValue(chartDiv);
    Object.defineProperty(chartDiv, 'offsetWidth', { value: 400, configurable: true });
    Object.defineProperty(chartDiv, 'offsetHeight', { value: 300, configurable: true });
    document.body.appendChild(handle.element);

    for (const cb of rafCallbacks) cb();
    expect(mockChartInstance.setOption).toHaveBeenCalled();

    handle.dispose();

    expect(mockChartInstance.dispose).toHaveBeenCalled();
  });

  it('keeps SlideHandle.ready pending until chart RAF initialization runs', async () => {
    const pres = makePresentation();
    const slide = pres.slides[0];
    slide.nodes = [makeChartNode()];

    const handle = renderSlide(pres, slide);
    const chartWrapper = handle.element.firstElementChild as HTMLElement;
    const chartDiv = chartWrapper.firstElementChild as HTMLElement;
    mockChartInstance.getDom.mockReturnValue(chartDiv);
    Object.defineProperty(chartDiv, 'offsetWidth', { value: 400, configurable: true });
    Object.defineProperty(chartDiv, 'offsetHeight', { value: 300, configurable: true });
    document.body.appendChild(handle.element);

    let readyResolved = false;
    void handle.ready.then(() => {
      readyResolved = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(readyResolved).toBe(false);
    expect(mockChartInstance.setOption).not.toHaveBeenCalled();

    for (const cb of rafCallbacks) cb();
    await handle.ready;

    expect(mockChartInstance.setOption).toHaveBeenCalled();
    expect(readyResolved).toBe(true);
  });

  it('resolves SlideHandle.ready after deferring zero-size chart initialization', async () => {
    const pres = makePresentation();
    const slide = pres.slides[0];
    slide.nodes = [makeChartNode()];
    const observeSpy = vi.fn();
    let observedElement: Element | undefined;

    (window as any).ResizeObserver = class {
      observe = vi.fn((element: Element) => {
        observedElement = element;
        observeSpy(element);
      });
      disconnect = vi.fn();
    };

    const handle = renderSlide(pres, slide);
    const chartWrapper = handle.element.firstElementChild as HTMLElement;
    const chartDiv = chartWrapper.firstElementChild as HTMLElement;
    mockChartInstance.getDom.mockReturnValue(chartDiv);
    Object.defineProperty(chartDiv, 'offsetWidth', { value: 0, configurable: true });
    Object.defineProperty(chartDiv, 'offsetHeight', { value: 0, configurable: true });
    document.body.appendChild(handle.element);

    let readyResolved = false;
    void handle.ready.then(() => {
      readyResolved = true;
    });

    for (const cb of rafCallbacks) cb();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    expect(observeSpy).toHaveBeenCalledWith(chartDiv);
    expect(observedElement).toBe(chartDiv);
    expect(mockChartInstance.setOption).not.toHaveBeenCalled();
    expect(readyResolved).toBe(true);
  });

  it('does not dispose caller-owned chart instances outside the slide', () => {
    const pres = makePresentation();
    const slide = pres.slides[0];
    const externalChart = {
      isDisposed: vi.fn(() => false),
      dispose: vi.fn(),
      getDom: vi.fn(() => document.createElement('div')),
    } as unknown as EChartsType;
    const sharedCharts = new Set<EChartsType>([externalChart]);

    const handle = renderSlide(pres, slide, { chartInstances: sharedCharts });
    handle.dispose();

    expect(externalChart.dispose).not.toHaveBeenCalled();
    expect(sharedCharts.has(externalChart)).toBe(true);
  });
});
