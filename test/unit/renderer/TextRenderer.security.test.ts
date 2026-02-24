import { describe, expect, it } from 'vitest';
import { renderTextBody } from '../../../src/renderer/TextRenderer';
import { createMockRenderContext } from '../helpers/mockContext';
import { xmlNode } from '../helpers/xmlNode';
import type { TextBody } from '../../../src/model/nodes/ShapeNode';

function makeTextBodyWithLink(rId: string): TextBody {
  return {
    paragraphs: [
      {
        level: 0,
        runs: [
          {
            text: 'Click me',
            properties: xmlNode(`<rPr><hlinkClick r:id="${rId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></rPr>`),
          },
        ],
      },
    ],
  };
}

describe('TextRenderer hyperlink security', () => {
  it('does not create anchor for javascript links', () => {
    const ctx = createMockRenderContext();
    ctx.slide.rels.set('rId1', {
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
      target: 'javascript:alert(1)',
      targetMode: 'External',
    });

    const container = document.createElement('div');
    renderTextBody(makeTextBodyWithLink('rId1'), undefined, ctx, container);

    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('Click me');
  });

  it('creates anchor for allowed external https links', () => {
    const ctx = createMockRenderContext();
    ctx.slide.rels.set('rId1', {
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
      target: 'https://example.com/docs',
      targetMode: 'External',
    });

    const container = document.createElement('div');
    renderTextBody(makeTextBodyWithLink('rId1'), undefined, ctx, container);

    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('https://example.com/docs');
  });
});
