import { describe, expect, it } from 'vitest';
import { renderTable } from '../../../src/renderer/TableRenderer';
import type { RenderContext } from '../../../src/renderer/RenderContext';
import type { TableNodeData, TableRow } from '../../../src/model/nodes/TableNode';
import { parseXml, SafeXmlNode } from '../../../src/parser/XmlParser';

const emptyXml = new SafeXmlNode(null);

function makeCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    presentation: { width: 960, height: 540, media: new Map(), tableStyles: emptyXml } as any,
    slide: { rels: new Map() } as any,
    theme: {
      colorScheme: new Map([['dk1', '000000'], ['lt1', 'FFFFFF'], ['accent1', '4472C4']]),
      majorFont: { latin: 'Calibri', ea: '', cs: '' },
      minorFont: { latin: 'Calibri', ea: '', cs: '' },
      fillStyles: [],
      lineStyles: [],
      effectStyles: [],
    },
    master: {
      colorMap: new Map([['tx1', 'dk1'], ['bg1', 'lt1']]),
      textStyles: {},
      placeholders: [],
      spTree: emptyXml,
      rels: new Map(),
    } as any,
    layout: {
      placeholders: [],
      spTree: emptyXml,
      rels: new Map(),
      showMasterSp: true,
    } as any,
    mediaUrlCache: new Map(),
    colorCache: new Map(),
    ...overrides,
  };
}

function makeTable(opts: {
  columns?: number[];
  rows?: TableRow[];
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  tableStyleId?: string;
  properties?: SafeXmlNode;
} = {}): TableNodeData {
  return {
    id: '1',
    name: 'Table 1',
    nodeType: 'table',
    position: { x: 100, y: 50 },
    size: { w: 400, h: 200 },
    rotation: opts.rotation ?? 0,
    flipH: opts.flipH ?? false,
    flipV: opts.flipV ?? false,
    source: emptyXml,
    columns: opts.columns ?? [200, 200],
    rows: opts.rows ?? [
      {
        height: 100,
        cells: [
          { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false },
          { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false },
        ],
      },
      {
        height: 100,
        cells: [
          { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false },
          { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false },
        ],
      },
    ],
    tableStyleId: opts.tableStyleId,
    properties: opts.properties,
  };
}

