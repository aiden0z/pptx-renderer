import { describe, expect, it } from 'vitest';
import { parseXml } from '../../../src/parser/XmlParser';
import { parseTableNode } from '../../../src/model/nodes/TableNode';
import { renderTable } from '../../../src/renderer/TableRenderer';
import { renderTextBody } from '../../../src/renderer/TextRenderer';
import { renderTextFixture } from '../../fixtures/text-coverage';

describe('text choices through ShapeRenderer', () => {
  it.each(['noAutofit', 'spAutoFit'])('%s clears inherited normAutofit', (mode) => {
    const result = renderTextFixture(
      `<bodyPr><${mode}/></bodyPr>`,
      '',
      '',
      '',
      undefined,
      '<bodyPr><normAutofit fontScale="50000"/></bodyPr>',
    );
    expect(result.span.style.fontSize).toBe('24pt');
  });
  it('explicit normAutofit overrides inherited noAutofit', () => {
    expect(
      renderTextFixture(
        '<bodyPr><normAutofit fontScale="50000"/></bodyPr>',
        '',
        '',
        '',
        undefined,
        '<bodyPr><noAutofit/></bodyPr>',
      ).span.style.fontSize,
    ).toBe('12pt');
  });
  it.each(['50000', '50%'])('parses fontScale %s', (scale) => {
    expect(
      renderTextFixture(`<bodyPr><normAutofit fontScale="${scale}"/></bodyPr>`).span.style.fontSize,
    ).toBe('12pt');
  });
  it.each([
    ['<buChar char="•"/>', '<buAutoNum type="arabicPeriod"/>', '1.', '•'],
    ['<buAutoNum type="arabicPeriod" startAt="5"/>', '<buChar char="•"/>', '•', '5.'],
    ['<buChar char="•"/>', '<buNone/>', 'Alpha', '•'],
    ['<buNone/>', '<buAutoNum type="arabicPeriod"/>', '1.', '•'],
    [
      '<buAutoNum type="arabicPeriod" startAt="5"/>',
      '<buAutoNum type="arabicPeriod"/>',
      '1.',
      '5.',
    ],
  ])('replaces bullet choice %s by %s', (inherited, own, expected, absent) => {
    const { element } = renderTextFixture(undefined, own, `<lvl1pPr>${inherited}</lvl1pPr>`);
    expect(element.textContent).toContain(expected);
    expect(element.textContent).not.toContain(absent);
  });
  it.each([
    ['clip', 'clip'],
    ['clip', 'overflow'],
    ['overflow', 'clip'],
    ['overflow', 'overflow'],
  ])('noAutofit preserves overflow axes %s / %s', (x, y) => {
    const { container } = renderTextFixture(
      `<bodyPr horzOverflow="${x}" vertOverflow="${y}"><noAutofit/></bodyPr>`,
    );
    expect(container.style.overflowX).toBe(x === 'clip' ? 'clip' : 'visible');
    expect(container.style.overflowY).toBe(y === 'clip' ? 'clip' : 'visible');
  });
  it.each(['20000', '20%'])('subtracts line spacing reduction %s from 150 percent', (reduction) => {
    const { para } = renderTextFixture(
      `<bodyPr><normAutofit lnSpcReduction="${reduction}"/></bodyPr>`,
      '<lnSpc><spcPct val="150%"/></lnSpc>',
    );
    expect(Number(para.style.lineHeight)).toBeCloseTo(1.3);
  });
  it('does not reduce point line spacing', () => {
    const { para } = renderTextFixture(
      '<bodyPr><normAutofit lnSpcReduction="20000"/></bodyPr>',
      '<lnSpc><spcPts val="3000"/></lnSpc>',
    );
    expect(para.style.lineHeight).toBe('30pt');
  });
  it('percentage paragraph spacing clears inherited points', () => {
    const { para } = renderTextFixture(
      undefined,
      '<spcBef><spcPct val="50%"/></spcBef><spcAft><spcPct val="25%"/></spcAft>',
      '<lvl1pPr><spcBef><spcPts val="3000"/></spcBef><spcAft><spcPts val="3000"/></spcAft></lvl1pPr>',
    );
    expect(para.style.marginTop).toBe('12pt');
    expect(para.style.marginBottom).toBe('6pt');
  });
  it('point paragraph spacing clears inherited percentage', () => {
    const { para } = renderTextFixture(
      undefined,
      '<spcBef><spcPts val="600"/></spcBef><spcAft><spcPts val="300"/></spcAft>',
      '<lvl1pPr><spcBef><spcPct val="100000"/></spcBef><spcAft><spcPct val="100000"/></spcAft></lvl1pPr>',
    );
    expect(para.style.marginTop).toBe('6pt');
    expect(para.style.marginBottom).toBe('3pt');
  });
  it('paragraph fill overrides fontRef and explicit run fill still wins', () => {
    const { element } = renderTextFixture(
      undefined,
      '<defRPr><solidFill><srgbClr val="FF0000"/></solidFill></defRPr>',
      '',
      '<p:style><a:fontRef idx="minor"><a:srgbClr val="00FF00"/></a:fontRef></p:style>',
      '<a:r><a:t>Alpha</a:t></a:r><a:r><a:rPr><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill></a:rPr><a:t>Explicit</a:t></a:r>',
    );
    const spans = element.querySelectorAll('span');
    expect(spans[0].style.color).toBe('rgb(255, 0, 0)');
    expect(spans[1].style.color).toBe('rgb(0, 0, 255)');
  });
  it.each([
    ['obj', 'body'],
    ['ctrTitle', 'title'],
    ['dt', 'dt'],
  ])('matches master %s by category and layout by idx', (type, masterType) => {
    const { node, ctx } = renderTextFixture();
    const ph = (phType: string, idx: number, size: number) =>
      parseXml(
        `<sp><nvSpPr><nvPr><ph type="${phType}" idx="${idx}"/></nvPr></nvSpPr><txBody><lstStyle><lvl1pPr><defRPr sz="${size}"/></lvl1pPr></lstStyle></txBody></sp>`,
      );
    ctx.master.placeholders = [ph('ftr', 7, 800), ph(masterType, 99, 3000)];
    node.textBody!.paragraphs[0].runs[0].properties = undefined;
    const masterContainer = document.createElement('div');
    renderTextBody(node.textBody!, { type, idx: 7 }, ctx, masterContainer);
    expect(masterContainer.querySelector('span')!.style.fontSize).toBe('30pt');
    ctx.layout.placeholders = [{ node: ph(type, 3, 600) }, { node: ph('obj', 7, 1800) }];
    const layoutContainer = document.createElement('div');
    renderTextBody(node.textBody!, { type, idx: 7 }, ctx, layoutContainer);
    expect(layoutContainer.querySelector('span')!.style.fontSize).toBe('18pt');
  });
  it('percentage line spacing clears inherited absolute-line wrapper behavior', () => {
    const { element, para } = renderTextFixture(
      undefined,
      '<lnSpc><spcPct val="150000"/></lnSpc>',
      '<lvl1pPr><lnSpc><spcPts val="2000"/></lnSpc></lvl1pPr>',
      '',
      '<a:r><a:t>Alpha</a:t></a:r><a:br/><a:r><a:t>Beta</a:t></a:r>',
    );
    expect(Number(para.style.lineHeight)).toBe(1.5);
    expect(element.querySelector('br')).not.toBeNull();
  });

  it('table style color yields to paragraph and run fills', () => {
    const { ctx } = renderTextFixture();
    ctx.presentation.tableStyles = parseXml(
      '<tblStyleLst><tblStyle styleId="coverage"><wholeTbl><tcTxStyle><srgbClr val="00FF00"/></tcTxStyle></wholeTbl></tblStyle></tblStyleLst>',
    );
    const node = parseTableNode(
      parseXml(
        `<graphicFrame><nvGraphicFramePr><cNvPr id="4" name="Color table"/><nvPr/></nvGraphicFramePr><xfrm><off x="0" y="0"/><ext cx="3810000" cy="952500"/></xfrm><graphic><graphicData><tbl><tblPr><tableStyleId>coverage</tableStyleId></tblPr><tblGrid><gridCol w="3810000"/></tblGrid><tr h="952500"><tc><txBody><bodyPr/><lstStyle/><p><pPr><defRPr><solidFill><srgbClr val="FF0000"/></solidFill></defRPr></pPr><r><t>Paragraph</t></r><r><rPr><solidFill><srgbClr val="0000FF"/></solidFill></rPr><t>Run</t></r></p><p><r><t>Style</t></r></p></txBody><tcPr/></tc></tr></tbl></graphicData></graphic></graphicFrame>`,
      ),
    );
    const spans = renderTable(node, ctx).querySelectorAll('span');
    expect([...spans].map((span) => span.style.color)).toEqual([
      'rgb(255, 0, 0)',
      'rgb(0, 0, 255)',
      'rgb(0, 255, 0)',
    ]);
  });
  it('paragraph fill does not suppress independent hyperlink theme rules', () => {
    const { ctx, node } = renderTextFixture(
      undefined,
      '<defRPr><solidFill><srgbClr val="FF0000"/></solidFill></defRPr>',
      '',
      '',
      '<a:r><a:rPr xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><a:hlinkClick r:id="link"/></a:rPr><a:t>Alpha</a:t></a:r>',
    );
    ctx.slide.rels.set('link', {
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
      target: 'https://example.com',
      targetMode: 'External',
    });
    const container = document.createElement('div');
    renderTextBody(node.textBody!, undefined, ctx, container, { fontRefColor: '#00FF00' });
    expect(container.querySelector('a')!.style.color).toBe('rgb(5, 99, 193)');
  });
  it('ordinary shapes keep default insets and explicit wrap none', () => {
    const { container } = renderTextFixture('<bodyPr wrap="none"><noAutofit/></bodyPr>');
    expect(parseFloat(container.style.paddingLeft)).toBeCloseTo(9.6);
    expect(parseFloat(container.style.paddingTop)).toBeCloseTo(4.8);
    expect(container.style.whiteSpace).toBe('nowrap');
  });

  it.each(['square', 'none'])(
    'standalone text rendering isolates host styles with wrap=%s',
    (wrap) => {
      const { node, ctx } = renderTextFixture(`<bodyPr wrap="${wrap}"><noAutofit/></bodyPr>`);
      const host = document.createElement('div');
      host.style.whiteSpace = 'pre';
      const container = document.createElement('div');
      host.append(container);
      renderTextBody(node.textBody!, undefined, ctx, container);
      expect(container.style.whiteSpace).toBe(wrap === 'none' ? 'nowrap' : 'normal');
    },
  );
  it('text defaults follow matched layout parent instead of an explicit differing slide type', () => {
    const { node, ctx } = renderTextFixture();
    const ph = (type: string, idx: number, style = '') =>
      parseXml(
        `<sp><nvSpPr><nvPr><ph type="${type}" idx="${idx}"/></nvPr></nvSpPr><txBody><lstStyle>${style}</lstStyle></txBody></sp>`,
      );
    ctx.master.placeholders = [
      ph('title', 7, '<lvl1pPr><defRPr sz="900"/></lvl1pPr>'),
      ph('body', 99, '<lvl1pPr><defRPr sz="3000"/></lvl1pPr>'),
    ];
    ctx.layout.placeholders = [{ node: ph('obj', 7) }];
    node.textBody!.paragraphs[0].runs[0].properties = undefined;
    const container = document.createElement('div');
    renderTextBody(node.textBody!, { type: 'title', idx: 7 }, ctx, container);
    expect(container.querySelector('span')!.style.fontSize).toBe('30pt');
  });
  it('a layout placeholder with omitted type uses the default object master text category', () => {
    const { node, ctx } = renderTextFixture();
    ctx.layout.placeholders = [
      { node: parseXml('<sp><nvSpPr><nvPr><ph idx="7"/></nvPr></nvSpPr></sp>') },
    ];
    ctx.master.textStyles.bodyStyle = parseXml(
      '<bodyStyle><lvl1pPr><defRPr sz="3000"/></lvl1pPr></bodyStyle>',
    );
    ctx.master.textStyles.otherStyle = parseXml(
      '<otherStyle><lvl1pPr><defRPr sz="900"/></lvl1pPr></otherStyle>',
    );
    node.textBody!.paragraphs[0].runs[0].properties = undefined;
    const container = document.createElement('div');
    renderTextBody(node.textBody!, { idx: 7 }, ctx, container);
    expect(container.querySelector('span')!.style.fontSize).toBe('30pt');
  });
});
