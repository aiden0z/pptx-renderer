import { describe, expect, it } from 'vitest';
import { parseChartNode } from '../../../../src/model/nodes/ChartNode';
import { parseXml } from '../../../../src/parser/XmlParser';
import type { RelEntry } from '../../../../src/parser/RelParser';

function makeChartXml(rId = 'rId1') {
  return parseXml(`
    <graphicFrame xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                  xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
      <nvGraphicFramePr>
        <cNvPr id="7" name="Chart 1"/>
        <nvPr/>
      </nvGraphicFramePr>
      <xfrm>
        <off x="914400" y="914400"/>
        <ext cx="4572000" cy="2743200"/>
      </xfrm>
      <graphic>
        <graphicData>
          <chart r:id="${rId}"/>
        </graphicData>
      </graphic>
    </graphicFrame>
  `);
}

function makeRels(target = 'charts/chart1.xml'): Map<string, RelEntry> {
  return new Map([
    ['rId1', { type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart', target }],
  ]);
}

describe('parseChartNode', () => {
  it('parses chart node with valid rel', () => {
    const node = parseChartNode(makeChartXml(), makeRels(), 'ppt/slides/slide1.xml');
    expect(node).toBeDefined();
    expect(node!.nodeType).toBe('chart');
    expect(node!.id).toBe('7');
    expect(node!.name).toBe('Chart 1');
    expect(node!.chartPath).toBe('ppt/slides/charts/chart1.xml');
  });

  it('resolves chart path relative to slide', () => {
    const rels = new Map([
      ['rId1', { type: 'chart', target: '../charts/chart2.xml' }],
    ]) as Map<string, RelEntry>;
    const node = parseChartNode(makeChartXml(), rels, 'ppt/slides/slide1.xml');
    expect(node!.chartPath).toBe('ppt/charts/chart2.xml');
  });

  it('returns undefined when chart rId not found in rels', () => {
    const emptyRels = new Map<string, RelEntry>();
    const node = parseChartNode(makeChartXml(), emptyRels, 'ppt/slides/slide1.xml');
    expect(node).toBeUndefined();
  });

  it('returns undefined when no chart element in graphicData', () => {
    const xml = parseXml(`
      <graphicFrame xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <nvGraphicFramePr>
          <cNvPr id="7" name="Not a chart"/>
          <nvPr/>
        </nvGraphicFramePr>
        <xfrm><off x="0" y="0"/><ext cx="100" cy="100"/></xfrm>
        <graphic><graphicData><tbl/></graphicData></graphic>
      </graphicFrame>
    `);
    const node = parseChartNode(xml, makeRels(), 'ppt/slides/slide1.xml');
    expect(node).toBeUndefined();
  });
});
