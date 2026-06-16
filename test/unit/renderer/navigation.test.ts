import { describe, expect, it } from 'vitest';
import {
  resolveSlideJumpIndex,
  resolveSlideNavigationIndex,
  slideJumpTitle,
} from '../../../src/renderer/navigation';
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

  it('ignores URI query and fragment suffixes when resolving slide relationship targets', () => {
    const ctx = createMockRenderContext();
    ctx.slide.slidePath = 'ppt/slides/slide1.xml';
    ctx.presentation.slides = [
      ctx.slide,
      { ...ctx.slide, index: 1, slidePath: 'ppt/slides/slide2.xml', rels: new Map() },
    ];

    expect(
      resolveSlideNavigationIndex(ctx, 'ppaction://hlinksldjump', {
        type: 'slide',
        target: 'slide2.xml#section',
      }),
    ).toBe(1);

    expect(
      resolveSlideNavigationIndex(ctx, 'ppaction://hlinksldjump', {
        type: 'slide',
        target: 'slide2.xml?view=notes',
      }),
    ).toBe(1);
  });

  it('does not resolve external TargetMode relationships as internal slide jumps', () => {
    const ctx = createMockRenderContext();
    ctx.presentation.slides = [
      ctx.slide,
      { ...ctx.slide, index: 1, slidePath: 'ppt/slides/slide2.xml', rels: new Map() },
    ];

    expect(
      resolveSlideNavigationIndex(ctx, 'ppaction://hlinksldjump', {
        type: 'hyperlink',
        target: 'https://example.com/slide2.xml',
        targetMode: 'External',
      }),
    ).toBeUndefined();
  });

  it('falls back to slide file numbering when the target is absent from presentation order', () => {
    const ctx = createMockRenderContext();
    ctx.slide.slidePath = 'ppt/slides/slide1.xml';
    ctx.presentation.slides = [
      { ...ctx.slide, index: 0, slidePath: 'ppt/slides/slide1.xml', rels: new Map() },
    ];

    expect(
      resolveSlideJumpIndex(ctx, {
        type: 'slide',
        target: '..\\slides\\slide12.xml?mode=show',
      }),
    ).toBe(11);
  });

  it('returns undefined for non-slide relationship targets without file-number fallback', () => {
    const ctx = createMockRenderContext();

    expect(
      resolveSlideJumpIndex(ctx, {
        type: 'hyperlink',
        target: '../media/image1.png',
      }),
    ).toBeUndefined();
  });

  it('uses current slide path when slide.index is outside the presentation range', () => {
    const ctx = createMockRenderContext();
    ctx.slide.index = 99;
    ctx.slide.slidePath = 'ppt/slides/slide2.xml';
    ctx.presentation.slides = [
      { ...ctx.slide, index: 0, slidePath: 'ppt/slides/slide1.xml', rels: new Map() },
      ctx.slide,
      { ...ctx.slide, index: 2, slidePath: 'ppt/slides/slide3.xml', rels: new Map() },
    ];

    expect(resolveSlideNavigationIndex(ctx, 'ppaction://hlinkshowjump?jump=nextslide')).toBe(2);
  });

  it('uses slide zero as current fallback when neither index nor path matches', () => {
    const ctx = createMockRenderContext();
    ctx.slide.index = 99;
    ctx.slide.slidePath = 'ppt/slides/missing.xml';
    ctx.presentation.slides = [
      { ...ctx.slide, index: 0, slidePath: 'ppt/slides/slide1.xml', rels: new Map() },
      { ...ctx.slide, index: 1, slidePath: 'ppt/slides/slide2.xml', rels: new Map() },
    ];

    expect(resolveSlideNavigationIndex(ctx, 'ppaction://hlinkshowjump?jump=nextslide')).toBe(1);
  });

  it('handles first, last, and out-of-range show jump actions', () => {
    const ctx = createMockRenderContext();
    ctx.slide.index = 0;
    ctx.presentation.slides = [
      ctx.slide,
      { ...ctx.slide, index: 1, slidePath: 'ppt/slides/slide2.xml', rels: new Map() },
    ];

    expect(resolveSlideNavigationIndex(ctx, 'ppaction://hlinkshowjump?jump=firstslide')).toBe(0);
    expect(resolveSlideNavigationIndex(ctx, 'ppaction://hlinkshowjump?jump=lastslide')).toBe(1);
    expect(resolveSlideNavigationIndex(ctx, 'ppaction://hlinkshowjump?jump=previousslide')).toBe(
      undefined,
    );

    ctx.slide.index = 1;
    expect(resolveSlideNavigationIndex(ctx, 'ppaction://hlinkshowjump?jump=nextslide')).toBe(
      undefined,
    );
  });

  it('returns undefined for show jumps when the presentation has no slides', () => {
    const ctx = createMockRenderContext();
    ctx.presentation.slides = [];

    expect(resolveSlideNavigationIndex(ctx, 'ppaction://hlinkshowjump?jump=firstslide')).toBe(
      undefined,
    );
  });

  it('keeps malformed query components isolated while parsing show jump actions', () => {
    const ctx = createMockRenderContext();
    ctx.presentation.slides = [
      ctx.slide,
      { ...ctx.slide, index: 1, slidePath: 'ppt/slides/slide2.xml', rels: new Map() },
    ];

    expect(resolveSlideNavigationIndex(ctx, 'ppaction://hlinkshowjump?ju%ZZmp=nope&jump=lastslide'))
      .toBe(1);
    expect(resolveSlideNavigationIndex(ctx, 'ppaction://hlinkshowjump?jump=next%ZZslide')).toBe(
      undefined,
    );
  });

  it('returns undefined for missing or unrelated navigation actions', () => {
    const ctx = createMockRenderContext();

    expect(resolveSlideNavigationIndex(ctx, undefined)).toBeUndefined();
    expect(resolveSlideNavigationIndex(ctx, 'ppaction://hlinksldjump')).toBeUndefined();
    expect(resolveSlideNavigationIndex(ctx, 'ppaction://unknown?jump=nextslide')).toBeUndefined();
  });

  it('formats slide jump titles using one-based numbering', () => {
    expect(slideJumpTitle(4)).toBe('Go to slide 5');
  });
});
