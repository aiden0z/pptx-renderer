/**
 * Slide parser — converts a slide XML into a structured SlideData
 * with typed node objects for each shape on the slide.
 */

import { SafeXmlNode } from '../parser/XmlParser';
import { RelEntry } from '../parser/RelParser';
import { parseRenderableChild, type RenderableNode } from './RenderableChild';
import { parseOoxmlBool } from '../parser/booleans';

export { parseOleFrameAsPicture } from './RenderableChild';

export type SlideNode = RenderableNode;

export interface SlideData {
  index: number;
  nodes: SlideNode[];
  background?: SafeXmlNode;
  layoutIndex: string;
  rels: Map<string, RelEntry>;
  /** Full path to the slide file (e.g. "ppt/slides/slide3.xml"). */
  slidePath: string;
  /** When false, shapes from the layout and master should NOT be rendered on this slide. */
  showMasterSp: boolean;
}

function parseDefaultTrueBoolAttr(value: string | undefined): boolean {
  return parseOoxmlBool(value, true);
}

/**
 * Find the layout relationship target from a slide's rels map.
 * The relationship type URI for slide layouts ends with "slideLayout".
 */
function findLayoutRel(rels: Map<string, RelEntry>): string {
  for (const [, entry] of rels) {
    if (entry.type.includes('slideLayout')) {
      return entry.target;
    }
  }
  return '';
}

/**
 * Parse a slide XML root (`p:sld`) into SlideData.
 *
 * @param root      Parsed XML root of the slide
 * @param index     Zero-based slide index
 * @param rels      Relationship entries for this slide
 * @param slidePath Full path to the slide file (e.g. "ppt/slides/slide1.xml")
 */
export function parseSlide(
  root: SafeXmlNode,
  index: number,
  rels: Map<string, RelEntry>,
  slidePath: string = '',
  diagramDrawings?: Map<string, string>,
): SlideData {
  const cSld = root.child('cSld');

  // --- Background ---
  const bg = cSld.child('bg');
  const background = bg.exists() ? bg : undefined;

  // --- Parse shape tree children ---
  const spTree = cSld.child('spTree');
  const nodes: SlideNode[] = [];

  for (const child of spTree.allChildren()) {
    const node = parseRenderableChild(child, {
      rels,
      partPath: slidePath,
      diagramDrawings,
    });
    if (node) {
      nodes.push(node);
    }
  }

  // --- Layout relationship ---
  const layoutIndex = findLayoutRel(rels);

  // --- showMasterSp: if false, layout/master shapes should not be rendered on this slide ---
  const showMasterSp = parseDefaultTrueBoolAttr(root.attr('showMasterSp'));

  return {
    index,
    nodes,
    background,
    layoutIndex,
    rels,
    slidePath,
    showMasterSp,
  };
}
