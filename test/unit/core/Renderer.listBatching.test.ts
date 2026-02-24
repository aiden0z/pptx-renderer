import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/parser/ZipParser', () => ({
  parseZip: vi.fn(async () => ({})),
}));

vi.mock('../../../src/model/Presentation', () => ({
  buildPresentation: vi.fn(() => {
    const slides = Array.from({ length: 4 }, (_, i) => ({
      index: i,
      nodes: [],
      layoutIndex: '',
      rels: new Map(),
      showMasterSp: true,
      slidePath: `ppt/slides/slide${i + 1}.xml`,
    }));
    return {
      width: 1000,
      height: 750,
      slides,
      layouts: new Map(),
      masters: new Map(),
      themes: new Map(),
      slideToLayout: new Map(),
      layoutToMaster: new Map(),
      masterToTheme: new Map(),
      media: new Map(),
      charts: new Map(),
      isWps: false,
    };
  }),
}));

vi.mock('../../../src/renderer/SlideRenderer', () => ({
  renderSlide: vi.fn(() => {
    const el = document.createElement('div');
    el.textContent = 'slide';
    return el;
  }),
}));

import { PptxRenderer } from '../../../src/core/Renderer';

describe('PptxRenderer list batching', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('appends batched fragments in list mode', async () => {
    const container = document.createElement('div');
    const appendSpy = vi.spyOn(container, 'appendChild');

    const renderer = new PptxRenderer(container, {
      mode: 'list',
      listRenderBatchSize: 2,
    });

    await renderer.preview(new ArrayBuffer(8));

    // 4 slides with batch size 2 should flush 2 batched appends.
    expect(appendSpy).toHaveBeenCalledTimes(2);
  });
});
