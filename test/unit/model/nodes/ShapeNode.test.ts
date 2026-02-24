import { describe, it, expect } from 'vitest';
import { parseShapeNode, parseTextBody } from '../../../../src/model/nodes/ShapeNode';
import { parseXml } from '../../../../src/parser/XmlParser';

function shape(xml: string) {
  return parseShapeNode(parseXml(xml));
}

describe('parseShapeNode', () => {
  it('parses preset geometry', () => {
    const s = shape(`
      <sp>
        <nvSpPr><cNvPr id="1" name="S"/><nvPr/></nvSpPr>
        <spPr>
          <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
          <prstGeom prst="ellipse"><avLst/></prstGeom>
        </spPr>
      </sp>
    `);
    expect(s.nodeType).toBe('shape');
    expect(s.presetGeometry).toBe('ellipse');
  });

  it('parses adjustments from avLst', () => {
    const s = shape(`
      <sp>
        <nvSpPr><cNvPr id="1" name="S"/><nvPr/></nvSpPr>
        <spPr>
          <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
          <prstGeom prst="roundRect">
            <avLst>
              <gd name="adj" fmla="val 16667"/>
            </avLst>
          </prstGeom>
        </spPr>
      </sp>
    `);
    expect(s.adjustments.get('adj')).toBe(16667);
  });

  it('parses adjustment with direct numeric fmla', () => {
    const s = shape(`
      <sp>
        <nvSpPr><cNvPr id="1" name="S"/><nvPr/></nvSpPr>
        <spPr>
          <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
          <prstGeom prst="rect">
            <avLst>
              <gd name="adj" fmla="50000"/>
            </avLst>
          </prstGeom>
        </spPr>
      </sp>
    `);
    expect(s.adjustments.get('adj')).toBe(50000);
  });

  it('skips adjustment without name', () => {
    const s = shape(`
      <sp>
        <nvSpPr><cNvPr id="1" name="S"/><nvPr/></nvSpPr>
        <spPr>
          <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
          <prstGeom prst="rect">
            <avLst>
              <gd fmla="val 50000"/>
            </avLst>
          </prstGeom>
        </spPr>
      </sp>
    `);
    expect(s.adjustments.size).toBe(0);
  });

  it('parses customGeometry', () => {
    const s = shape(`
      <sp>
        <nvSpPr><cNvPr id="1" name="S"/><nvPr/></nvSpPr>
        <spPr>
          <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
          <custGeom>
            <pathLst>
              <path w="100" h="100"><moveTo><pt x="0" y="0"/></moveTo><lnTo><pt x="100" y="100"/></lnTo></path>
            </pathLst>
          </custGeom>
        </spPr>
      </sp>
    `);
    expect(s.customGeometry).toBeDefined();
    expect(s.presetGeometry).toBeUndefined();
  });

  it('parses solidFill', () => {
    const s = shape(`
      <sp>
        <nvSpPr><cNvPr id="1" name="S"/><nvPr/></nvSpPr>
        <spPr>
          <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
          <solidFill><srgbClr val="FF0000"/></solidFill>
        </spPr>
      </sp>
    `);
    expect(s.fill).toBeDefined();
    expect(s.fill!.localName).toBe('solidFill');
  });

  it('parses gradFill', () => {
    const s = shape(`
      <sp>
        <nvSpPr><cNvPr id="1" name="S"/><nvPr/></nvSpPr>
        <spPr>
          <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
          <gradFill><gsLst><gs pos="0"><srgbClr val="FF0000"/></gs></gsLst></gradFill>
        </spPr>
      </sp>
    `);
    expect(s.fill).toBeDefined();
    expect(s.fill!.localName).toBe('gradFill');
  });

  it('parses noFill', () => {
    const s = shape(`
      <sp>
        <nvSpPr><cNvPr id="1" name="S"/><nvPr/></nvSpPr>
        <spPr>
          <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
          <noFill/>
        </spPr>
      </sp>
    `);
    expect(s.fill).toBeDefined();
    expect(s.fill!.localName).toBe('noFill');
  });

  it('parses line properties', () => {
    const s = shape(`
      <sp>
        <nvSpPr><cNvPr id="1" name="S"/><nvPr/></nvSpPr>
        <spPr>
          <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
          <ln w="25400"><solidFill><srgbClr val="000000"/></solidFill></ln>
        </spPr>
      </sp>
    `);
    expect(s.line).toBeDefined();
  });

  it('parses headEnd and tailEnd arrowheads', () => {
    const s = shape(`
      <sp>
        <nvSpPr><cNvPr id="1" name="S"/><nvPr/></nvSpPr>
        <spPr>
          <xfrm><off x="0" y="0"/><ext cx="914400" cy="0"/></xfrm>
          <ln w="12700">
            <headEnd type="triangle" w="med" len="med"/>
            <tailEnd type="stealth" w="lg" len="sm"/>
          </ln>
        </spPr>
      </sp>
    `);
    expect(s.headEnd).toEqual({ type: 'triangle', w: 'med', len: 'med' });
    expect(s.tailEnd).toEqual({ type: 'stealth', w: 'lg', len: 'sm' });
  });

  it('ignores arrowhead with type="none"', () => {
    const s = shape(`
      <sp>
        <nvSpPr><cNvPr id="1" name="S"/><nvPr/></nvSpPr>
        <spPr>
          <xfrm><off x="0" y="0"/><ext cx="914400" cy="0"/></xfrm>
          <ln><headEnd type="none"/><tailEnd type="none"/></ln>
        </spPr>
      </sp>
    `);
    expect(s.headEnd).toBeUndefined();
    expect(s.tailEnd).toBeUndefined();
  });

  it('parses textBody with paragraphs and runs', () => {
    const s = shape(`
      <sp>
        <nvSpPr><cNvPr id="1" name="S"/><nvPr/></nvSpPr>
        <spPr>
          <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
        </spPr>
        <txBody>
          <bodyPr anchor="ctr"/>
          <lstStyle/>
          <p>
            <pPr lvl="0"/>
            <r><rPr lang="en-US" b="1"/><t>Bold text</t></r>
          </p>
        </txBody>
      </sp>
    `);
    expect(s.textBody).toBeDefined();
    expect(s.textBody!.bodyProperties).toBeDefined();
    expect(s.textBody!.paragraphs).toHaveLength(1);
    expect(s.textBody!.paragraphs[0].runs[0].text).toBe('Bold text');
    expect(s.textBody!.paragraphs[0].runs[0].properties).toBeDefined();
  });

  it('parses line breaks and field codes in paragraphs', () => {
    const s = shape(`
      <sp>
        <nvSpPr><cNvPr id="1" name="S"/><nvPr/></nvSpPr>
        <spPr>
          <xfrm><off x="0" y="0"/><ext cx="914400" cy="914400"/></xfrm>
        </spPr>
        <txBody>
          <bodyPr/>
          <p>
            <r><t>Line1</t></r>
            <br/>
            <r><t>Line2</t></r>
            <fld type="slidenum"><t>3</t></fld>
          </p>
        </txBody>
      </sp>
    `);
    expect(s.textBody).toBeDefined();
    const runs = s.textBody!.paragraphs[0].runs;
    expect(runs.length).toBe(4); // Line1, \n, Line2, 3
    expect(runs[0].text).toBe('Line1');
    expect(runs[1].text).toBe('\n');
    expect(runs[2].text).toBe('Line2');
    expect(runs[3].text).toBe('3');
  });

  it('parses txXfrm for diagram text box bounds', () => {
    const s = shape(`
      <sp>
        <nvSpPr><cNvPr id="1" name="S"/><nvPr/></nvSpPr>
        <spPr>
          <xfrm><off x="914400" y="914400"/><ext cx="1828800" cy="914400"/></xfrm>
        </spPr>
        <txXfrm><off x="914400" y="914400"/><ext cx="1828800" cy="457200"/></txXfrm>
        <txBody><bodyPr/><p><r><t>Diagram text</t></r></p></txBody>
      </sp>
    `);
    expect(s.textBoxBounds).toBeDefined();
    expect(s.textBoxBounds!.x).toBeCloseTo(0, 0); // localX = 914400-914400 = 0
    expect(s.textBoxBounds!.y).toBeCloseTo(0, 0);
    expect(s.textBoxBounds!.w).toBeGreaterThan(0);
    expect(s.textBoxBounds!.h).toBeGreaterThan(0);
  });

  it('handles 180deg txXfrm rotation by mirroring box placement', () => {
    // Shape at (914400, 914400) size (1828800, 914400)
    // txXfrm at (914400, 914400) size (914400, 457200) rot=10800000 (180deg)
    const s = shape(`
      <sp>
        <nvSpPr><cNvPr id="1" name="S"/><nvPr/></nvSpPr>
        <spPr>
          <xfrm><off x="914400" y="914400"/><ext cx="1828800" cy="914400"/></xfrm>
        </spPr>
        <txXfrm rot="10800000"><off x="914400" y="914400"/><ext cx="914400" cy="457200"/></txXfrm>
        <txBody><bodyPr/><p><r><t>Rotated</t></r></p></txBody>
      </sp>
    `);
    expect(s.textBoxBounds).toBeDefined();
    // 180deg → isHalfTurn=true → boxX = shapeW - (localX + txW) = 1828800 - (0 + 914400) = 914400
    expect(s.textBoxBounds!.rotation).toBeCloseTo(180, 0);
  });

  it('returns undefined textBoxBounds when shapeW or shapeH is 0', () => {
    const s = shape(`
      <sp>
        <nvSpPr><cNvPr id="1" name="S"/><nvPr/></nvSpPr>
        <spPr>
          <xfrm><off x="0" y="0"/><ext cx="0" cy="0"/></xfrm>
        </spPr>
        <txXfrm><off x="0" y="0"/><ext cx="914400" cy="457200"/></txXfrm>
      </sp>
    `);
    expect(s.textBoxBounds).toBeUndefined();
  });
});

