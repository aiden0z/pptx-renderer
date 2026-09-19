/**
 * Serialize PresentationData into a plain JSON-serializable structure.
 * Strips all SafeXmlNode references and re-parses group children.
 */

import {
  materializeSlideNodes,
  PresentationData,
  resolveNodePlaceholderInheritance,
} from '../model/Presentation';
import { SlideNode } from '../model/Slide';
import { ShapeNodeData, TextBody } from '../model/nodes/ShapeNode';
import { PicNodeData } from '../model/nodes/PicNode';
import { TableNodeData, TableRow, TableCell } from '../model/nodes/TableNode';
import { GroupNodeData } from '../model/nodes/GroupNode';
import { ChartNodeData } from '../model/nodes/ChartNode';
import { BaseNodeData } from '../model/nodes/BaseNode';
import { SafeXmlNode } from '../parser/XmlParser';
import { parseRenderableChildren } from '../model/RenderableChild';
import { parseTemplateShapes } from '../model/TemplateShapes';
import type { RelEntry } from '../parser/RelParser';
import type { LayoutData } from '../model/Layout';
import type { MasterData } from '../model/Master';
import type { Shape3DProperties } from '../model/nodes/Shape3D';

// ---------------------------------------------------------------------------
// Serialized Types (JSON-safe)
// ---------------------------------------------------------------------------

interface SerializedParagraph {
  level: number;
  text: string;
}

interface SerializedTextBody {
  paragraphs: SerializedParagraph[];
  totalText: string;
}

interface SerializedCell {
  text: string;
  gridSpan: number;
  rowSpan: number;
}

interface SerializedRow {
  height: number;
  cells: SerializedCell[];
}

export interface SerializedNode {
  id: string;
  name: string;
  nodeType: string;
  position: { x: number; y: number };
  size: { w: number; h: number };
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  presetGeometry?: string;
  shape3d?: SerializedShape3D;
  textBody?: SerializedTextBody;
  columns?: number[];
  rows?: SerializedRow[];
  tableStyleId?: string;
  blipEmbed?: string;
  chartPath?: string;
  children?: SerializedNode[];
}

export type SerializedShape3D = Omit<Shape3DProperties, 'shape'> & {
  shape?: Omit<NonNullable<Shape3DProperties['shape']>, 'contourColorSource'>;
};

export interface SerializedSlide {
  index: number;
  hidden?: boolean;
  nodes: SerializedNode[];
  colorMapOverride?: Record<string, string>;
  colorMapOverrideMode?: 'override' | 'master';
  /** Key into `SerializedPresentation.layouts`, when the slide resolves to one. */
  layoutPath?: string;
  /** Key into `SerializedPresentation.masters`, when the layout resolves to one. */
  masterPath?: string;
  /** When false, this slide suppresses its master's template shapes. */
  showMasterSp: boolean;
}

/**
 * The non-placeholder shapes a layout or master contributes to the slides
 * that use it. Placeholder shapes are excluded: they are inheritance
 * templates, not drawn content.
 */
export interface SerializedTemplate {
  path: string;
  nodes: SerializedNode[];
  /** Layouts only: when false, the layout suppresses its master's shapes. */
  showMasterSp?: boolean;
}

