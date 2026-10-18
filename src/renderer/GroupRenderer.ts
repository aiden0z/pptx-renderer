/**
 * Group renderer — renders grouped shapes with coordinate space remapping.
 */

import { composeTransforms, nodeTransform } from './coordinateTransform';
import { GroupNodeData } from '../model/nodes/GroupNode';
import { RenderContext } from './RenderContext';
import { BaseNodeData } from '../model/nodes/BaseNode';
import type { ShapeNodeData } from '../model/nodes/ShapeNode';
import { parseRenderableChild } from '../model/RenderableChild';
import { resolveNodePlaceholderInheritance } from '../model/Presentation';
import { emuToPx } from '../parser/units';
import { SafeXmlNode } from '../parser/XmlParser';
import { hexToRgb } from '../utils/color';
import { resolveColor } from './StyleResolver';
import { applyReflectionEffect } from './ReflectionRenderer';
import { applyStaticGroup3DPlane, buildStaticGroup3DPlan } from './Shape3DRenderer';

function shouldPropagateGroupFlip(node: BaseNodeData): boolean {
  return node.nodeType !== 'table' && node.nodeType !== 'chart';
}

function numericAttributeIsZeroOrAbsent(node: SafeXmlNode, name: string): boolean {
  const raw = node.attr(name);
  if (raw === undefined) return true;
  const value = Number(raw);
  return Number.isFinite(value) && value === 0;
}

function hasSupportedSourceCrop(srcRect: SafeXmlNode): boolean {
  if (!srcRect.exists()) return true;
  const values = ['t', 'r', 'b', 'l'].map((name) => {
    const raw = srcRect.attr(name);
    return raw === undefined ? 0 : Number(raw) / 100000;
  });
  if (!values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) return false;
  const [top, right, bottom, left] = values;
  return left + right < 0.999 && top + bottom < 0.999;
}

function isSupportedGroupPictureChild(child: SafeXmlNode): boolean {
  if (child.localName !== 'pic' || child.child('style').exists()) return false;
  const nvPr = child.child('nvPicPr').child('nvPr');
  if (nvPr.child('videoFile').exists() || nvPr.child('audioFile').exists()) return false;

  const blipFill = child.child('blipFill');
  const blip = blipFill.child('blip');
  const stretch = blipFill.child('stretch');
  if (
    !blipFill.exists() ||
    !blip.exists() ||
    !(blip.attr('embed') ?? blip.attr('r:embed')) ||
    blip.allChildren().length > 0 ||
    !stretch.exists() ||
    blipFill.child('tile').exists() ||
    !hasSupportedSourceCrop(blipFill.child('srcRect'))
  ) {
    return false;
  }
  const stretchChildren = stretch.allChildren();
  if (
    stretchChildren.length > 1 ||
    (stretchChildren.length === 1 &&
      (stretchChildren[0].localName !== 'fillRect' ||
        (stretchChildren[0].element?.attributes.length ?? 0) > 0))
  ) {
    return false;
  }

  const shapeProperties = child.child('spPr');
  const transform = shapeProperties.child('xfrm');
  const extent = transform.child('ext');
  const width = extent.numAttr('cx');
  const height = extent.numAttr('cy');
  const geometry = shapeProperties.child('prstGeom');
  if (
    !shapeProperties.exists() ||
    !transform.exists() ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !(width! > 0) ||
    !(height! > 0) ||
    !numericAttributeIsZeroOrAbsent(transform, 'rot') ||
    !numericAttributeIsZeroOrAbsent(transform, 'flipH') ||
    !numericAttributeIsZeroOrAbsent(transform, 'flipV') ||
    (geometry.exists() &&
      (geometry.attr('prst') !== 'rect' || geometry.child('avLst').allChildren().length > 0)) ||
    shapeProperties.child('custGeom').exists() ||
    shapeProperties.child('scene3d').exists() ||
    shapeProperties.child('sp3d').exists() ||
    shapeProperties.child('effectLst').exists() ||
    shapeProperties.child('effectDag').exists() ||
    shapeProperties.child('ln').exists() ||
    ['solidFill', 'gradFill', 'pattFill', 'blipFill', 'grpFill'].some((name) =>
      shapeProperties.child(name).exists(),
    )
  ) {
    return false;
  }
  return true;
}

