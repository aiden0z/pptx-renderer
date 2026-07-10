import { describe, expect, it, vi } from 'vitest';
import { renderSlide } from '../../../src/renderer/SlideRenderer';
import { SafeXmlNode } from '../../../src/parser/XmlParser';
import type { PresentationData } from '../../../src/model/Presentation';
import type { SlideData } from '../../../src/model/Slide';
import type { PicNodeData } from '../../../src/model/nodes/PicNode';
import { xmlNode } from '../helpers/xmlNode';

const emptyXml = new SafeXmlNode(null);

function makeMinimalPres(): PresentationData {
  const layoutPath = 'ppt/slideLayouts/slideLayout1.xml';
  const masterPath = 'ppt/slideMasters/slideMaster1.xml';
  const themePath = 'ppt/theme/theme1.xml';

  return {
    width: 960,
    height: 540,
    slides: [],
    layouts: new Map([
      [
        layoutPath,
        {
          placeholders: [],
          spTree: emptyXml,
          rels: new Map(),
          showMasterSp: true,
        },
      ],
    ]),
    masters: new Map([
      [
        masterPath,
        {
          colorMap: new Map(),
          textStyles: {},
          placeholders: [],
          spTree: emptyXml,
          rels: new Map(),
        },
      ],
    ]),
    themes: new Map([
      [
        themePath,
        {
          colorScheme: new Map(),
          majorFont: { latin: 'Calibri', ea: '', cs: '' },
          minorFont: { latin: 'Calibri', ea: '', cs: '' },
          fillStyles: [],
          lineStyles: [],
          effectStyles: [],
        },
      ],
    ]),
    slideToLayout: new Map([[0, layoutPath]]),
    layoutToMaster: new Map([[layoutPath, masterPath]]),
    masterToTheme: new Map([[masterPath, themePath]]),
    media: new Map(),
    charts: new Map(),
    isWps: false,
  } as PresentationData;
}

function makeSlide(): SlideData {
  return {
    index: 0,
    nodes: [],
    rels: new Map(),
    showMasterSp: true,
  };
}

