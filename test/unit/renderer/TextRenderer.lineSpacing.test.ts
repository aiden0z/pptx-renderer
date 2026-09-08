import { describe, it, expect } from 'vitest';
import { renderTextBody } from '../../../src/renderer/TextRenderer';
import { createMockRenderContext } from '../helpers/mockContext';
import { xmlNode } from '../helpers/xmlNode';
import type { TextBody } from '../../../src/model/nodes/ShapeNode';

/** Create a minimal TextBody with a single paragraph. */
function makeTextBody(pPrXml?: string, bodyPrXml?: string): TextBody {
  return {
    bodyProperties: bodyPrXml ? xmlNode(bodyPrXml) : undefined,
    paragraphs: [
      {
        properties: pPrXml ? xmlNode(pPrXml) : undefined,
        runs: [{ text: 'Hello' }],
        level: 0,
      },
    ],
  };
}

/** Render text body into a div and return the first paragraph div. */
function renderAndGetPara(textBody: TextBody): HTMLElement {
  const ctx = createMockRenderContext();
  const container = document.createElement('div');
  renderTextBody(textBody, undefined, ctx, container);
  // The paragraph div is a child of the container
  return container.children[0] as HTMLElement;
}

describe('TextRenderer — line spacing', () => {
  describe('lnSpc (line spacing)', () => {
    it('converts spcPct 100000 to one Office line (1.19 CSS em)', () => {
      const body = makeTextBody(`<pPr><lnSpc><spcPct val="100000"/></lnSpc></pPr>`);
      const para = renderAndGetPara(body);
      expect(parseFloat(para.style.lineHeight)).toBeCloseTo(1.19, 3);
    });

    it('converts spcPct 120000 to 1.2 Office lines', () => {
      const body = makeTextBody(`<pPr><lnSpc><spcPct val="120000"/></lnSpc></pPr>`);
      const para = renderAndGetPara(body);
      expect(parseFloat(para.style.lineHeight)).toBeCloseTo(1.428, 3);
    });

    it('converts spcPct 150000 to 1.5 Office lines', () => {
      const body = makeTextBody(`<pPr><lnSpc><spcPct val="150000"/></lnSpc></pPr>`);
      const para = renderAndGetPara(body);
      expect(parseFloat(para.style.lineHeight)).toBeCloseTo(1.785, 3);
    });

    it('converts spcPts 1200 to 12pt line-height', () => {
      const body = makeTextBody(`<pPr><lnSpc><spcPts val="1200"/></lnSpc></pPr>`);
      const para = renderAndGetPara(body);
      expect(para.style.lineHeight).toBe('12pt');
    });

    it('converts spcPts 2000 to 20pt line-height', () => {
      const body = makeTextBody(`<pPr><lnSpc><spcPts val="2000"/></lnSpc></pPr>`);
      const para = renderAndGetPara(body);
      expect(para.style.lineHeight).toBe('20pt');
    });
  });

  describe('spcBef / spcAft (space before/after)', () => {
    it('applies spcBef in points as margin-top', () => {
      const body = makeTextBody(`<pPr><spcBef><spcPts val="600"/></spcBef></pPr>`);
      const para = renderAndGetPara(body);
      // 600 / 100 = 6pt
      expect(para.style.marginTop).toBe('6pt');
    });

    it('applies spcAft in points as margin-bottom', () => {
      const body = makeTextBody(`<pPr><spcAft><spcPts val="400"/></spcAft></pPr>`);
      const para = renderAndGetPara(body);
      // 400 / 100 = 4pt
      expect(para.style.marginBottom).toBe('4pt');
    });

    it('applies spcBef percentage-based spacing', () => {
      // spcPct val="50000" = 50% of font size
      const body = makeTextBody(`<pPr><spcBef><spcPct val="50000"/></spcBef></pPr>`);
      const para = renderAndGetPara(body);
      // OOXML percentage spacing uses the Office line unit: 12pt × 1.19 × 50% = 7.14pt.
      expect(para.style.marginTop).toBe('7.14pt');
    });
  });

  describe('lnSpcReduction (normAutofit)', () => {
    it('subtracts normAutofit reduction from percentage line spacing', () => {
      // lnSpc=150000 (1.5), lnSpcReduction=20000 (20%)
      // Microsoft NormalAutoFit: 150% - 20 percentage points = 130% of an Office line.
      const body: TextBody = {
        bodyProperties: xmlNode(`<bodyPr><normAutofit lnSpcReduction="20000"/></bodyPr>`),
        paragraphs: [
          {
            properties: xmlNode(`<pPr><lnSpc><spcPct val="150000"/></lnSpc></pPr>`),
            runs: [{ text: 'Hello' }],
            level: 0,
          },
        ],
      };
      const para = renderAndGetPara(body);
      expect(parseFloat(para.style.lineHeight)).toBeCloseTo(1.547, 3);
    });

    it('preserves point-based line spacing despite normAutofit reduction', () => {
      // lnSpc=2000 (20pt), lnSpcReduction=25000 (25%)
      // NormalAutoFit line-space reduction applies only to percentage spacing.
      const body: TextBody = {
        bodyProperties: xmlNode(`<bodyPr><normAutofit lnSpcReduction="25000"/></bodyPr>`),
        paragraphs: [
          {
            properties: xmlNode(`<pPr><lnSpc><spcPts val="2000"/></lnSpc></pPr>`),
            runs: [{ text: 'Hello' }],
            level: 0,
          },
        ],
      };
      const para = renderAndGetPara(body);
      expect(para.style.lineHeight).toBe('20pt');
    });

    it('noAutofit suppresses inherited normal-autofit line reduction', () => {
      const body = makeTextBody(
        '<pPr><lnSpc><spcPct val="150000"/></lnSpc></pPr>',
        '<bodyPr><noAutofit/></bodyPr>',
      );
      body.layoutBodyProperties = xmlNode('<bodyPr><normAutofit lnSpcReduction="20000"/></bodyPr>');
      expect(parseFloat(renderAndGetPara(body).style.lineHeight)).toBeCloseTo(1.785, 3);
    });

    it('does not reduce line spacing when lnSpcReduction is 0', () => {
      const body: TextBody = {
        bodyProperties: xmlNode(`<bodyPr><normAutofit lnSpcReduction="0"/></bodyPr>`),
        paragraphs: [
          {
            properties: xmlNode(`<pPr><lnSpc><spcPct val="120000"/></lnSpc></pPr>`),
            runs: [{ text: 'Hello' }],
            level: 0,
          },
        ],
      };
      const para = renderAndGetPara(body);
      expect(parseFloat(para.style.lineHeight)).toBeCloseTo(1.428, 3);
    });

    it('reduces an implicit line height by the matching fraction of an Office line', () => {
      const body: TextBody = {
        bodyProperties: xmlNode(`<bodyPr><normAutofit lnSpcReduction="20000"/></bodyPr>`),
        paragraphs: [{ runs: [{ text: 'Hello' }], level: 0 }],
      };
      const ctx = createMockRenderContext();
      const container = document.createElement('div');

      renderTextBody(body, undefined, ctx, container, { defaultLineHeight: '1.18' });

      const para = container.children[0] as HTMLElement;
      expect(parseFloat(para.style.lineHeight)).toBeCloseTo(0.942, 3);
    });
  });

  describe('alignment', () => {
    it('maps algn="ctr" to text-align center', () => {
      const body = makeTextBody(`<pPr algn="ctr"/>`);
      const para = renderAndGetPara(body);
      expect(para.style.textAlign).toBe('center');
    });

    it('maps algn="r" to text-align right', () => {
      const body = makeTextBody(`<pPr algn="r"/>`);
      const para = renderAndGetPara(body);
      expect(para.style.textAlign).toBe('right');
    });

    it('maps algn="just" to text-align justify', () => {
      const body = makeTextBody(`<pPr algn="just"/>`);
      const para = renderAndGetPara(body);
      expect(para.style.textAlign).toBe('justify');
    });
  });
});