export interface SerializedPresentation {
  width: number;
  height: number;
  slideCount: number;
  slides: SerializedSlide[];
  /**
   * Slide layouts that at least one slide uses, keyed by part path.
   *
   * Draw order for a slide is master shapes, then layout shapes, then the
   * slide's own `nodes` — and the master is skipped when either the slide's
   * or the layout's `showMasterSp` is false.
   */
  layouts: SerializedTemplate[];
  /** Slide masters that at least one used layout resolves to, keyed by part path. */
  masters: SerializedTemplate[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serializeTextBody(tb: TextBody | undefined): SerializedTextBody | undefined {
  if (!tb) return undefined;
  const paragraphs: SerializedParagraph[] = tb.paragraphs.map((p) => ({
    level: p.level,
    text: p.runs.map((r) => r.text).join(''),
  }));
  const totalText = paragraphs.map((p) => p.text).join('\n');
  if (!totalText.trim()) return undefined;
  return { paragraphs, totalText };
}

function serializeCell(cell: TableCell): SerializedCell {
  const text = cell.textBody
    ? cell.textBody.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n')
    : '';
  return { text, gridSpan: cell.gridSpan, rowSpan: cell.rowSpan };
}

function serializeRow(row: TableRow): SerializedRow {
  return {
    height: row.height,
    cells: row.cells.map(serializeCell),
  };
}

function serializeShape3D(shape3d: Shape3DProperties | undefined): SerializedShape3D | undefined {
  if (!shape3d) return undefined;
  const shape = shape3d.shape;
  return {
    scene: shape3d.scene,
    shape: shape
      ? {
          extrusionHeight: shape.extrusionHeight,
          contourWidth: shape.contourWidth,
          ...(shape.presetMaterial !== undefined ? { presetMaterial: shape.presetMaterial } : {}),
          ...(shape.bevelTop ? { bevelTop: shape.bevelTop } : {}),
          ...(shape.bevelBottom ? { bevelBottom: shape.bevelBottom } : {}),
          ...(shape.contourColor ? { contourColor: shape.contourColor } : {}),
        }
      : undefined,
    effectKinds: [...shape3d.effectKinds],
    parseIssues: [...shape3d.parseIssues],
  };
}

/**
 * Parse a raw XML child node from a group into a typed node.
 */
function parseGroupChildren(
  childXml: SafeXmlNode,
  rels: Map<string, RelEntry>,
  partPath: string,
  diagramDrawings?: Map<string, string>,
  layout?: LayoutData,
  master?: MasterData,
  parentGroup?: GroupNodeData,
): BaseNodeData[] {
  const children = parseRenderableChildren(childXml, { rels, partPath, diagramDrawings });
  for (const child of children) {
    resolveNodePlaceholderInheritance(child, layout, master, { parentGroup });
  }
  return children;
}

function serializeNode(
  node: SlideNode | BaseNodeData,
  rels: Map<string, RelEntry>,
  partPath: string,
  diagramDrawings?: Map<string, string>,
  layout?: LayoutData,
  master?: MasterData,
): SerializedNode {
  const base: SerializedNode = {
    id: node.id,
    name: node.name,
    nodeType: node.nodeType,
    position: { x: node.position.x, y: node.position.y },
    size: { w: node.size.w, h: node.size.h },
    rotation: node.rotation,
    flipH: node.flipH,
    flipV: node.flipV,
  };

  switch (node.nodeType) {
    case 'shape': {
      const s = node as ShapeNodeData;
      base.presetGeometry = s.presetGeometry;
      base.textBody = serializeTextBody(s.textBody);
      base.shape3d = serializeShape3D(s.shape3d);
      break;
    }
    case 'picture': {
      const p = node as PicNodeData;
      base.blipEmbed = p.blipEmbed;
      base.shape3d = serializeShape3D(p.shape3d);
      break;
    }
    case 'table': {
      const t = node as TableNodeData;
      base.columns = [...t.columns];
      base.rows = t.rows.map(serializeRow);
      base.tableStyleId = t.tableStyleId;
      break;
    }
    case 'chart': {
      const c = node as ChartNodeData;
      base.chartPath = c.chartPath;
      break;
    }
    case 'group': {
      const g = node as GroupNodeData;
      base.shape3d = serializeShape3D(g.shape3d);
      const children: SerializedNode[] = [];
      for (const childXml of g.children) {
        try {
          const parsedChildren = parseGroupChildren(
            childXml,
            rels,
            partPath,
            diagramDrawings,
            layout,
            master,
            g,
          );
          for (const parsed of parsedChildren) {
            children.push(serializeNode(parsed, rels, partPath, diagramDrawings, layout, master));
          }
        } catch {
          // skip unparseable group children
        }
      }
      base.children = children;
      break;
    }
  }

  return base;
}

// ---------------------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------------------

/**
 * Serialize one layout's or master's template shapes.
 *
 * Template shapes are decoration rather than placeholders, so they resolve no
 * placeholder inheritance and are serialized with the part's own rels.
 */
function serializeTemplate(
  path: string,
  spTree: SafeXmlNode,
  rels: Map<string, RelEntry>,
  diagramDrawings: Map<string, string> | undefined,
  showMasterSp?: boolean,
): SerializedTemplate {
  const nodes = parseTemplateShapes(spTree, { rels, partPath: path, diagramDrawings }).map((node) =>
    serializeNode(node, rels, path, diagramDrawings),
  );
  return showMasterSp === undefined ? { path, nodes } : { path, nodes, showMasterSp };
}

export function serializePresentation(pres: PresentationData): SerializedPresentation {
  const layoutPaths = new Set<string>();
  const masterPaths = new Set<string>();

  const slides = pres.slides.map((slide, i) => {
    materializeSlideNodes(pres, slide);

    const layoutPath = pres.slideToLayout.get(slide.index) || slide.layoutIndex;
    const layout = pres.layouts.get(layoutPath);
    const masterPath = layoutPath ? pres.layoutToMaster.get(layoutPath) : '';
    const master = masterPath ? pres.masters.get(masterPath) : undefined;

    if (layoutPath && layout) layoutPaths.add(layoutPath);
    if (masterPath && master) masterPaths.add(masterPath);

    return {
      index: i,
      hidden: slide.hidden,
      colorMapOverride:
        slide.colorMapOverride === undefined
          ? undefined
          : Object.fromEntries(slide.colorMapOverride),
      colorMapOverrideMode: slide.colorMapOverrideMode,
      layoutPath: layout ? layoutPath : undefined,
      masterPath: master ? masterPath : undefined,
      showMasterSp: slide.showMasterSp,
      nodes: slide.nodes.map((node) =>
        serializeNode(node, slide.rels, slide.slidePath, pres.diagramDrawings, layout, master),
      ),
    };
  });

  const layouts: SerializedTemplate[] = [];
  for (const path of layoutPaths) {
    const layout = pres.layouts.get(path);
    if (!layout) continue;
    layouts.push(
      serializeTemplate(
        path,
        layout.spTree,
        layout.rels,
        pres.diagramDrawings,
        layout.showMasterSp,
      ),
    );
  }

  const masters: SerializedTemplate[] = [];
  for (const path of masterPaths) {
    const master = pres.masters.get(path);
    if (!master) continue;
    masters.push(serializeTemplate(path, master.spTree, master.rels, pres.diagramDrawings));
  }

  return {
    width: pres.width,
    height: pres.height,
    slideCount: pres.slides.length,
    slides,
    layouts,
    masters,
  };
}
