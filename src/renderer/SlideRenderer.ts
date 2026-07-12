/**
 * Slide renderer — orchestrates rendering of a complete slide with all its nodes.
 */

import { SlideData } from '../model/Slide';
import { materializeSlideNodes, PresentationData } from '../model/Presentation';
import { RenderContext, createRenderContext } from './RenderContext';
import { renderBackground } from './BackgroundRenderer';
import { renderShape } from './ShapeRenderer';
import { renderImage } from './ImageRenderer';
import { renderTable } from './TableRenderer';
import { renderGroup } from './GroupRenderer';
import { renderChart } from './ChartRenderer';
import { ShapeNodeData } from '../model/nodes/ShapeNode';
import { PicNodeData } from '../model/nodes/PicNode';
import { TableNodeData } from '../model/nodes/TableNode';
import { GroupNodeData } from '../model/nodes/GroupNode';
import { ChartNodeData } from '../model/nodes/ChartNode';
import { BaseNodeData } from '../model/nodes/BaseNode';
import { SafeXmlNode } from '../parser/XmlParser';
import type { RelEntry } from '../parser/RelParser';
import { isPlaceholderNode, parseRenderableChild } from '../model/RenderableChild';
import type { EChartsType } from 'echarts/core';
import { useEmbeddedFonts } from './EmbeddedFontLoader';
import type { PdfjsConfig } from '../utils/pdfRenderer';

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
  /** Optional pdfjs URLs for EMF-embedded PDF fallback rendering. */
  pdfjs?: PdfjsConfig;
  /** Shared set of live ECharts instances for explicit disposal. */
  chartInstances?: Set<EChartsType>;
}

/**
 * Per-slide resource handle returned by `renderSlide()`.
 * Allows the caller to dispose of slide-specific resources (chart instances,
 * blob URLs in standalone mode) without tearing down the whole viewer.
 */