function hasValidGroupChildCoordinateSpace(groupProperties: SafeXmlNode): boolean {
  const transform = groupProperties.child('xfrm');
  const extent = transform.child('ext');
  const childExtent = transform.child('chExt');
  const values = [
    extent.numAttr('cx'),
    extent.numAttr('cy'),
    childExtent.numAttr('cx'),
    childExtent.numAttr('cy'),
  ];
  return values.every((value) => value !== undefined && Number.isFinite(value) && value > 0);
}

function rotationSwapsAxes(rotation: number): boolean {
  const normalized = ((rotation % 360) + 360) % 360;
  return Math.abs(normalized - 90) < 0.0001 || Math.abs(normalized - 270) < 0.0001;
}

function remapShapeTextBoxBounds(
  node: BaseNodeData,
  scaleX: number,
  scaleY: number,
  swapsAxes: boolean,
): void {
  if (node.nodeType !== 'shape') return;
  const shapeNode = node as ShapeNodeData;
  if (!shapeNode.textBoxBounds) return;

  const tbScaleX = swapsAxes ? scaleY : scaleX;
  const tbScaleY = swapsAxes ? scaleX : scaleY;
  const tb = shapeNode.textBoxBounds;
  shapeNode.textBoxBounds = {
    ...tb,
    x: tb.x * tbScaleX,
    y: tb.y * tbScaleY,
    w: tb.w * tbScaleX,
    h: tb.h * tbScaleY,
  };
}

