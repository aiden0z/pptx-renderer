import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

if (process.env.PLAYWRIGHT_CHANNEL) test.use({ channel: process.env.PLAYWRIGHT_CHANNEL });

// These tests use only the built public entry in the browser. The fixture is a real
// OPC package with relationships/content types, not an injected PresentationData.
const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const p = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const c = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const ns = `xmlns:a="${a}" xmlns:p="${p}" xmlns:r="${r}" xmlns:c="${c}"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:svg="http://schemas.microsoft.com/office/drawing/2016/SVG/main"
  xmlns:unknown="urn:unsupported:test"`;
const map =
  'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"';
const groupProps =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';
const xfrm = (x: number, y: number, w = 60, h = 40, tag = 'a:xfrm') =>
  `<${tag}><a:off x="${x * 9525}" y="${y * 9525}"/><a:ext cx="${w * 9525}" cy="${h * 9525}"/></${tag}>`;
const shape = (id: number, name: string, x: number, y: number) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(x, y)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="900"/><a:t>${name}</a:t></a:r></a:p></p:txBody></p:sp>`;
const alternate = (requires: string, choice: string, fallback: string) =>
  `<mc:AlternateContent><mc:Choice Requires="${requires}">${choice}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent>`;
const picture = (id: number, svg: boolean) =>
  `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="preview-${id}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rRaster">${svg ? '<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><svg:svgBlip r:embed="rSvg"/></a:ext></a:extLst>' : ''}</a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(10, 70)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
const frame = (
  id: number,
  name: string,
  x: number,
  content: string,
  uri: string,
  width = 90,
  height = 70,
) =>
  `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${name}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>${xfrm(x, 70, width, height, 'p:xfrm')}<a:graphic><a:graphicData uri="${uri}">${content}</a:graphicData></a:graphic></p:graphicFrame>`;