describe('parseTextBody', () => {
  it('returns undefined for non-existent txBody', () => {
    const node = parseXml('<sp/>');
    const result = parseTextBody(node.child('txBody'));
    expect(result).toBeUndefined();
  });

  it('parses listStyle', () => {
    const node = parseXml(`
      <txBody>
        <bodyPr/>
        <lstStyle>
          <lvl1pPr><defRPr sz="1800"/></lvl1pPr>
        </lstStyle>
        <p><r><t>Text</t></r></p>
      </txBody>
    `);
    const result = parseTextBody(node);
    expect(result).toBeDefined();
    expect(result!.listStyle).toBeDefined();
  });

  it('parses paragraph level from pPr lvl', () => {
    const node = parseXml(`
      <txBody>
        <bodyPr/>
        <p><pPr lvl="2"/><r><t>Level 2</t></r></p>
      </txBody>
    `);
    const result = parseTextBody(node);
    expect(result!.paragraphs[0].level).toBe(2);
  });

  it('defaults paragraph level to 0', () => {
    const node = parseXml(`
      <txBody>
        <bodyPr/>
        <p><r><t>Default level</t></r></p>
      </txBody>
    `);
    const result = parseTextBody(node);
    expect(result!.paragraphs[0].level).toBe(0);
  });
});