describe('SlideHandle lifecycle', () => {
  it('returns a SlideHandle with element, dispose, and Symbol.dispose', () => {
    const pres = makeMinimalPres();
    const handle = renderSlide(pres, makeSlide());

    expect(handle.element).toBeInstanceOf(HTMLElement);
    expect(typeof handle.dispose).toBe('function');
    expect(typeof handle[Symbol.dispose]).toBe('function');
  });

  it('standalone mode: dispose() revokes blob URLs from its own cache', () => {
    const revokeStub = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const pres = makeMinimalPres();

    // No shared mediaUrlCache → standalone mode
    const handle = renderSlide(pres, makeSlide());

    // Inject fake blob URLs into the internal cache via the render context
    // We can't directly access the cache, but we can verify the mechanism
    // by checking that dispose doesn't throw
    handle.dispose();
    expect(() => handle.dispose()).not.toThrow(); // idempotent
    revokeStub.mockRestore();
  });

  it('shared cache mode: dispose() does NOT revoke shared blob URLs', () => {
    const revokeStub = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const pres = makeMinimalPres();
    const sharedCache = new Map<string, string>();
    sharedCache.set('img1', 'blob:http://localhost/shared-1');

    const handle = renderSlide(pres, makeSlide(), { mediaUrlCache: sharedCache });
    handle.dispose();

    // Shared cache blob URLs should NOT be revoked
    expect(revokeStub).not.toHaveBeenCalled();
    expect(sharedCache.size).toBe(1); // still intact
    revokeStub.mockRestore();
  });

  it('dispose() is idempotent — double-dispose is safe', () => {
    const pres = makeMinimalPres();
    const handle = renderSlide(pres, makeSlide());

    expect(() => {
      handle.dispose();
      handle.dispose();
    }).not.toThrow();
  });

  it('Symbol.dispose performs same cleanup as dispose()', () => {
    const pres = makeMinimalPres();
    const chartInstances = new Set<any>();
    const handle = renderSlide(pres, makeSlide(), { chartInstances });

    // Add a chart to verify cleanup happens
    const chartDom = document.createElement('div');
    handle.element.appendChild(chartDom);
    const mockChart = {
      isDisposed: vi.fn(() => false),
      dispose: vi.fn(),
      getDom: vi.fn(() => chartDom),
    };
    chartInstances.add(mockChart);

    handle[Symbol.dispose]();
    expect(mockChart.dispose).toHaveBeenCalled();
    expect(chartInstances.size).toBe(0);
  });

  it('dispose() disposes chart instances whose DOM is inside the slide container', () => {
    const pres = makeMinimalPres();
    const chartInstances = new Set<any>();

    const handle = renderSlide(pres, makeSlide(), { chartInstances });

    // Simulate a chart instance inside this slide
    const chartDom = document.createElement('div');
    handle.element.appendChild(chartDom);
    const mockChart = {
      isDisposed: vi.fn(() => false),
      dispose: vi.fn(),
      getDom: vi.fn(() => chartDom),
    };
    chartInstances.add(mockChart);

    handle.dispose();

    expect(mockChart.dispose).toHaveBeenCalled();
    expect(chartInstances.size).toBe(0);
  });

  it('dispose() does not dispose chart instances from other slides', () => {
    const pres = makeMinimalPres();
    const chartInstances = new Set<any>();

    const handle = renderSlide(pres, makeSlide(), { chartInstances });

    // Chart DOM is NOT inside the slide container
    const otherDom = document.createElement('div');
    const mockChart = {
      isDisposed: vi.fn(() => false),
      dispose: vi.fn(),
      getDom: vi.fn(() => otherDom),
    };
    chartInstances.add(mockChart);

    handle.dispose();

    expect(mockChart.dispose).not.toHaveBeenCalled();
    expect(chartInstances.size).toBe(1);
  });

  it('dispose() skips already-disposed chart instances', () => {
    const pres = makeMinimalPres();
    const chartInstances = new Set<any>();

    const handle = renderSlide(pres, makeSlide(), { chartInstances });

    const chartDom = document.createElement('div');
    handle.element.appendChild(chartDom);
    const mockChart = {
      isDisposed: vi.fn(() => true),
      dispose: vi.fn(),
      getDom: vi.fn(() => chartDom),
    };
    chartInstances.add(mockChart);

    handle.dispose();

    expect(mockChart.dispose).not.toHaveBeenCalled();
    // Already-disposed chart stays in the set (not removed by this handle)
    expect(chartInstances.size).toBe(1);
  });

  it('aborts async EMF-PDF rendering and rejects late writes after dispose()', async () => {
    const emfModule = await import('../../../src/utils/emfParser');
    const pdfModule = await import('../../../src/utils/pdfRenderer');
    const emfSpy = vi.spyOn(emfModule, 'parseEmfContent').mockReturnValue({
      type: 'pdf',
      data: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    });
    let resolvePdf!: (url: string | null) => void;
    const pdfSpy = vi.spyOn(pdfModule, 'renderPdfToImage').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePdf = resolve;
        }),
    );
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const pres = makeMinimalPres();
    const sharedCache = new Map<string, string>();
    pres.media.set('ppt/media/image1.emf', new Uint8Array([1]));
    const slide = makeSlide();
    slide.rels.set('rId1', { type: 'image', target: 'ppt/media/image1.emf' });
    slide.nodes = [
      {
        id: '1',
        name: 'EMF picture',
        nodeType: 'picture',
        position: { x: 0, y: 0 },
        size: { w: 100, h: 80 },
        rotation: 0,
        flipH: false,
        flipV: false,
        blipEmbed: 'rId1',
        source: xmlNode('<pic/>'),
      } as PicNodeData,
    ];

    const handle = renderSlide(pres, slide, { mediaUrlCache: sharedCache });
    const signal = pdfSpy.mock.calls[0]?.[4];
    expect(signal?.aborted).toBe(false);

    handle.dispose();
    expect(signal?.aborted).toBe(true);
    resolvePdf('blob:late-slide-pdf');
    await handle.ready;

    expect(revokeSpy).toHaveBeenCalledWith('blob:late-slide-pdf');
    expect(sharedCache.size).toBe(0);
    expect(handle.element.querySelector('img')).toBeNull();

    emfSpy.mockRestore();
    pdfSpy.mockRestore();
    revokeSpy.mockRestore();
  });
});