const rels = (entries: [string, string, string, boolean?][]) =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.map(([id, type, target, external]) => `<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;

async function packageBytes(chartMap: 'accent2' | 'accent1' | 'absent') {
  const zip = new JSZip();
  const template = await JSZip.loadAsync(
    await readFile('docs/example/1-chart-and-complex/source.pptx'),
  );
  let theme = await template.file('ppt/theme/theme1.xml')!.async('string');
  for (const [key, color] of [
    ['accent1', 'FF0000'],
    ['accent2', '0000FF'],
    ['accent3', '00FF00'],
    ['accent4', '888888'],
  ])
    theme = theme.replace(
      new RegExp(`<a:${key}>[\\s\\S]*?</a:${key}>`),
      `<a:${key}><a:srgbClr val="${color}"/></a:${key}>`,
    );
  zip.file('ppt/theme/theme1.xml', theme);
  const parts = [
    ['presentation', 'presentation', 'presentation'],
    ['slides/slide1', 'slide', 'slide'],
    ['slideLayouts/slideLayout1', 'slideLayout', 'slideLayout'],
    ['slideMasters/slideMaster1', 'slideMaster', 'slideMaster'],
  ];
  zip.file(
    '[Content_Types].xml',
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="svg" ContentType="image/svg+xml"/><Default Extension="png" ContentType="image/png"/>${parts.map(([path, , type]) => `<Override PartName="/ppt/${path}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${type}${type === 'presentation' ? '.main' : ''}+xml"/>`).join('')}<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`,
  );
  zip.file('_rels/.rels', rels([['rDocument', 'officeDocument', 'ppt/presentation.xml']]));
  zip.file(
    'ppt/presentation.xml',
    `<p:presentation ${ns}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rMaster"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rSlide"/></p:sldIdLst><p:sldSz cx="3810000" cy="2095500"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    rels([
      ['rMaster', 'slideMaster', 'slideMasters/slideMaster1.xml'],
      ['rSlide', 'slide', 'slides/slide1.xml'],
    ]),
  );
  zip.file(
    'ppt/slideMasters/slideMaster1.xml',
    `<p:sldMaster ${ns}><p:cSld><p:spTree>${groupProps}</p:spTree></p:cSld><p:clrMap ${map}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rLayout"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`,
  );
  zip.file(
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    rels([
      ['rTheme', 'theme', '../theme/theme1.xml'],
      ['rLayout', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
    ]),
  );
  zip.file(
    'ppt/slideLayouts/slideLayout1.xml',
    `<p:sldLayout ${ns} type="blank"><p:cSld><p:spTree>${groupProps}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
  );
  zip.file(
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    rels([['rMaster', 'slideMaster', '../slideMasters/slideMaster1.xml']]),
  );
  const ole = (svg: boolean) =>
    `<p:oleObj name="Linked preview" r:id="rOle" progId="Excel.Sheet.12"><p:link updateAutomatic="0"/>${picture(9, svg)}</p:oleObj>`;
  const nested = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="6" name="nested"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3810000" cy="2095500"/><a:chOff x="0" y="0"/><a:chExt cx="3810000" cy="2095500"/></a:xfrm></p:grpSpPr>${alternate('unknown', shape(60, 'discard-nested', 0, 0), shape(7, 'nested-first', 10, 160) + shape(8, 'nested-second', 90, 160))}</p:grpSp>`;
  zip.file(
    'ppt/slides/slide1.xml',
    `<p:sld ${ns}><p:cSld><p:spTree>${groupProps}${shape(2, 'ordinary-before', 10, 10)}${alternate('p', shape(3, 'chosen', 90, 10), shape(30, 'discard-fallback', 0, 0))}${alternate('unknown', shape(40, 'discard-choice', 0, 0), shape(4, 'fallback', 170, 10))}${alternate('svg', picture(5, true), picture(50, false))}${nested}${frame(9, 'ole-preview', 90, alternate('svg', ole(true), ole(false)), 'http://schemas.openxmlformats.org/presentationml/2006/ole')}${frame(10, 'mapped-chart', 210, '<c:chart r:id="rChart"/>', c, 180, 120)}${shape(11, 'ordinary-after', 290, 160)}</p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping ${map.replace('accent1="accent1"', 'accent1="accent3"')}/></p:clrMapOvr></p:sld>`,
  );
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    rels([
      ['rLayout', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
      ['rSvg', 'image', '../media/preview.svg'],
      ['rRaster', 'image', '../media/preview.png'],
      ['rChart', 'chart', '../charts/chart1.xml'],
      ['rOle', 'oleObject', 'https://example.invalid/unopened.xlsx', true],
    ]),
  );
  zip.file(
    'ppt/media/preview.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40"><rect width="60" height="40" fill="#ff00ff"/></svg>',
  );
  zip.file(
    'ppt/media/preview.png',
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=',
    { base64: true },
  );
  zip.file(
    'ppt/charts/chart1.xml',
    `<c:chartSpace ${ns}>${chartMap === 'absent' ? '' : `<c:clrMapOvr ${map.replace('accent1="accent1"', `accent1="${chartMap}"`)}/>`}<c:chart><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:spPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr><c:cat><c:strLit><c:ptCount val="1"/><c:pt idx="0"><c:v>one</c:v></c:pt></c:strLit></c:cat><c:val><c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>1</c:v></c:pt></c:numLit></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:crossAx val="2"/><c:crosses val="autoZero"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:crossAx val="1"/><c:crosses val="autoZero"/></c:valAx></c:plotArea><c:plotVisOnly val="1"/></c:chart><c:spPr><a:solidFill><a:schemeClr val="accent4"/></a:solidFill></c:spPr></c:chartSpace>`,
  );
  return [...(await zip.generateAsync({ type: 'uint8array' }))];
}

for (const lazy of [false, true]) {
  for (const chartMap of ['accent2', 'accent1', 'absent'] as const) {
    test(`built entry selects and decodes MCE previews with ${lazy ? 'lazy' : 'eager'} slides and chart map ${chartMap}`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/test/browser/blank.html');
      const result = await page.evaluate(
        async ({ bytes, lazy }) => {
          const api = await import('/dist/aiden0z-pptx-renderer.browser.es.js');
          const presentation = api.buildPresentation(
            await (lazy ? api.parseZipLazyMedia : api.parseZip)(new Uint8Array(bytes).buffer),
            { lazySlides: lazy },
          );
          const slide = presentation.slides[0];
          const deferred = slide.nodes.length;
          const handle = api.renderSlide(presentation, slide);
          document.body.replaceChildren(handle.element);
          await handle.ready;
          const images = [...handle.element.querySelectorAll('img')];
          const decoded = [];
          for (const img of images) {
            await img.decode();
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            canvas.getContext('2d')!.drawImage(img, 0, 0, 1, 1);
            decoded.push({
              width: img.naturalWidth,
              pixel: [...canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data],
            });
          }
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          const chart = handle.element.querySelector('canvas')!;
          if (!chart) throw new Error('No rendered chart Canvas');
          const pixels = chart.getContext('2d')!.getImageData(0, 0, chart.width, chart.height).data;
          const colors: Record<string, number> = { red: 0, blue: 0, green: 0, frameGray: 0 };
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 3] < 250) continue;
            if (pixels[i] === 136 && pixels[i + 1] === 136 && pixels[i + 2] === 136)
              colors.frameGray++;
            if (pixels[i] > 250 && pixels[i + 1] < 5 && pixels[i + 2] < 5) colors.red++;
            if (pixels[i] < 5 && pixels[i + 1] < 5 && pixels[i + 2] > 250) colors.blue++;
            if (pixels[i] < 5 && pixels[i + 1] > 250 && pixels[i + 2] < 5) colors.green++;
          }
          const serialized = api.serializePresentation(presentation).slides[0];
          const response = {
            deferred,
            decoded,
            colors,
            ids: serialized.nodes.map((node) => node.id),
            groupIds: serialized.nodes
              .find((node) => node.nodeType === 'group')
              ?.children.map((node) => node.id),
            text: handle.element.textContent,
            fills: [...handle.element.querySelectorAll('svg path')].map((path) =>
              path.getAttribute('fill'),
            ),
            parentMap: slide.colorMapOverride?.get('accent1'),
          };
          handle.dispose();
          return response;
        },
        { bytes: await packageBytes(chartMap), lazy },
      );
      expect(errors).toEqual([]);
      expect(result.deferred).toBe(lazy ? 0 : 8);
      expect(result.ids).toEqual(['2', '3', '4', '5', '6', '9', '10', '11']);
      expect(result.groupIds).toEqual(['7', '8']);
      expect(result.text).toContain('chosen');
      expect(result.text).toContain('fallback');
      expect(result.text).toContain('nested-first');
      expect(result.text).toContain('nested-second');
      expect(result.text).not.toContain('discard');
      expect(result.decoded).toEqual([
        { width: 60, pixel: [255, 0, 255, 255] },
        { width: 60, pixel: [255, 0, 255, 255] },
      ]);
      expect(result.parentMap).toBe('accent3');
      expect(result.fills.filter((fill) => fill?.toUpperCase() === '#00FF00')).toHaveLength(6);
      // The neutral frame cannot satisfy the independent red/blue/green bar assertion.
      expect(result.colors.frameGray).toBeGreaterThan(100);
      const expected = chartMap === 'accent2' ? 'blue' : chartMap === 'accent1' ? 'red' : 'green';
      expect(result.colors[expected], JSON.stringify(result.colors)).toBeGreaterThan(100);
      for (const color of ['red', 'blue', 'green'])
        if (color !== expected) expect(result.colors[color]).toBe(0);
    });
  }
}
