import { resolveRelTarget, type RelEntry } from '../parser/RelParser';
import type { RenderContext } from './RenderContext';

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex >= 0 ? normalized.slice(0, slashIndex) : '';
}

function normalizePackagePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * Resolve a slide relationship to the zero-based presentation order.
 *
 * Slide relationship targets point to slide part paths, but the displayed slide
 * order comes from presentation.xml and can differ from slideN.xml numbering.
 */
export function resolveSlideJumpIndex(ctx: RenderContext, rel: RelEntry): number | undefined {
  const basePath = dirname(ctx.slide.slidePath || 'ppt/slides/slide1.xml');
  const targetPath = normalizePackagePath(resolveRelTarget(basePath, rel.target));

  const slideIndex = ctx.presentation.slides.findIndex(
    (slide) => normalizePackagePath(slide.slidePath || '') === targetPath,
  );
  if (slideIndex >= 0) return slideIndex;

  const fallback = rel.target.match(/(?:^|[\\/])slide(\d+)\.xml$/i);
  if (!fallback) return undefined;

  return parseInt(fallback[1], 10) - 1;
}

function currentSlideIndex(ctx: RenderContext): number {
  const byIndex = ctx.slide.index;
  if (byIndex >= 0 && byIndex < ctx.presentation.slides.length) return byIndex;

  const currentPath = normalizePackagePath(ctx.slide.slidePath || '');
  const byPath = ctx.presentation.slides.findIndex(
    (slide) => normalizePackagePath(slide.slidePath || '') === currentPath,
  );
  return byPath >= 0 ? byPath : 0;
}

function decodeQueryComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function queryParamCaseInsensitive(query: string, name: string): string | undefined {
  const expectedName = name.toLowerCase();
  for (const part of query.split('&')) {
    const [rawKey, ...rawValue] = part.split('=');
    if (decodeQueryComponent(rawKey).toLowerCase() !== expectedName) continue;
    return decodeQueryComponent(rawValue.join('='));
  }
  return undefined;
}

function resolveShowJumpIndex(ctx: RenderContext, action: string): number | undefined {
  const match = action.match(/^ppaction:\/\/hlinkshowjump\?(.+)$/i);
  if (!match) return undefined;

  const jump = queryParamCaseInsensitive(match[1], 'jump')?.toLowerCase();
  const slideCount = ctx.presentation.slides.length;
  if (slideCount === 0) return undefined;

  switch (jump) {
    case 'firstslide':
      return 0;
    case 'lastslide':
      return slideCount - 1;
    case 'nextslide': {
      const nextIndex = currentSlideIndex(ctx) + 1;
      return nextIndex < slideCount ? nextIndex : undefined;
    }
    case 'previousslide': {
      const previousIndex = currentSlideIndex(ctx) - 1;
      return previousIndex >= 0 ? previousIndex : undefined;
    }
    default:
      return undefined;
  }
}

export function resolveSlideNavigationIndex(
  ctx: RenderContext,
  action: string | undefined,
  rel?: RelEntry,
): number | undefined {
  const normalizedAction = action?.toLowerCase();
  if (normalizedAction === 'ppaction://hlinksldjump' && rel) {
    return resolveSlideJumpIndex(ctx, rel);
  }
  if (action) {
    return resolveShowJumpIndex(ctx, action);
  }
  return undefined;
}

export function slideJumpTitle(slideIndex: number): string {
  return `Go to slide ${slideIndex + 1}`;
}
