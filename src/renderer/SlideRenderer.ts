/**
 * Slide renderer — orchestrates rendering of a complete slide with all its nodes.
 */

import { SlideData } from '../model/Slide';
import { PresentationData } from '../model/Presentation';
import { RenderContext, createRenderContext } from './RenderContext';
import { renderBackground } from './BackgroundRenderer';
import { renderShape } from './ShapeRenderer';
import { renderImage } from './ImageRenderer';
import { renderTable } from './TableRenderer';
import { renderGroup } from './GroupRenderer';
import { renderChart } from './ChartRenderer';
import { ShapeNodeData, parseShapeNode } from '../model/nodes/ShapeNode';
import { PicNodeData, parsePicNode } from '../model/nodes/PicNode';
import { TableNodeData, parseTableNode } from '../model/nodes/TableNode';
import { GroupNodeData, parseGroupNode } from '../model/nodes/GroupNode';
import { ChartNodeData } from '../model/nodes/ChartNode';
import { BaseNodeData } from '../model/nodes/BaseNode';
import { SafeXmlNode } from '../parser/XmlParser';
import { RelEntry } from '../parser/RelParser';
import type { ECharts } from 'echarts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlideRendererOptions {
  /** Called when a single node fails to render. */
  onNodeError?: (nodeId: string, error: unknown) => void;
  /**
   * Navigation callback for shape-level hyperlink actions (action buttons, etc.).
   * Called with target slide index (0-based) for slide jumps,
   * or with a URL string for external links.
   */
  onNavigate?: (target: { slideIndex?: number; url?: string }) => void;
  /** Shared media URL cache for blob URL reuse across slides. */
  mediaUrlCache?: Map<string, string>;
  /** Shared set of live ECharts instances for explicit disposal. */
  chartInstances?: Set<ECharts>;
}

// ---------------------------------------------------------------------------
// Node Dispatch
// ---------------------------------------------------------------------------

/**
 * Dispatch a typed node to its appropriate renderer.
 * This function is also passed into GroupRenderer for recursive child rendering.
 */
function renderNode(node: BaseNodeData, ctx: RenderContext): HTMLElement {
  switch (node.nodeType) {
    case 'shape':
      return renderShape(node as ShapeNodeData, ctx);
    case 'picture':
      return renderImage(node as PicNodeData, ctx);
    case 'table':
      return renderTable(node as TableNodeData, ctx);
    case 'group':
      return renderGroup(node as GroupNodeData, ctx, renderNode);
    case 'chart':
      return renderChart(node as ChartNodeData, ctx);
    default: {
      // Unknown node type — render as empty positioned div
      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.left = `${node.position.x}px`;
      el.style.top = `${node.position.y}px`;
      el.style.width = `${node.size.w}px`;
      el.style.height = `${node.size.h}px`;
      return el;
    }
  }
}

// ---------------------------------------------------------------------------
// Error Placeholder
// ---------------------------------------------------------------------------

/**
 * Create a visual error placeholder at the node's position.
 */
function createErrorPlaceholder(node: BaseNodeData): HTMLElement {
  const el = document.createElement('div');
  el.style.position = 'absolute';
  el.style.left = `${node.position.x}px`;
  el.style.top = `${node.position.y}px`;
  el.style.width = `${node.size.w}px`;
  el.style.height = `${node.size.h}px`;
  el.style.border = '2px dashed #ff4444';
  el.style.backgroundColor = 'rgba(255,68,68,0.08)';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.color = '#cc0000';
  el.style.fontSize = '11px';
  el.style.fontFamily = 'monospace';
  el.style.overflow = 'hidden';
  el.style.boxSizing = 'border-box';
  el.style.padding = '4px';
  el.textContent = `Render Error`;
  el.title = `Failed to render node: ${node.id} (${node.name})`;
  return el;
}

// ---------------------------------------------------------------------------
// Master/Layout Shape Parsing
// ---------------------------------------------------------------------------

/**
 * Check whether a shape node is a placeholder (has p:ph in nvPr).
 */
function isPlaceholderNode(node: SafeXmlNode): boolean {
  for (const wrapper of ['nvSpPr', 'nvPicPr', 'nvGrpSpPr', 'nvGraphicFramePr', 'nvCxnSpPr']) {
    const nv = node.child(wrapper);
    if (nv.exists()) {
      const nvPr = nv.child('nvPr');
      if (nvPr.child('ph').exists()) return true;
    }
  }
  return false;
}

