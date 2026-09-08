import { SafeXmlNode, parseXml } from '../parser/XmlParser';
import { RelEntry, resolveRelTarget, isExternalTargetMode } from '../parser/RelParser';
import { parseBaseProps } from './nodes/BaseNode';
import { ShapeNodeData, parseShapeNode } from './nodes/ShapeNode';
import { PicNodeData, parsePicNode } from './nodes/PicNode';
import { TableNodeData, parseTableNode } from './nodes/TableNode';
import { GroupNodeData, parseGroupNode } from './nodes/GroupNode';
import { ChartNodeData, parseChartNode } from './nodes/ChartNode';

export type RenderableNode =
  | ShapeNodeData
  | PicNodeData
  | TableNodeData
  | GroupNodeData
  | ChartNodeData;

interface RenderableChildParseContext {
  rels: Map<string, RelEntry>;
  partPath?: string;
  diagramDrawings?: Map<string, string>;
  skipPlaceholders?: boolean;
}

const CHILD_TAGS = new Set(['sp', 'pic', 'grpSp', 'graphicFrame', 'cxnSp']);
const PLACEHOLDER_WRAPPERS = ['nvSpPr', 'nvPicPr', 'nvGrpSpPr', 'nvGraphicFramePr', 'nvCxnSpPr'];
const SUPPORTED_MCE_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/presentationml/2006/main',
  'http://purl.oclc.org/ooxml/presentationml/main',
  'http://schemas.openxmlformats.org/drawingml/2006/main',
  'http://purl.oclc.org/ooxml/drawingml/main',
  'http://schemas.openxmlformats.org/drawingml/2006/chart',
  'http://purl.oclc.org/ooxml/drawingml/chart',
  'http://schemas.openxmlformats.org/drawingml/2006/diagram',
  'http://purl.oclc.org/ooxml/drawingml/diagram',
  'http://schemas.microsoft.com/office/drawing/2008/diagram',
  'http://schemas.microsoft.com/office/drawing/2016/SVG/main',
]);

function isCompatibleChoice(choice: SafeXmlNode): boolean {
  const requires = choice.attr('Requires')?.trim();
  if (!requires) return true;
  const element = choice.element;
  if (!element) return false;

  return requires
    .split(/\s+/)
    .every((prefix) => SUPPORTED_MCE_NAMESPACES.has(element.lookupNamespaceURI(prefix) ?? ''));
}

function selectAlternateContentBranch(alternateContent: SafeXmlNode): SafeXmlNode | undefined {
  for (const choice of alternateContent.children('Choice')) {
    if (isCompatibleChoice(choice)) return choice;
  }
  const fallback = alternateContent.child('Fallback');
  return fallback.exists() ? fallback : undefined;
}

/**
 * Expand one MCE wrapper into the children from exactly one compatible branch.
 * Nested wrappers are flattened recursively so callers preserve source draw order.
 */
export function expandCompatibleChildren(node: SafeXmlNode): SafeXmlNode[] {
  if (node.localName !== 'AlternateContent') return [node];
  const branch = selectAlternateContentBranch(node);
  if (!branch) return [];
  return branch.allChildren().flatMap(expandCompatibleChildren);
}

export function isPlaceholderNode(node: SafeXmlNode): boolean {
  for (const wrapper of PLACEHOLDER_WRAPPERS) {
    const nv = node.child(wrapper);
    if (nv.exists() && nv.child('nvPr').child('ph').exists()) return true;
  }
  return false;
}

function isTableFrame(node: SafeXmlNode): boolean {
  return node.child('graphic').child('graphicData').child('tbl').exists();
}

function isChartFrame(node: SafeXmlNode): boolean {
  const uri = node.child('graphic').child('graphicData').attr('uri') || '';
  return uri.includes('chart');
}

function isDiagramFrame(node: SafeXmlNode): boolean {
  const uri = node.child('graphic').child('graphicData').attr('uri') || '';
  return uri.includes('diagram');
}

function containingDir(partPath: string | undefined): string {
  if (!partPath) return '';
  const idx = partPath.lastIndexOf('/');
  return idx >= 0 ? partPath.substring(0, idx) : '';
}

function findOleFallbackPic(graphicFrame: SafeXmlNode): SafeXmlNode | null {
  const graphicData = graphicFrame.child('graphic').child('graphicData');
  const uri = graphicData.attr('uri') || '';
  if (!uri.includes('ole')) return null;

  const hasResolvableBlip = (pic: SafeXmlNode): boolean => {
    const blip = pic.child('blipFill').child('blip');
    return Boolean(
      blip.attr('embed') ?? blip.attr('r:embed') ?? blip.attr('link') ?? blip.attr('r:link'),
    );
  };

  const directOleObj = graphicData.child('oleObj');
  if (directOleObj.exists()) {
    const pic = directOleObj.child('pic');
    if (pic.exists() && hasResolvableBlip(pic)) return pic;
  }

  const altContent = graphicData.child('AlternateContent');
  if (!altContent.exists()) return null;
  const branch = selectAlternateContentBranch(altContent);
  if (!branch) return null;
  const oleObj = branch.child('oleObj');
  if (!oleObj.exists()) return null;
  const pic = oleObj.child('pic');
  if (pic.exists() && hasResolvableBlip(pic)) return pic;
  return null;
}

