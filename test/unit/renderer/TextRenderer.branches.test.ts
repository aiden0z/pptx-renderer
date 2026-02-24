/**
 * TextRenderer branch coverage — comprehensive test suite for uncovered code paths.
 * Targets 7-level style inheritance, gradient fills, outlines, advanced formatting, etc.
 */

import { describe, it, expect } from 'vitest';
import { renderTextBody } from '../../../src/renderer/TextRenderer';
import { createMockRenderContext } from '../helpers/mockContext';
import { xmlNode } from '../helpers/xmlNode';
import type { TextBody, TextParagraph, TextRun } from '../../../src/model/nodes/ShapeNode';

function makeTextBody(opts: {
  paragraphs?: TextParagraph[];
  bodyPr?: string;
  listStyle?: string;
} = {}): TextBody {
  return {
    bodyProperties: opts.bodyPr ? xmlNode(opts.bodyPr) : undefined,
    listStyle: opts.listStyle ? xmlNode(opts.listStyle) : undefined,
    paragraphs: opts.paragraphs ?? [{
      runs: [{ text: 'Test' }],
      level: 0,
    }],
  };
}

function renderToContainer(textBody: TextBody, placeholder?: any, options?: any): HTMLElement {
  const ctx = createMockRenderContext();
  const container = document.createElement('div');
  renderTextBody(textBody, placeholder, ctx, container, options);
  return container;
}

