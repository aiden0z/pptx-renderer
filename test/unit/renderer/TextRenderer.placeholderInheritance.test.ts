import { describe, it, expect } from 'vitest';
import { renderTextBody } from '../../../src/renderer/TextRenderer';
import { createMockRenderContext } from '../helpers/mockContext';
import { xmlNode } from '../helpers/xmlNode';
import type { PlaceholderEntry } from '../../../src/model/Layout';
import type { TextBody } from '../../../src/model/nodes/ShapeNode';

/**
 * A layout placeholder shape carrying an optional level-1 `defRPr` solid colour in its `lstStyle`.
 */
function layoutPlaceholder(
  type: string,
  idx: number | null,
  colourHex: string | null,
): PlaceholderEntry {
  const phAttrs = `type="${type}"${idx !== null ? ` idx="${idx}"` : ''}`;
  const lstStyle =
    colourHex !== null
      ? `<lstStyle><lvl1pPr><defRPr><solidFill><srgbClr val="${colourHex}"/></solidFill></defRPr></lvl1pPr></lstStyle>`
      : '';
  return {
    node: xmlNode(
      `<sp><nvSpPr><nvPr><ph ${phAttrs}/></nvPr></nvSpPr><txBody>${lstStyle}</txBody></sp>`,
    ),
  };
}

function makeTextBody(): TextBody {
  return {
    bodyProperties: undefined,
    listStyle: undefined,
    paragraphs: [{ runs: [{ text: 'Hello' }], level: 0 }],
  };
}

function renderColour(placeholders: PlaceholderEntry[], idx: number): string | undefined {
  const ctx = createMockRenderContext();
  ctx.layout.placeholders = placeholders;
  const container = document.createElement('div');
  renderTextBody(makeTextBody(), { type: 'title', idx }, ctx, container);
  return container.querySelector('span')?.style.color;
}

describe('TextRenderer — placeholder colour inheritance (aiden0z/pptx-renderer#13)', () => {
  it('matches the layout placeholder by idx, not the first same-type placeholder', () => {
    // A deck (e.g. a Google Slides export) can have several placeholders of the same type with
    // different idx. A title with no explicit run colour must inherit from the placeholder whose
    // idx matches — not from the first one that merely shares its type.
    const colour = renderColour(
      [
        layoutPlaceholder('title', null, 'FF0000'), // first type match, red — the trap
        layoutPlaceholder('title', 3, '00FF00'), // idx match, green — the intended colour
      ],
      3,
    );
    expect(colour).toBe('rgb(0, 255, 0)');
  });

  it('falls back to a type match when no placeholder has the given idx', () => {
    const colour = renderColour([layoutPlaceholder('title', null, 'FF0000')], 9);
    expect(colour).toBe('rgb(255, 0, 0)');
  });
});