export function parseOleFrameAsPicture(graphicFrame: SafeXmlNode): PicNodeData | undefined {
  const pic = findOleFallbackPic(graphicFrame);
  if (!pic) return undefined;

  const base = parseBaseProps(graphicFrame);
  const fallbackPic = parsePicNode(pic);
  if (!fallbackPic.blipEmbed && !fallbackPic.blipLink) return undefined;

  return {
    ...fallbackPic,
    ...base,
    nodeType: 'picture',
    source: pic,
  };
}

function buildDiagramGroup(
  base: ReturnType<typeof parseBaseProps>,
  drawingXml: string,
): GroupNodeData {
  const drawingRoot = parseXml(drawingXml);
  const spTree = drawingRoot.child('spTree');
  const children: SafeXmlNode[] = [];

  if (spTree.exists()) {
    for (const child of spTree.allChildren()) {
      for (const selected of expandCompatibleChildren(child)) {
        if (CHILD_TAGS.has(selected.localName)) children.push(selected);
      }
    }
  }

  return {
    ...base,
    nodeType: 'group',
    childOffset: { x: 0, y: 0 },
    childExtent: { w: Math.max(1, base.size.w), h: Math.max(1, base.size.h) },
    children,
  };
}

function parseDiagramFrame(
  graphicFrame: SafeXmlNode,
  ctx: RenderableChildParseContext,
): GroupNodeData | undefined {
  if (!ctx.diagramDrawings) return undefined;

  const base = parseBaseProps(graphicFrame);
  const partDir = containingDir(ctx.partPath);
  const drawingCandidates = Array.from(ctx.rels.values())
    .filter(
      (entry) => entry.type.includes('diagramDrawing') || entry.target.includes('diagrams/drawing'),
    )
    .map((entry) => {
      const match = entry.target.match(/drawing(\d+)/);
      return {
        target: entry.target,
        num: match ? Number.parseInt(match[1], 10) : undefined,
      };
    });

  const relIds = graphicFrame.child('graphic').child('graphicData').child('relIds');
  if (relIds.exists()) {
    const dmRId = relIds.attr('r:dm') ?? relIds.attr('dm');
    const dmRel = dmRId ? ctx.rels.get(dmRId) : undefined;
    const dataNum = dmRel?.target.match(/data(\d+)/)?.[1];
    if (dataNum) {
      const drawingNum = Number.parseInt(dataNum, 10);
      drawingCandidates.sort((a, b) => {
        const da = a.num === undefined ? Number.POSITIVE_INFINITY : Math.abs(a.num - drawingNum);
        const db = b.num === undefined ? Number.POSITIVE_INFINITY : Math.abs(b.num - drawingNum);
        return da - db;
      });
    }
  }

  for (const candidate of drawingCandidates) {
    const drawingPath = resolveRelTarget(partDir, candidate.target);
    const drawingXml = ctx.diagramDrawings.get(drawingPath);
    if (drawingXml) {
      const group = buildDiagramGroup(base, drawingXml);
      const layoutId = relIds.attr('r:lo') ?? relIds.attr('lo');
      const layoutRel = layoutId ? ctx.rels.get(layoutId) : undefined;
      if (
        layoutRel &&
        !isExternalTargetMode(layoutRel.targetMode) &&
        layoutRel.type.endsWith('/diagramLayout')
      ) {
        const layoutXml = ctx.diagramDrawings.get(resolveRelTarget(partDir, layoutRel.target));
        if (layoutXml) group.diagramLayoutId = parseXml(layoutXml).attr('uniqueId');
      }
      return group;
    }
  }

  return undefined;
}

function parseDirectRenderableChild(
  childXml: SafeXmlNode,
  ctx: RenderableChildParseContext,
): RenderableNode | undefined {
  if (ctx.skipPlaceholders && isPlaceholderNode(childXml)) return undefined;

  switch (childXml.localName) {
    case 'sp':
    case 'cxnSp':
      return parseShapeNode(childXml);
    case 'pic':
      return parsePicNode(childXml);
    case 'grpSp': {
      const group = parseGroupNode(childXml);
      group.children = childXml
        .allChildren()
        .flatMap(expandCompatibleChildren)
        .filter((child) => CHILD_TAGS.has(child.localName));
      return group;
    }
    case 'graphicFrame':
      if (isTableFrame(childXml)) return parseTableNode(childXml);
      if (isChartFrame(childXml)) return parseChartNode(childXml, ctx.rels, ctx.partPath ?? '');
      if (isDiagramFrame(childXml)) return parseDiagramFrame(childXml, ctx);
      return parseOleFrameAsPicture(childXml);
    default:
      return undefined;
  }
}

export function parseRenderableChildren(
  childXml: SafeXmlNode,
  ctx: RenderableChildParseContext,
): RenderableNode[] {
  const nodes: RenderableNode[] = [];
  for (const selected of expandCompatibleChildren(childXml)) {
    const node = parseDirectRenderableChild(selected, ctx);
    if (node) nodes.push(node);
  }
  return nodes;
}

export function parseRenderableChild(
  childXml: SafeXmlNode,
  ctx: RenderableChildParseContext,
): RenderableNode | undefined {
  return parseRenderableChildren(childXml, ctx)[0];
}