describe('renderTable', () => {
  it('creates wrapper with correct position and size', () => {
    const el = renderTable(makeTable(), makeCtx());
    expect(el.style.position).toBe('absolute');
    expect(el.style.left).toBe('100px');
    expect(el.style.top).toBe('50px');
    expect(el.style.width).toBe('400px');
    expect(el.style.height).toBe('200px');
  });

  it('creates inner table element with border-collapse', () => {
    const el = renderTable(makeTable(), makeCtx());
    const table = el.querySelector('table')!;
    expect(table).not.toBeNull();
    expect(table.style.borderCollapse).toBe('collapse');
    expect(table.style.width).toBe('100%');
    expect(table.style.height).toBe('100%');
    expect(table.style.tableLayout).toBe('fixed');
  });

  it('creates colgroup with percentage widths', () => {
    const el = renderTable(makeTable({ columns: [300, 100] }), makeCtx());
    const cols = el.querySelectorAll('col');
    expect(cols).toHaveLength(2);
    expect(cols[0].style.width).toBe('75%');
    expect(cols[1].style.width).toBe('25%');
  });

  it('creates correct number of rows and cells', () => {
    const el = renderTable(makeTable(), makeCtx());
    const rows = el.querySelectorAll('tr');
    expect(rows).toHaveLength(2);
    const cells = el.querySelectorAll('td');
    expect(cells).toHaveLength(4);
  });

  it('applies rotation transform', () => {
    const el = renderTable(makeTable({ rotation: 45 }), makeCtx());
    expect(el.style.transform).toContain('rotate(45deg)');
  });

  it('applies flipH transform', () => {
    const el = renderTable(makeTable({ flipH: true }), makeCtx());
    expect(el.style.transform).toContain('scaleX(-1)');
  });

  it('applies flipV transform', () => {
    const el = renderTable(makeTable({ flipV: true }), makeCtx());
    expect(el.style.transform).toContain('scaleY(-1)');
  });

  it('skips merged cells (hMerge/vMerge)', () => {
    const rows: TableRow[] = [
      {
        height: 100,
        cells: [
          { gridSpan: 2, rowSpan: 1, hMerge: false, vMerge: false },
          { gridSpan: 1, rowSpan: 1, hMerge: true, vMerge: false },
        ],
      },
    ];
    const el = renderTable(makeTable({ columns: [200, 200], rows }), makeCtx());
    const tds = el.querySelectorAll('td');
    expect(tds).toHaveLength(1);
    expect(tds[0].colSpan).toBe(2);
  });

  it('sets rowSpan for vertical merge', () => {
    const rows: TableRow[] = [
      {
        height: 100,
        cells: [
          { gridSpan: 1, rowSpan: 2, hMerge: false, vMerge: false },
          { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false },
        ],
      },
      {
        height: 100,
        cells: [
          { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: true },
          { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false },
        ],
      },
    ];
    const el = renderTable(makeTable({ columns: [200, 200], rows }), makeCtx());
    const firstRowTds = el.querySelectorAll('tr:first-child td');
    expect(firstRowTds[0].rowSpan).toBe(2);
  });

  it('applies cell properties with solid fill', () => {
    const tcPrXml = parseXml('<tcPr><solidFill><srgbClr val="FF0000"/></solidFill></tcPr>');
    const rows: TableRow[] = [
      {
        height: 100,
        cells: [
          { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false, properties: tcPrXml },
        ],
      },
    ];
    const el = renderTable(makeTable({ columns: [400], rows }), makeCtx());
    const td = el.querySelector('td')!;
    // jsdom normalizes hex to rgb
    expect(td.style.backgroundColor).toBe('rgb(255, 0, 0)');
  });

  it('applies cell borders from tcPr', () => {
    const tcPrXml = parseXml(`
      <tcPr>
        <lnT w="25400"><solidFill><srgbClr val="000000"/></solidFill></lnT>
      </tcPr>
    `);
    const rows: TableRow[] = [
      {
        height: 100,
        cells: [
          { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false, properties: tcPrXml },
        ],
      },
    ];
    const el = renderTable(makeTable({ columns: [400], rows }), makeCtx());
    const td = el.querySelector('td')!;
    expect(td.style.borderTop).not.toBe('');
  });

  it('applies vertical alignment from cell anchor attribute', () => {
    const tcPrXml = parseXml('<tcPr anchor="ctr"/>');
    const rows: TableRow[] = [
      {
        height: 100,
        cells: [
          { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false, properties: tcPrXml },
        ],
      },
    ];
    const el = renderTable(makeTable({ columns: [400], rows }), makeCtx());
    const td = el.querySelector('td')!;
    expect(td.style.verticalAlign).toBe('middle');
  });

  it('applies default padding when no margin attributes', () => {
    const tcPrXml = parseXml('<tcPr/>');
    const rows: TableRow[] = [
      {
        height: 100,
        cells: [
          { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false, properties: tcPrXml },
        ],
      },
    ];
    const el = renderTable(makeTable({ columns: [400], rows }), makeCtx());
    const td = el.querySelector('td')!;
    // Default margin is 91440 EMU ≈ 9.6px
    expect(parseFloat(td.style.paddingLeft)).toBeCloseTo(9.6, 0);
  });

  it('applies cell border with solid fill line', () => {
    const tcPrXml = parseXml(`
      <tcPr>
        <lnB w="25400"><solidFill><srgbClr val="0000FF"/></solidFill></lnB>
      </tcPr>
    `);
    const rows: TableRow[] = [
      {
        height: 100,
        cells: [
          { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false, properties: tcPrXml },
        ],
      },
    ];
    const el = renderTable(makeTable({ columns: [400], rows }), makeCtx());
    const td = el.querySelector('td')!;
    expect(td.style.borderBottom).not.toBe('');
  });

  it('uses percentage row heights', () => {
    const rows: TableRow[] = [
      {
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }],
      },
      {
        height: 300,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }],
      },
    ];
    const el = renderTable(makeTable({ columns: [400], rows }), makeCtx());
    const trs = el.querySelectorAll('tr');
    expect(trs[0].style.height).toBe('25%');
    expect(trs[1].style.height).toBe('75%');
  });

  describe('table style sections', () => {
    function makeCtxWithTableStyle(tblStyleXml: string): RenderContext {
      const tableStyles = parseXml(tblStyleXml);
      return makeCtx({
        presentation: { width: 960, height: 540, media: new Map(), tableStyles } as any,
      });
    }

    it('applies wholeTbl fill from table style', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{ABC}">
            <wholeTbl>
              <tcStyle>
                <fill><solidFill><srgbClr val="CCDDEE"/></solidFill></fill>
              </tcStyle>
            </wholeTbl>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{ABC}' }), ctx);
      const td = el.querySelector('td')!;
      expect(td.style.backgroundColor).not.toBe('');
    });

    it('applies firstRow style when firstRow="1" in tblPr', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{ABC}">
            <wholeTbl><tcStyle><fill><solidFill><srgbClr val="FFFFFF"/></solidFill></fill></tcStyle></wholeTbl>
            <firstRow><tcStyle><fill><solidFill><srgbClr val="FF0000"/></solidFill></fill></tcStyle></firstRow>
          </tblStyle>
        </tblStyleLst>
      `);
      const tblPr = parseXml('<tblPr firstRow="1"/>');
      const rows: TableRow[] = [
        { height: 50, cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }] },
        { height: 50, cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }] },
      ];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{ABC}', properties: tblPr }), ctx);
      const tds = el.querySelectorAll('td');
      // First row should have red fill (FF0000)
      expect(tds[0].style.backgroundColor).toBe('rgb(255, 0, 0)');
      // Second row should have white fill from wholeTbl
      expect(tds[1].style.backgroundColor).toBe('rgb(255, 255, 255)');
    });

    it('applies lastRow style when lastRow="1" in tblPr', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{ABC}">
            <wholeTbl><tcStyle><fill><solidFill><srgbClr val="FFFFFF"/></solidFill></fill></tcStyle></wholeTbl>
            <lastRow><tcStyle><fill><solidFill><srgbClr val="00FF00"/></solidFill></fill></tcStyle></lastRow>
          </tblStyle>
        </tblStyleLst>
      `);
      const tblPr = parseXml('<tblPr lastRow="1"/>');
      const rows: TableRow[] = [
        { height: 50, cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }] },
        { height: 50, cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }] },
      ];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{ABC}', properties: tblPr }), ctx);
      const tds = el.querySelectorAll('td');
      expect(tds[1].style.backgroundColor).toBe('rgb(0, 255, 0)');
    });

    it('applies firstCol style when firstCol="1" in tblPr', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{ABC}">
            <wholeTbl><tcStyle><fill><solidFill><srgbClr val="FFFFFF"/></solidFill></fill></tcStyle></wholeTbl>
            <firstCol><tcStyle><fill><solidFill><srgbClr val="0000FF"/></solidFill></fill></tcStyle></firstCol>
          </tblStyle>
        </tblStyleLst>
      `);
      const tblPr = parseXml('<tblPr firstCol="1"/>');
      const rows: TableRow[] = [
        { height: 100, cells: [
          { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false },
          { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false },
        ]},
      ];
      const el = renderTable(makeTable({ columns: [200, 200], rows, tableStyleId: '{ABC}', properties: tblPr }), ctx);
      const tds = el.querySelectorAll('td');
      expect(tds[0].style.backgroundColor).toBe('rgb(0, 0, 255)');
      expect(tds[1].style.backgroundColor).toBe('rgb(255, 255, 255)');
    });

    it('applies tcTxStyle text color from table style section', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{ABC}">
            <firstRow>
              <tcTxStyle><srgbClr val="FFFFFF"/></tcTxStyle>
              <tcStyle><fill><solidFill><srgbClr val="000000"/></solidFill></fill></tcStyle>
            </firstRow>
          </tblStyle>
        </tblStyleLst>
      `);
      const tblPr = parseXml('<tblPr firstRow="1"/>');
      const rows: TableRow[] = [{
        height: 100,
        cells: [{
          gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false,
          textBody: { paragraphs: [{ runs: [{ text: 'Header' }], level: 0 }] },
        }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{ABC}', properties: tblPr }), ctx);
      const td = el.querySelector('td')!;
      // Cell should have text rendered
      expect(td.textContent).toContain('Header');
    });

    it('applies table background from tblBg solidFill', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{ABC}">
            <tblBg><solidFill><srgbClr val="FFFFCC"/></solidFill></tblBg>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{ABC}' }), ctx);
      const table = el.querySelector('table')!;
      expect(table.style.backgroundColor).toBe('rgb(255, 255, 204)');
    });

    it('applies style borders from tcBdr', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{ABC}">
            <wholeTbl>
              <tcStyle>
                <tcBdr>
                  <top><ln w="25400"><solidFill><srgbClr val="000000"/></solidFill></ln></top>
                  <bottom><ln w="25400"><solidFill><srgbClr val="000000"/></solidFill></ln></bottom>
                </tcBdr>
              </tcStyle>
            </wholeTbl>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{ABC}' }), ctx);
      const td = el.querySelector('td')!;
      expect(td.style.borderTop).not.toBe('');
      expect(td.style.borderBottom).not.toBe('');
    });

    it('applies noFill border from style', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{ABC}">
            <wholeTbl>
              <tcStyle>
                <tcBdr>
                  <top><ln><noFill/></ln></top>
                </tcBdr>
              </tcStyle>
            </wholeTbl>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{ABC}' }), ctx);
      const td = el.querySelector('td')!;
      // borderTop should not be set when noFill
      expect(td.style.borderTop).toBe('');
    });

    it('applies custom cell margins', () => {
      const tcPrXml = parseXml('<tcPr marL="182880" marR="182880" marT="91440" marB="91440"/>');
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false, properties: tcPrXml }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows }), makeCtx());
      const td = el.querySelector('td')!;
      // 182880 EMU ≈ 19.2px
      expect(parseFloat(td.style.paddingLeft)).toBeCloseTo(19.2, 0);
      expect(parseFloat(td.style.paddingRight)).toBeCloseTo(19.2, 0);
    });

    it('renders cell text body', () => {
      const rows: TableRow[] = [{
        height: 100,
        cells: [{
          gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false,
          textBody: { paragraphs: [{ runs: [{ text: 'Cell Text' }], level: 0 }] },
        }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows }), makeCtx());
      const td = el.querySelector('td')!;
      expect(td.textContent).toContain('Cell Text');
    });

    // -----------------------------------------------------------------------
    // getEffectiveTableStyleTextColor — alpha < 1 branch (rgba return)
    // -----------------------------------------------------------------------

    it('getEffectiveTableStyleTextColor: returns rgba when tcTxStyle color has alpha modifier', () => {
      // Use schemeClr with alpha modifier so alpha < 1, triggering the rgba path
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{ALPHA}">
            <firstRow>
              <tcTxStyle>
                <schemeClr val="dk1"><alpha val="50000"/></schemeClr>
              </tcTxStyle>
              <tcStyle><fill><solidFill><srgbClr val="000000"/></solidFill></fill></tcStyle>
            </firstRow>
          </tblStyle>
        </tblStyleLst>
      `);
      const tblPr = parseXml('<tblPr firstRow="1"/>');
      // Cell must have textBody so renderTextBody is called and the color is actually exercised
      const rows: TableRow[] = [{
        height: 100,
        cells: [{
          gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false,
          textBody: { paragraphs: [{ runs: [{ text: 'Alpha Text' }], level: 0 }] },
        }],
      }];
      const el = renderTable(
        makeTable({ columns: [400], rows, tableStyleId: '{ALPHA}', properties: tblPr }),
        ctx,
      );
      // The test exercises the rgba branch inside getEffectiveTableStyleTextColor.
      // We can only verify the cell renders without throwing (the color is passed to
      // renderTextBody as cellTextColor which applies it inline).
      const td = el.querySelector('td')!;
      expect(td).not.toBeNull();
      expect(td.textContent).toContain('Alpha Text');
    });

    it('getEffectiveTableStyleTextColor: uses srgbClr directly in tcTxStyle', () => {
      // srgbClr at the tcTxStyle level (not nested under solidFill)
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{SRGB}">
            <wholeTbl>
              <tcTxStyle><srgbClr val="FF0000"/></tcTxStyle>
              <tcStyle><fill><solidFill><srgbClr val="000000"/></solidFill></fill></tcStyle>
            </wholeTbl>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{
          gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false,
          textBody: { paragraphs: [{ runs: [{ text: 'Red Text' }], level: 0 }] },
        }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{SRGB}' }), ctx);
      const td = el.querySelector('td')!;
      expect(td.textContent).toContain('Red Text');
    });

    it('getEffectiveTableStyleTextColor: skips sections with no tcTxStyle and returns undefined for empty sections', () => {
      // Sections exist but none have tcTxStyle — returns undefined, no crash
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{NOTXSTYLE}">
            <wholeTbl>
              <tcStyle><fill><solidFill><srgbClr val="AABBCC"/></solidFill></fill></tcStyle>
            </wholeTbl>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{
          gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false,
          textBody: { paragraphs: [{ runs: [{ text: 'Plain' }], level: 0 }] },
        }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{NOTXSTYLE}' }), ctx);
      const td = el.querySelector('td')!;
      // Rendered without error; no cellTextColor override applied
      expect(td.textContent).toContain('Plain');
    });

    // -----------------------------------------------------------------------
    // applyStyleFill — fillRef path
    // -----------------------------------------------------------------------

    it('applyStyleFill: applies fillRef color from table style tcStyle', () => {
      // fillRef contains a color child element — resolveColor reads it
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{FILLREF}">
            <wholeTbl>
              <tcStyle>
                <fill>
                  <fillRef idx="1"><srgbClr val="CC8800"/></fillRef>
                </fill>
              </tcStyle>
            </wholeTbl>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{FILLREF}' }), ctx);
      const td = el.querySelector('td')!;
      // fillRef resolves srgbClr CC8800 = rgb(204,136,0)
      expect(td.style.backgroundColor).toBe('rgb(204, 136, 0)');
    });

    it('applyStyleFill: applies fillRef with alpha < 1 as rgba background', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{FILLREF_ALPHA}">
            <wholeTbl>
              <tcStyle>
                <fill>
                  <fillRef idx="1">
                    <srgbClr val="FF0000"><alpha val="50000"/></srgbClr>
                  </fillRef>
                </fill>
              </tcStyle>
            </wholeTbl>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{FILLREF_ALPHA}' }), ctx);
      const td = el.querySelector('td')!;
      // alpha=50000 → 0.5 → rgba
      expect(td.style.backgroundColor).toMatch(/rgba\(255,\s*0,\s*0,\s*0\.5/);
    });

    it('applyStyleFill: noFill within tcStyle fill does not set background', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{NOFILL}">
            <wholeTbl>
              <tcStyle>
                <fill><noFill/></fill>
              </tcStyle>
            </wholeTbl>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{NOFILL}' }), ctx);
      const td = el.querySelector('td')!;
      // noFill returns true but sets no backgroundColor
      expect(td.style.backgroundColor).toBe('');
    });

    it('applyStyleFill: solidFill with alpha < 1 sets rgba background', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{SOLID_ALPHA}">
            <wholeTbl>
              <tcStyle>
                <fill>
                  <solidFill>
                    <srgbClr val="0000FF"><alpha val="50000"/></srgbClr>
                  </solidFill>
                </fill>
              </tcStyle>
            </wholeTbl>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{SOLID_ALPHA}' }), ctx);
      const td = el.querySelector('td')!;
      expect(td.style.backgroundColor).toMatch(/rgba\(0,\s*0,\s*255,\s*0\.5/);
    });

    // -----------------------------------------------------------------------
    // applyStyleBorders — insideH and insideV mapping
    // -----------------------------------------------------------------------

    it('applyStyleBorders: insideH maps to borderBottom for non-last rows and borderTop for non-first rows', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{INSIDE_H}">
            <wholeTbl>
              <tcStyle>
                <tcBdr>
                  <insideH><ln w="25400"><solidFill><srgbClr val="FF0000"/></solidFill></ln></insideH>
                </tcBdr>
              </tcStyle>
            </wholeTbl>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [
        { height: 50, cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }] },
        { height: 50, cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }] },
        { height: 50, cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }] },
      ];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{INSIDE_H}' }), ctx);
      const tds = el.querySelectorAll('td');
      // Row 0 (not last): gets borderBottom from insideH
      expect(tds[0].style.borderBottom).not.toBe('');
      // Row 0 (first row): no borderTop from insideH
      expect(tds[0].style.borderTop).toBe('');
      // Row 1 (middle): gets both borderBottom and borderTop from insideH
      expect(tds[1].style.borderBottom).not.toBe('');
      expect(tds[1].style.borderTop).not.toBe('');
      // Row 2 (last): no borderBottom from insideH, but gets borderTop
      expect(tds[2].style.borderBottom).toBe('');
      expect(tds[2].style.borderTop).not.toBe('');
    });

    it('applyStyleBorders: insideV maps to borderRight for non-last cols and borderLeft for non-first cols', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{INSIDE_V}">
            <wholeTbl>
              <tcStyle>
                <tcBdr>
                  <insideV><ln w="25400"><solidFill><srgbClr val="0000FF"/></solidFill></ln></insideV>
                </tcBdr>
              </tcStyle>
            </wholeTbl>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [
          { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false },
          { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false },
          { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false },
        ],
      }];
      const el = renderTable(makeTable({ columns: [133, 133, 134], rows, tableStyleId: '{INSIDE_V}' }), ctx);
      const tds = el.querySelectorAll('td');
      // Col 0 (not last): gets borderRight, no borderLeft
      expect(tds[0].style.borderRight).not.toBe('');
      expect(tds[0].style.borderLeft).toBe('');
      // Col 1 (middle): gets both borderRight and borderLeft
      expect(tds[1].style.borderRight).not.toBe('');
      expect(tds[1].style.borderLeft).not.toBe('');
      // Col 2 (last): no borderRight, gets borderLeft
      expect(tds[2].style.borderRight).toBe('');
      expect(tds[2].style.borderLeft).not.toBe('');
    });

    // -----------------------------------------------------------------------
    // applyStyleBorders — lnRef path
    // -----------------------------------------------------------------------

    it('applyStyleBorders: lnRef with idx=0 skips border (no line)', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{LNREF_ZERO}">
            <wholeTbl>
              <tcStyle>
                <tcBdr>
                  <top><lnRef idx="0"><srgbClr val="FF0000"/></lnRef></top>
                </tcBdr>
              </tcStyle>
            </wholeTbl>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{LNREF_ZERO}' }), ctx);
      const td = el.querySelector('td')!;
      expect(td.style.borderTop).toBe('');
    });

    it('applyStyleBorders: lnRef with idx >= 1 resolves color and sets border', () => {
      // Set up a theme with a lineStyle so the lnRef width lookup works
      const tableStyles = parseXml(`
        <tblStyleLst>
          <tblStyle styleId="{LNREF_ONE}">
            <wholeTbl>
              <tcStyle>
                <tcBdr>
                  <top><lnRef idx="1"><srgbClr val="008800"/></lnRef></top>
                </tcBdr>
              </tcStyle>
            </wholeTbl>
          </tblStyle>
        </tblStyleLst>
      `);
      // Provide a lineStyle entry at index 0 (idx-1) for the theme
      const themeLnXml = parseXml('<ln w="25400"/>');
      const ctx = makeCtx({
        presentation: { width: 960, height: 540, media: new Map(), tableStyles } as any,
        theme: {
          colorScheme: new Map([['dk1', '000000'], ['lt1', 'FFFFFF'], ['accent1', '4472C4']]),
          majorFont: { latin: 'Calibri', ea: '', cs: '' },
          minorFont: { latin: 'Calibri', ea: '', cs: '' },
          fillStyles: [],
          lineStyles: [themeLnXml],
          effectStyles: [],
        },
        master: {
          colorMap: new Map([['tx1', 'dk1'], ['bg1', 'lt1']]),
          textStyles: {},
          placeholders: [],
          spTree: emptyXml,
          rels: new Map(),
        } as any,
      });
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{LNREF_ONE}' }), ctx);
      const td = el.querySelector('td')!;
      expect(td.style.borderTop).not.toBe('');
      // Should contain the resolved color rgb(0,136,0)
      expect(td.style.borderTop).toContain('rgb(0, 136, 0)');
    });

    it('applyStyleBorders: lnRef with idx >= 1 and no matching theme lineStyle uses 1px default', () => {
      // lineStyles array is empty — falls back to default 1px
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{LNREF_NOTHEME}">
            <wholeTbl>
              <tcStyle>
                <tcBdr>
                  <top><lnRef idx="1"><srgbClr val="AA0000"/></lnRef></top>
                </tcBdr>
              </tcStyle>
            </wholeTbl>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{LNREF_NOTHEME}' }), ctx);
      const td = el.querySelector('td')!;
      // Should still produce a border with default 1px
      expect(td.style.borderTop).not.toBe('');
      expect(td.style.borderTop).toContain('solid');
    });

    it('applyStyleBorders: lnRef with alpha < 1 resolves rgba color for border', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{LNREF_ALPHA}">
            <wholeTbl>
              <tcStyle>
                <tcBdr>
                  <top>
                    <lnRef idx="1">
                      <srgbClr val="FF0000"><alpha val="50000"/></srgbClr>
                    </lnRef>
                  </top>
                </tcBdr>
              </tcStyle>
            </wholeTbl>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{LNREF_ALPHA}' }), ctx);
      const td = el.querySelector('td')!;
      // Border should contain rgba for the semi-transparent color
      expect(td.style.borderTop).toMatch(/rgba/);
    });

    // -----------------------------------------------------------------------
    // applyCellProperties — alpha < 1 solidFill branch
    // -----------------------------------------------------------------------

    it('applyCellProperties: solidFill with alpha < 1 sets rgba background', () => {
      // alpha=50000 → 0.5
      const tcPrXml = parseXml(`
        <tcPr>
          <solidFill>
            <srgbClr val="FF0000"><alpha val="50000"/></srgbClr>
          </solidFill>
        </tcPr>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false, properties: tcPrXml }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows }), makeCtx());
      const td = el.querySelector('td')!;
      expect(td.style.backgroundColor).toMatch(/rgba\(255,\s*0,\s*0,\s*0\.5/);
    });

    // -----------------------------------------------------------------------
    // applyCellProperties — vertical alignment variants
    // -----------------------------------------------------------------------

    it('applyCellProperties: anchor="t" maps to top vertical alignment', () => {
      const tcPrXml = parseXml('<tcPr anchor="t"/>');
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false, properties: tcPrXml }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows }), makeCtx());
      const td = el.querySelector('td')!;
      expect(td.style.verticalAlign).toBe('top');
    });

    it('applyCellProperties: anchor="b" maps to bottom vertical alignment', () => {
      const tcPrXml = parseXml('<tcPr anchor="b"/>');
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false, properties: tcPrXml }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows }), makeCtx());
      const td = el.querySelector('td')!;
      expect(td.style.verticalAlign).toBe('bottom');
    });

    it('applyCellProperties: unknown anchor value defaults to top', () => {
      const tcPrXml = parseXml('<tcPr anchor="unknown_value"/>');
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false, properties: tcPrXml }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows }), makeCtx());
      const td = el.querySelector('td')!;
      expect(td.style.verticalAlign).toBe('top');
    });

    // -----------------------------------------------------------------------
    // applyBorder — noFill clears existing border
    // -----------------------------------------------------------------------

    it('applyBorder: noFill in lnT overrides a table-style-set borderTop (jsdom normalizes "none" to "")', () => {
      // Table style sets borderTop via wholeTbl tcBdr; cell tcPr lnT noFill should clear it.
      // jsdom normalizes td.style.borderTop = 'none' to '' (empty string).
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{BORDER_CLEAR}">
            <wholeTbl>
              <tcStyle>
                <tcBdr>
                  <top><ln w="25400"><solidFill><srgbClr val="000000"/></solidFill></ln></top>
                </tcBdr>
              </tcStyle>
            </wholeTbl>
          </tblStyle>
        </tblStyleLst>
      `);
      // First verify: without cell noFill override, the border is set from the table style
      const rowsWithBorder: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }],
      }];
      const elWithBorder = renderTable(makeTable({ columns: [400], rows: rowsWithBorder, tableStyleId: '{BORDER_CLEAR}' }), ctx);
      expect(elWithBorder.querySelector('td')!.style.borderTop).not.toBe('');

      // Now with cell-level lnT noFill: the noFill branch executes and sets borderTop='none'
      // which jsdom normalizes to '' — clearing the previously set style-border
      const tcPrXml = parseXml('<tcPr><lnT><noFill/></lnT></tcPr>');
      const rowsWithNoFill: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false, properties: tcPrXml }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows: rowsWithNoFill, tableStyleId: '{BORDER_CLEAR}' }), ctx);
      const td = el.querySelector('td')!;
      // jsdom normalizes 'none' to '' — the border is effectively cleared
      expect(td.style.borderTop).toBe('');
    });

    it('applyBorder: noFill in lnB executes noFill branch (jsdom normalizes "none" to "")', () => {
      const tcPrXml = parseXml('<tcPr><lnB><noFill/></lnB></tcPr>');
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false, properties: tcPrXml }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows }), makeCtx());
      const td = el.querySelector('td')!;
      // jsdom normalizes 'none' → ''; the code path is executed (returns early without setting a border)
      expect(td.style.borderBottom).toBe('');
    });

    it('applyBorder: noFill in lnL executes noFill branch (jsdom normalizes "none" to "")', () => {
      const tcPrXml = parseXml('<tcPr><lnL><noFill/></lnL></tcPr>');
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false, properties: tcPrXml }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows }), makeCtx());
      const td = el.querySelector('td')!;
      expect(td.style.borderLeft).toBe('');
    });

    it('applyBorder: noFill in lnR executes noFill branch (jsdom normalizes "none" to "")', () => {
      const tcPrXml = parseXml('<tcPr><lnR><noFill/></lnR></tcPr>');
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false, properties: tcPrXml }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows }), makeCtx());
      const td = el.querySelector('td')!;
      expect(td.style.borderRight).toBe('');
    });

    // -----------------------------------------------------------------------
    // lastCol style
    // -----------------------------------------------------------------------

    it('applies lastCol style when lastCol="1" in tblPr', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{LASTCOL}">
            <wholeTbl><tcStyle><fill><solidFill><srgbClr val="FFFFFF"/></solidFill></fill></tcStyle></wholeTbl>
            <lastCol><tcStyle><fill><solidFill><srgbClr val="800000"/></solidFill></fill></tcStyle></lastCol>
          </tblStyle>
        </tblStyleLst>
      `);
      const tblPr = parseXml('<tblPr lastCol="1"/>');
      const rows: TableRow[] = [{
        height: 100,
        cells: [
          { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false },
          { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false },
        ],
      }];
      const el = renderTable(makeTable({ columns: [200, 200], rows, tableStyleId: '{LASTCOL}', properties: tblPr }), ctx);
      const tds = el.querySelectorAll('td');
      // Last column (index 1) gets the lastCol fill rgb(128,0,0)
      expect(tds[1].style.backgroundColor).toBe('rgb(128, 0, 0)');
      // First column gets wholeTbl white fill
      expect(tds[0].style.backgroundColor).toBe('rgb(255, 255, 255)');
    });

    // -----------------------------------------------------------------------
    // Band row/col styling
    // -----------------------------------------------------------------------

    it('applies band1H and band2H banding to alternating rows', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{BANDROW}">
            <band1H><tcStyle><fill><solidFill><srgbClr val="EEEEEE"/></solidFill></fill></tcStyle></band1H>
            <band2H><tcStyle><fill><solidFill><srgbClr val="CCCCCC"/></solidFill></fill></tcStyle></band2H>
          </tblStyle>
        </tblStyleLst>
      `);
      const tblPr = parseXml('<tblPr bandRow="1"/>');
      const rows: TableRow[] = [
        { height: 50, cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }] },
        { height: 50, cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }] },
        { height: 50, cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }] },
        { height: 50, cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }] },
      ];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{BANDROW}', properties: tblPr }), ctx);
      const tds = el.querySelectorAll('td');
      // Row 0 → effectiveRow 0 → even → band1H → rgb(238,238,238)
      expect(tds[0].style.backgroundColor).toBe('rgb(238, 238, 238)');
      // Row 1 → effectiveRow 1 → odd → band2H → rgb(204,204,204)
      expect(tds[1].style.backgroundColor).toBe('rgb(204, 204, 204)');
      // Row 2 → effectiveRow 2 → even → band1H
      expect(tds[2].style.backgroundColor).toBe('rgb(238, 238, 238)');
      // Row 3 → effectiveRow 3 → odd → band2H
      expect(tds[3].style.backgroundColor).toBe('rgb(204, 204, 204)');
    });

    it('applies band1V and band2V banding to alternating columns', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{BANDCOL}">
            <band1V><tcStyle><fill><solidFill><srgbClr val="DDDDDD"/></solidFill></fill></tcStyle></band1V>
            <band2V><tcStyle><fill><solidFill><srgbClr val="BBBBBB"/></solidFill></fill></tcStyle></band2V>
          </tblStyle>
        </tblStyleLst>
      `);
      const tblPr = parseXml('<tblPr bandCol="1"/>');
      const rows: TableRow[] = [{
        height: 100,
        cells: [
          { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false },
          { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false },
          { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false },
          { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false },
        ],
      }];
      const el = renderTable(makeTable({ columns: [100, 100, 100, 100], rows, tableStyleId: '{BANDCOL}', properties: tblPr }), ctx);
      const tds = el.querySelectorAll('td');
      // Col 0 → even → band1V → rgb(221,221,221)
      expect(tds[0].style.backgroundColor).toBe('rgb(221, 221, 221)');
      // Col 1 → odd → band2V → rgb(187,187,187)
      expect(tds[1].style.backgroundColor).toBe('rgb(187, 187, 187)');
      // Col 2 → even → band1V
      expect(tds[2].style.backgroundColor).toBe('rgb(221, 221, 221)');
      // Col 3 → odd → band2V
      expect(tds[3].style.backgroundColor).toBe('rgb(187, 187, 187)');
    });

    // -----------------------------------------------------------------------
    // tblBg — fillRef path (theme fill reference)
    // -----------------------------------------------------------------------

    it('applies table background from tblBg fillRef color', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{TBLBG_FILLREF}">
            <tblBg><fillRef idx="1"><srgbClr val="334455"/></fillRef></tblBg>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{TBLBG_FILLREF}' }), ctx);
      const table = el.querySelector('table')!;
      // 33=51, 44=68, 55=85
      expect(table.style.backgroundColor).toBe('rgb(51, 68, 85)');
    });

    it('applies table background from tblBg solidFill with alpha < 1 as rgba', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{TBLBG_ALPHA}">
            <tblBg>
              <solidFill>
                <srgbClr val="FF8800"><alpha val="50000"/></srgbClr>
              </solidFill>
            </tblBg>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{TBLBG_ALPHA}' }), ctx);
      const table = el.querySelector('table')!;
      expect(table.style.backgroundColor).toMatch(/rgba/);
    });

    it('applies tblBg fillRef with alpha < 1 as rgba table background', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{TBLBG_FILLREF_ALPHA}">
            <tblBg>
              <fillRef idx="1">
                <srgbClr val="001122"><alpha val="50000"/></srgbClr>
              </fillRef>
            </tblBg>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{TBLBG_FILLREF_ALPHA}' }), ctx);
      const table = el.querySelector('table')!;
      expect(table.style.backgroundColor).toMatch(/rgba/);
    });

    // -----------------------------------------------------------------------
    // Edge cases
    // -----------------------------------------------------------------------

    it('handles no tableStyleId gracefully (no tblStyle lookup)', () => {
      // No tableStyleId set — tblStyle is undefined, sections is empty
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows }), makeCtx());
      const td = el.querySelector('td')!;
      expect(td).not.toBeNull();
      expect(td.style.backgroundColor).toBe('');
    });

    it('handles tableStyleId that does not match any style', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{OTHER}">
            <wholeTbl><tcStyle><fill><solidFill><srgbClr val="FF0000"/></solidFill></fill></tcStyle></wholeTbl>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }],
      }];
      // Uses tableStyleId '{NOTFOUND}' which has no match in the style list
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{NOTFOUND}' }), ctx);
      const td = el.querySelector('td')!;
      expect(td.style.backgroundColor).toBe('');
    });

    it('handles cell with no properties (tcPr is undefined)', () => {
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows }), makeCtx());
      const td = el.querySelector('td')!;
      // No crash, no border/background set from direct properties
      expect(td).not.toBeNull();
    });

    it('handles tblBg with neither fillRef nor solidFill (no background applied)', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{EMPTY_TBLBG}">
            <tblBg></tblBg>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{EMPTY_TBLBG}' }), ctx);
      const table = el.querySelector('table')!;
      expect(table.style.backgroundColor).toBe('');
    });

    it('handles tcStyle with no fill element (applyStyleFill returns false)', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{NO_FILL_ELEM}">
            <wholeTbl>
              <tcStyle>
                <tcBdr/>
              </tcStyle>
            </wholeTbl>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{NO_FILL_ELEM}' }), ctx);
      const td = el.querySelector('td')!;
      expect(td.style.backgroundColor).toBe('');
    });

    // -----------------------------------------------------------------------
    // Remaining branch coverage
    // -----------------------------------------------------------------------

    // flag() child-element path (lines 68-72): tblPr uses child elements instead of attributes
    it('flag() child-element fallback: firstRow child element (without val="0") enables firstRow style', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{FLAG_CHILD}">
            <wholeTbl><tcStyle><fill><solidFill><srgbClr val="FFFFFF"/></solidFill></fill></tcStyle></wholeTbl>
            <firstRow><tcStyle><fill><solidFill><srgbClr val="FF0000"/></solidFill></fill></tcStyle></firstRow>
          </tblStyle>
        </tblStyleLst>
      `);
      // tblPr uses a <firstRow/> child element instead of firstRow="1" attribute
      const tblPr = parseXml('<tblPr><firstRow/></tblPr>');
      const rows: TableRow[] = [
        { height: 50, cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }] },
        { height: 50, cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }] },
      ];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{FLAG_CHILD}', properties: tblPr }), ctx);
      const tds = el.querySelectorAll('td');
      // firstRow child element enables the firstRow style — first cell gets red fill
      expect(tds[0].style.backgroundColor).toBe('rgb(255, 0, 0)');
    });

    it('flag() child-element fallback: firstRow child with val="0" disables firstRow style', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{FLAG_CHILD_ZERO}">
            <wholeTbl><tcStyle><fill><solidFill><srgbClr val="AABBCC"/></solidFill></fill></tcStyle></wholeTbl>
            <firstRow><tcStyle><fill><solidFill><srgbClr val="FF0000"/></solidFill></fill></tcStyle></firstRow>
          </tblStyle>
        </tblStyleLst>
      `);
      // <firstRow val="0"/> should be treated as disabled
      const tblPr = parseXml('<tblPr><firstRow val="0"/></tblPr>');
      const rows: TableRow[] = [
        { height: 50, cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }] },
      ];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{FLAG_CHILD_ZERO}', properties: tblPr }), ctx);
      const tds = el.querySelectorAll('td');
      // firstRow disabled: uses wholeTbl fill (AABBCC = rgb(170,187,204))
      expect(tds[0].style.backgroundColor).toBe('rgb(170, 187, 204)');
    });

    // getEffectiveTableStyleTextColor: tcTxStyle exists but has no recognized color child (line 159)
    it('getEffectiveTableStyleTextColor: returns undefined when tcTxStyle has no recognized color child', () => {
      // tcTxStyle contains only unrecognized elements → loop finds nothing → returns undefined
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{TXSTYLE_NOCOLOR}">
            <wholeTbl>
              <tcTxStyle><unknownElement val="whatever"/></tcTxStyle>
              <tcStyle><fill><solidFill><srgbClr val="CCCCCC"/></solidFill></fill></tcStyle>
            </wholeTbl>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{
          gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false,
          textBody: { paragraphs: [{ runs: [{ text: 'NoColor' }], level: 0 }] },
        }],
      }];
      // Should render without error; cellTextColor is undefined (no recognized color)
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{TXSTYLE_NOCOLOR}' }), ctx);
      const td = el.querySelector('td')!;
      expect(td.textContent).toContain('NoColor');
    });

    // applyStyleFill: fill element exists but has none of solidFill/fillRef/noFill (line 208)
    it('applyStyleFill: fill with unknown child returns false and sets no background', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{FILL_UNKNOWN}">
            <wholeTbl>
              <tcStyle>
                <fill><unknownFillType/></fill>
              </tcStyle>
            </wholeTbl>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{FILL_UNKNOWN}' }), ctx);
      const td = el.querySelector('td')!;
      // No backgroundColor set — applyStyleFill returned false
      expect(td.style.backgroundColor).toBe('');
    });

    // -----------------------------------------------------------------------
    // tcTxStyle bold and italic (CT_TableStyleTextStyle b/i attributes)
    // -----------------------------------------------------------------------

    it('tcTxStyle b="on" applies bold to cell text', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{BOLD}">
            <firstRow>
              <tcTxStyle b="on"><srgbClr val="FFFFFF"/></tcTxStyle>
              <tcStyle><fill><solidFill><srgbClr val="333333"/></solidFill></fill></tcStyle>
            </firstRow>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false,
          textBody: { paragraphs: [{ runs: [{ text: 'Bold Header' }], level: 0 }] } as any }],
      }];
      const tblPr = parseXml('<tblPr firstRow="1"/>');
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{BOLD}', properties: tblPr }), ctx);
      const span = el.querySelector('span');
      expect(span).not.toBeNull();
      expect(span!.style.fontWeight).toBe('bold');
    });

    it('tcTxStyle i="on" applies italic to cell text', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{ITALIC}">
            <firstRow>
              <tcTxStyle i="on"><srgbClr val="FFFFFF"/></tcTxStyle>
              <tcStyle><fill><solidFill><srgbClr val="333333"/></solidFill></fill></tcStyle>
            </firstRow>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false,
          textBody: { paragraphs: [{ runs: [{ text: 'Italic Header' }], level: 0 }] } as any }],
      }];
      const tblPr = parseXml('<tblPr firstRow="1"/>');
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{ITALIC}', properties: tblPr }), ctx);
      const span = el.querySelector('span');
      expect(span).not.toBeNull();
      expect(span!.style.fontStyle).toBe('italic');
    });

    it('tcTxStyle bold does not apply when run has explicit b="1" in rPr', () => {
      // Run rPr explicitly sets bold off — should NOT be overridden by tcTxStyle
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{BOLD_OVERRIDE}">
            <firstRow>
              <tcTxStyle b="on"><srgbClr val="FFFFFF"/></tcTxStyle>
              <tcStyle><fill><solidFill><srgbClr val="333333"/></solidFill></fill></tcStyle>
            </firstRow>
          </tblStyle>
        </tblStyleLst>
      `);
      const rPr = parseXml('<rPr b="0"/>');
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false,
          textBody: { paragraphs: [{ runs: [{ text: 'Not Bold', properties: rPr }], level: 0 }] } as any }],
      }];
      const tblPr = parseXml('<tblPr firstRow="1"/>');
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{BOLD_OVERRIDE}', properties: tblPr }), ctx);
      const span = el.querySelector('span');
      expect(span).not.toBeNull();
      // Explicit rPr b="0" should win — not bold
      expect(span!.style.fontWeight).not.toBe('bold');
    });

    it('tcTxStyle text color overrides inherited cascade color (cellTextColor priority)', () => {
      // This tests that cellTextColor wins over inherited color from master text styles
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{COLOR_PRIO}">
            <firstRow>
              <tcTxStyle><srgbClr val="FFFFFF"/></tcTxStyle>
              <tcStyle><fill><solidFill><srgbClr val="000000"/></solidFill></fill></tcStyle>
            </firstRow>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false,
          textBody: { paragraphs: [{ runs: [{ text: 'White Text' }], level: 0 }] } as any }],
      }];
      const tblPr = parseXml('<tblPr firstRow="1"/>');
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{COLOR_PRIO}', properties: tblPr }), ctx);
      const span = el.querySelector('span');
      expect(span).not.toBeNull();
      // tcTxStyle color FFFFFF should be applied (white), not inherited black
      expect(span!.style.color).toBe('rgb(255, 255, 255)');
    });

    // -----------------------------------------------------------------------
    // tcTxStyle font family (font > latin/ea/cs) and fontRef
    // -----------------------------------------------------------------------

    it('tcTxStyle font > latin typeface applies font family to cell text', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{FONT_LATIN}">
            <firstRow>
              <tcTxStyle><font><latin typeface="Georgia"/></font><srgbClr val="000000"/></tcTxStyle>
              <tcStyle><fill><solidFill><srgbClr val="EEEEEE"/></solidFill></fill></tcStyle>
            </firstRow>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false,
          textBody: { paragraphs: [{ runs: [{ text: 'Latin Font' }], level: 0 }] } as any }],
      }];
      const tblPr = parseXml('<tblPr firstRow="1"/>');
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{FONT_LATIN}', properties: tblPr }), ctx);
      const span = el.querySelector('span');
      expect(span).not.toBeNull();
      expect(span!.style.fontFamily).toContain('Georgia');
    });

    it('tcTxStyle font > ea typeface applies font family when no latin font on run', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{FONT_EA}">
            <wholeTbl>
              <tcTxStyle><font><ea typeface="SimSun"/></font><srgbClr val="000000"/></tcTxStyle>
              <tcStyle><fill><solidFill><srgbClr val="EEEEEE"/></solidFill></fill></tcStyle>
            </wholeTbl>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false,
          textBody: { paragraphs: [{ runs: [{ text: '东亚字体' }], level: 0 }] } as any }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{FONT_EA}' }), ctx);
      const span = el.querySelector('span');
      expect(span).not.toBeNull();
      expect(span!.style.fontFamily).toContain('SimSun');
    });

    it('tcTxStyle fontRef idx="minor" applies theme minor font to cell text', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{FONTREF_MINOR}">
            <wholeTbl>
              <tcTxStyle><fontRef idx="minor"/><srgbClr val="000000"/></tcTxStyle>
              <tcStyle><fill><solidFill><srgbClr val="EEEEEE"/></solidFill></fill></tcStyle>
            </wholeTbl>
          </tblStyle>
        </tblStyleLst>
      `);
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false,
          textBody: { paragraphs: [{ runs: [{ text: 'Minor Font' }], level: 0 }] } as any }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{FONTREF_MINOR}' }), ctx);
      const span = el.querySelector('span');
      expect(span).not.toBeNull();
      // Theme minor font is 'Calibri' from makeCtx()
      expect(span!.style.fontFamily).toContain('Calibri');
    });

    it('tcTxStyle fontRef idx="major" applies theme major font to cell text', () => {
      // Override theme majorFont to a distinctive name
      const ctx = makeCtx({
        presentation: {
          width: 960, height: 540, media: new Map(),
          tableStyles: parseXml(`
            <tblStyleLst>
              <tblStyle styleId="{FONTREF_MAJOR}">
                <wholeTbl>
                  <tcTxStyle><fontRef idx="major"/><srgbClr val="000000"/></tcTxStyle>
                  <tcStyle><fill><solidFill><srgbClr val="EEEEEE"/></solidFill></fill></tcStyle>
                </wholeTbl>
              </tblStyle>
            </tblStyleLst>
          `),
        } as any,
        theme: {
          colorScheme: new Map([['dk1', '000000'], ['lt1', 'FFFFFF']]),
          majorFont: { latin: 'Impact', ea: '', cs: '' },
          minorFont: { latin: 'Calibri', ea: '', cs: '' },
          fillStyles: [],
          lineStyles: [],
          effectStyles: [],
        },
      });
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false,
          textBody: { paragraphs: [{ runs: [{ text: 'Major Font' }], level: 0 }] } as any }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{FONTREF_MAJOR}' }), ctx);
      const span = el.querySelector('span');
      expect(span).not.toBeNull();
      expect(span!.style.fontFamily).toContain('Impact');
    });

    it('explicit run rPr font overrides tcTxStyle font', () => {
      const ctx = makeCtxWithTableStyle(`
        <tblStyleLst>
          <tblStyle styleId="{FONT_OVERRIDE}">
            <wholeTbl>
              <tcTxStyle><font><latin typeface="Georgia"/></font><srgbClr val="000000"/></tcTxStyle>
              <tcStyle><fill><solidFill><srgbClr val="EEEEEE"/></solidFill></fill></tcStyle>
            </wholeTbl>
          </tblStyle>
        </tblStyleLst>
      `);
      const rPr = parseXml('<rPr><latin typeface="Arial"/></rPr>');
      const rows: TableRow[] = [{
        height: 100,
        cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false,
          textBody: { paragraphs: [{ runs: [{ text: 'Arial Text', properties: rPr }], level: 0 }] } as any }],
      }];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{FONT_OVERRIDE}' }), ctx);
      const span = el.querySelector('span');
      expect(span).not.toBeNull();
      // Explicit rPr latin="Arial" wins over tcTxStyle latin="Georgia"
      expect(span!.style.fontFamily).toContain('Arial');
      expect(span!.style.fontFamily).not.toContain('Georgia');
    });
  });

  // -----------------------------------------------------------------------
  // Predefined table style bold on firstRow / firstCol / lastRow / lastCol
  // -----------------------------------------------------------------------
  describe('predefined style bold', () => {
    it('Medium-Style-2 + Accent6 applies bold to firstRow cells', () => {
      // {93296810-A885-4BE3-A3E7-6D5BEEA58F35} = Medium-Style-2 + Accent6
      // Table with firstRow=1 enabled
      const ctx = makeCtx();
      const tblPr = parseXml('<tblPr firstRow="1" bandRow="1"/>');
      const rows: TableRow[] = [
        { height: 50, cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false,
          textBody: { paragraphs: [{ runs: [{ text: 'Header' }], level: 0 }] } as any }] },
        { height: 50, cells: [{ gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false,
          textBody: { paragraphs: [{ runs: [{ text: 'Body' }], level: 0 }] } as any }] },
      ];
      const el = renderTable(makeTable({ columns: [400], rows, tableStyleId: '{93296810-A885-4BE3-A3E7-6D5BEEA58F35}', properties: tblPr }), ctx);
      const tds = el.querySelectorAll('td');
      // firstRow cell should be bold
      const headerSpan = tds[0]?.querySelector('span');
      expect(headerSpan).not.toBeNull();
      expect(headerSpan!.style.fontWeight).toBe('bold');
      // body cell should NOT be bold
      const bodySpan = tds[1]?.querySelector('span');
      expect(bodySpan).not.toBeNull();
      expect(bodySpan!.style.fontWeight).not.toBe('bold');
    });

    it('Medium-Style-2 + Accent6 applies bold to firstCol cells', () => {
      const ctx = makeCtx();
      const tblPr = parseXml('<tblPr firstCol="1" bandRow="1"/>');
      const rows: TableRow[] = [
        { height: 50, cells: [
          { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false,
            textBody: { paragraphs: [{ runs: [{ text: 'Col1' }], level: 0 }] } as any },
          { gridSpan: 1, rowSpan: 1, hMerge: false, vMerge: false,
            textBody: { paragraphs: [{ runs: [{ text: 'Col2' }], level: 0 }] } as any },
        ] },
      ];
      const el = renderTable(makeTable({ columns: [200, 200], rows, tableStyleId: '{93296810-A885-4BE3-A3E7-6D5BEEA58F35}', properties: tblPr }), ctx);
      const tds = el.querySelectorAll('td');
      // firstCol cell should be bold
      const col1Span = tds[0]?.querySelector('span');
      expect(col1Span!.style.fontWeight).toBe('bold');
      // second col should NOT be bold
      const col2Span = tds[1]?.querySelector('span');
      expect(col2Span!.style.fontWeight).not.toBe('bold');
    });
  });
});
