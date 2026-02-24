import { describe, expect, it } from 'vitest';
import { createRenderContext } from '../../../src/renderer/RenderContext';
import type { PresentationData } from '../../../src/model/Presentation';
import type { SlideData } from '../../../src/model/Slide';
import { SafeXmlNode } from '../../../src/parser/XmlParser';

function makePres(opts: {
  layoutPath?: string;
  masterPath?: string;
  themePath?: string;
} = {}): PresentationData {
  const emptyXml = new SafeXmlNode(null);
  const layoutPath = opts.layoutPath ?? 'ppt/slideLayouts/slideLayout1.xml';
  const masterPath = opts.masterPath ?? 'ppt/slideMasters/slideMaster1.xml';
  const themePath = opts.themePath ?? 'ppt/theme/theme1.xml';

  const pres: PresentationData = {
    width: 960,
    height: 540,
    slides: [],
    layouts: new Map([
      [layoutPath, {
        placeholders: [],
        spTree: emptyXml,
        rels: new Map(),
        showMasterSp: true,
      }],
    ]),
    masters: new Map([
      [masterPath, {
        colorMap: new Map([['tx1', 'dk1']]),
        textStyles: {},
        placeholders: [],
        spTree: emptyXml,
        rels: new Map(),
      }],
    ]),
    themes: new Map([
      [themePath, {
        colorScheme: new Map([['dk1', '000000']]),
        majorFont: { latin: 'Arial', ea: '', cs: '' },
        minorFont: { latin: 'Arial', ea: '', cs: '' },
        fillStyles: [],
        lineStyles: [],
        effectStyles: [],
      }],
    ]),
    slideToLayout: new Map([[0, layoutPath]]),
    layoutToMaster: new Map([[layoutPath, masterPath]]),
    masterToTheme: new Map([[masterPath, themePath]]),
    media: new Map(),
    charts: new Map(),
    isWps: false,
  } as PresentationData;

  return pres;
}

function makeSlide(): SlideData {
  return {
    index: 0,
    nodes: [],
    rels: new Map(),
    showMasterSp: true,
  };
}

describe('createRenderContext', () => {
  it('resolves layout, master, theme from chain', () => {
    const pres = makePres();
    const slide = makeSlide();
    const ctx = createRenderContext(pres, slide);

    expect(ctx.presentation).toBe(pres);
    expect(ctx.slide).toBe(slide);
    expect(ctx.theme.colorScheme.get('dk1')).toBe('000000');
    expect(ctx.master.colorMap.get('tx1')).toBe('dk1');
    expect(ctx.layout.showMasterSp).toBe(true);
  });

  it('uses default values when chain is broken', () => {
    const pres = makePres();
    pres.slideToLayout.clear();
    const ctx = createRenderContext(pres, makeSlide());

    // Should not throw, uses empty defaults
    expect(ctx.theme.majorFont.latin).toBe('Calibri'); // default fallback
    expect(ctx.master.colorMap.size).toBe(0);
    expect(ctx.layout.placeholders).toHaveLength(0);
  });

  it('uses provided mediaUrlCache', () => {
    const cache = new Map<string, string>();
    cache.set('test.png', 'blob:123');
    const ctx = createRenderContext(makePres(), makeSlide(), cache);
    expect(ctx.mediaUrlCache).toBe(cache);
    expect(ctx.mediaUrlCache.get('test.png')).toBe('blob:123');
  });

  it('creates new mediaUrlCache when not provided', () => {
    const ctx = createRenderContext(makePres(), makeSlide());
    expect(ctx.mediaUrlCache).toBeInstanceOf(Map);
    expect(ctx.mediaUrlCache.size).toBe(0);
  });

  it('initializes empty colorCache', () => {
    const ctx = createRenderContext(makePres(), makeSlide());
    expect(ctx.colorCache).toBeInstanceOf(Map);
    expect(ctx.colorCache.size).toBe(0);
  });
});