export interface SlideHandle {
  /** The rendered slide DOM element. */
  readonly element: HTMLElement;
  /** Resolves when asynchronous slide resources (for example EMF-PDF fallbacks) finish. */
  readonly ready: Promise<void>;
  /** Dispose slide-specific resources (charts inside this slide, blob URLs if standalone). */
  dispose(): void;
  /** Support `using` declarations (TC39 Explicit Resource Management). */
  [Symbol.dispose](): void;
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

interface TemplateShapeCacheEntry {
  nodes: BaseNodeData[];
  rels?: Map<string, RelEntry>;
  partPath?: string;
  diagramDrawings?: Map<string, string>;
}

const templateShapeCache = new WeakMap<SafeXmlNode, TemplateShapeCacheEntry>();

/**
 * Parse and collect renderable shapes from a master or layout spTree.
 * Only includes NON-placeholder shapes (decorative elements, logos, footers).
 * Placeholder shapes are never rendered from master/layout — they only serve
 * as position/size inheritance templates.
 */
function parseTemplateShapes(
  spTree: SafeXmlNode,
  rels?: Map<string, RelEntry>,
  partPath?: string,
  diagramDrawings?: Map<string, string>,
): BaseNodeData[] {
  const nodes: BaseNodeData[] = [];
  if (!spTree || !spTree.exists || !spTree.exists()) return nodes;
  const parseContext = {
    rels: rels ?? new Map<string, RelEntry>(),
    partPath,
    diagramDrawings,
  };

  for (const child of spTree.allChildren()) {
    // Skip ALL placeholder shapes — they're templates, not renderable content
    if (isPlaceholderNode(child)) continue;

    try {
      const node = parseRenderableChild(child, parseContext);
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

function getTemplateShapes(
  spTree: SafeXmlNode,
  rels?: Map<string, RelEntry>,
  partPath?: string,
  diagramDrawings?: Map<string, string>,
): BaseNodeData[] {
  const cached = templateShapeCache.get(spTree);
  if (
    cached &&
    cached.rels === rels &&
    cached.partPath === partPath &&
    cached.diagramDrawings === diagramDrawings
  ) {
    return cached.nodes;
  }

  const nodes = parseTemplateShapes(spTree, rels, partPath, diagramDrawings);
  templateShapeCache.set(spTree, {
    nodes,
    rels,
    partPath,
    diagramDrawings,
  });
  return nodes;
}

function temporarilyConnectForMeasurement(container: HTMLElement): () => void {
  if (container.isConnected) return () => undefined;

  const previous = {
    position: container.style.position,
    left: container.style.left,
    top: container.style.top,
    visibility: container.style.visibility,
    pointerEvents: container.style.pointerEvents,
    contain: container.style.contain,
  };

  container.style.position = 'fixed';
  container.style.left = '-100000px';
  container.style.top = '0';
  container.style.visibility = 'hidden';
  container.style.pointerEvents = 'none';
  container.style.contain = 'layout style paint';
  document.body.appendChild(container);

  return () => {
    if (container.parentNode === document.body) {
      document.body.removeChild(container);
    }
    container.style.position = previous.position;
    container.style.left = previous.left;
    container.style.top = previous.top;
    container.style.visibility = previous.visibility;
    container.style.pointerEvents = previous.pointerEvents;
    container.style.contain = previous.contain;
  };
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
): SlideHandle {
  materializeSlideNodes(presentation, slide);

  const isSharedCache = !!options?.mediaUrlCache;
  const chartInstances = options?.chartInstances ?? new Set<EChartsType>();
  const asyncTasks: Promise<void>[] = [];
  const abortController = new AbortController();

  // Create render context (resolves slide -> layout -> master -> theme chain)
  const ctx = createRenderContext(
    presentation,
    slide,
    options?.mediaUrlCache,
    chartInstances,
    options?.pdfjs,
    abortController.signal,
  );
  ctx.asyncTasks = asyncTasks;
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

  ctx.measurementRoot = container;
  const restoreMeasurementMount = temporarilyConnectForMeasurement(container);

  try {
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
        partPath: ctx.masterPath,
        skipPlaceholderChildren: true,
      };
      const masterShapes = getTemplateShapes(
        ctx.master.spTree,
        ctx.master.rels,
        ctx.masterPath,
        presentation.diagramDrawings,
      );
      for (const node of masterShapes) {
        try {
          const el = renderNode(node, masterCtx);
          container.appendChild(el);
        } catch {
          // Master shape errors are non-fatal
        }
      }
    }

    // --- Render layout template shapes ---
    if (slide.showMasterSp) {
      const layoutCtx: RenderContext = {
        ...ctx,
        slide: { ...ctx.slide, rels: ctx.layout.rels },
        partPath: ctx.layoutPath,
        skipPlaceholderChildren: true,
      };
      const layoutShapes = getTemplateShapes(
        ctx.layout.spTree,
        ctx.layout.rels,
        ctx.layoutPath,
        presentation.diagramDrawings,
      );
      for (const node of layoutShapes) {
        try {
          const el = renderNode(node, layoutCtx);
          container.appendChild(el);
        } catch {
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
  } finally {
    restoreMeasurementMount();
  }

  const embeddedFontUse = useEmbeddedFonts(presentation, ctx.usedEmbeddedFontFamilies ?? new Set());
  asyncTasks.push(embeddedFontUse.ready);

  // Build SlideHandle
  let disposed = false;
  const mediaUrlCache = ctx.mediaUrlCache;
  const ready = Promise.allSettled(asyncTasks).then(() => undefined);

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    abortController.abort();
    embeddedFontUse.dispose();

    // Dispose chart instances whose DOM is inside this slide container
    if (chartInstances) {
      for (const chart of chartInstances) {
        if (!chart.isDisposed() && container.contains(chart.getDom())) {
          chart.dispose();
          chartInstances.delete(chart);
        }
      }
    }

    // Revoke blob URLs only in standalone mode (caller doesn't own a shared cache)
    if (!isSharedCache) {
      for (const url of mediaUrlCache.values()) {
        URL.revokeObjectURL(url);
      }
      mediaUrlCache.clear();
    }
  };

  return {
    element: container,
    ready,
    dispose,
    [Symbol.dispose](): void {
      dispose();
    },
  };
}