function resolveEffectColor(node: SafeXmlNode, ctx: RenderContext, fallback: string): string {
  const { color, alpha } = resolveColor(node, ctx);
  if (!color) return fallback;
  const hex = color.startsWith('#') ? color : `#${color}`;
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

function applyGroupOuterShadow(
  wrapper: HTMLElement,
  node: GroupNodeData,
  outerShdw: SafeXmlNode,
  ctx: RenderContext,
): void {
  const dir = outerShdw.numAttr('dir') ?? 0;
  const distPx = emuToPx(outerShdw.numAttr('dist') ?? 0);
  const blurPx = emuToPx(outerShdw.numAttr('blurRad') ?? 0);
  const dirDeg = dir / 60000;
  const offsetX = distPx * Math.cos((dirDeg * Math.PI) / 180);
  const offsetY = distPx * Math.sin((dirDeg * Math.PI) / 180);
  const shadowColor = resolveEffectColor(outerShdw, ctx, 'rgba(0,0,0,0.4)');

  const sx = outerShdw.numAttr('sx');
  const sy = outerShdw.numAttr('sy');
  if (sx != null && sy != null && sx > 0 && sy > 0) {
    const scaleX = sx / 100000;
    const scaleY = sy / 100000;
    const spreadX = (node.size.w * (scaleX - 1)) / 2;
    const spreadY = (node.size.h * (scaleY - 1)) / 2;
    const spread = Math.max(0, (spreadX + spreadY) / 2);
    wrapper.style.boxShadow = `${offsetX.toFixed(1)}px ${offsetY.toFixed(1)}px ${blurPx.toFixed(1)}px ${spread.toFixed(1)}px ${shadowColor}`;
    return;
  }

  wrapper.style.filter = `drop-shadow(${offsetX.toFixed(1)}px ${offsetY.toFixed(1)}px ${blurPx.toFixed(1)}px ${shadowColor})`;
}

function applyGroupEffects(
  wrapper: HTMLElement,
  node: GroupNodeData,
  ctx: RenderContext,
  grpSpPr: SafeXmlNode,
): void {
  const effectLst = grpSpPr.child('effectLst');
  if (!effectLst.exists()) return;

  const outerShdw = effectLst.child('outerShdw');
  if (outerShdw.exists()) {
    applyGroupOuterShadow(wrapper, node, outerShdw, ctx);
  }

  const reflection = effectLst.child('reflection');
  if (reflection.exists()) {
    applyReflectionEffect(wrapper, reflection, node.size);
  }
}

// ---------------------------------------------------------------------------
// Group Rendering
// ---------------------------------------------------------------------------

/**
 * Render a group node into an absolutely-positioned HTML element.
 *
 * Groups define a child coordinate space (childOffset + childExtent) that must
 * be remapped to the group's actual position and size. Each child's position
 * and size are transformed accordingly before rendering.
 *
 * @param node       The parsed group node data
 * @param ctx        The render context
 * @param renderNode A callback to render individual child nodes (avoids circular deps)
 */
export function renderGroup(
  node: GroupNodeData,
  ctx: RenderContext,
  renderNode: (childNode: BaseNodeData, ctx: RenderContext) => HTMLElement | null,
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.style.position = 'absolute';
  wrapper.style.left = `${node.position.x}px`;
  wrapper.style.top = `${node.position.y}px`;
  wrapper.style.width = `${node.size.w}px`;
  wrapper.style.height = `${node.size.h}px`;

  // Apply group rotation. Group flips are applied by remapping child geometry below so text
  // renderers can keep readable text upright instead of mirroring the entire DOM subtree.
  const transforms: string[] = [];
  if (node.rotation !== 0) {
    transforms.push(`rotate(${node.rotation}deg)`);
  }
  if (transforms.length > 0) {
    wrapper.style.transform = transforms.join(' ');
    wrapper.style.transformOrigin = 'center center';
  }

  const chOff = node.childOffset;
  const chExt = node.childExtent;
  const groupW = node.size.w;
  const groupH = node.size.h;

  // Resolve group fill from grpSpPr for children that use a:grpFill
  const grpSpPr = node.source.child('grpSpPr');
  const childCtx: RenderContext = {
    ...ctx,
    groupDepth: (ctx.groupDepth ?? 0) + 1,
    // Child positions/flips are already remapped below; the wrapper adds only translation/rotation.
    parentToSlide: composeTransforms(ctx.parentToSlide, nodeTransform(node, false)),
    groupTransformHasRotationOrFlip: Boolean(
      ctx.groupTransformHasRotationOrFlip || node.rotation !== 0 || node.flipH || node.flipV,
    ),
  };
  if (grpSpPr.exists()) {
    // Check if the group itself has a fill (solidFill, gradFill, etc.)
    // that children can inherit via grpFill
    const FILL_TAGS = ['solidFill', 'gradFill', 'blipFill', 'pattFill'];
    for (const tag of FILL_TAGS) {
      if (grpSpPr.child(tag).exists()) {
        childCtx.groupFillNode = grpSpPr;
        break;
      }
    }
    // If the group itself uses grpFill, propagate the parent's group fill
    if (!childCtx.groupFillNode && grpSpPr.child('grpFill').exists() && ctx.groupFillNode) {
      childCtx.groupFillNode = ctx.groupFillNode;
    }
  }

  const group3dPlan = buildStaticGroup3DPlan(
    node.shape3d,
    {
      width: groupW,
      height: groupH,
      container: (ctx.groupDepth ?? 0) === 0 ? 'standalone-slide' : 'group',
      hasTransformedAncestor: ctx.groupTransformHasRotationOrFlip,
      hasSceneAncestor: ctx.groupAncestorHas3dScene,
      rotation: node.rotation,
      flipH: node.flipH,
      flipV: node.flipV,
      childKinds: node.children.map((child) => child.localName),
      hasSupportedPictureChildren: node.children.every(isSupportedGroupPictureChild),
      hasValidChildCoordinateSpace: hasValidGroupChildCoordinateSpace(grpSpPr),
    },
    ctx,
  );
  let childHost = wrapper;
  let projectedGroupLayer: HTMLElement | undefined;
  if (group3dPlan.mode === 'camera-projected-group-plane') {
    const childLayer = document.createElement('div');
    childLayer.style.position = 'absolute';
    childLayer.style.left = '0px';
    childLayer.style.top = '0px';
    childLayer.style.width = `${groupW}px`;
    childLayer.style.height = `${groupH}px`;
    if (applyStaticGroup3DPlane(childLayer, group3dPlan)) {
      const contentLayer = document.createElement('div');
      contentLayer.dataset.pptxShape3dGroupContent = 'true';
      contentLayer.style.position = 'absolute';
      contentLayer.style.inset = '0';
      contentLayer.style.filter = `brightness(${group3dPlan.lighting.brightness})`;
      childLayer.appendChild(contentLayer);
      wrapper.appendChild(childLayer);
      childHost = contentLayer;
      projectedGroupLayer = childLayer;
    } else {
      wrapper.dataset.pptxShape3dFallback = 'projection-out-of-range';
    }
  } else if (node.shape3d) {
    wrapper.dataset.pptxShape3dFallback = group3dPlan.reason;
  }
  childCtx.groupAncestorHas3dScene = Boolean(ctx.groupAncestorHas3dScene || node.shape3d?.scene);

  // Cycle diagram: 3 pie sectors + 3 circular arrows → one circle (3 equal 120° sectors) centered in the diagram.
  const parsedChildren = new Map<number, BaseNodeData | undefined>();
  const parseByIndex = (index: number): BaseNodeData | undefined => {
    if (!parsedChildren.has(index)) {
      parsedChildren.set(index, parseGroupChild(node.children[index], ctx, node));
    }
    return parsedChildren.get(index);
  };

  let pieCommon: { x: number; y: number; w: number; h: number } | null = null;
  let pieCenterOffsets: Map<number, { x: number; y: number }> | null = null;
  if (
    node.diagramLayoutId === 'urn:microsoft.com/office/officeart/2005/8/layout/cycle8' &&
    node.children.length === 6 &&
    chExt.w > 0 &&
    chExt.h > 0
  ) {
    const prst = (c: (typeof node.children)[0]) => c.child('spPr').child('prstGeom').attr('prst');
    const firstPie = node.children.slice(0, 3).every((c) => prst(c) === 'pie');
    const nextArrow = node.children.slice(3, 6).every((c) => prst(c) === 'circularArrow');
    if (firstPie && nextArrow) {
      // Use diagram extent center and a single circle size so the circle is centered and fits.
      const pieNodes = [0, 1, 2].map((i) => parseByIndex(i)).filter(Boolean);
      if (pieNodes.length === 3) {
        const pieW = Math.max(...pieNodes.map((n) => n!.size.w));
        const pieH = Math.max(...pieNodes.map((n) => n!.size.h));
        const circleSize = Math.min(pieW, pieH, chExt.w, chExt.h);
        const centerX = chOff.x + chExt.w / 2;
        const centerY = chOff.y + chExt.h / 2;
        const left = centerX - circleSize / 2;
        const top = centerY - circleSize / 2;
        pieCommon = {
          x: ((left - chOff.x) / chExt.w) * groupW,
          y: ((top - chOff.y) / chExt.h) * groupH,
          w: (circleSize / chExt.w) * groupW,
          h: (circleSize / chExt.h) * groupH,
        };

        const firstPieSize = pieNodes[0]!.size;
        const samePieSize = pieNodes.every(
          (n) =>
            Math.abs(n!.size.w - firstPieSize.w) < 0.01 &&
            Math.abs(n!.size.h - firstPieSize.h) < 0.01,
        );
        if (samePieSize) {
          pieCenterOffsets = new Map(
            pieNodes.map((n, i) => [
              i,
              {
                x: ((n!.position.x + n!.size.w / 2 - centerX) / chExt.w) * groupW,
                y: ((n!.position.y + n!.size.h / 2 - centerY) / chExt.h) * groupH,
              },
            ]),
          );
        }
      }
    }
  }

  // Cycle diagram: render arrows first (3,4,5) then pies (0,1,2) so blue sectors draw on top.
  const order = pieCommon ? [3, 4, 5, 0, 1, 2] : undefined;
  const indices = order ?? node.children.map((_, i) => i);

  for (const index of indices) {
    try {
      const childNode = parseByIndex(index);
      if (!childNode || childNode.hidden) continue;
      const originalSize = childNode.size;

      // Remap child coordinates from child space to group space
      if (chExt.w > 0 || chExt.h > 0) {
        const scaleX = chExt.w > 0 ? groupW / chExt.w : 1;
        const scaleY = chExt.h > 0 ? groupH / chExt.h : 1;
        const swapsAxes = rotationSwapsAxes(childNode.rotation);
        const originalPosition = childNode.position;
        if (swapsAxes) {
          const rotatedBBoxX = originalPosition.x + (originalSize.w - originalSize.h) / 2;
          const rotatedBBoxY = originalPosition.y + (originalSize.h - originalSize.w) / 2;
          const nextSize = {
            w: originalSize.w * scaleY,
            h: originalSize.h * scaleX,
          };
          childNode.position = {
            x: (rotatedBBoxX - chOff.x) * scaleX - (nextSize.w - nextSize.h) / 2,
            y: (rotatedBBoxY - chOff.y) * scaleY - (nextSize.h - nextSize.w) / 2,
          };
          childNode.size = nextSize;
        } else {
          childNode.position = {
            x: (originalPosition.x - chOff.x) * scaleX,
            y: (originalPosition.y - chOff.y) * scaleY,
          };
          childNode.size = {
            w: originalSize.w * scaleX,
            h: originalSize.h * scaleY,
          };
        }
        remapShapeTextBoxBounds(childNode, scaleX, scaleY, swapsAxes);
      }

      if (node.flipH) {
        childNode.position = {
          ...childNode.position,
          x: groupW - childNode.position.x - childNode.size.w,
        };
        if (shouldPropagateGroupFlip(childNode)) {
          childNode.flipH = !childNode.flipH;
        }
      }
      if (node.flipV) {
        childNode.position = {
          ...childNode.position,
          y: groupH - childNode.position.y - childNode.size.h,
        };
        if (shouldPropagateGroupFlip(childNode)) {
          childNode.flipV = !childNode.flipV;
        }
      }

      // Overlap the 3 pie sectors at the same center so they form one circle
      if (pieCommon && index < 3 && childNode.nodeType === 'shape') {
        const origW = childNode.size.w;
        const origH = childNode.size.h;
        const pieOffset = pieCenterOffsets?.get(index) ?? { x: 0, y: 0 };
        childNode.position = { x: pieCommon.x + pieOffset.x, y: pieCommon.y + pieOffset.y };
        childNode.size = { w: pieCommon.w, h: pieCommon.h };
        // Scale text box so labels stay in the right sector (txXfrm was in original shape space)
        const shapeNode = childNode as ShapeNodeData;
        if (origW > 0 && origH > 0 && shapeNode.textBoxBounds) {
          const tb = shapeNode.textBoxBounds;
          shapeNode.textBoxBounds = {
            x: (tb.x / origW) * pieCommon.w,
            y: (tb.y / origH) * pieCommon.h,
            w: (tb.w / origW) * pieCommon.w,
            h: (tb.h / origH) * pieCommon.h,
          };
        }
      }

      const groupChildScale = {
        x: originalSize.w > 0 ? childNode.size.w / originalSize.w : 1,
        y: originalSize.h > 0 ? childNode.size.h / originalSize.h : 1,
      };
      const el = renderNode(childNode, { ...childCtx, groupChildScale });
      if (el) childHost.appendChild(el);
    } catch {
      // Per-child error handling — create error placeholder
      const errDiv = document.createElement('div');
      errDiv.style.position = 'absolute';
      errDiv.style.border = '1px dashed #ff6b6b';
      errDiv.style.backgroundColor = 'rgba(255,107,107,0.1)';
      errDiv.style.fontSize = '10px';
      errDiv.style.color = '#cc0000';
      errDiv.style.display = 'flex';
      errDiv.style.alignItems = 'center';
      errDiv.style.justifyContent = 'center';
      errDiv.style.padding = '2px';
      errDiv.textContent = 'Group child error';
      childHost.appendChild(errDiv);
    }
  }

  if (projectedGroupLayer && group3dPlan.mode === 'camera-projected-group-plane') {
    const lighting = document.createElement('div');
    lighting.dataset.pptxShape3dGroupLighting = 'threePt:t';
    lighting.style.position = 'absolute';
    lighting.style.inset = '0';
    lighting.style.pointerEvents = 'none';
    lighting.style.backgroundColor = `rgba(255, 255, 255, ${group3dPlan.lighting.opacity})`;
    projectedGroupLayer.appendChild(lighting);
  }

  // Reflection must clone the completed child subtree. Applying group effects before rendering
  // children creates an empty reflected source even though the effect node itself is present.
  if (grpSpPr.exists()) applyGroupEffects(wrapper, node, ctx, grpSpPr);

  return wrapper;
}

// ---------------------------------------------------------------------------
// Child Node Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a raw XML child node from a group's spTree into a typed node object.
 * Returns undefined for unrecognized or unsupported elements.
 */
function parseGroupChild(
  childXml: SafeXmlNode,
  ctx: RenderContext,
  parentGroup: GroupNodeData,
): BaseNodeData | undefined {
  const child = parseRenderableChild(childXml, {
    rels: ctx.slide.rels,
    partPath: ctx.partPath ?? ctx.slide.slidePath,
    diagramDrawings: ctx.presentation.diagramDrawings,
    skipPlaceholders: ctx.skipPlaceholderChildren,
  });
  if (child) {
    resolveNodePlaceholderInheritance(child, ctx.layout, ctx.master, { parentGroup });
  }
  return child;
}
