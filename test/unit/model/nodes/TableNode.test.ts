import { describe, expect, it } from 'vitest';
import { parseTableNode } from '../../../../src/model/nodes/TableNode';
import { parseXml } from '../../../../src/parser/XmlParser';

function makeTableXml(
  opts: {
    styleId?: string;
    cells?: string[][];
    gridWidths?: number[];
    rowHeight?: number;
    frameWidth?: number;
    frameHeight?: number;
    merge?: boolean;
  } = {},
) {
  const gridWidths = opts.gridWidths ?? [914400, 914400];
  const rowHeight = opts.rowHeight ?? 370840;
  const cells = opts.cells ?? [
    ['A1', 'B1'],
    ['A2', 'B2'],
  ];
  const styleId = opts.styleId;
  const frameWidth = opts.frameWidth ?? 1828800;
  const frameHeight = opts.frameHeight ?? 741680;

  const gridCols = gridWidths.map((w) => `<gridCol w="${w}"/>`).join('');
  const rows = cells
    .map((row) => {
      const tcs = row
        .map((text, ci) => {
          const mergeAttrs =
            opts.merge && ci === 0 ? ' gridSpan="2"' : opts.merge && ci === 1 ? ' hMerge="1"' : '';
          return `<tc${mergeAttrs}><txBody><p><r><t>${text}</t></r></p></txBody><tcPr/></tc>`;
        })
        .join('');
      return `<tr h="${rowHeight}">${tcs}</tr>`;
    })
    .join('');

  const tblPrContent = styleId ? `<tableStyleId>${styleId}</tableStyleId>` : '';

  return parseXml(`
    <graphicFrame xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <nvGraphicFramePr>
        <cNvPr id="8" name="Table 1"/>
        <nvPr/>
      </nvGraphicFramePr>
      <xfrm>
        <off x="457200" y="457200"/>
        <ext cx="${frameWidth}" cy="${frameHeight}"/>
      </xfrm>
      <graphic>
        <graphicData>
          <tbl>
            <tblPr>${tblPrContent}</tblPr>
            <tblGrid>${gridCols}</tblGrid>
            ${rows}
          </tbl>
        </graphicData>
      </graphic>
    </graphicFrame>
  `);
}

