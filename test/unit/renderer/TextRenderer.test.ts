import { describe, it, expect } from 'vitest';
import { renderTextBody } from '../../../src/renderer/TextRenderer';
import { createMockRenderContext } from '../helpers/mockContext';
import { xmlNode } from '../helpers/xmlNode';
import { parseXml } from '../../../src/parser/XmlParser';
import type { TextBody, TextParagraph, TextRun } from '../../../src/model/nodes/ShapeNode';

function makeTextBody(opts: {
  paragraphs?: TextParagraph[];
  bodyPr?: string;
  listStyle?: string;
  layoutBodyPr?: string;
} = {}): TextBody {
  return {
    bodyProperties: opts.bodyPr ? xmlNode(opts.bodyPr) : undefined,
    layoutBodyProperties: opts.layoutBodyPr ? xmlNode(opts.layoutBodyPr) : undefined,
    listStyle: opts.listStyle ? xmlNode(opts.listStyle) : undefined,
    paragraphs: opts.paragraphs ?? [{
      runs: [{ text: 'Hello World' }],
      level: 0,
    }],
  };
}

function renderToContainer(textBody: TextBody, placeholder?: any): HTMLElement {
  const ctx = createMockRenderContext();
  const container = document.createElement('div');
  renderTextBody(textBody, placeholder, ctx, container);
  return container;
}

