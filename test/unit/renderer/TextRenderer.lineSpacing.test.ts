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
    it('converts spcPct 100000 to unitless line-height 1.000', () => {
      const body = makeTextBody(`<pPr><lnSpc><spcPct val="100000"/></lnSpc></pPr>`);
      const para = renderAndGetPara(body);
      expect(parseFloat(para.style.lineHeight)).toBeCloseTo(1.0, 3);
    });

    it('converts spcPct 120000 to unitless line-height 1.2', () => {
      const body = makeTextBody(`<pPr><lnSpc><spcPct val="120000"/></lnSpc></pPr>`);
      const para = renderAndGetPara(body);
      expect(parseFloat(para.style.lineHeight)).toBeCloseTo(1.2, 3);
    });

    it('converts spcPct 150000 to unitless line-height 1.5', () => {
      const body = makeTextBody(`<pPr><lnSpc><spcPct val="150000"/></lnSpc></pPr>`);
      const para = renderAndGetPara(body);
      expect(parseFloat(para.style.lineHeight)).toBeCloseTo(1.5, 3);
    });

    it('accepts percent-string line spacing', () => {
      const para = renderAndGetPara(makeTextBody(`<pPr><lnSpc><spcPct val="120%"/></lnSpc></pPr>`));

      expect(para.style.lineHeight).toBe('1.2');
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

    it('clears inherited absolute spacing when spcPct overrides spcPts', () => {
      const body = makeTextBody(`<pPr><lnSpc><spcPct val="100000"/></lnSpc></pPr>`);
      body.listStyle = xmlNode(
        `<lstStyle><lvl1pPr><lnSpc><spcPts val="2000"/></lnSpc></lvl1pPr></lstStyle>`,
      );
      body.paragraphs[0].runs = [{ text: 'First' }, { text: '\n' }, { text: 'Second' }];

      const para = renderAndGetPara(body);

      expect(para.style.lineHeight).toBe('1');
      expect(Array.from(para.children).filter((child) => child.tagName === 'DIV')).toHaveLength(0);
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
      // 50% of default 12pt = 6pt → marginTop should be set
      expect(para.style.marginTop).not.toBe('');
    });

    it('accepts percent-string paragraph spacing', () => {
      const para = renderAndGetPara(
        makeTextBody(
          `<pPr><spcBef><spcPct val="50%"/></spcBef><spcAft><spcPct val="25%"/></spcAft></pPr>`,
        ),
      );

      expect(para.style.marginTop).toBe('6pt');
      expect(para.style.marginBottom).toBe('3pt');
    });
  });

  describe('lnSpcReduction (normAutofit)', () => {
    it('reduces line spacing by normAutofit lnSpcReduction percentage', () => {
      // lnSpc=150000 (1.5), lnSpcReduction=20000 (20%)
      // Effective = 1.5 * (1 - 0.2) = 1.2
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
      // 1.5 * 0.8 = 1.2
      expect(parseFloat(para.style.lineHeight)).toBeCloseTo(1.2, 3);
    });

    it('accepts percent-string normAutofit values', () => {
      const body = makeTextBody(
        `<pPr><lnSpc><spcPct val="150%"/></lnSpc></pPr>`,
        `<bodyPr><normAutofit fontScale="50%" lnSpcReduction="20%"/></bodyPr>`,
      );
      body.paragraphs[0].runs[0].properties = xmlNode('<rPr sz="2000"/>');

      const para = renderAndGetPara(body);

      expect(para.style.lineHeight).toBe('1.2');
      expect(para.style.fontSize).toBe('10pt');
      expect((para.firstElementChild as HTMLElement).style.fontSize).toBe('10pt');
    });

    it('does not reduce point-based line spacing by normAutofit', () => {
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
      expect(parseFloat(para.style.lineHeight)).toBeCloseTo(1.2, 3);
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
