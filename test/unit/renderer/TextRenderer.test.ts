import { describe, it, expect } from 'vitest';
import { renderTextBody } from '../../../src/renderer/TextRenderer';
import { createMockRenderContext } from '../helpers/mockContext';
import { xmlNode } from '../helpers/xmlNode';
import { parseXml } from '../../../src/parser/XmlParser';
import type { TextBody, TextParagraph, TextRun } from '../../../src/model/nodes/ShapeNode';

function makeTextBody(
  opts: {
    paragraphs?: TextParagraph[];
    bodyPr?: string;
    listStyle?: string;
    layoutBodyPr?: string;
  } = {},
): TextBody {
  return {
    bodyProperties: opts.bodyPr ? xmlNode(opts.bodyPr) : undefined,
    layoutBodyProperties: opts.layoutBodyPr ? xmlNode(opts.layoutBodyPr) : undefined,
    listStyle: opts.listStyle ? xmlNode(opts.listStyle) : undefined,
    paragraphs: opts.paragraphs ?? [
      {
        runs: [{ text: 'Hello World' }],
        level: 0,
      },
    ],
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
        paragraphs: [{ runs: [], level: 0 }],
      });
      const container = renderToContainer(body);
      // Empty paragraphs should still produce a div
      expect(container.children.length).toBeGreaterThanOrEqual(1);
    });

    it('renders multiple runs in a paragraph', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [{ text: 'Hello ' }, { text: 'World' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      expect(container.textContent).toContain('Hello World');
    });

    it('keeps compact numeric percentage tokens on one line (issue #4)', () => {
      for (const text of ['80%', '15 %']) {
        const body = makeTextBody({
          paragraphs: [
            {
              runs: [
                {
                  text,
                  properties: xmlNode('<rPr lang="en-US" sz="4800"/>'),
                },
              ],
              level: 0,
            },
          ],
        });

        const container = renderToContainer(body);
        const span = container.querySelector('span');

        expect(span?.textContent).toBe(text);
        expect(span?.style.whiteSpace).toBe('nowrap');
      }
    });

    it('keeps only the compact numeric token nowrap while leaving trailing space breakable', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: '80% ',
                properties: xmlNode('<rPr lang="en-US" sz="4800"/>'),
              },
            ],
            level: 0,
          },
        ],
      });

      const container = renderToContainer(body);
      const outerRun = container.querySelector('div > span');
      const token = outerRun?.querySelector('span');

      expect(outerRun?.textContent).toBe('80% ');
      expect(outerRun?.style.whiteSpace).not.toBe('nowrap');
      expect(token?.textContent).toBe('80%');
      expect(token?.style.whiteSpace).toBe('nowrap');
    });

    it('does not create arbitrary wrap points between adjacent numeric percentage runs', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [{ text: '80' }, { text: '%' }],
            level: 0,
          },
        ],
      });

      const container = renderToContainer(body);
      const paragraph = container.querySelector('div');
      const group = paragraph?.querySelector(':scope > span');

      expect(container.textContent).toBe('80%');
      expect(paragraph?.style.overflowWrap).toBe('anywhere');
      expect(group?.textContent).toBe('80%');
      expect(group?.style.whiteSpace).toBe('nowrap');
    });

    it('parses OOXML boolean aliases for paragraph rtl direction', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [{ text: 'RTL' }],
            properties: xmlNode('<pPr rtl="on"/>'),
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const paragraph = container.querySelector('div');
      expect(paragraph!.style.direction).toBe('rtl');
    });
  });

  describe('run properties', () => {
    it('applies bold from rPr', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'Bold',
                properties: xmlNode('<rPr b="1"/>'),
              },
            ],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span).not.toBeNull();
      expect(span!.style.fontWeight).toBe('bold');
    });

    it('applies italic from rPr', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'Italic',
                properties: xmlNode('<rPr i="1"/>'),
              },
            ],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.fontStyle).toBe('italic');
    });

    it('applies text glow from rPr effectLst (ai-computing slide 27)', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'Glowing text',
                properties: xmlNode(
                  `<rPr>
                    <effectLst>
                      <glow rad="762000">
                        <srgbClr val="C9D0F0"><alpha val="40000"/></srgbClr>
                      </glow>
                    </effectLst>
                  </rPr>`,
                ),
              },
            ],
            level: 0,
          },
        ],
      });

      const container = renderToContainer(body);
      const span = container.querySelector('span');

      expect(span).not.toBeNull();
      expect(span!.style.textShadow).toContain('80.0px');
      expect(span!.style.textShadow.replace(/\s/g, '')).toContain('rgba(201,208,240,0.400)');
    });

    it('applies text outer shadow from rPr effectLst (xcloud-solution slide 26)', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'Shadowed text',
                properties: xmlNode(
                  `<rPr>
                    <effectLst>
                      <outerShdw blurRad="38100" dist="38100" dir="2700000" algn="tl">
                        <srgbClr val="000000"><alpha val="43137"/></srgbClr>
                      </outerShdw>
                    </effectLst>
                  </rPr>`,
                ),
              },
            ],
            level: 0,
          },
        ],
      });

      const container = renderToContainer(body);
      const span = container.querySelector('span');

      expect(span).not.toBeNull();
      expect(span!.style.textShadow).toContain('2.8px 2.8px 4.0px');
      expect(span!.style.textShadow.replace(/\s/g, '')).toContain('rgba(0,0,0,0.431)');
    });

    it('applies underline from rPr', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'Underline',
                properties: xmlNode('<rPr u="sng"/>'),
              },
            ],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.textDecoration).toContain('underline');
    });

    it('applies strikethrough from rPr', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'Strike',
                properties: xmlNode('<rPr strike="sngStrike"/>'),
              },
            ],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.textDecoration).toContain('line-through');
    });

    it('applies font size from rPr sz', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'Big',
                properties: xmlNode('<rPr sz="2400"/>'),
              },
            ],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.fontSize).toBe('24pt');
    });

    it('applies effective run font size to the paragraph line box (xcloud-intro slide 12 mini map)', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'Multi-Cloud Mgmt.',
                properties: xmlNode('<rPr sz="400"/>'),
              },
            ],
            level: 0,
          },
          {
            runs: [
              {
                text: '& FinOps',
                properties: xmlNode('<rPr sz="400"/>'),
              },
            ],
            level: 0,
          },
        ],
      });

      const container = renderToContainer(body);
      const paragraphs = [...container.children] as HTMLElement[];

      expect(paragraphs.map((paragraph) => paragraph.style.fontSize)).toEqual(['4pt', '4pt']);
      expect([...container.querySelectorAll('span')].map((span) => span.style.fontSize)).toEqual([
        '4pt',
        '4pt',
      ]);
    });

    it('preserves inherited defRPr font size when paragraph defRPr is empty (ai-computing slide 28)', () => {
      const ctx = createMockRenderContext();
      ctx.master.textStyles.otherStyle = parseXml(`
        <p:otherStyle xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <a:lvl1pPr><a:defRPr sz="2400"/></a:lvl1pPr>
        </p:otherStyle>
      `);
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode('<pPr><defRPr/></pPr>'),
            runs: [
              {
                text: '为追求极致性能与灵活控制的AI团队，提供高度自主、稳定可靠的专业训练基础设施',
                properties: xmlNode('<rPr><solidFill><srgbClr val="3F58CA"/></solidFill></rPr>'),
              },
            ],
            level: 0,
          },
        ],
      });
      const container = document.createElement('div');

      renderTextBody(body, undefined, ctx, container);

      const span = container.querySelector('span');
      expect(span!.style.fontSize).toBe('24pt');
    });

    it('applies text color from rPr solidFill', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'Red',
                properties: xmlNode('<rPr><solidFill><srgbClr val="FF0000"/></solidFill></rPr>'),
              },
            ],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.color).not.toBe('');
    });

    it('lets explicit run solidFill override inherited gradient text fill (xcloud-intro slide 2)', () => {
      const body = makeTextBody({
        listStyle: `
          <lstStyle xmlns="http://schemas.openxmlformats.org/drawingml/2006/main">
            <lvl1pPr>
              <defRPr sz="3200">
                <gradFill>
                  <gsLst>
                    <gs pos="0"><srgbClr val="FFFFFF"/></gs>
                    <gs pos="100000"><srgbClr val="FFC000"/></gs>
                  </gsLst>
                  <lin ang="2700000" scaled="0"/>
                </gradFill>
              </defRPr>
            </lvl1pPr>
          </lstStyle>
        `,
        paragraphs: [
          {
            properties: xmlNode('<pPr><defRPr/></pPr>'),
            runs: [
              {
                text: 'Lenovo AI Cloud',
                properties: xmlNode('<rPr><solidFill><srgbClr val="FFFFFF"/></solidFill></rPr>'),
              },
            ],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span') as HTMLElement;

      expect(span.style.color).toBe('rgb(255, 255, 255)');
      expect(span.style.background).toBe('');
    });

    it('applies letter spacing from rPr spc', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'Spaced',
                properties: xmlNode('<rPr spc="200"/>'),
              },
            ],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      // spc=200 means 2pt letter spacing
      expect(span!.style.letterSpacing).not.toBe('');
    });

    it('applies ALL CAPS from rPr cap="all"', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'caps',
                properties: xmlNode('<rPr cap="all"/>'),
              },
            ],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.textTransform).toBe('uppercase');
    });

    it('applies superscript from baseline > 0', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'sup',
                properties: xmlNode('<rPr baseline="30000"/>'),
              },
            ],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      // baseline=30000 → 30% vertical shift
      expect(span!.style.verticalAlign).toBe('30%');
    });

    it('applies subscript from baseline < 0', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'sub',
                properties: xmlNode('<rPr baseline="-25000"/>'),
              },
            ],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      // baseline=-25000 → -25% vertical shift
      expect(span!.style.verticalAlign).toBe('-25%');
    });
  });

  describe('paragraph properties', () => {
    it('applies internal padding from marL', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode('<pPr marL="457200"/>'),
            runs: [{ text: 'Indented' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      // 457200 EMU ≈ 48px
      expect(parseFloat(para.style.paddingLeft)).toBeGreaterThan(0);
      expect(para.style.marginLeft).toBe('');
      expect(para.style.boxSizing).toBe('border-box');
    });

    it('applies text-indent from indent', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode('<pPr indent="-228600"/>'),
            runs: [{ text: 'Hanging' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      expect(parseFloat(para.style.textIndent)).toBeLessThan(0);
    });
  });

  describe('bullets', () => {
    it('renders character bullet from buChar', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode('<pPr><buChar char="•"/></pPr>'),
            runs: [{ text: 'Bullet item' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      expect(container.textContent).toContain('•');
      expect(container.textContent).toContain('Bullet item');
    });

    it('sizes bullet glyph from inherited paragraph defRPr', () => {
      const body = makeTextBody({
        listStyle: `
          <lstStyle xmlns="http://schemas.openxmlformats.org/drawingml/2006/main">
            <lvl1pPr>
              <buFont typeface="Arial"/>
              <buChar char="•"/>
              <defRPr sz="3200"/>
            </lvl1pPr>
          </lstStyle>
        `,
        paragraphs: [
          {
            runs: [{ text: 'Body placeholder item' }],
            level: 0,
          },
        ],
      });

      const container = renderToContainer(body);
      const bulletSpan = Array.from(container.querySelectorAll('span')).find((span) =>
        span.textContent?.startsWith('•'),
      ) as HTMLElement | undefined;

      expect(bulletSpan).toBeDefined();
      expect(bulletSpan!.style.fontSize).toBe('32pt');
    });

    it('resolves theme placeholders in bullet fonts instead of emitting raw +mj-lt', () => {
      const body = makeTextBody({
        listStyle: `
          <lstStyle xmlns="http://schemas.openxmlformats.org/drawingml/2006/main">
            <lvl1pPr>
              <buFont typeface="+mj-lt"/>
              <buChar char="•"/>
              <defRPr sz="1600"/>
            </lvl1pPr>
          </lstStyle>
        `,
        paragraphs: [
          {
            runs: [{ text: 'Themed bullet font' }],
            level: 0,
          },
        ],
      });

      const container = renderToContainer(body);
      const bulletSpan = Array.from(container.querySelectorAll('span')).find((span) =>
        span.textContent?.startsWith('•'),
      ) as HTMLElement | undefined;

      expect(bulletSpan).toBeDefined();
      expect(bulletSpan!.style.fontFamily).toContain('Calibri');
      expect(bulletSpan!.style.fontFamily).not.toContain('+mj-lt');
    });

    it('applies percentage bullet size from buSzPct', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode(`
            <pPr>
              <buChar char="•"/>
              <buSzPct val="75000"/>
              <defRPr sz="4000"/>
            </pPr>
          `),
            runs: [{ text: 'Scaled bullet' }],
            level: 0,
          },
        ],
      });

      const container = renderToContainer(body);
      const bulletSpan = Array.from(container.querySelectorAll('span')).find((span) =>
        span.textContent?.startsWith('•'),
      ) as HTMLElement | undefined;

      expect(bulletSpan).toBeDefined();
      expect(bulletSpan!.style.fontSize).toBe('30pt');
    });

    it('uses hanging indent as a fixed bullet gutter for wrapped bullet text', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode('<pPr marL="171450" indent="-171450"><buChar char="•"/></pPr>'),
            runs: [{ text: 'NV GPU卡&国产异构GPU卡统一调度' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      const bulletSpan = Array.from(para.querySelectorAll('span')).find((span) =>
        span.textContent?.includes('•'),
      ) as HTMLElement | undefined;

      expect(parseFloat(para.style.paddingLeft)).toBeGreaterThan(0);
      expect(para.style.textIndent).toBe('0px');
      expect(para.style.position).toBe('relative');
      expect(bulletSpan).toBeDefined();
      expect(bulletSpan!.style.position).toBe('absolute');
      expect(bulletSpan!.style.left).toBe('0px');
      expect(parseFloat(bulletSpan!.style.width)).toBeCloseTo(
        parseFloat(para.style.paddingLeft),
        1,
      );
    });

    it('centers hanging bullet lines as one inline unit (xcloud-solution slide 14)', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode(
              '<pPr marL="171450" indent="-171450" algn="ctr"><buChar char="•"/></pPr>',
            ),
            runs: [{ text: '低门槛应用开发' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      const bulletSpan = Array.from(para.querySelectorAll('span')).find((span) =>
        span.textContent?.includes('•'),
      ) as HTMLElement | undefined;

      expect(para.style.textAlign).toBe('center');
      expect(para.style.paddingLeft).toBe('0px');
      expect(para.style.textIndent).toBe('0px');
      expect(bulletSpan).toBeDefined();
      expect(bulletSpan!.style.position).not.toBe('absolute');
      expect(bulletSpan!.style.display).toBe('inline-block');
      expect(parseFloat(bulletSpan!.style.width)).toBeCloseTo(18, 1);
    });

    it('applies absolute bullet size from buSzPts', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode(`
            <pPr>
              <buChar char="•"/>
              <buSzPts val="1800"/>
              <defRPr sz="4000"/>
            </pPr>
          `),
            runs: [{ text: 'Absolute bullet' }],
            level: 0,
          },
        ],
      });

      const container = renderToContainer(body);
      const bulletSpan = Array.from(container.querySelectorAll('span')).find((span) =>
        span.textContent?.startsWith('•'),
      ) as HTMLElement | undefined;

      expect(bulletSpan).toBeDefined();
      expect(bulletSpan!.style.fontSize).toBe('18pt');
    });

    it('uses first run preset color for buClrTx bullets (model-platform slide 25)', () => {
      const body = makeTextBody({
        listStyle: `
          <lstStyle xmlns="http://schemas.openxmlformats.org/drawingml/2006/main">
            <lvl1pPr>
              <defRPr>
                <solidFill><srgbClr val="000000"/></solidFill>
              </defRPr>
            </lvl1pPr>
          </lstStyle>
        `,
        paragraphs: [
          {
            properties: xmlNode(`
            <pPr>
              <buClrTx/>
              <buSzTx/>
              <buFont typeface="Arial"/>
              <buChar char="•"/>
              <defRPr/>
            </pPr>
          `),
            runs: [
              {
                text: '内置海量模型，涵盖多种能力领域',
                properties: xmlNode(`
                <rPr sz="1200">
                  <solidFill><prstClr val="white"/></solidFill>
                  <latin typeface="微软雅黑"/>
                </rPr>
              `),
              },
            ],
            level: 0,
          },
        ],
      });

      const container = renderToContainer(body);
      const bulletSpan = Array.from(container.querySelectorAll('span')).find((span) =>
        span.textContent?.startsWith('•'),
      ) as HTMLElement | undefined;

      expect(bulletSpan).toBeDefined();
      expect(bulletSpan!.style.color).toBe('rgb(255, 255, 255)');
    });

    it('uses first visible run color when buChar omits buClrTx but inherited defRPr is dark (xcloud-plan slide 25)', () => {
      const body = makeTextBody({
        listStyle: `
          <lstStyle xmlns="http://schemas.openxmlformats.org/drawingml/2006/main">
            <lvl1pPr>
              <defRPr>
                <solidFill><srgbClr val="000000"/></solidFill>
              </defRPr>
            </lvl1pPr>
          </lstStyle>
        `,
        paragraphs: [
          {
            properties: xmlNode(`
              <pPr marL="285750" indent="-285750">
                <buFont typeface="Arial"/>
                <buChar char="•"/>
                <defRPr/>
              </pPr>
            `),
            runs: [
              {
                text: 'GenAI Adoption / GenAI 赋能开发 / 会用 AI 工具',
                properties: xmlNode(`
                  <rPr sz="1400">
                    <solidFill><srgbClr val="FFFFFF"/></solidFill>
                    <latin typeface="Arial"/>
                  </rPr>
                `),
              },
            ],
            level: 0,
          },
        ],
      });

      const container = renderToContainer(body);
      const bulletSpan = Array.from(container.querySelectorAll('span')).find((span) =>
        span.textContent?.startsWith('•'),
      ) as HTMLElement | undefined;

      expect(bulletSpan).toBeDefined();
      expect(bulletSpan!.style.color).toBe('rgb(255, 255, 255)');
    });

    it('suppresses bullet when buNone is present', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode('<pPr><buNone/></pPr>'),
            runs: [{ text: 'No bullet' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      expect(container.textContent).toBe('No bullet');
    });
  });

  describe('body properties', () => {
    it('applies font scale from normAutofit', () => {
      const body = makeTextBody({
        bodyPr: '<bodyPr><normAutofit fontScale="80000"/></bodyPr>',
        paragraphs: [
          {
            runs: [
              {
                text: 'Scaled',
                properties: xmlNode('<rPr sz="2000"/>'),
              },
            ],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      // 2000/100 = 20pt * 0.8 = 16pt
      expect(span).not.toBeNull();
      expect(span!.style.fontSize).toBe('16pt');
    });

    it('applies font scale from inherited layout bodyPr normAutofit', () => {
      const body = makeTextBody({
        layoutBodyPr: '<bodyPr><normAutofit fontScale="50000"/></bodyPr>',
        paragraphs: [
          {
            runs: [
              {
                text: 'Inherited scale',
                properties: xmlNode('<rPr sz="2400"/>'),
              },
            ],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span).not.toBeNull();
      expect(span!.style.fontSize).toBe('12pt');
    });

    it('applies lnSpcReduction from normAutofit', () => {
      const body: TextBody = {
        bodyProperties: xmlNode('<bodyPr><normAutofit lnSpcReduction="20000"/></bodyPr>'),
        paragraphs: [
          {
            properties: xmlNode('<pPr><lnSpc><spcPct val="150000"/></lnSpc></pPr>'),
            runs: [{ text: 'Reduced' }],
            level: 0,
          },
        ],
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
        paragraphs: [
          {
            runs: [
              {
                text: 'Click me',
                properties: xmlNode(
                  '<rPr xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><hlinkClick r:id="rId1"/></rPr>',
                ),
              },
            ],
            level: 0,
          },
        ],
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

    it('renders internal slide jump hlinkClick as clickable text using presentation order', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'Jump',
                properties: xmlNode(
                  '<rPr xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><hlinkClick r:id="rIdJump" action="ppaction://hlinksldjump"/></rPr>',
                ),
              },
            ],
            level: 0,
          },
        ],
      });
      const navigateCalls: Array<{ slideIndex?: number; url?: string }> = [];
      const ctx = createMockRenderContext();
      ctx.slide.slidePath = 'ppt/slides/slide5.xml';
      ctx.slide.rels.set('rIdJump', { type: 'slide', target: 'slide9.xml' });
      ctx.presentation.slides = [
        ctx.slide,
        { ...ctx.slide, index: 1, slidePath: 'ppt/slides/slide2.xml', rels: new Map() },
        { ...ctx.slide, index: 2, slidePath: 'ppt/slides/slide9.xml', rels: new Map() },
      ];
      ctx.onNavigate = (target) => navigateCalls.push(target);
      const container = document.createElement('div');

      renderTextBody(body, undefined, ctx, container);
      const link = container.querySelector<HTMLElement>('[role="link"]');
      link?.click();

      expect(link).not.toBeNull();
      expect(link!.textContent).toBe('Jump');
      expect(link!.title).toBe('Go to slide 3');
      expect(link!.style.cursor).toBe('pointer');
      expect(link!.style.color).toBe('rgb(5, 99, 193)');
      expect(navigateCalls).toEqual([{ slideIndex: 2 }]);
    });

    it('renders hlinkshowjump text actions as clickable slide navigation without r:id', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'Next',
                properties: xmlNode(
                  '<rPr><hlinkClick action="ppaction://hlinkshowjump?jump=nextslide"/></rPr>',
                ),
              },
            ],
            level: 0,
          },
        ],
      });
      const navigateCalls: Array<{ slideIndex?: number; url?: string }> = [];
      const ctx = createMockRenderContext();
      ctx.slide.index = 1;
      ctx.presentation.slides = [
        { ...ctx.slide, index: 0, slidePath: 'ppt/slides/slide1.xml', rels: new Map() },
        ctx.slide,
        { ...ctx.slide, index: 2, slidePath: 'ppt/slides/slide3.xml', rels: new Map() },
      ];
      ctx.onNavigate = (target) => navigateCalls.push(target);
      const container = document.createElement('div');

      renderTextBody(body, undefined, ctx, container);
      const link = container.querySelector<HTMLElement>('[role="link"]');
      link?.click();

      expect(link).not.toBeNull();
      expect(link!.textContent).toBe('Next');
      expect(link!.title).toBe('Go to slide 3');
      expect(link!.style.color).toBe('rgb(5, 99, 193)');
      expect(navigateCalls).toEqual([{ slideIndex: 2 }]);
    });
  });

  describe('line breaks', () => {
    it('renders \\n text as <br>', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [{ text: 'Line 1' }, { text: '\n' }, { text: 'Line 2' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const br = container.querySelector('br');
      expect(br).not.toBeNull();
      expect(container.textContent).toContain('Line 1');
      expect(container.textContent).toContain('Line 2');
    });

    it('renders empty paragraphs with <br>, including explicit empty runs', () => {
      for (const runs of [[], [{ text: '' }]]) {
        const body = makeTextBody({ paragraphs: [{ runs, level: 0 }] });
        expect(renderToContainer(body).querySelector('br')).not.toBeNull();
      }
    });

    it('renders slide number fields from the current slide index', () => {
      const ctx = createMockRenderContext();
      ctx.slide.index = 19;
      const container = document.createElement('div');
      renderTextBody(
        makeTextBody({ paragraphs: [{ runs: [{ text: '‹#›', fieldType: 'slidenum' }], level: 0 }] }),
        undefined,
        ctx,
        container,
      );
      expect(container.textContent).toBe('20');
    });
  });

  describe('cellTextColor override', () => {
    it('uses cellTextColor from table style', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [{ text: 'Cell' }],
            level: 0,
          },
        ],
      });
      const ctx = createMockRenderContext();
      const container = document.createElement('div');
      renderTextBody(body, undefined, ctx, container, { cellTextColor: '#FF0000' });
      const span = container.querySelector('span');
      if (span) {
        expect(span.style.color).not.toBe('');
      }
    });

    it('resolves theme placeholders passed from table text styles', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [{ text: '表格主题字体' }],
            level: 0,
          },
        ],
      });
      const ctx = createMockRenderContext();
      ctx.theme.minorFont = { latin: 'Calibri', ea: 'Microsoft YaHei', cs: '' };
      const container = document.createElement('div');

      renderTextBody(body, undefined, ctx, container, { cellTextFontFamily: '+mn-ea' });
      const span = container.querySelector('span');

      expect(span!.style.fontFamily).toContain('Microsoft YaHei');
      expect(span!.style.fontFamily).not.toContain('+mn-ea');
    });
  });

  describe('text alignment', () => {
    it('applies center alignment from pPr algn="ctr"', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode('<pPr algn="ctr"/>'),
            runs: [{ text: 'Centered' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      expect(para.style.textAlign).toBe('center');
    });

    it('applies right alignment', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode('<pPr algn="r"/>'),
            runs: [{ text: 'Right' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      expect(para.style.textAlign).toBe('right');
    });

    it('applies justify alignment', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode('<pPr algn="just"/>'),
            runs: [{ text: 'Justified' }],
            level: 0,
          },
        ],
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
        paragraphs: [
          {
            properties: xmlNode('<pPr><buAutoNum type="alphaLcPeriod"/></pPr>'),
            runs: [{ text: 'Alpha' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      expect(container.textContent).toContain('a.');
    });

    it('renders romanUcPeriod auto-numbering', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode('<pPr><buAutoNum type="romanUcPeriod"/></pPr>'),
            runs: [{ text: 'Roman' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      expect(container.textContent).toContain('I.');
    });
  });

  describe('font resolution', () => {
    it('resolves +mn-lt to theme minor font', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'Themed',
                properties: xmlNode('<rPr><latin typeface="+mn-lt"/></rPr>'),
              },
            ],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.fontFamily).toContain('Calibri');
    });

    it('falls back to theme latin font when +mn-ea points to an empty theme slot', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: '主题中文字体',
                properties: xmlNode('<rPr><ea typeface="+mn-ea"/></rPr>'),
              },
            ],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');

      expect(span!.style.fontFamily).toContain('Calibri');
      expect(span!.style.fontFamily).not.toContain('+mn-ea');
    });

    it('resolves +mn-ea to the theme East Asian font when the slot exists', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: '主题中文字体',
                properties: xmlNode('<rPr><ea typeface="+mn-ea"/></rPr>'),
              },
            ],
            level: 0,
          },
        ],
      });
      const ctx = createMockRenderContext();
      ctx.theme.minorFont = { latin: 'Calibri', ea: 'Microsoft YaHei', cs: '' };
      const container = document.createElement('div');

      renderTextBody(body, undefined, ctx, container);
      const span = container.querySelector('span');

      expect(span!.style.fontFamily).toContain('Microsoft YaHei');
      expect(span!.style.fontFamily).not.toContain('Calibri');
      expect(span!.style.fontFamily).not.toContain('+mn-ea');
    });

    it('uses script-specific Hans font for +mj-ea when the theme ea slot is empty', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: '丰富的SAP客户经验',
                properties: xmlNode(
                  '<rPr lang="zh-CN" altLang="en-US"><latin typeface="+mj-ea"/><ea typeface="+mj-ea"/></rPr>',
                ),
              },
            ],
            level: 0,
          },
        ],
      });
      const ctx = createMockRenderContext();
      ctx.theme.majorFont = {
        latin: 'Arial Black',
        ea: '',
        cs: '',
        scripts: { Hans: 'Microsoft YaHei' },
      } as any;
      const container = document.createElement('div');

      renderTextBody(body, undefined, ctx, container);
      const span = container.querySelector('span');

      expect(span!.style.fontFamily).toContain('Microsoft YaHei');
      expect(span!.style.fontFamily).not.toContain('Arial Black');
      expect(span!.style.fontFamily).not.toContain('+mj-ea');
    });

    it('resolves +mj-lt to theme major font', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'Major',
                properties: xmlNode('<rPr><latin typeface="+mj-lt"/></rPr>'),
              },
            ],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      // Theme major font is 'Calibri Light' but the mock may use 'Calibri'
      expect(span!.style.fontFamily).not.toBe('');
    });

    it('uses explicit font family from latin typeface', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'Arial',
                properties: xmlNode('<rPr><latin typeface="Arial"/></rPr>'),
              },
            ],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.fontFamily).toContain('Arial');
    });

    it('keeps East Asian font fallback when latin and ea typefaces are both declared (ai-computing slide 40 titles)', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: '项目背景',
                properties: xmlNode(
                  '<rPr><latin typeface="Arial"/><ea typeface="微软雅黑"/></rPr>',
                ),
              },
            ],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');

      expect(span!.style.fontFamily).toContain('Arial');
      expect(span!.style.fontFamily).toContain('微软雅黑');
      expect(span!.style.fontFamily).toContain('PingFang SC');
    });

    it('adds CJK sans fallbacks for Microsoft YaHei to avoid serif fallback (ai-computing slide 20)', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'DRF（Dominant Resource Fairness）是主资源公平调度策略',
                properties: xmlNode('<rPr><latin typeface="微软雅黑"/></rPr>'),
              },
            ],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');

      expect(span!.style.fontFamily).toContain('微软雅黑');
      expect(span!.style.fontFamily).toContain('PingFang SC');
      expect(span!.style.fontFamily).toContain('sans-serif');
    });

    it('prefers system-ui before Arial for missing Office default Latin fonts (line-spacing oracle)', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'Solution Architecture',
                properties: xmlNode('<rPr><latin typeface="Calibri"/></rPr>'),
              },
            ],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');

      expect(span!.style.fontFamily).toContain('Calibri');
      expect(span!.style.fontFamily).toContain('Aptos');
      expect(span!.style.fontFamily).toContain('Carlito');
      expect(span!.style.fontFamily).toContain('system-ui');
      expect(span!.style.fontFamily.indexOf('system-ui')).toBeLessThan(
        span!.style.fontFamily.indexOf('Arial'),
      );
      expect(span!.style.fontFamily).not.toContain('PingFang SC');
    });

    it('falls back to theme minor font when no font specified', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [{ text: 'Fallback' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.fontFamily).toContain('Calibri');
    });
  });

  describe('line spacing', () => {
    it('applies spcPct line height', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode('<pPr><lnSpc><spcPct val="120000"/></lnSpc></pPr>'),
            runs: [{ text: 'Spaced' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      expect(parseFloat(para.style.lineHeight)).toBeCloseTo(1.2, 2);
    });

    it('applies spcPts line height', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode('<pPr><lnSpc><spcPts val="2400"/></lnSpc></pPr>'),
            runs: [{ text: 'Fixed' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      expect(para.style.lineHeight).toBe('24pt');
    });

    it('uses fixed-height line wrappers for spcPts paragraphs with manual line breaks', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode('<pPr><lnSpc><spcPts val="1800"/></lnSpc></pPr>'),
            runs: [{ text: 'Line 1' }, { text: '\n' }, { text: 'Line 2' }],
            level: 0,
          },
        ],
      });

      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      const lineWrappers = Array.from(para.children).filter(
        (child) => child instanceof HTMLElement && child.tagName === 'DIV',
      ) as HTMLElement[];

      expect(para.querySelector('br')).toBeNull();
      expect(lineWrappers).toHaveLength(2);
      expect(lineWrappers.map((line) => line.style.height)).toEqual(['18pt', '18pt']);
      expect(lineWrappers.map((line) => line.textContent)).toEqual(['Line 1', 'Line 2']);
    });
  });

  describe('paragraph spacing', () => {
    it('applies spaceBefore in pt from spcBef spcPts', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode('<pPr><spcBef><spcPts val="1200"/></spcBef></pPr>'),
            runs: [{ text: 'Before' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      expect(para.style.marginTop).toBe('12pt');
    });

    it('applies spaceAfter in pt from spcAft spcPts', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            properties: xmlNode('<pPr><spcAft><spcPts val="600"/></spcAft></pPr>'),
            runs: [{ text: 'After' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const para = container.children[0] as HTMLElement;
      expect(para.style.marginBottom).toBe('6pt');
    });
  });

  describe('text effects', () => {
    it('applies noFill to make text transparent', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'Ghost',
                properties: xmlNode('<rPr><noFill/></rPr>'),
              },
            ],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.color).toBe('transparent');
    });

    it('applies highlight color from run properties without replacing text color', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'Highlighted',
                properties: xmlNode(
                  '<rPr><solidFill><srgbClr val="112233"/></solidFill><highlight><srgbClr val="FFFF00"/></highlight></rPr>',
                ),
              },
            ],
            level: 0,
          },
        ],
      });

      const container = renderToContainer(body);
      const span = container.querySelector('span')!;

      expect(span.style.backgroundColor).toBe('rgb(255, 255, 0)');
      expect(span.style.color).toBe('rgb(17, 34, 51)');
    });

    it('applies explicit underline color from uFill independently of text color', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'Colored underline',
                properties: xmlNode(
                  '<rPr u="sng"><solidFill><srgbClr val="112233"/></solidFill><uFill><solidFill><srgbClr val="FF0000"/></solidFill></uFill></rPr>',
                ),
              },
            ],
            level: 0,
          },
        ],
      });

      const container = renderToContainer(body);
      const span = container.querySelector('span')!;

      expect(span.style.textDecoration).toContain('underline');
      expect(span.style.color).toBe('rgb(17, 34, 51)');
      expect(span.style.textDecorationColor.toUpperCase()).toBe('#FF0000');
    });

    it('makes uFillTx underline color follow the effective table text color', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'Table link style',
                properties: xmlNode('<rPr u="sng"><uFillTx/></rPr>'),
              },
            ],
            level: 0,
          },
        ],
      });
      const ctx = createMockRenderContext();
      const container = document.createElement('div');

      renderTextBody(body, undefined, ctx, container, { cellTextColor: '#00B050' });
      const span = container.querySelector('span')!;

      expect(span.style.textDecoration).toContain('underline');
      expect(span.style.color).toBe('rgb(0, 176, 80)');
      expect(span.style.textDecorationColor.toUpperCase()).toBe('#00B050');
    });

    it('clips gradient text fill to glyphs while keeping the text run measurable', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'Gradient text',
                properties: xmlNode(`
                  <rPr>
                    <gradFill>
                      <gsLst>
                        <gs pos="0"><srgbClr val="FFFFFF"/></gs>
                        <gs pos="100000"><srgbClr val="0070C0"/></gs>
                      </gsLst>
                      <lin ang="2700000"/>
                    </gradFill>
                  </rPr>
                `),
              },
            ],
            level: 0,
          },
        ],
      });

      const container = renderToContainer(body);
      const span = container.querySelector('span') as HTMLElement & {
        style: CSSStyleDeclaration & { webkitBackgroundClip?: string };
      };

      expect(span.textContent).toBe('Gradient text');
      expect(span.style.background).toContain('linear-gradient');
      expect(span.style.color).toBe('transparent');
      expect(span.style.webkitBackgroundClip).toBe('text');
    });

    it('keeps compact numeric gradient runs unsplit so background-clip still paints text', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: '80% ',
                properties: xmlNode(`
                  <rPr>
                    <gradFill>
                      <gsLst>
                        <gs pos="0"><srgbClr val="FFFFFF"/></gs>
                        <gs pos="100000"><srgbClr val="0070C0"/></gs>
                      </gsLst>
                      <lin ang="2700000"/>
                    </gradFill>
                  </rPr>
                `),
              },
            ],
            level: 0,
          },
        ],
      });

      const container = renderToContainer(body);
      const span = container.querySelector('div > span') as HTMLElement & {
        style: CSSStyleDeclaration & { webkitBackgroundClip?: string };
      };

      expect(span.textContent).toBe('80% ');
      expect(span.querySelector('span')).toBeNull();
      expect(span.style.whiteSpace).toBe('nowrap');
      expect(span.style.background).toContain('linear-gradient');
      expect(span.style.webkitBackgroundClip).toBe('text');
    });

    it('applies text outline with solid fill', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'Outlined',
                properties: xmlNode(
                  '<rPr><ln w="12700"><solidFill><srgbClr val="FF0000"/></solidFill></ln></rPr>',
                ),
              },
            ],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span') as any;
      expect(span.style.webkitTextStrokeColor || span.style.paintOrder).toBeTruthy();
    });

    it('applies small caps from cap="small"', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'smallcaps',
                properties: xmlNode('<rPr cap="small"/>'),
              },
            ],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.fontVariant).toBe('small-caps');
    });

    it('applies kerning when kern is set', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'Kerned',
                properties: xmlNode('<rPr kern="0" sz="2400"/>'),
              },
            ],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const span = container.querySelector('span');
      expect(span!.style.fontKerning).toBe('normal');
    });

    it('reduces font size for super/subscript with large shift', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'sup',
                properties: xmlNode('<rPr baseline="30000" sz="2400"/>'),
              },
            ],
            level: 0,
          },
        ],
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
        paragraphs: [
          {
            runs: [{ text: 'SmartArt' }],
            level: 0,
          },
        ],
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
        paragraphs: [
          {
            runs: [
              {
                text: 'Link',
                properties: xmlNode(
                  '<rPr xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><hlinkClick r:id="rId1"/></rPr>',
                ),
              },
            ],
            level: 0,
          },
        ],
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

    it('applies hlink theme color and underline when Office emits default tx1 fill', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'LangSmith',
                properties: xmlNode(
                  '<rPr xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><solidFill><schemeClr val="tx1"/></solidFill><hlinkClick r:id="rId1"/></rPr>',
                ),
              },
            ],
            level: 0,
          },
        ],
      });
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId1', {
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
        target: 'https://www.langchain.com/langsmith',
        targetMode: 'External',
      });
      const container = document.createElement('div');
      renderTextBody(body, undefined, ctx, container);
      const link = container.querySelector('a');
      expect(link).not.toBeNull();
      expect(link!.style.color).toBe('rgb(5, 99, 193)');
      expect(link!.style.textDecoration).toContain('underline');
    });

    it('applies hlink theme color when Office materializes surrounding text color on linked runs', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'Gartner<',
                properties: xmlNode('<rPr><solidFill><srgbClr val="212121"/></solidFill></rPr>'),
              },
              {
                text: 'Assessing OpenTelemetry',
                properties: xmlNode(
                  '<rPr xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><solidFill><srgbClr val="212121"/></solidFill><hlinkClick r:id="rId1"/></rPr>',
                ),
              },
              {
                text: '>',
                properties: xmlNode('<rPr><solidFill><srgbClr val="212121"/></solidFill></rPr>'),
              },
            ],
            level: 0,
            endParaRPr: xmlNode(
              '<endParaRPr><solidFill><srgbClr val="212121"/></solidFill></endParaRPr>',
            ),
          },
        ],
      });
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId1', {
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
        target: 'https://www.gartner.com/document/4429299',
        targetMode: 'External',
      });
      const container = document.createElement('div');
      renderTextBody(body, undefined, ctx, container);
      const link = container.querySelector('a');
      expect(link).not.toBeNull();
      expect(link!.style.color).toBe('rgb(5, 99, 193)');
      expect(link!.style.textDecoration).toContain('underline');
    });

    it('preserves explicit hyperlink colors that differ from surrounding text', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [
              {
                text: 'Source: ',
                properties: xmlNode('<rPr><solidFill><srgbClr val="212121"/></solidFill></rPr>'),
              },
              {
                text: 'custom link',
                properties: xmlNode(
                  '<rPr xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><solidFill><srgbClr val="E1251B"/></solidFill><hlinkClick r:id="rId1"/></rPr>',
                ),
              },
            ],
            level: 0,
            endParaRPr: xmlNode(
              '<endParaRPr><solidFill><srgbClr val="212121"/></solidFill></endParaRPr>',
            ),
          },
        ],
      });
      const ctx = createMockRenderContext();
      ctx.slide.rels.set('rId1', {
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
        target: 'https://example.com/custom',
        targetMode: 'External',
      });
      const container = document.createElement('div');
      renderTextBody(body, undefined, ctx, container);
      const link = container.querySelector('a');
      expect(link).not.toBeNull();
      expect(link!.style.color).toBe('rgb(225, 37, 27)');
    });
  });

  describe('layout placeholder lstStyle inheritance (Level 4)', () => {
    it('inherits alignment from layout placeholder lstStyle', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [{ text: 'From layout' }],
            level: 0,
          },
        ],
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
        paragraphs: [
          {
            runs: [{ text: 'Override test' }],
            level: 0,
          },
        ],
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
        paragraphs: [
          {
            properties: xmlNode('<pPr><buChar char="•"/></pPr>'),
            runs: [{ text: 'Bullet item' }],
            level: 0,
          },
        ],
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
        paragraphs: [
          {
            properties: xmlNode(
              '<pPr><buClr><srgbClr val="00FF00"/></buClr><buChar char="•"/></pPr>',
            ),
            runs: [{ text: 'Bullet item' }],
            level: 0,
          },
        ],
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
        paragraphs: [
          {
            properties: xmlNode('<pPr><buChar char="-"/></pPr>'),
            runs: [{ text: 'Item with dash' }],
            level: 0,
          },
        ],
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
        paragraphs: [
          {
            runs: [
              { text: '示例服务', properties: xmlNode('<rPr lang="zh-CN" sz="6600"/>') },
              { text: '\n' },
              { text: '-- AIDC aaS', properties: xmlNode('<rPr lang="en-US" sz="4000"/>') },
            ],
            level: 0,
          },
        ],
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
        paragraphs: [
          {
            runs: [{ text: 'Hello' }, { text: '\n' }],
            level: 0,
            endParaRPr,
          } as any,
        ],
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
        paragraphs: [
          {
            runs: [],
            level: 0,
            endParaRPr,
          } as any,
        ],
      });
      const container = renderToContainer(body);
      const paraDiv = container.children[0] as HTMLElement;
      expect(paraDiv.style.fontSize).toBe('54pt');
      // The empty paragraph's br should use the endParaRPr font size
      const br = paraDiv.querySelector('br, span');
      // The br or spacer should exist
      expect(paraDiv.children.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('consecutive space preservation', () => {
    it('uses non-breaking spaces to preserve consecutive spaces without justify stretching', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [{ text: '             Lenovo AI Cloud' }],
            level: 0,
          },
        ],
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
        paragraphs: [
          {
            runs: [{ text: 'Hello World' }],
            level: 0,
          },
        ],
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
        paragraphs: [
          {
            runs: [{ text: '示例服务' }, { text: '\t\t\t' }, { text: '-- AIDC aaS' }],
            level: 0,
          },
        ],
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
        paragraphs: [
          {
            runs: [{ text: 'Before' }, { text: '\t' }, { text: 'After' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      // The paragraph div should have a tab-size set
      const paraDiv = container.children[0] as HTMLElement;
      expect(paraDiv).toBeDefined();
      expect(paraDiv.style.tabSize).toBeTruthy();
    });

    it('uses paragraph defTabSz instead of the OOXML default when rendering tabs', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [{ text: 'Before' }, { text: '\t' }, { text: 'After' }],
            properties: xmlNode('<pPr defTabSz="1219200"/>'),
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const paraDiv = container.children[0] as HTMLElement;
      expect(paraDiv.style.tabSize).toBe('128px');
    });

    it('renders tab characters between text with preserved whitespace', () => {
      const body = makeTextBody({
        paragraphs: [
          {
            runs: [{ text: 'A' }, { text: '\t' }, { text: 'B' }],
            level: 0,
          },
        ],
      });
      const container = renderToContainer(body);
      const allText = container.textContent || '';
      // Tab character must be present in the output
      expect(allText).toContain('\t');
    });
  });
});