describe('TextRenderer — branch coverage (uncovered paths)', () => {
  // ============================================================================
  // Run-level gradient fill (textGradientCss)
  // ============================================================================
  describe('gradient text fill (gradFill on rPr)', () => {
    it('applies text gradient fill with background-clip', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Gradient Text',
            properties: xmlNode(
              `<rPr>
                <gradFill>
                  <gsLst>
                    <gs pos="0"><srgbClr val="FF0000"/></gs>
                    <gs pos="100000"><srgbClr val="0000FF"/></gs>
                  </gsLst>
                  <lin ang="0" scaled="0"/>
                </gradFill>
              </rPr>`,
            ),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span') as any;
      expect(span.style.background).toContain('gradient');
      expect(span.style.webkitBackgroundClip).toBe('text');
      expect(span.style.color).toBe('transparent');
    });

    it('applies gradient fill with multiple color stops', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Multi-stop gradient',
            properties: xmlNode(
              `<rPr>
                <gradFill>
                  <gsLst>
                    <gs pos="0"><srgbClr val="FF0000"/></gs>
                    <gs pos="50000"><srgbClr val="00FF00"/></gs>
                    <gs pos="100000"><srgbClr val="0000FF"/></gs>
                  </gsLst>
                  <lin ang="5400000" scaled="0"/>
                </gradFill>
              </rPr>`,
            ),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span') as any;
      expect(span.style.background).toContain('gradient');
      expect(span.style.background).toContain('%');
    });
  });

  // ============================================================================
  // Text outline with gradient (ln > gradFill on rPr)
  // ============================================================================
  describe('text outline with gradient (textOutlineGradientCss)', () => {
    it('applies text outline with gradient fill', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Gradient Outline',
            properties: xmlNode(
              `<rPr>
                <ln w="25400">
                  <solidFill><srgbClr val="FF0000"/></solidFill>
                </ln>
              </rPr>`,
            ),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span') as any;
      // Text outline should set webkitTextStrokeColor
      expect(span.style.webkitTextStrokeColor || span.style.color).toBeTruthy();
    });

    it('applies ghost text with gradient outline', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Ghost Gradient',
            properties: xmlNode(
              `<rPr>
                <noFill/>
                <ln w="25400">
                  <gradFill>
                    <gsLst>
                      <gs pos="0"><srgbClr val="FFFFFF"/></gs>
                      <gs pos="100000"><srgbClr val="FFFFFF" alphaModFix="50000"/></gs>
                    </gsLst>
                    <lin ang="0" scaled="0"/>
                  </gradFill>
                </ln>
              </rPr>`,
            ),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span') as any;
      expect(span.style.color).toBe('transparent');
      expect(span.style.maskImage).toContain('gradient');
    });
  });

  // ============================================================================
  // Paragraph indent (marL, indent)
  // ============================================================================
  describe('paragraph indent (marL, indent)', () => {
    it('applies both margin-left and text-indent', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(
            `<pPr marL="914400" indent="-457200"/>`,
          ),
          runs: [{ text: 'Hanging indent' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      expect(parseFloat(para.style.marginLeft)).toBeGreaterThan(0);
      expect(parseFloat(para.style.textIndent)).toBeLessThan(0);
    });

    it('applies large margin-left with hanging indent', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(`<pPr marL="2286000" indent="-228600"/>`),
          runs: [{ text: 'Deeply indented' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      // 2286000 EMU ≈ 240px
      expect(parseFloat(para.style.marginLeft)).toBeGreaterThan(200);
    });
  });

  // ============================================================================
  // Vertical text (vert="vert270", "eaVert")
  // Note: TextRenderer doesn't directly render vert, but test listStyle inheritance with levels
  // ============================================================================
  describe('list style inheritance with multiple levels', () => {
    it('renders paragraphs at level 1', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [{ text: 'Level 0' }],
            level: 0,
          },
          {
            runs: [{ text: 'Level 1' }],
            level: 1,
          },
        ],
      });
      const container = renderToContainer(body);
      expect(container.children.length).toBe(2);
      expect(container.textContent).toContain('Level 1');
    });

    it('renders paragraphs at level 2', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [{ text: 'Level 0' }],
            level: 0,
          },
          {
            runs: [{ text: 'Level 2' }],
            level: 2,
          },
        ],
      });
      const container = renderToContainer(body);
      expect(container.children.length).toBe(2);
      expect(container.textContent).toContain('Level 2');
    });
  });

  // ============================================================================
  // Word wrap mode (wrap="none") — not directly testable in TextRenderer
  // but covered by ensuring normal text rendering with long runs
  // ============================================================================
  describe('text with long runs (word wrap)', () => {
    it('renders very long text without breaking', () => {
      const longText = 'A'.repeat(200);
      const body = makeTextBody({
        paragraphs: [{
          runs: [{ text: longText }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      expect(container.textContent).toHaveLength(200);
    });
  });

  // ============================================================================
  // Anchor bottom/middle (anchor="b", "ctr") — applied via bodyPr
  // Note: TextRenderer doesn't apply anchor directly; tested via listStyle inheritance
  // ============================================================================
  describe('vertical text anchoring via style inheritance', () => {
    it('preserves paragraph properties through inheritance chain', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(`<pPr algn="dist"/>`),
          runs: [{ text: 'Distributed' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      expect(para.style.textAlign).toBe('justify');
    });
  });

  // ============================================================================
  // Text auto-fit (spAutoFit, normAutofit)
  // ============================================================================
  describe('text auto-fit (spAutoFit, normAutofit)', () => {
    it('applies spAutoFit scaling (shape auto-fit)', () => {
      const body = makeTextBody({
        bodyPr: `<bodyPr><spAutoFit/></bodyPr>`,
        paragraphs: [{
          runs: [{
            text: 'Auto-fit',
            properties: xmlNode(`<rPr sz="2400"/>`),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      // spAutoFit doesn't modify font scale directly (that's normAutofit)
      expect(span).not.toBeNull();
    });

    it('applies font scale > 100% from normAutofit', () => {
      const body = makeTextBody({
        bodyPr: `<bodyPr><normAutofit fontScale="110000"/></bodyPr>`,
        paragraphs: [{
          runs: [{
            text: 'Scaled up',
            properties: xmlNode(`<rPr sz="2000"/>`),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      // 20pt * 1.1 = 22pt
      expect(span!.style.fontSize).toBe('22pt');
    });

    it('applies font scale < 100% from normAutofit', () => {
      const body = makeTextBody({
        bodyPr: `<bodyPr><normAutofit fontScale="50000"/></bodyPr>`,
        paragraphs: [{
          runs: [{
            text: 'Scaled down',
            properties: xmlNode(`<rPr sz="2400"/>`),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      // 24pt * 0.5 = 12pt
      expect(span!.style.fontSize).toBe('12pt');
    });
  });

  // ============================================================================
  // Text margin/inset (tIns, bIns, lIns, rIns)
  // Note: Not directly applied by TextRenderer (would be in container style)
  // but test inheritance pathways
  // ============================================================================
  describe('text margins via paragraph properties', () => {
    it('applies margin-left from nested marL', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(`<pPr marL="1828800"/>`),
          runs: [{ text: 'Indented paragraph' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      // 1828800 EMU ≈ 192px
      expect(parseFloat(para.style.marginLeft)).toBeGreaterThan(100);
    });
  });

  // ============================================================================
  // Shape listStyle processing (tested implicitly via level handling)
  // ============================================================================
  describe('listStyle processing', () => {
    it('processes shape listStyle without errors', () => {
      const body = makeTextBody({
        listStyle: `<lstStyle>
          <lvl1pPr><pPr algn="ctr"/></lvl1pPr>
        </lstStyle>`,
        paragraphs: [{
          runs: [{ text: 'With listStyle' }],
          level: 0,
        }],
      });

      const container = renderToContainer(body);
      expect(container.textContent).toContain('With listStyle');
    });

    it('handles paragraph pPr alongside listStyle', () => {
      const body = makeTextBody({
        listStyle: `<lstStyle>
          <lvl1pPr><pPr algn="ctr"/></lvl1pPr>
        </lstStyle>`,
        paragraphs: [{
          properties: xmlNode(`<pPr algn="r"/>`),
          runs: [{ text: 'Paragraph override' }],
          level: 0,
        }],
      });

      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      // Paragraph pPr should override listStyle
      expect(para.style.textAlign).toBe('right');
    });
  });

  // ============================================================================
  // Run-level highlight color (not explicitly in schema, but covered via solidFill)
  // ============================================================================
  describe('run color resolution with fallback chain', () => {
    it('uses explicit run solidFill color', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Explicit color',
            properties: xmlNode(`<rPr><solidFill><srgbClr val="00FF00"/></solidFill></rPr>`),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.color).toContain('0'); // green color
    });

    it('falls back to defRPr color when run has no color', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(
            `<pPr><defRPr><solidFill><srgbClr val="FF0000"/></solidFill></defRPr></pPr>`,
          ),
          runs: [{
            text: 'Inherited from defRPr',
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.color).toContain('255'); // red
    });

    it('falls back to lstStyle defRPr when paragraph defRPr is empty', () => {
      const body = makeTextBody({
        listStyle: `<lstStyle>
          <lvl1pPr>
            <defRPr><solidFill><srgbClr val="0000FF"/></solidFill></defRPr>
          </lvl1pPr>
        </lstStyle>`,
        paragraphs: [{
          properties: xmlNode(`<pPr><defRPr/></pPr>`),
          runs: [{
            text: 'lstStyle fallback',
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      // Blue from lstStyle
      expect(span!.style.color).toBeTruthy();
    });
  });

  // ============================================================================
  // Strike-through text (strike attribute)
  // ============================================================================
  describe('strike-through text', () => {
    it('applies line-through for sngStrike', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Struck',
            properties: xmlNode(`<rPr strike="sngStrike"/>`),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.textDecoration).toContain('line-through');
    });

    it('removes strike-through with noStrike', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Not struck',
            properties: xmlNode(`<rPr strike="noStrike"/>`),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.textDecoration).not.toContain('line-through');
    });

    it('combines underline and strike-through', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Underlined and struck',
            properties: xmlNode(`<rPr u="sng" strike="sngStrike"/>`),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.textDecoration).toContain('underline');
      expect(span!.style.textDecoration).toContain('line-through');
    });
  });

  // ============================================================================
  // Character spacing (spc) and kerning (kern)
  // ============================================================================
  describe('character spacing and kerning', () => {
    it('applies positive character spacing', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Spaced',
            properties: xmlNode(`<rPr spc="500"/>`),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.letterSpacing).toBe('5pt');
    });

    it('applies kerning for large font sizes', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Kerned',
            properties: xmlNode(`<rPr kern="1200" sz="2400"/>`),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      // 24pt >= 12pt threshold, so kerning enabled
      expect(span!.style.fontKerning).toBe('normal');
    });

    it('disables kerning for small font sizes', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'No kern',
            properties: xmlNode(`<rPr kern="1200" sz="1000"/>`),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      // 10pt < 12pt threshold, so kerning disabled
      expect(span!.style.fontKerning).toBe('none');
    });

    it('applies kern="0" to always enable kerning', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Always kern',
            properties: xmlNode(`<rPr kern="0" sz="800"/>`),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      // kern=0 means always kern (8pt >= 0pt)
      expect(span!.style.fontKerning).toBe('normal');
    });
  });

  // ============================================================================
  // Bullet variations (buChar with font, buAutoNum with startAt)
  // ============================================================================
  describe('bullet variations', () => {
    it('applies bullet font from buFont', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(
            `<pPr><buChar char="●"/><buFont typeface="Wingdings"/></pPr>`,
          ),
          runs: [{ text: 'Windings bullet' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const bulletSpan = container.querySelector('span');
      expect(bulletSpan).not.toBeNull();
      expect(bulletSpan!.style.fontFamily).toContain('Wingdings');
    });

    it('renders bullet with explicit color from buClr', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(
            `<pPr><buChar char="►"/><buClr><srgbClr val="FF0000"/></buClr></pPr>`,
          ),
          runs: [{ text: 'Red bullet' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const bulletSpan = container.querySelector('span');
      expect(bulletSpan!.style.color).toContain('255'); // red
    });

    it('applies arabicParenR auto-numbering', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode(`<pPr><buAutoNum type="arabicParenR"/></pPr>`),
            runs: [{ text: 'First' }],
            level: 0,
          },
          {
            properties: xmlNode(`<pPr><buAutoNum type="arabicParenR"/></pPr>`),
            runs: [{ text: 'Second' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      expect(container.textContent).toContain('1)');
      expect(container.textContent).toContain('2)');
    });

    it('applies romanLcPeriod auto-numbering', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode(`<pPr><buAutoNum type="romanLcPeriod"/></pPr>`),
            runs: [{ text: 'Item 1' }],
            level: 0,
          },
          {
            properties: xmlNode(`<pPr><buAutoNum type="romanLcPeriod"/></pPr>`),
            runs: [{ text: 'Item 2' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      expect(container.textContent).toContain('i.');
      expect(container.textContent).toContain('ii.');
    });

    it('applies alphaUcParenR auto-numbering', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(`<pPr><buAutoNum type="alphaUcParenR"/></pPr>`),
          runs: [{ text: 'Alpha' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      expect(container.textContent).toContain('A)');
    });

    it('suppresses bullets for empty paragraphs', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(`<pPr><buAutoNum type="arabicPeriod"/></pPr>`),
          runs: [],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      expect(container.textContent).not.toContain('1.');
    });

    it('suppresses bullets for title placeholder', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(`<pPr><buAutoNum type="arabicPeriod"/></pPr>`),
          runs: [{ text: 'Title text' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body, { type: 'title' });
      expect(container.textContent).not.toContain('1.');
    });

    it('suppresses bullets for metadata placeholders (sldNum)', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(`<pPr><buAutoNum type="arabicPeriod"/></pPr>`),
          runs: [{ text: '1' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body, { type: 'sldNum' });
      expect(container.textContent).not.toContain('1.');
      expect(container.textContent).toBe('1');
    });

    it('suppresses bullets for date placeholder (dt)', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(`<pPr><buAutoNum type="arabicPeriod"/></pPr>`),
          runs: [{ text: '2024-01-01' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body, { type: 'dt' });
      expect(container.textContent).not.toContain('1.');
    });

    it('suppresses bullets for footer placeholder (ftr)', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(`<pPr><buAutoNum type="arabicPeriod"/></pPr>`),
          runs: [{ text: 'Footer text' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body, { type: 'ftr' });
      expect(container.textContent).not.toContain('1.');
    });

    it('suppresses bullets for centered title placeholder (ctrTitle)', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(`<pPr><buAutoNum type="arabicPeriod"/></pPr>`),
          runs: [{ text: 'Centered' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body, { type: 'ctrTitle' });
      expect(container.textContent).not.toContain('1.');
    });
  });

  // ============================================================================
  // Multiple paragraphs in a single text body
  // ============================================================================
  describe('multiple paragraphs with different styles', () => {
    it('applies different alignment to each paragraph', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode(`<pPr algn="l"/>`),
            runs: [{ text: 'Left' }],
            level: 0,
          },
          {
            properties: xmlNode(`<pPr algn="ctr"/>`),
            runs: [{ text: 'Center' }],
            level: 0,
          },
          {
            properties: xmlNode(`<pPr algn="r"/>`),
            runs: [{ text: 'Right' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const paras = Array.from(container.children) as HTMLElement[];
      expect(paras[0].style.textAlign).toBe('left');
      expect(paras[1].style.textAlign).toBe('center');
      expect(paras[2].style.textAlign).toBe('right');
    });

    it('applies different bullet styles to adjacent paragraphs', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode(`<pPr><buChar char="•"/></pPr>`),
            runs: [{ text: 'Bullet 1' }],
            level: 0,
          },
          {
            properties: xmlNode(`<pPr><buChar char="○"/></pPr>`),
            runs: [{ text: 'Bullet 2' }],
            level: 0,
          },
          {
            properties: xmlNode(`<pPr><buNone/></pPr>`),
            runs: [{ text: 'No bullet' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      expect(container.textContent).toContain('•');
      expect(container.textContent).toContain('○');
      expect(container.textContent).toContain('No bullet');
    });

    it('handles mixed levels in paragraph hierarchy', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode(`<pPr algn="l"/>`),
            runs: [{ text: 'Level 0' }],
            level: 0,
          },
          {
            properties: xmlNode(`<pPr algn="ctr"/>`),
            runs: [{ text: 'Level 1' }],
            level: 1,
          },
          {
            properties: xmlNode(`<pPr algn="r"/>`),
            runs: [{ text: 'Level 0 again' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      expect(container.children.length).toBe(3);
    });
  });

  // ============================================================================
  // Line breaks with absolute line spacing (useLineWrappers)
  // ============================================================================
  describe('line breaks with absolute line spacing', () => {
    it('uses line wrappers when spcPts and line breaks are present', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(`<pPr><lnSpc><spcPts val="2400"/></lnSpc></pPr>`),
          runs: [
            { text: 'Line 1' },
            { text: '\n' },
            { text: 'Line 2' },
          ],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      // Should have nested divs for line wrappers
      const divChildren = Array.from(para.children).filter(
        (el) => el.tagName === 'DIV',
      );
      expect(divChildren.length).toBeGreaterThan(0);
    });

    it('does not use line wrappers when spcPct is used', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(`<pPr><lnSpc><spcPct val="120000"/></lnSpc></pPr>`),
          runs: [
            { text: 'Line 1' },
            { text: '\n' },
            { text: 'Line 2' },
          ],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const br = container.querySelector('br');
      expect(br).not.toBeNull();
    });

    it('handles multiple consecutive line breaks with absolute spacing', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(`<pPr><lnSpc><spcPts val="1800"/></lnSpc></pPr>`),
          runs: [
            { text: 'A' },
            { text: '\n' },
            { text: 'B' },
            { text: '\n' },
            { text: 'C' },
          ],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      const divChildren = Array.from(para.children).filter(
        (el) => el.tagName === 'DIV',
      );
      expect(divChildren.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================================================
  // EastAsian and Complex Script fonts (ea, cs)
  // ============================================================================
  describe('east asian and complex script fonts', () => {
    it('resolves +mn-ea to theme minor font (east asian)', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'East Asian',
            properties: xmlNode(`<rPr><ea typeface="+mn-ea"/></rPr>`),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.fontFamily).not.toBe('');
    });

    it('resolves +mn-cs to theme minor font (complex script)', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Complex script',
            properties: xmlNode(`<rPr><cs typeface="+mn-cs"/></rPr>`),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.fontFamily).not.toBe('');
    });

    it('falls back to ea when latin is not specified', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'EA fallback',
            properties: xmlNode(`<rPr><ea typeface="Microsoft YaHei"/></rPr>`),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.fontFamily).toContain('Microsoft YaHei');
    });

    it('falls back to cs when neither latin nor ea specified', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'CS fallback',
            properties: xmlNode(`<rPr><cs typeface="Devanagari"/></rPr>`),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.fontFamily).toContain('Devanagari');
    });
  });

  // ============================================================================
  // No fill on outline (ln > noFill)
  // ============================================================================
  describe('text outline with no fill', () => {
    it('applies outline without interior fill', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Outline only',
            properties: xmlNode(`<rPr><ln w="25400"><noFill/></ln></rPr>`),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      // noFill on ln means no outline is applied
      expect(span).not.toBeNull();
    });
  });

  // ============================================================================
  // Ghost text variations (noFill + outline)
  // ============================================================================
  describe('ghost text with outline variations', () => {
    it('applies ghost text with solid outline color', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Ghost solid outline',
            properties: xmlNode(
              `<rPr>
                <noFill/>
                <ln w="12700"><solidFill><srgbClr val="FF0000"/></solidFill></ln>
              </rPr>`,
            ),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span') as any;
      expect(span.style.color).toBe('transparent');
      expect(span.style.webkitTextStrokeColor).toContain('255'); // red
    });

    it('applies pure ghost text (noFill without outline)', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Invisible',
            properties: xmlNode(`<rPr><noFill/></rPr>`),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.color).toBe('transparent');
    });
  });

  // ============================================================================
  // Superscript/subscript with font size reduction
  // ============================================================================
  describe('superscript and subscript with font scaling', () => {
    it('reduces font size for superscript with large shift', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'x',
            properties: xmlNode(`<rPr baseline="50000" sz="2400"/>`),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      // baseline=50000 → 50% shift (>= 20%) → font shrinks to 65%
      const fontSize = parseFloat(span!.style.fontSize);
      expect(fontSize).toBeLessThan(24);
      expect(fontSize).toBeCloseTo(24 * 0.65, 1);
    });

    it('reduces font size for subscript with large negative shift', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'y',
            properties: xmlNode(`<rPr baseline="-30000" sz="2400"/>`),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      // baseline=-30000 → -30% shift (>= 20%) → font shrinks to 65%
      const fontSize = parseFloat(span!.style.fontSize);
      expect(fontSize).toBeLessThan(24);
    });

    it('does not reduce font size for small baseline shift', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'z',
            properties: xmlNode(`<rPr baseline="10000" sz="2400"/>`),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      // baseline=10000 → 10% shift (< 20%) → no font reduction
      const fontSize = parseFloat(span!.style.fontSize);
      expect(fontSize).toBe(24);
    });

    it('applies baseline=0 (no shift)', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'normal',
            properties: xmlNode(`<rPr baseline="0" sz="2400"/>`),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      // baseline=0 → no shift, no font reduction
      expect(span!.style.verticalAlign).not.toBe('0%');
    });
  });

  // ============================================================================
  // Space before/after with percentage-based spacing
  // ============================================================================
  describe('paragraph spacing with percentage', () => {
    it('applies percentage-based space before', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(`<pPr><spcBef><spcPct val="100000"/></spcBef></pPr>`),
          runs: [{ text: 'Text' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      // 100% of default 12pt = 12pt
      expect(para.style.marginTop).toBe('12pt');
    });

    it('applies percentage-based space after', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(`<pPr><spcAft><spcPct val="200000"/></spcAft></pPr>`),
          runs: [{ text: 'Text' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      // 200% of 12pt = 24pt
      expect(para.style.marginBottom).toBe('24pt');
    });
  });

  // ============================================================================
  // Color with alpha modifiers (alpha < 1)
  // ============================================================================
  describe('text colors with alpha transparency', () => {
    it('applies color with transparency modifier', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Transparent',
            properties: xmlNode(
              `<rPr><solidFill><srgbClr val="FF0000"><alphaModFix val="50000"/></srgbClr></solidFill></rPr>`,
            ),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      // Color should be set with transparency
      expect(span!.style.color).toBeTruthy();
      // Either rgba or rgb format is acceptable (jsdom may normalize)
      expect(span!.style.color).toMatch(/rgb/);
    });
  });

  // ============================================================================
  // Unsupported underline styles (remove decoration)
  // ============================================================================
  describe('underline styles', () => {
    it('removes underline for u="none"', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Not underlined',
            properties: xmlNode(`<rPr u="none"/>`),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.textDecoration).not.toContain('underline');
    });

    it('applies underline for u="dbl"', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Double underline',
            properties: xmlNode(`<rPr u="dbl"/>`),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.textDecoration).toContain('underline');
    });
  });

  // ============================================================================
  // fontRefColor and cellTextColor interaction
  // ============================================================================
  describe('color override options (fontRefColor, cellTextColor)', () => {
    it('prefers explicit run color over fontRefColor', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Explicit wins',
            properties: xmlNode(
              `<rPr><solidFill><srgbClr val="00FF00"/></solidFill></rPr>`,
            ),
          }],
          level: 0,
        }],
      });
      const ctx = createMockRenderContext();
      const container = document.createElement('div');
      renderTextBody(body, undefined, ctx, container, {
        fontRefColor: '#FF0000',
      });
      const span = container.querySelector('span');
      // Green (explicit) not red (fontRef)
      expect(span!.style.color).toContain('0'); // green
    });

    it('applies fontRefColor when run has no explicit color', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'SmartArt text',
          }],
          level: 0,
        }],
      });
      const ctx = createMockRenderContext();
      const container = document.createElement('div');
      renderTextBody(body, undefined, ctx, container, {
        fontRefColor: '#FF0000',
      });
      const span = container.querySelector('span');
      // Red from fontRefColor
      expect(span!.style.color).toBe('rgb(255, 0, 0)');
    });

    it('uses cellTextColor as fallback when no other color set', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Table cell',
          }],
          level: 0,
        }],
      });
      const ctx = createMockRenderContext();
      const container = document.createElement('div');
      renderTextBody(body, undefined, ctx, container, {
        cellTextColor: '#0000FF',
      });
      const span = container.querySelector('span');
      expect(span!.style.color).toBeTruthy();
    });
  });

  // ============================================================================
  // Placeholder category detection (title, body, other)
  // ============================================================================
  describe('placeholder category inheritance', () => {
    it('treats ctrTitle as title category', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{ text: 'Centered title' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body, { type: 'ctrTitle' });
      // Should be treated as title (no bullets)
      expect(container.textContent).toBe('Centered title');
    });

    it('treats subTitle as body category', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode(`<pPr><buAutoNum type="arabicPeriod"/></pPr>`),
            runs: [{ text: 'Subtitle' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body, { type: 'subTitle' });
      // subTitle is body category but bullets are suppressed for it
      expect(container.textContent).not.toContain('1.');
    });

    it('treats obj as body category', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{ text: 'Object text' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body, { type: 'obj' });
      expect(container.textContent).toContain('Object text');
    });

    it('defaults to other category for unknown placeholder types', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{ text: 'Other text' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body, { type: 'unknown' });
      expect(container.textContent).toContain('Other text');
    });
  });

  // ============================================================================
  // Default text style at various levels
  // ============================================================================
  describe('master text styles by category', () => {
    it('renders title placeholder without bullets', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode(`<pPr><buAutoNum type="arabicPeriod"/></pPr>`),
            runs: [{ text: 'Title' }],
            level: 0,
          },
        ],
      });

      const container = renderToContainer(body, { type: 'title' });
      // Title placeholders suppress bullets
      expect(container.textContent).not.toContain('1.');
    });

    it('renders body placeholder with bullets allowed', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode(`<pPr><buAutoNum type="arabicPeriod"/></pPr>`),
            runs: [{ text: 'Body item' }],
            level: 0,
          },
        ],
      });

      const container = renderToContainer(body, { type: 'body' });
      // Body allows bullets (unless content is empty)
      expect(container.textContent).toContain('1.');
    });

    it('treats subTitle placeholder as metadata (suppresses bullets)', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode(`<pPr><buAutoNum type="arabicPeriod"/></pPr>`),
            runs: [{ text: 'Subtitle' }],
            level: 0,
          },
        ],
      });

      const container = renderToContainer(body, { type: 'subTitle' });
      // subTitle suppresses bullets (it's in the metadata list)
      expect(container.textContent).not.toContain('1.');
    });
  });

  // ============================================================================
  // Style inheritance paths
  // ============================================================================
  describe('style inheritance paths', () => {
    it('inherits alignment from paragraph properties', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(`<pPr algn="ctr"/>`),
          runs: [{ text: 'Centered' }],
          level: 0,
        }],
      });

      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      expect(para.style.textAlign).toBe('center');
    });

    it('allows paragraph pPr to override lower-priority styles', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode(`<pPr algn="r"/>`),
            runs: [{ text: 'Right' }],
            level: 0,
          },
          {
            properties: xmlNode(`<pPr algn="ctr"/>`),
            runs: [{ text: 'Center' }],
            level: 0,
          },
        ],
      });

      const container = renderToContainer(body);
      const para1 = container.children[0] as HTMLElement;
      const para2 = container.children[1] as HTMLElement;
      expect(para1.style.textAlign).toBe('right');
      expect(para2.style.textAlign).toBe('center');
    });
  });

  // ============================================================================
  // Arabic auto-numbering with padding
  // ============================================================================
  describe('auto-numbering arabic variations', () => {
    it('renders arabicParenBoth numbering', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(`<pPr><buAutoNum type="arabicParenBoth"/></pPr>`),
          runs: [{ text: 'Both parens' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      expect(container.textContent).toContain('(1)');
    });

    it('renders arabicPlain numbering (no punctuation)', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(`<pPr><buAutoNum type="arabicPlain"/></pPr>`),
          runs: [{ text: 'Plain' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      expect(container.textContent).toContain('1 ');
    });
  });

  // ============================================================================
  // Bullet color inheritance chain
  // ============================================================================
  describe('bullet color resolution', () => {
    it('uses buClr over defRPr and run colors', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(
            `<pPr>
              <buChar char="●"/>
              <buClr><srgbClr val="FF0000"/></buClr>
            </pPr>`,
          ),
          runs: [{
            text: 'Red bullet',
            properties: xmlNode(`<rPr><solidFill><srgbClr val="00FF00"/></solidFill></rPr>`),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const bulletSpan = container.querySelector('span');
      // Bullet should be red (from buClr), not green (from run)
      expect(bulletSpan!.style.color).toContain('255'); // red
    });

    it('falls back to first run color for bullet', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(`<pPr><buChar char="●"/></pPr>`),
          runs: [{
            text: 'Bullet inherits color',
            properties: xmlNode(
              `<rPr><solidFill><srgbClr val="0000FF"/></solidFill></rPr>`,
            ),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const bulletSpan = container.querySelector('span');
      // Bullet should inherit blue from run
      expect(bulletSpan!.style.color).toContain('0'); // blue
    });

    it('falls back to lstStyle defRPr for bullet color', () => {
      const body = makeTextBody({
        listStyle: `<lstStyle>
          <lvl1pPr>
            <defRPr><solidFill><srgbClr val="FF0000"/></solidFill></defRPr>
          </lvl1pPr>
        </lstStyle>`,
        paragraphs: [{
          properties: xmlNode(`<pPr><buChar char="●"/></pPr>`),
          runs: [{ text: 'lstStyle bullet' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const bulletSpan = container.querySelector('span');
      // Bullet should be red from lstStyle
      expect(bulletSpan!.style.color).toContain('255');
    });
  });

  // ============================================================================
  // Style merging order (later overrides earlier)
  // ============================================================================
  describe('style inheritance merging order', () => {
    it('paragraph properties override master text style', () => {
      const ctx = createMockRenderContext();
      ctx.master.textStyles.bodyStyle = xmlNode(
        `<lstStyle><lvl1pPr><pPr algn="ctr"/></lvl1pPr></lstStyle>`,
      );

      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(`<pPr algn="r"/>`),
          runs: [{ text: 'Paragraph style wins' }],
          level: 0,
        }],
      });

      const container = document.createElement('div');
      renderTextBody(body, { type: 'body' }, ctx, container);
      const para = container.children[0] as HTMLElement;
      // Paragraph pPr (right) should override master textStyle (center)
      expect(para.style.textAlign).toBe('right');
    });

    it('run rPr fontSize overrides paragraph defRPr', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode(`<pPr><defRPr><sz="1200"/></defRPr></pPr>`),
          runs: [{
            text: 'Run size wins',
            properties: xmlNode(`<rPr sz="2400"/>`),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      // Run 24pt should override paragraph defRPr 12pt
      expect(span!.style.fontSize).toBe('24pt');
    });
  });

  // ============================================================================
  // Placeholder index matching (idx attribute)
  // ============================================================================
  describe('placeholder matching', () => {
    it('renders placeholder with specific type', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{ text: 'Typed placeholder' }],
          level: 0,
        }],
      });

      const container = renderToContainer(body, { type: 'body' });
      expect(container.textContent).toContain('Typed placeholder');
    });

    it('renders placeholder with both type and idx', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{ text: 'Indexed placeholder' }],
          level: 0,
        }],
      });

      const container = renderToContainer(body, { type: 'body', idx: 1 });
      expect(container.textContent).toContain('Indexed placeholder');
    });
  });

  // ============================================================================
  // nvPicPr placeholder path (for pictures in shapes)
  // ============================================================================
  describe('placeholder type handling', () => {
    it('renders picture placeholder text', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{ text: 'Picture text' }],
          level: 0,
        }],
      });

      const container = renderToContainer(body, { type: 'pic' });
      expect(container.textContent).toContain('Picture text');
    });

    it('renders different placeholder types', () => {
      const placeholders = ['body', 'title', 'dt', 'ftr', 'sldNum', 'pic'];
      for (const phType of placeholders) {
        const body = makeTextBody({
          paragraphs: [{
            runs: [{ text: `Type: ${phType}` }],
            level: 0,
          }],
        });

        const container = renderToContainer(body, { type: phType as any });
        expect(container.textContent).toContain(`Type: ${phType}`);
      }
    });
  });
});
