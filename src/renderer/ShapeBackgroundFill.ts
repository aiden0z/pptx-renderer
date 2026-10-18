import type { ShapeNodeData } from '../model/nodes/ShapeNode';
import type { RenderContext } from './RenderContext';
import { renderBackground } from './BackgroundRenderer';
import { composeTransforms, invertTransform, nodeTransform } from './coordinateTransform';

let backgroundClipId = 0;

/** Paint the slide background in slide coordinates, then clip it to the shape's filled contours. */
export function applyShapeBackgroundFill(
  svg: SVGSVGElement,
  node: ShapeNodeData,
  ctx: RenderContext,
): void {
  const ns = 'http://www.w3.org/2000/svg';
  const paths = Array.from(svg.children).filter(
    (child): child is SVGPathElement =>
      child.localName === 'path' && child.getAttribute('fill') !== 'none',
  );
  if (paths.length === 0) return;
  const defs = document.createElementNS(ns, 'defs');
  const clip = document.createElementNS(ns, 'clipPath');
  const id = `shape-background-${++backgroundClipId}`;
  clip.id = id;
  clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
  for (const path of paths) {
    const contour = document.createElementNS(ns, 'path');
    contour.setAttribute('d', path.getAttribute('d') ?? '');
    contour.setAttribute('clip-rule', path.getAttribute('fill-rule') ?? 'nonzero');
    clip.appendChild(contour);
    path.setAttribute('fill', 'none');
  }
  defs.appendChild(clip);
  svg.insertBefore(defs, svg.firstChild);

  const paint = document.createElementNS(ns, 'g');
  paint.setAttribute('clip-path', `url(#${id})`);
  paint.style.pointerEvents = 'none';
  const viewport = document.createElementNS(ns, 'foreignObject');
  viewport.setAttribute('width', String(ctx.presentation.width));
  viewport.setAttribute('height', String(ctx.presentation.height));
  const inverse = invertTransform(composeTransforms(ctx.parentToSlide, nodeTransform(node)));
  viewport.setAttribute('transform', `matrix(${inverse.join(' ')})`);
  const surface = document.createElement('div');
  surface.dataset.pptxShapeBackground = 'true';
  surface.style.position = 'relative';
  surface.style.width = `${ctx.presentation.width}px`;
  surface.style.height = `${ctx.presentation.height}px`;
  // Share gradient, image, relationship, lazy-loading and external-media policy behavior.
  // A missing background becomes white; authored alpha retains the background renderer's semantics.
  // Template shapes sample their own part's background chain: master, or layout → master.
  // A slide-local background must not override paint authored on those ancestor parts.
  const backgroundCtx =
    ctx.nodeOrigin === 'layout' || ctx.nodeOrigin === 'master'
      ? {
          ...ctx,
          slide: { ...ctx.slide, background: undefined },
          layout:
            ctx.nodeOrigin === 'master' ? { ...ctx.layout, background: undefined } : ctx.layout,
        }
      : ctx;
  renderBackground(backgroundCtx, surface);
  viewport.appendChild(surface);
  paint.appendChild(viewport);
  svg.insertBefore(paint, defs.nextSibling);
}
