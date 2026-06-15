import { describe, expect, it } from 'vitest';
import { resolveSlideNavigationIndex } from '../../../src/renderer/navigation';
import { createMockRenderContext } from '../helpers/mockContext';

describe('renderer navigation helpers', () => {
  it('resolves hlinksldjump action names case-insensitively', () => {
    const ctx = createMockRenderContext();
    ctx.slide.slidePath = 'ppt/slides/slide5.xml';
    ctx.presentation.slides = [
      ctx.slide,
      { ...ctx.slide, index: 1, slidePath: 'ppt/slides/slide2.xml', rels: new Map() },
      { ...ctx.slide, index: 2, slidePath: 'ppt/slides/slide9.xml', rels: new Map() },
    ];

    expect(
      resolveSlideNavigationIndex(ctx, 'PPACTION://hlinksldjump', {
        type: 'slide',
        target: 'slide9.xml',
      }),
    ).toBe(2);
  });

  it('resolves hlinkshowjump query keys and values case-insensitively', () => {
    const ctx = createMockRenderContext();
    ctx.slide.index = 1;
    ctx.presentation.slides = [
      { ...ctx.slide, index: 0, slidePath: 'ppt/slides/slide1.xml', rels: new Map() },
      ctx.slide,
      { ...ctx.slide, index: 2, slidePath: 'ppt/slides/slide3.xml', rels: new Map() },
    ];

    expect(resolveSlideNavigationIndex(ctx, 'PPACTION://hlinkshowjump?Jump=PreviousSlide')).toBe(0);
  });
});