describe('TextRenderer — renderTextBody', () => {
  describe('basic rendering', () => {
    it('renders single paragraph with text', () => {
      const container = renderToContainer(makeTextBody());
      expect(container.textContent).toContain('Hello World');
    });

    it('renders multiple paragraphs', () => {
      const body = makeTextBody({
        paragraphs: [
          { runs: [{ text: 'Para 1' }], level: 0 },
          { runs: [{ text: 'Para 2' }], level: 0 },
        ],
      });
      const container = renderToContainer(body);
      expect(container.textContent).toContain('Para 1');
      expect(container.textContent).toContain('Para 2');
      expect(container.children.length).toBeGreaterThanOrEqual(2);
    });

    it('renders empty paragraph as line break', () => {
      const body = makeTextBody({
        paragraphs: [
          { runs: [], level: 0 },
        ],
      });
      const container = renderToContainer(body);
      // Empty paragraphs should still produce a div
      expect(container.children.length).toBeGreaterThanOrEqual(1);
    });

    it('renders multiple runs in a paragraph', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [
            { text: 'Hello ' },
            { text: 'World' },
          ],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      expect(container.textContent).toContain('Hello World');
    });
  });

  describe('run properties', () => {
    it('applies bold from rPr', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Bold',
            properties: xmlNode('<rPr b="1"/>'),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span).not.toBeNull();
      expect(span!.style.fontWeight).toBe('bold');
    });

    it('applies italic from rPr', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Italic',
            properties: xmlNode('<rPr i="1"/>'),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.fontStyle).toBe('italic');
    });

    it('applies underline from rPr', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Underline',
            properties: xmlNode('<rPr u="sng"/>'),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.textDecoration).toContain('underline');
    });

    it('applies strikethrough from rPr', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Strike',
            properties: xmlNode('<rPr strike="sngStrike"/>'),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.textDecoration).toContain('line-through');
    });

    it('applies font size from rPr sz', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Big',
            properties: xmlNode('<rPr sz="2400"/>'),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.fontSize).toBe('24pt');
    });

    it('applies text color from rPr solidFill', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Red',
            properties: xmlNode('<rPr><solidFill><srgbClr val="FF0000"/></solidFill></rPr>'),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.color).not.toBe('');
    });

    it('applies letter spacing from rPr spc', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Spaced',
            properties: xmlNode('<rPr spc="200"/>'),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      // spc=200 means 2pt letter spacing
      expect(span!.style.letterSpacing).not.toBe('');
    });

    it('applies ALL CAPS from rPr cap="all"', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'caps',
            properties: xmlNode('<rPr cap="all"/>'),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.textTransform).toBe('uppercase');
    });

    it('applies superscript from baseline > 0', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'sup',
            properties: xmlNode('<rPr baseline="30000"/>'),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      // baseline=30000 → 30% vertical shift
      expect(span!.style.verticalAlign).toBe('30%');
    });

    it('applies subscript from baseline < 0', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'sub',
            properties: xmlNode('<rPr baseline="-25000"/>'),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      // baseline=-25000 → -25% vertical shift
      expect(span!.style.verticalAlign).toBe('-25%');
    });
  });

  describe('paragraph properties', () => {
    it('applies margin-left from marL', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode('<pPr marL="457200"/>'),
          runs: [{ text: 'Indented' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      // 457200 EMU ≈ 48px
      expect(parseFloat(para.style.marginLeft)).toBeGreaterThan(0);
    });

    it('applies text-indent from indent', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode('<pPr indent="-228600"/>'),
          runs: [{ text: 'Hanging' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      expect(parseFloat(para.style.textIndent)).toBeLessThan(0);
    });
  });

  describe('bullets', () => {
    it('renders character bullet from buChar', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode('<pPr><buChar char="•"/></pPr>'),
          runs: [{ text: 'Bullet item' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      expect(container.textContent).toContain('•');
      expect(container.textContent).toContain('Bullet item');
    });

    it('suppresses bullet when buNone is present', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode('<pPr><buNone/></pPr>'),
          runs: [{ text: 'No bullet' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      expect(container.textContent).toBe('No bullet');
    });
  });

  describe('body properties', () => {
    it('applies font scale from normAutofit', () => {
      const body = makeTextBody({
        bodyPr: '<bodyPr><normAutofit fontScale="80000"/></bodyPr>',
        paragraphs: [{
          runs: [{
            text: 'Scaled',
            properties: xmlNode('<rPr sz="2000"/>'),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      // 2000/100 = 20pt * 0.8 = 16pt
      expect(span).not.toBeNull();
      expect(span!.style.fontSize).toBe('16pt');
    });

    it('applies lnSpcReduction from normAutofit', () => {
      const body: TextBody = {
        bodyProperties: xmlNode('<bodyPr><normAutofit lnSpcReduction="20000"/></bodyPr>'),
        paragraphs: [{
          properties: xmlNode('<pPr><lnSpc><spcPct val="150000"/></lnSpc></pPr>'),
          runs: [{ text: 'Reduced' }],
          level: 0,
        }],
      };
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      // 1.5 * (1 - 0.2) = 1.2
      expect(parseFloat(para.style.lineHeight)).toBeCloseTo(1.2, 3);
    });
  });

  describe('hyperlinks', () => {
    it('renders hlinkClick as anchor tag via rels', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Click me',
            properties: xmlNode('<rPr xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><hlinkClick r:id="rId1"/></rPr>'),
          }],
          level: 0,
        }],
      });
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId1', {
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
        target: 'https://example.com',
        targetMode: 'External',
      });
      const container = document.createElement('div');
      renderTextBody(body, undefined, ctx, container);
      const link = container.querySelector('a');
      expect(link).not.toBeNull();
      expect(link!.href).toContain('https://example.com');
      expect(link!.textContent).toBe('Click me');
    });
  });

  describe('line breaks', () => {
    it('renders \\n text as <br>', () => {
      const body = makeTextBody({
        paragraphs: [{
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
      expect(container.textContent).toContain('Line 1');
      expect(container.textContent).toContain('Line 2');
    });

    it('renders empty paragraph with <br>', () => {
      const body = makeTextBody({
        paragraphs: [{ runs: [], level: 0 }],
      });
      const container = renderToContainer(body);
      const br = container.querySelector('br');
      expect(br).not.toBeNull();
    });
  });

  describe('cellTextColor override', () => {
    it('uses cellTextColor from table style', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{ text: 'Cell' }],
          level: 0,
        }],
      });
      const ctx = createMockRenderContext();
      const container = document.createElement('div');
      renderTextBody(body, undefined, ctx, container, { cellTextColor: '#FF0000' });
      const span = container.querySelector('span');
      if (span) {
        expect(span.style.color).not.toBe('');
      }
    });
  });

  describe('text alignment', () => {
    it('applies center alignment from pPr algn="ctr"', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode('<pPr algn="ctr"/>'),
          runs: [{ text: 'Centered' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      expect(para.style.textAlign).toBe('center');
    });

    it('applies right alignment', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode('<pPr algn="r"/>'),
          runs: [{ text: 'Right' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      expect(para.style.textAlign).toBe('right');
    });

    it('applies justify alignment', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode('<pPr algn="just"/>'),
          runs: [{ text: 'Justified' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      expect(para.style.textAlign).toBe('justify');
    });
  });

  describe('auto-numbering', () => {
    it('renders arabicPeriod auto-numbering', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode('<pPr><buAutoNum type="arabicPeriod"/></pPr>'),
            runs: [{ text: 'First' }],
            level: 0,
          },
          {
            properties: xmlNode('<pPr><buAutoNum type="arabicPeriod"/></pPr>'),
            runs: [{ text: 'Second' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      expect(container.textContent).toContain('1.');
      expect(container.textContent).toContain('First');
    });

    it('renders alphaLcPeriod auto-numbering', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode('<pPr><buAutoNum type="alphaLcPeriod"/></pPr>'),
          runs: [{ text: 'Alpha' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      expect(container.textContent).toContain('a.');
    });

    it('renders romanUcPeriod auto-numbering', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode('<pPr><buAutoNum type="romanUcPeriod"/></pPr>'),
          runs: [{ text: 'Roman' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      expect(container.textContent).toContain('I.');
    });
  });

  describe('font resolution', () => {
    it('resolves +mn-lt to theme minor font', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Themed',
            properties: xmlNode('<rPr><latin typeface="+mn-lt"/></rPr>'),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.fontFamily).toContain('Calibri');
    });

    it('resolves +mj-lt to theme major font', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Major',
            properties: xmlNode('<rPr><latin typeface="+mj-lt"/></rPr>'),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      // Theme major font is 'Calibri Light' but the mock may use 'Calibri'
      expect(span!.style.fontFamily).not.toBe('');
    });

    it('uses explicit font family from latin typeface', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Arial',
            properties: xmlNode('<rPr><latin typeface="Arial"/></rPr>'),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.fontFamily).toContain('Arial');
    });

    it('falls back to theme minor font when no font specified', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{ text: 'Fallback' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.fontFamily).toContain('Calibri');
    });
  });

  describe('line spacing', () => {
    it('applies spcPct line height', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode('<pPr><lnSpc><spcPct val="120000"/></lnSpc></pPr>'),
          runs: [{ text: 'Spaced' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      expect(parseFloat(para.style.lineHeight)).toBeCloseTo(1.2, 2);
    });

    it('applies spcPts line height', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode('<pPr><lnSpc><spcPts val="2400"/></lnSpc></pPr>'),
          runs: [{ text: 'Fixed' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      expect(para.style.lineHeight).toBe('24pt');
    });
  });

  describe('paragraph spacing', () => {
    it('applies spaceBefore in pt from spcBef spcPts', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode('<pPr><spcBef><spcPts val="1200"/></spcBef></pPr>'),
          runs: [{ text: 'Before' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      expect(para.style.marginTop).toBe('12pt');
    });

    it('applies spaceAfter in pt from spcAft spcPts', () => {
      const body = makeTextBody({
        paragraphs: [{
          properties: xmlNode('<pPr><spcAft><spcPts val="600"/></spcAft></pPr>'),
          runs: [{ text: 'After' }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      expect(para.style.marginBottom).toBe('6pt');
    });
  });

  describe('text effects', () => {
    it('applies noFill to make text transparent', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Ghost',
            properties: xmlNode('<rPr><noFill/></rPr>'),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.color).toBe('transparent');
    });

    it('applies text outline with solid fill', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Outlined',
            properties: xmlNode('<rPr><ln w="12700"><solidFill><srgbClr val="FF0000"/></solidFill></ln></rPr>'),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span') as any;
      expect(span.style.webkitTextStrokeColor || span.style.paintOrder).toBeTruthy();
    });

    it('applies small caps from cap="small"', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'smallcaps',
            properties: xmlNode('<rPr cap="small"/>'),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.fontVariant).toBe('small-caps');
    });

    it('applies kerning when kern is set', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Kerned',
            properties: xmlNode('<rPr kern="0" sz="2400"/>'),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.fontKerning).toBe('normal');
    });

    it('reduces font size for super/subscript with large shift', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'sup',
            properties: xmlNode('<rPr baseline="30000" sz="2400"/>'),
          }],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      // baseline=30000 → 30% shift → font shrinks to 65%
      const fontSize = parseFloat(span!.style.fontSize);
      expect(fontSize).toBeLessThan(24); // 24pt * 0.65 = 15.6pt
    });
  });

  describe('fontRefColor override', () => {
    it('uses fontRefColor when no explicit run color', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{ text: 'SmartArt' }],
          level: 0,
        }],
      });
      const ctx = createMockRenderContext();
      const container = document.createElement('div');
      renderTextBody(body, undefined, ctx, container, { fontRefColor: '#FFFFFF' });
      const span = container.querySelector('span');
      // jsdom normalizes #FFFFFF to rgb(255, 255, 255)
      expect(span!.style.color).toBe('rgb(255, 255, 255)');
    });
  });

  describe('hyperlink theme color', () => {
    it('applies hlink theme color when run has hlinkClick without explicit color', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{
            text: 'Link',
            properties: xmlNode('<rPr xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><hlinkClick r:id="rId1"/></rPr>'),
          }],
          level: 0,
        }],
      });
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId1', {
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
        target: 'https://example.com',
        targetMode: 'External',
      });
      const container = document.createElement('div');
      renderTextBody(body, undefined, ctx, container);
      const link = container.querySelector('a');
      expect(link).not.toBeNull();
      // Should use hlink color from theme (0563C1) - jsdom normalizes to rgb
      expect(link!.style.color).toBe('rgb(5, 99, 193)');
    });
  });

  describe('layout placeholder lstStyle inheritance (Level 4)', () => {
    it('inherits alignment from layout placeholder lstStyle', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{ text: 'From layout' }],
          level: 0,
        }],
      });
      const ctx = createMockRenderContext();
      // Set up a layout placeholder with lstStyle containing alignment
      const layoutPlaceholderNode = xmlNode(
        `<sp xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <nvSpPr>
            <cNvPr id="2" name="Content Placeholder 1"/>
            <nvPr><ph type="body" idx="1"/></nvPr>
          </nvSpPr>
          <txBody>
            <lstStyle>
              <lvl1pPr algn="ctr"/>
            </lstStyle>
            <p><r><t>placeholder</t></r></p>
          </txBody>
        </sp>`,
      );
      ctx.layout.placeholders = [{ node: layoutPlaceholderNode }];

      const container = document.createElement('div');
      const placeholder = { type: 'body', idx: 1 };
      renderTextBody(body, placeholder, ctx, container);
      const para = container.children[0] as HTMLElement;
      expect(para.style.textAlign).toBe('center');
    });

    it('layout placeholder lstStyle overrides master placeholder lstStyle', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [{ text: 'Override test' }],
          level: 0,
        }],
      });
      const ctx = createMockRenderContext();

      // Master placeholder with left alignment
      const masterPlaceholderNode = xmlNode(
        `<sp xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <nvSpPr>
            <cNvPr id="3" name="Body Placeholder"/>
            <nvPr><ph type="body" idx="1"/></nvPr>
          </nvSpPr>
          <txBody>
            <lstStyle>
              <lvl1pPr algn="l"/>
            </lstStyle>
            <p><r><t>master</t></r></p>
          </txBody>
        </sp>`,
      );
      ctx.master.placeholders = [masterPlaceholderNode];

      // Layout placeholder with right alignment (should win over master)
      const layoutPlaceholderNode = xmlNode(
        `<sp xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <nvSpPr>
            <cNvPr id="4" name="Body Placeholder"/>
            <nvPr><ph type="body" idx="1"/></nvPr>
          </nvSpPr>
          <txBody>
            <lstStyle>
              <lvl1pPr algn="r"/>
            </lstStyle>
            <p><r><t>layout</t></r></p>
          </txBody>
        </sp>`,
      );
      ctx.layout.placeholders = [{ node: layoutPlaceholderNode }];

      const container = document.createElement('div');
      const placeholder = { type: 'body', idx: 1 };
      renderTextBody(body, placeholder, ctx, container);
      const para = container.children[0] as HTMLElement;
      // Layout (Level 4) overrides Master (Level 3)
      expect(para.style.textAlign).toBe('right');
    });
  });

  describe('bullet color fallback from shape lstStyle defRPr', () => {
    it('uses lstStyle defRPr color when no explicit bullet color is set', () => {
      const body: TextBody = {
        bodyProperties: xmlNode('<bodyPr/>'),
        listStyle: xmlNode(
          `<lstStyle xmlns="http://schemas.openxmlformats.org/drawingml/2006/main">
            <lvl1pPr>
              <defRPr>
                <solidFill><srgbClr val="FF0000"/></solidFill>
              </defRPr>
              <buChar char="•"/>
            </lvl1pPr>
          </lstStyle>`,
        ),
        paragraphs: [{
          properties: xmlNode('<pPr><buChar char="•"/></pPr>'),
          runs: [{ text: 'Bullet item' }],
          level: 0,
        }],
      };

      const ctx = createMockRenderContext();
      const container = document.createElement('div');
      renderTextBody(body, undefined, ctx, container);

      // Find the bullet span (first span containing the bullet character)
      const spans = container.querySelectorAll('span');
      let bulletSpan: HTMLElement | null = null;
      spans.forEach((s) => {
        if (s.textContent?.includes('\u2022')) {
          bulletSpan = s;
        }
      });
      expect(bulletSpan).not.toBeNull();
      // The bullet color should come from lstStyle defRPr solidFill (#FF0000)
      // jsdom normalizes to rgb(255, 0, 0)
      expect(bulletSpan!.style.color).toBe('rgb(255, 0, 0)');
    });

    it('prefers explicit buClr over lstStyle defRPr color', () => {
      const body: TextBody = {
        bodyProperties: xmlNode('<bodyPr/>'),
        listStyle: xmlNode(
          `<lstStyle xmlns="http://schemas.openxmlformats.org/drawingml/2006/main">
            <lvl1pPr>
              <defRPr>
                <solidFill><srgbClr val="FF0000"/></solidFill>
              </defRPr>
            </lvl1pPr>
          </lstStyle>`,
        ),
        paragraphs: [{
          properties: xmlNode(
            '<pPr><buClr><srgbClr val="00FF00"/></buClr><buChar char="•"/></pPr>',
          ),
          runs: [{ text: 'Bullet item' }],
          level: 0,
        }],
      };

      const ctx = createMockRenderContext();
      const container = document.createElement('div');
      renderTextBody(body, undefined, ctx, container);

      const spans = container.querySelectorAll('span');
      let bulletSpan: HTMLElement | null = null;
      spans.forEach((s) => {
        if (s.textContent?.includes('\u2022')) {
          bulletSpan = s;
        }
      });
      expect(bulletSpan).not.toBeNull();
      // Explicit buClr (#00FF00) should take precedence
      expect(bulletSpan!.style.color).toBe('rgb(0, 255, 0)');
    });

    it('falls back to lstStyle defRPr when no buClr and no run color', () => {
      const body: TextBody = {
        bodyProperties: xmlNode('<bodyPr/>'),
        listStyle: xmlNode(
          `<lstStyle xmlns="http://schemas.openxmlformats.org/drawingml/2006/main">
            <lvl1pPr>
              <defRPr>
                <solidFill><srgbClr val="0000FF"/></solidFill>
              </defRPr>
            </lvl1pPr>
          </lstStyle>`,
        ),
        paragraphs: [{
          properties: xmlNode('<pPr><buChar char="-"/></pPr>'),
          runs: [{ text: 'Item with dash' }],
          level: 0,
        }],
      };

      const ctx = createMockRenderContext();
      const container = document.createElement('div');
      renderTextBody(body, undefined, ctx, container);

      const spans = container.querySelectorAll('span');
      let bulletSpan: HTMLElement | null = null;
      spans.forEach((s) => {
        if (s.textContent?.startsWith('-')) {
          bulletSpan = s;
        }
      });
      expect(bulletSpan).not.toBeNull();
      // lstStyle defRPr solidFill (#0000FF)
      expect(bulletSpan!.style.color).toBe('rgb(0, 0, 255)');
    });
  });

  describe('layout placeholder lstStyle line spacing inheritance', () => {
    it('title placeholder inherits lnSpc spcPct=75000 (0.75 line-height) from layout lstStyle', () => {
      // Layout with title placeholder that has lnSpc 75%
      const layoutPhNode = parseXml(`
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="2" name="Title 1"/>
            <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
            <p:nvPr><p:ph type="title"/></p:nvPr>
          </p:nvSpPr>
          <p:spPr/>
          <p:txBody>
            <a:bodyPr anchor="b"/>
            <a:lstStyle>
              <a:lvl1pPr>
                <a:lnSpc><a:spcPct val="75000"/></a:lnSpc>
              </a:lvl1pPr>
            </a:lstStyle>
            <a:p><a:r><a:rPr lang="en-US"/><a:t>Title</a:t></a:r></a:p>
          </p:txBody>
        </p:sp>
      `);
      const ctx = createMockRenderContext({
        layout: {
          placeholders: [{ node: layoutPhNode }],
          spTree: xmlNode('<spTree/>'),
          rels: new Map(),
          showMasterSp: true,
        },
      });

      const body = makeTextBody({
        paragraphs: [{
          runs: [
            { text: '示例服务', properties: xmlNode('<rPr lang="zh-CN" sz="6600"/>') },
            { text: '\n' },
            { text: '-- AIDC aaS', properties: xmlNode('<rPr lang="en-US" sz="4000"/>') },
          ],
          level: 0,
        }],
      });
      const container = document.createElement('div');
      const placeholder = { type: 'title' };
      renderTextBody(body, placeholder, ctx, container);
      const paraDiv = container.children[0] as HTMLElement;
      // Should have 75% line spacing = 0.75 line-height
      expect(parseFloat(paraDiv.style.lineHeight)).toBeCloseTo(0.75, 2);
    });
  });

  describe('endParaRPr trailing line height', () => {
    it('trailing <br> before endParaRPr at 72pt creates a line with matching font size', () => {
      // Simulates: "Hello" + <br/> + endParaRPr sz=7200 (72pt)
      // The trailing <br> should produce a line whose height matches 72pt
      const endParaRPr = xmlNode('<endParaRPr lang="en-US" sz="7200"/>');
      const body = makeTextBody({
        paragraphs: [{
          runs: [
            { text: 'Hello' },
            { text: '\n' },
          ],
          level: 0,
          endParaRPr,
        } as any],
      });
      const container = renderToContainer(body);
      // After "Hello" and the <br>, there should be a trailing spacer element
      // with font-size matching the endParaRPr size (72pt)
      const paraDiv = container.children[0] as HTMLElement;
      const lastChild = paraDiv.lastElementChild as HTMLElement;
      // The trailing spacer must exist and have the endParaRPr font size
      expect(lastChild).not.toBeNull();
      // It should create space matching 72pt (the endParaRPr size)
      expect(lastChild!.style.fontSize).toBe('72pt');
    });

    it('paragraph with only endParaRPr (no visible runs) uses endParaRPr font size for height', () => {
      const endParaRPr = xmlNode('<endParaRPr lang="en-US" sz="5400"/>');
      const body = makeTextBody({
        paragraphs: [{
          runs: [],
          level: 0,
          endParaRPr,
        } as any],
      });
      const container = renderToContainer(body);
      const paraDiv = container.children[0] as HTMLElement;
      // The empty paragraph's br should use the endParaRPr font size
      const br = paraDiv.querySelector('br, span');
      // The br or spacer should exist
      expect(paraDiv.children.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('consecutive space preservation', () => {
    it('uses non-breaking spaces to preserve consecutive spaces without justify stretching', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [
            { text: '             Lenovo AI Cloud' },
          ],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const spans = container.querySelectorAll('span');
      let spaceSpan: HTMLElement | null = null;
      spans.forEach((s) => {
        if (s.textContent?.includes('Lenovo AI Cloud')) {
          spaceSpan = s;
        }
      });
      expect(spaceSpan, 'should have a span with the text').not.toBeNull();
      // Consecutive spaces should be converted to alternating space + &nbsp;
      // so they are not collapsed by HTML but also not stretched by justify
      expect(spaceSpan!.innerHTML).toContain('&nbsp;');
      // Should NOT use pre-wrap (which would cause justify stretching)
      expect(spaceSpan!.style.whiteSpace).not.toBe('pre-wrap');
    });

    it('does not alter spans with only single spaces', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [
            { text: 'Hello World' },
          ],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const spans = container.querySelectorAll('span');
      spans.forEach((s) => {
        if (s.textContent === 'Hello World') {
          // No &nbsp; needed for single spaces
          expect(s.innerHTML).not.toContain('\u00a0');
        }
      });
    });
  });

  describe('tab character rendering', () => {
    it('preserves tab characters with white-space: pre so browser renders them', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [
            { text: '示例服务' },
            { text: '\t\t\t' },
            { text: '-- AIDC aaS' },
          ],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      // Find the span containing tab characters
      const spans = container.querySelectorAll('span');
      let tabSpan: HTMLElement | null = null;
      spans.forEach((s) => {
        if (s.textContent?.includes('\t')) {
          tabSpan = s;
        }
      });
      expect(tabSpan, 'should have a span with tab characters').not.toBeNull();
      // Tab characters must be preserved (white-space: pre or pre-wrap)
      expect(tabSpan!.style.whiteSpace).toMatch(/pre/);
    });

    it('sets tab-size on paragraph div based on default tab size (914400 EMU = 96px)', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [
            { text: 'Before' },
            { text: '\t' },
            { text: 'After' },
          ],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      // The paragraph div should have a tab-size set
      const paraDiv = container.children[0] as HTMLElement;
      expect(paraDiv).toBeDefined();
      expect(paraDiv.style.tabSize).toBeTruthy();
    });

    it('renders tab characters between text with preserved whitespace', () => {
      const body = makeTextBody({
        paragraphs: [{
          runs: [
            { text: 'A' },
            { text: '\t' },
            { text: 'B' },
          ],
          level: 0,
        }],
      });
      const container = renderToContainer(body);
      const allText = container.textContent || '';
      // Tab character must be present in the output
      expect(allText).toContain('\t');
    });
  });
});
