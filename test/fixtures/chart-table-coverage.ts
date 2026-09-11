import { parseXml } from '../../src/parser/XmlParser';
import { parseChartXml } from '../../src/renderer/ChartRenderer';
import { renderTable } from '../../src/renderer/TableRenderer';
import { parseTableNode } from '../../src/model/nodes/TableNode';
import { createMockRenderContext } from '../unit/helpers/mockContext';

export function cacheXml(kind: string, values: (number | string | null)[]): string {
  return `<c:${kind}><c:ptCount val="${values.length}"/>${values.map((v, i) => (v === null ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join('')}</c:${kind}>`;
}

export function xyChartXml(family = 'scatter', mode = 'gap', smooth = false): string {
  const source = (values: (number | null)[]) =>
    `<c:numRef>${cacheXml('numCache', values)}</c:numRef>`;
  return chartXml(
    `<c:${family}Chart>${family === 'scatter' ? `<c:scatterStyle val="${smooth ? 'smoothMarker' : 'lineMarker'}"/>` : ''}<c:ser><c:idx val="0"/><c:order val="0"/><c:xVal>${source([1, 2, 3, null, 5])}</c:xVal><c:yVal>${source([10, null, 0, 40, 50])}</c:yVal>${family === 'bubble' ? `<c:bubbleSize>${source([10, 10000, 30, 40, null])}</c:bubbleSize>` : ''}</c:ser></c:${family}Chart>`,
    mode,
  );
}

export function chartXml(plot: string, mode = 'gap'): string {
  return `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:autoTitleDeleted val="1"/><c:plotArea>${plot}<c:valAx><c:axId val="1"/><c:axPos val="b"/></c:valAx><c:valAx><c:axId val="2"/><c:axPos val="l"/></c:valAx></c:plotArea><c:dispBlanksAs val="${mode}"/></c:chart></c:chartSpace>`;
}

export function chartOption(xml: string) {
  return parseChartXml(parseXml(xml), createMockRenderContext()).option;
}

export function borderXml(side: string, color: string, width = 38100) {
  return `<a:${side}><a:ln w="${width}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></a:${side}>`;
}

export function tableFixture(
  styles: string,
  flags = '',
  rows = ['<a:tc/><a:tc/>', '<a:tc/><a:tc/>'],
  cols = 2,
) {
  const ctx = createMockRenderContext();
  ctx.presentation.tableStyles = parseXml(
    `<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:tblStyle styleId="coverage">${styles}</a:tblStyle></a:tblStyleLst>`,
  );
  const frame = parseXml(
    `<p:graphicFrame xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:xfrm><a:off x="0" y="0"/><a:ext cx="3810000" cy="1905000"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tblPr ${flags}><a:tableStyleId>coverage</a:tableStyleId></a:tblPr><a:tblGrid>${Array(cols).fill('<a:gridCol w="1905000"/>').join('')}</a:tblGrid>${rows.map((row) => `<a:tr h="952500">${row}</a:tr>`).join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`,
  );
  const node = parseTableNode(frame);
  return renderTable(node, ctx);
}

export function cornerStyles() {
  return [
    ['wholeTbl', 'FFFFFF'],
    ['firstRow', 'AAAAAA'],
    ['lastRow', 'BBBBBB'],
    ['firstCol', 'CCCCCC'],
    ['lastCol', 'DDDDDD'],
    ['nwCell', 'FF0000'],
    ['neCell', '00FF00'],
    ['swCell', '0000FF'],
    ['seCell', 'FFFF00'],
  ]
    .map(
      ([section, color]) =>
        `<a:${section}><a:tcStyle><a:fill><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:fill></a:tcStyle></a:${section}>`,
    )
    .join('');
}