describe('parseTableNode', () => {
  it('parses basic table structure', () => {
    const node = parseTableNode(makeTableXml());
    expect(node.nodeType).toBe('table');
    expect(node.id).toBe('8');
    expect(node.name).toBe('Table 1');
    expect(node.columns).toHaveLength(2);
    expect(node.rows).toHaveLength(2);
  });

  it('parses column widths', () => {
    const node = parseTableNode(makeTableXml({ gridWidths: [914400, 1828800] }));
    expect(node.columns[0]).toBeCloseTo(96, 0); // 914400 EMU ≈ 96px
    expect(node.columns[1]).toBeCloseTo(192, 0); // 1828800 EMU ≈ 192px
  });

  it('parses row heights', () => {
    const node = parseTableNode(makeTableXml({ rowHeight: 457200 }));
    expect(node.rows[0].height).toBeCloseTo(48, 0);
  });

  it('normalizes stale frame extents to the table grid size', () => {
    const node = parseTableNode(
      makeTableXml({
        gridWidths: [914400, 1828800],
        rowHeight: 457200,
        frameWidth: 457200,
        frameHeight: 457200,
      }),
    );

    expect(node.size.w).toBeCloseTo(288, 0);
    expect(node.size.h).toBeCloseTo(96, 0);
  });

  it('falls back to each frame extent axis when the grid has no explicit size', () => {
    const node = parseTableNode(
      makeTableXml({
        gridWidths: [0],
        rowHeight: 0,
        frameWidth: 3048000,
        frameHeight: 2286000,
      }),
    );

    expect(node.size.w).toBeCloseTo(320, 0);
    expect(node.size.h).toBeCloseTo(240, 0);
  });

  it('defaults missing grid column width and row height to zero', () => {
    const node = parseTableNode(
      parseXml(`
        <graphicFrame xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <nvGraphicFramePr><cNvPr id="8" name="Table 1"/><nvPr/></nvGraphicFramePr>
          <xfrm><off x="0" y="0"/><ext cx="1828800" cy="741680"/></xfrm>
          <graphic>
            <graphicData>
              <tbl>
                <tblPr/>
                <tblGrid><gridCol/></tblGrid>
                <tr><tc><txBody/><tcPr/></tc></tr>
              </tbl>
            </graphicData>
          </graphic>
        </graphicFrame>
      `),
    );

    expect(node.columns).toEqual([0]);
    expect(node.rows[0].height).toBe(0);
  });

  it('parses cell text', () => {
    const node = parseTableNode(makeTableXml({ cells: [['Hello', 'World']] }));
    expect(node.rows[0].cells[0].textBody).toBeDefined();
    expect(node.rows[0].cells[0].textBody!.paragraphs[0].runs[0].text).toBe('Hello');
  });

  it('parses cell merge attributes', () => {
    const node = parseTableNode(makeTableXml({ merge: true }));
    expect(node.rows[0].cells[0].gridSpan).toBe(2);
    expect(node.rows[0].cells[1].hMerge).toBe(true);
  });

  it('parses OOXML boolean aliases for table merge attributes', () => {
    const node = parseTableNode(
      parseXml(`
      <graphicFrame xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <nvGraphicFramePr><cNvPr id="8" name="Table 1"/><nvPr/></nvGraphicFramePr>
        <xfrm><off x="0" y="0"/><ext cx="1828800" cy="741680"/></xfrm>
        <graphic>
          <graphicData>
            <tbl>
              <tblPr/>
              <tblGrid><gridCol w="914400"/><gridCol w="914400"/></tblGrid>
              <tr h="370840">
                <tc hMerge="on"><txBody><p><r><t>A</t></r></p></txBody><tcPr/></tc>
                <tc vMerge="t"><txBody><p><r><t>B</t></r></p></txBody><tcPr/></tc>
              </tr>
            </tbl>
          </graphicData>
        </graphic>
      </graphicFrame>
    `),
    );

    expect(node.rows[0].cells[0].hMerge).toBe(true);
    expect(node.rows[0].cells[1].vMerge).toBe(true);
  });

  it('parses table style ID', () => {
    const node = parseTableNode(
      makeTableXml({
        styleId: '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}',
      }),
    );
    expect(node.tableStyleId).toBe('{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}');
  });

  it('parses tableStyleId from val attribute when text content is empty', () => {
    const node = parseTableNode(
      parseXml(`
        <graphicFrame xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <nvGraphicFramePr><cNvPr id="8" name="Table 1"/><nvPr/></nvGraphicFramePr>
          <xfrm><off x="0" y="0"/><ext cx="1828800" cy="741680"/></xfrm>
          <graphic>
            <graphicData>
              <tbl>
                <tblPr><tableStyleId val="{STYLE_FROM_VAL}"/></tblPr>
                <tblGrid><gridCol w="914400"/></tblGrid>
                <tr h="370840"><tc><txBody/><tcPr/></tc></tr>
              </tbl>
            </graphicData>
          </graphic>
        </graphicFrame>
      `),
    );

    expect(node.tableStyleId).toBe('{STYLE_FROM_VAL}');
  });

  it('returns undefined for an empty tableStyleId node without val', () => {
    const node = parseTableNode(
      parseXml(`
        <graphicFrame xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <nvGraphicFramePr><cNvPr id="8" name="Table 1"/><nvPr/></nvGraphicFramePr>
          <xfrm><off x="0" y="0"/><ext cx="1828800" cy="741680"/></xfrm>
          <graphic>
            <graphicData>
              <tbl>
                <tblPr><tableStyleId/></tblPr>
                <tblGrid/>
              </tbl>
            </graphicData>
          </graphic>
        </graphicFrame>
      `),
    );

    expect(node.tableStyleId).toBeUndefined();
  });

  it('parses table style from tblStyle val, tblStyle text, and direct tblPr attribute', () => {
    const withTblStyleVal = parseTableNode(
      parseXml(`
        <graphicFrame xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <nvGraphicFramePr><cNvPr id="8" name="Table 1"/><nvPr/></nvGraphicFramePr>
          <xfrm><off x="0" y="0"/><ext cx="1828800" cy="741680"/></xfrm>
          <graphic><graphicData><tbl>
            <tblPr><tblStyle val="{STYLE_FROM_TBLSTYLE_VAL}"/></tblPr>
            <tblGrid/><tr h="0"/>
          </tbl></graphicData></graphic>
        </graphicFrame>
      `),
    );
    const withTblStyleText = parseTableNode(
      parseXml(`
        <graphicFrame xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <nvGraphicFramePr><cNvPr id="8" name="Table 1"/><nvPr/></nvGraphicFramePr>
          <xfrm><off x="0" y="0"/><ext cx="1828800" cy="741680"/></xfrm>
          <graphic><graphicData><tbl>
            <tblPr><tblStyle>{STYLE_FROM_TBLSTYLE_TEXT}</tblStyle></tblPr>
            <tblGrid/><tr h="0"/>
          </tbl></graphicData></graphic>
        </graphicFrame>
      `),
    );
    const withDirectAttr = parseTableNode(
      parseXml(`
        <graphicFrame xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <nvGraphicFramePr><cNvPr id="8" name="Table 1"/><nvPr/></nvGraphicFramePr>
          <xfrm><off x="0" y="0"/><ext cx="1828800" cy="741680"/></xfrm>
          <graphic><graphicData><tbl>
            <tblPr tblStyle="{STYLE_FROM_DIRECT_ATTR}"/>
            <tblGrid/><tr h="0"/>
          </tbl></graphicData></graphic>
        </graphicFrame>
      `),
    );

    expect(withTblStyleVal.tableStyleId).toBe('{STYLE_FROM_TBLSTYLE_VAL}');
    expect(withTblStyleText.tableStyleId).toBe('{STYLE_FROM_TBLSTYLE_TEXT}');
    expect(withDirectAttr.tableStyleId).toBe('{STYLE_FROM_DIRECT_ATTR}');
  });

  it('handles table without style ID', () => {
    const node = parseTableNode(makeTableXml());
    expect(node.tableStyleId).toBeUndefined();
  });

  it('parses cell properties node', () => {
    const node = parseTableNode(makeTableXml());
    expect(node.rows[0].cells[0].properties).toBeDefined();
  });

  it('parses table properties node', () => {
    const node = parseTableNode(makeTableXml());
    expect(node.properties).toBeDefined();
  });
});
