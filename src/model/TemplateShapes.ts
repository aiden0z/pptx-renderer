/**
 * Template shapes — the non-placeholder shapes a slide layout or slide master
 * contributes to every slide that uses it (logos, rules, background artwork).
 *
 * Placeholder shapes are deliberately excluded: they are position, size and
 * style templates that the slide's own placeholders inherit from, and drawing
 * them would paint the layout's prompt text over the author's content.
 */

import { SafeXmlNode } from '../parser/XmlParser';
import type { RelEntry } from '../parser/RelParser';
import type { BaseNodeData } from './nodes/BaseNode';
import { isPlaceholderNode, parseRenderableChildren } from './RenderableChild';

interface TemplateShapeContext {
  rels?: Map<string, RelEntry>;
  partPath?: string;
  diagramDrawings?: Map<string, string>;
}

/**
 * Parse the renderable non-placeholder shapes out of a layout or master
 * `p:spTree`, in source draw order.
 *
 * Shapes with no area and no text are dropped, and a child that cannot be
 * parsed is skipped rather than failing the whole tree — a template is
 * decoration, and one unreadable shape should not cost the rest of it.
 */
export function parseTemplateShapes(
  spTree: SafeXmlNode,
  ctx: TemplateShapeContext = {},
): BaseNodeData[] {
  const nodes: BaseNodeData[] = [];
  if (!spTree || !spTree.exists || !spTree.exists()) return nodes;

  const parseContext = {
    rels: ctx.rels ?? new Map<string, RelEntry>(),
    partPath: ctx.partPath,
    diagramDrawings: ctx.diagramDrawings,
  };

  for (const child of spTree.allChildren()) {
    try {
      for (const node of parseRenderableChildren(child, parseContext)) {
        if (isPlaceholderNode(node.source)) continue;
        if (node.size.w > 0 || node.size.h > 0) {
          nodes.push(node);
        }
      }
    } catch {
      // Skip unparseable template shapes silently
    }
  }

  return nodes;
}