/**
 * Parse and collect renderable shapes from a master or layout spTree.
 * Only includes NON-placeholder shapes (decorative elements, logos, footers).
 * Placeholder shapes are never rendered from master/layout — they only serve
 * as position/size inheritance templates.
 */
function parseTemplateShapes(spTree: SafeXmlNode, _slideNodes: BaseNodeData[]): BaseNodeData[] {
  const nodes: BaseNodeData[] = [];
  if (!spTree || !spTree.exists || !spTree.exists()) return nodes;

  for (const child of spTree.allChildren()) {
    const tag = child.localName;

    // Skip ALL placeholder shapes — they're templates, not renderable content
    if (isPlaceholderNode(child)) continue;

    try {
      let node: BaseNodeData | undefined;
      switch (tag) {
        case 'sp':
        case 'cxnSp':
          node = parseShapeNode(child);
          break;
        case 'pic':
          node = parsePicNode(child);
          break;
        case 'grpSp':
          node = parseGroupNode(child);
          break;
        case 'graphicFrame': {
          const graphic = child.child('graphic');
          const graphicData = graphic.child('graphicData');
          if (graphicData.child('tbl').exists()) {
            node = parseTableNode(child);
          }
          break;
        }
      }
      // Skip empty/invisible nodes (0x0 size and no text)
      if (node && (node.size.w > 0 || node.size.h > 0)) {
        nodes.push(node);
      }
    } catch {
      // Skip unparseable template shapes silently
    }
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// Main Slide Render Function
// ---------------------------------------------------------------------------

/**
 * Render a complete slide into an HTML element.
 *
 * Rendering order:
 * 1. Background (slide → layout → master inheritance)
 * 2. Master non-placeholder shapes (behind everything)
 * 3. Layout non-placeholder shapes
 * 4. Slide shapes (on top)
 */
export function renderSlide(
  presentation: PresentationData,
  slide: SlideData,
  options?: SlideRendererOptions,
): HTMLElement {
  // Create render context (resolves slide -> layout -> master -> theme chain)
  const ctx = createRenderContext(
    presentation,
    slide,
    options?.mediaUrlCache,
    options?.chartInstances,
  );
  if (options?.onNavigate) {
    ctx.onNavigate = options.onNavigate;
  }

  // Create slide container
  const container = document.createElement('div');
  container.style.position = 'relative';
  container.style.width = `${presentation.width}px`;
  container.style.height = `${presentation.height}px`;
  container.style.overflow = 'hidden';
  container.style.backgroundColor = '#FFFFFF';

  // Render background
  try {
    renderBackground(ctx, container);
  } catch (e) {
    options?.onNodeError?.('__background__', e);
  }

  // --- Render master template shapes (behind layout and slide) ---
  // Respect showMasterSp flags:
  //  - layout.showMasterSp === false  → skip master shapes
  //  - slide.showMasterSp === false   → skip both master AND layout shapes
  if (slide.showMasterSp && ctx.layout.showMasterSp) {
    const masterCtx: RenderContext = {
      ...ctx,
      slide: { ...ctx.slide, rels: ctx.master.rels },
    };
    const masterShapes = parseTemplateShapes(ctx.master.spTree, slide.nodes);
    for (const node of masterShapes) {
      try {
        const el = renderNode(node, masterCtx);
        container.appendChild(el);
      } catch (e) {
        // Master shape errors are non-fatal
      }
    }
  }

  // --- Render layout template shapes ---
  if (slide.showMasterSp) {
    const layoutCtx: RenderContext = {
      ...ctx,
      slide: { ...ctx.slide, rels: ctx.layout.rels },
    };
    const layoutShapes = parseTemplateShapes(ctx.layout.spTree, slide.nodes);
    for (const node of layoutShapes) {
      try {
        const el = renderNode(node, layoutCtx);
        container.appendChild(el);
      } catch (e) {
        // Layout shape errors are non-fatal
      }
    }
  }

  // --- Render slide shapes (on top) ---
  for (const node of slide.nodes) {
    try {
      const el = renderNode(node, ctx);
      container.appendChild(el);
    } catch (e) {
      options?.onNodeError?.(node.id, e);
      container.appendChild(createErrorPlaceholder(node));
    }
  }

  return container;
}
