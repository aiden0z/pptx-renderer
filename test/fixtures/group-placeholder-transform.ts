import type { PptxFiles } from '../../src/parser/ZipParser';

export const namespaces =
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

export function transform(x: number, y: number, w: number, h: number): string {
  return `<a:off x="${x * 9525}" y="${y * 9525}"/><a:ext cx="${w * 9525}" cy="${h * 9525}"/>`;
}

export function groupXml(
  components: string | null = transform(200, 100, 240, 120),
  placeholder = true,
): string {
  const children = [
    ['3', 'First', 20, 30, 'FF0000'],
    ['4', 'Second', 70, 50, '0000FF'],
  ] as const;
  return `<p:grpSp ${namespaces}>
    <p:nvGrpSpPr><p:cNvPr id="2" name="Group"/><p:cNvGrpSpPr/>
      <p:nvPr>${placeholder ? '<p:ph type="obj" idx="7"/>' : ''}</p:nvPr>
    </p:nvGrpSpPr>
    <p:grpSpPr>${components === null ? '' : `<a:xfrm>${components}<a:chOff x="95250" y="190500"/><a:chExt cx="1143000" cy="571500"/></a:xfrm>`}</p:grpSpPr>
    ${children
      .map(
        ([id, name, x, y, color]) => `<p:sp>
      <p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr><a:xfrm>${transform(x, y, 30, 10)}</a:xfrm><a:prstGeom prst="rect"/>
        <a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln>
      </p:spPr>
    </p:sp>`,
      )
      .join('')}
  </p:grpSp>`;
}

export function groupPlaceholderFiles(group = groupXml()): PptxFiles {
  const relationship = (type: string, target: string) =>
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/></Relationships>`;
  return {
    presentation: `<p:presentation ${namespaces}><p:sldSz cx="7620000" cy="5715000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`,
    presentationRels: relationship('slide', 'slides/slide1.xml'),
    slides: new Map([
      [
        'ppt/slides/slide1.xml',
        `<p:sld ${namespaces}><p:cSld><p:spTree>${group}</p:spTree></p:cSld></p:sld>`,
      ],
    ]),
    slideRels: new Map([
      [
        'ppt/slides/_rels/slide1.xml.rels',
        relationship('slideLayout', '../slideLayouts/slideLayout1.xml'),
      ],
    ]),
    slideLayouts: new Map([
      [
        'ppt/slideLayouts/slideLayout1.xml',
        `<p:sldLayout ${namespaces}><p:cSld><p:spTree><p:sp>
      <p:nvSpPr><p:cNvPr id="9" name="Template"/><p:cNvSpPr/><p:nvPr><p:ph type="obj" idx="7"/></p:nvPr></p:nvSpPr>
      <p:spPr><a:xfrm>${transform(10, 20, 600, 300)}</a:xfrm></p:spPr>
    </p:sp></p:spTree></p:cSld></p:sldLayout>`,
      ],
    ]),
    slideLayoutRels: new Map(),
    slideMasters: new Map(),
    slideMasterRels: new Map(),
    themes: new Map(),
    media: new Map(),
    charts: new Map(),
    diagramDrawings: new Map(),
  };
}
