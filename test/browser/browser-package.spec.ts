import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import JSZip from 'jszip';

const require = createRequire(import.meta.url);

function createBlankPdf(): number[] {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources <<>> /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf += object;
  }
  const xrefOffset = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return [...new TextEncoder().encode(pdf)];
}

function viteFsUrl(path: string): string {
  return `/@fs${path}`;
}

test('standalone browser entry renders a tracked PPTX including its chart', async ({ page }) => {
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  await page.goto('/test/browser/blank.html');
  const result = await page.evaluate(async () => {
    const renderer = await import('/dist/aiden0z-pptx-renderer.browser.es.js');
    const response = await fetch('/docs/example/1-chart-and-complex/source.pptx');
    const files = await renderer.parseZip(await response.arrayBuffer());
    const presentation = renderer.buildPresentation(files);
    const handles = presentation.slides.map((slide) => renderer.renderSlide(presentation, slide));
    document.body.replaceChildren(...handles.map((handle) => handle.element));
    await Promise.all(handles.map((handle) => handle.ready));
    return {
      slideCount: presentation.slides.length,
      canvasCount: document.querySelectorAll('canvas').length,
      width: handles[0].element.getBoundingClientRect().width,
      textLength: document.body.textContent?.trim().length ?? 0,
    };
  });

  expect(errors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(result.slideCount).toBeGreaterThan(0);
  expect(result.canvasCount).toBeGreaterThan(0);
  expect(result.width).toBeGreaterThan(0);
  expect(result.textLength).toBeGreaterThan(0);
});

test('standalone browser entry honors firstSlideNum with empty cached fields', async ({ page }) => {
  const zip = await JSZip.loadAsync(
    await readFile(resolve('docs/example/1-chart-and-complex/source.pptx')),
  );
  const presentationPath = 'ppt/presentation.xml';
  const presentationXml = await zip.file(presentationPath)!.async('string');
  zip.file(
    presentationPath,
    presentationXml.replace('<p:presentation ', '<p:presentation firstSlideNum="10" '),
  );
  for (const slidePath of ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml']) {
    const slideXml = await zip.file(slidePath)!.async('string');
    zip.file(
      slidePath,
      slideXml.replace(/(<a:fld\b[^>]*type="slidenum"[\s\S]*?<a:t>)[\s\S]*?(<\/a:t>)/g, '$1$2'),
    );
  }

  await page.goto('/test/browser/blank.html');
  const slideNumbers = await page.evaluate(
    async (bytes) => {
      const renderer = await import('/dist/aiden0z-pptx-renderer.browser.es.js');
      const presentation = renderer.buildPresentation(
        await renderer.parseZip(new Uint8Array(bytes).buffer),
      );

      return presentation.slides.map((slide) => {
        const fieldNode = slide.nodes.find(
          (node) =>
            node.nodeType === 'shape' &&
            node.textBody?.paragraphs.some((paragraph) =>
              paragraph.runs.some((run) => run.fieldType === 'slidenum'),
            ),
        );
        if (!fieldNode) return null;

        const handle = renderer.renderSlide(presentation, {
          ...slide,
          nodes: [fieldNode],
          showMasterSp: false,
        });
        const text = handle.element.textContent?.trim() ?? null;
        handle.dispose();
        return text;
      });
    },
    [...(await zip.generateAsync({ type: 'uint8array' }))],
  );

  expect(slideNumbers).toEqual(['10', '11']);
});

test('tracked PPTX renders stale table frames from the table grid dimensions', async ({ page }) => {
  await page.goto('/test/browser/blank.html');
  const result = await page.evaluate(async () => {
    const renderer = await import('/dist/aiden0z-pptx-renderer.browser.es.js');
    const response = await fetch('/docs/example/table-stale-frame/source.pptx');
    const presentation = renderer.buildPresentation(
      await renderer.parseZip(await response.arrayBuffer()),
    );
    const tableNode = presentation.slides[0].nodes.find((node) => node.nodeType === 'table');
    if (!tableNode || tableNode.nodeType !== 'table') throw new Error('Missing table node');
    const serializedTable = renderer
      .serializePresentation(presentation)
      .slides[0].nodes.find((node) => node.nodeType === 'table');
    const indexedCell = renderer
      .buildTextIndex(presentation)
      .find((entry) => entry.nodeType === 'table');
    const handle = renderer.renderSlide(presentation, presentation.slides[0]);
    document.body.replaceChildren(handle.element);
    await handle.ready;

    const table = handle.element.querySelector('table');
    const wrapper = table?.parentElement;
    const firstCell = table?.querySelector('td');
    if (!wrapper || !firstCell) throw new Error('Missing rendered table DOM');

    const rawExtent = tableNode.source.child('xfrm').child('ext');
    return {
      rawFrame: [rawExtent.numAttr('cx'), rawExtent.numAttr('cy')],
      modelSize: [tableNode.size.w, tableNode.size.h],
      serializedSize: [serializedTable?.size.w, serializedTable?.size.h],
      indexedSize: [indexedCell?.bounds.w, indexedCell?.bounds.h],
      domSize: [wrapper.getBoundingClientRect().width, wrapper.getBoundingClientRect().height],
      firstCellWidth: firstCell.getBoundingClientRect().width,
      text: wrapper.textContent,
    };
  });

  expect(result.rawFrame).toEqual([914400, 914400]);
  expect(result.modelSize[0]).toBeCloseTo(576, 0);
  expect(result.modelSize[1]).toBeCloseTo(192, 0);
  expect(result.serializedSize).toEqual(result.modelSize);
  expect(result.indexedSize).toEqual(result.modelSize);
  expect(result.domSize[0]).toBeCloseTo(576, 0);
  expect(result.domSize[1]).toBeCloseTo(192, 0);
  expect(result.firstCellWidth).toBeGreaterThan(250);
  expect(result.text).toContain('Wide table cell remains visible');
});

test('host image resets do not change PPTX picture sizing or crops', async ({ page }) => {
  await page.goto('/test/browser/blank.html');
  const pictures = await page.evaluate(async () => {
    const style = document.createElement('style');
    style.textContent = 'img { max-width: 100%; max-height: 100%; height: auto; }';
    document.head.appendChild(style);

    const renderer = await import('/dist/aiden0z-pptx-renderer.browser.es.js');
    const response = await fetch('/docs/example/image-crop-css-reset/source.pptx');
    const presentation = renderer.buildPresentation(
      await renderer.parseZip(await response.arrayBuffer()),
    );
    const handle = renderer.renderSlide(presentation, presentation.slides[0]);
    document.body.replaceChildren(handle.element);
    await handle.ready;

    return Array.from(handle.element.querySelectorAll('img')).map((image) => ({
      imageWidth: image.getBoundingClientRect().width,
      maxHeight: getComputedStyle(image).maxHeight,
      maxWidth: getComputedStyle(image).maxWidth,
      parentTop: Number.parseFloat(image.parentElement?.style.top ?? '0'),
      parentWidth: image.parentElement?.getBoundingClientRect().width ?? 0,
    }));
  });

  expect(pictures).toHaveLength(4);
  expect(pictures.every((picture) => picture.maxWidth === 'none')).toBe(true);
  expect(pictures.every((picture) => picture.maxHeight === 'none')).toBe(true);
  expect(pictures[0].imageWidth).toBeCloseTo(pictures[0].parentWidth, 0);
  expect(pictures.slice(1).every((picture) => picture.imageWidth > picture.parentWidth * 2.9)).toBe(
    true,
  );
  expect(pictures.slice(1).map((picture) => picture.parentTop)).toEqual(
    pictures
      .slice(1)
      .map((picture) => picture.parentTop)
      .toSorted((a, b) => a - b),
  );
});

test('isolated PDF fallback renders through the configured PDF.js module and worker', async ({
  page,
}) => {
  const pdfjsRoot = process.env.PDFJS_DIST_DIR;
  const modulePath = pdfjsRoot
    ? resolve(pdfjsRoot, 'build/pdf.min.mjs')
    : require.resolve('pdfjs-dist/build/pdf.min.mjs');
  const workerPath = pdfjsRoot
    ? resolve(pdfjsRoot, 'build/pdf.worker.min.mjs')
    : require.resolve('pdfjs-dist/build/pdf.worker.min.mjs');
  await page.goto('/test/browser/blank.html');

  const result = await page.evaluate(
    async ({ bytes, modulePath, workerPath }) => {
      const rendererModuleUrl = '/src/utils/pdfRenderer.ts';
      const { renderPdfToImage } = await import(/* @vite-ignore */ rendererModuleUrl);
      const moduleUrl = new URL(modulePath, location.origin).href;
      const workerUrl = new URL(workerPath, location.origin).href;
      const imageUrl = await renderPdfToImage(new Uint8Array(bytes), 64, 48, {
        moduleUrl,
        workerUrl,
      });
      if (!imageUrl) return null;
      try {
        const image = new Image();
        image.src = imageUrl;
        await image.decode();
        return { width: image.naturalWidth, height: image.naturalHeight };
      } finally {
        URL.revokeObjectURL(imageUrl);
      }
    },
    {
      bytes: createBlankPdf(),
      modulePath: viteFsUrl(modulePath),
      workerPath: viteFsUrl(workerPath),
    },
  );

  expect(result).not.toBeNull();
  expect(result?.width).toBeGreaterThan(0);
  expect(result?.height).toBeGreaterThan(0);
});

test('tree-shakeable ECharts runtime registers every renderer-supported series', async ({
  page,
}) => {
  await page.goto('/test/browser/blank.html');
  const result = await page.evaluate(async () => {
    const runtimeModuleUrl = '/src/renderer/chart/echartsRuntime.ts';
    const { echarts } = await import(/* @vite-ignore */ runtimeModuleUrl);
    const options = [
      { xAxis: { type: 'category', data: ['A'] }, yAxis: {}, series: [{ type: 'bar', data: [1] }] },
      {
        xAxis: { type: 'category', data: ['A'] },
        yAxis: {},
        series: [{ type: 'line', data: [1] }],
      },
      { series: [{ type: 'pie', data: [{ value: 1, name: 'A' }] }] },
      {
        radar: { indicator: [{ name: 'A', max: 2 }] },
        series: [{ type: 'radar', data: [{ value: [1] }] }],
      },
      { xAxis: {}, yAxis: {}, series: [{ type: 'scatter', data: [[1, 1]] }] },
      {
        xAxis: { type: 'category', data: ['A'] },
        yAxis: {},
        series: [{ type: 'candlestick', data: [[1, 2, 0, 3]] }],
      },
      {
        xAxis: {},
        yAxis: {},
        series: [
          {
            type: 'custom',
            data: [[1, 1]],
            renderItem: (_params: unknown, api: { coord(value: number[]): number[] }) => ({
              type: 'circle',
              shape: { cx: api.coord([1, 1])[0], cy: api.coord([1, 1])[1], r: 2 },
            }),
          },
        ],
      },
    ];

    return options.map((option) => {
      const container = document.createElement('div');
      container.style.width = '240px';
      container.style.height = '160px';
      document.body.appendChild(container);
      const chart = echarts.init(container);
      chart.setOption(option);
      const rendered = container.querySelectorAll('canvas').length;
      chart.dispose();
      return rendered;
    });
  });

  expect(result).toEqual([1, 1, 1, 1, 1, 1, 1]);
});

test('text overflow combinations remain non-scrollable in Chromium', async ({ page }) => {
  await page.goto('/test/browser/blank.html');
  const result = await page.evaluate(async () => {
    const xmlParserModuleUrl = '/src/parser/XmlParser.ts';
    const shapeNodeModuleUrl = '/src/model/nodes/ShapeNode.ts';
    const shapeRendererModuleUrl = '/src/renderer/ShapeRenderer.ts';
    const mockContextModuleUrl = '/test/unit/helpers/mockContext.ts';
    const [{ parseXml }, { parseShapeNode }, { renderShape }, { createMockRenderContext }] =
      await Promise.all([
        import(/* @vite-ignore */ xmlParserModuleUrl),
        import(/* @vite-ignore */ shapeNodeModuleUrl),
        import(/* @vite-ignore */ shapeRendererModuleUrl),
        import(/* @vite-ignore */ mockContextModuleUrl),
      ]);
    const combinations = [
      { name: 'bounded', attributes: '', expected: ['hidden', 'hidden'] },
      {
        name: 'both-visible',
        attributes: 'horzOverflow="overflow" vertOverflow="overflow"',
        expected: ['visible', 'visible'],
      },
      {
        name: 'horizontal-visible',
        attributes: 'horzOverflow="overflow"',
        expected: ['visible', 'clip'],
      },
      {
        name: 'vertical-visible',
        attributes: 'vertOverflow="overflow"',
        expected: ['clip', 'visible'],
      },
    ];

    return combinations.map(({ name, attributes, expected }) => {
      const xml = `
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr>
            <p:cNvPr id="1" name="${name}"/>
            <p:cNvSpPr txBox="1"/>
            <p:nvPr/>
          </p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="190500"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:noFill/><a:ln><a:noFill/></a:ln>
          </p:spPr>
          <p:txBody>
            <a:bodyPr wrap="square" ${attributes}><a:spAutoFit/></a:bodyPr>
            <a:lstStyle/>
            <a:p><a:r><a:rPr sz="2400"/><a:t>80% overflow probe</a:t></a:r></a:p>
          </p:txBody>
        </p:sp>
      `;
      const shape = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
      document.body.appendChild(shape);
      const container = Array.from(shape.querySelectorAll('div')).find(
        (element) => element.style.flexDirection === 'column',
      );
      if (!container) throw new Error(`Missing text container for ${name}`);
      const computed = getComputedStyle(container);
      return {
        name,
        inline: [container.style.overflowX, container.style.overflowY],
        computed: [computed.overflowX, computed.overflowY],
        expected,
      };
    });
  });

  for (const combination of result) {
    expect(combination.inline, combination.name).toEqual(combination.expected);
    expect(combination.computed, combination.name).toEqual(combination.expected);
  }
});

test('browser layout preserves blank lines and roundRect wrapping', async ({ page }) => {
  await page.goto('/test/browser/blank.html');
  const result = await page.evaluate(async () => {
    const [{ parseXml }, { parseShapeNode }, { renderShape }, { createMockRenderContext }] =
      await Promise.all([
        import('/src/parser/XmlParser.ts'),
        import('/src/model/nodes/ShapeNode.ts'),
        import('/src/renderer/ShapeRenderer.ts'),
        import('/test/unit/helpers/mockContext.ts'),
      ]);
    const render = (xml: string) => {
      const shape = renderShape(parseShapeNode(parseXml(xml)), createMockRenderContext());
      document.body.appendChild(shape);
      const container = Array.from(shape.querySelectorAll('div')).find(
        (element) => element.style.flexDirection === 'column',
      );
      if (!container) throw new Error('Missing text container');
      return { shape, container };
    };

    const blank = render(`
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="1" name="Blank lines"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="4762500" cy="4762500"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr lIns="0" tIns="0" rIns="0" bIns="0"><a:noAutofit/></a:bodyPr>
          <a:lstStyle/>
          <a:p><a:pPr><a:lnSpc><a:spcPct val="100000"/></a:lnSpc></a:pPr><a:r><a:rPr sz="1000"><a:latin typeface="Arial"/></a:rPr><a:t>Small </a:t></a:r><a:r><a:rPr sz="2000"><a:latin typeface="Arial"/></a:rPr><a:t>Before</a:t></a:r></a:p>
          <a:p><a:pPr><a:lnSpc><a:spcPct val="100000"/></a:lnSpc></a:pPr><a:r><a:rPr sz="600"/><a:t/></a:r><a:endParaRPr sz="2000"><a:latin typeface="Arial"/></a:endParaRPr></a:p>
          <a:p><a:pPr><a:lnSpc><a:spcPct val="100000"/></a:lnSpc></a:pPr><a:r><a:t/></a:r><a:endParaRPr sz="2000"><a:latin typeface="Arial"/></a:endParaRPr></a:p>
          <a:p><a:pPr><a:lnSpc><a:spcPct val="100000"/></a:lnSpc></a:pPr><a:r><a:rPr sz="2000"><a:latin typeface="Arial"/></a:rPr><a:t>After</a:t></a:r></a:p>
          <a:p><a:br/><a:endParaRPr sz="2000"><a:latin typeface="Arial"/></a:endParaRPr></a:p>
        </p:txBody>
      </p:sp>
    `);
    const paragraphRects = Array.from(blank.container.children).map((paragraph) => {
      const rect = paragraph.getBoundingClientRect();
      return {
        height: rect.height,
        top: rect.top,
        fontFamily: getComputedStyle(paragraph).fontFamily,
      };
    });
    blank.shape.remove();

    const lineBreaks = render(`
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="3" name="Styled line breaks"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="4762500" cy="4762500"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr lIns="0" tIns="0" rIns="0" bIns="0"><a:noAutofit/></a:bodyPr>
          <a:lstStyle/>
          <a:p><a:pPr><a:lnSpc><a:spcPct val="100000"/></a:lnSpc></a:pPr><a:r><a:rPr sz="1000"><a:latin typeface="Arial"/></a:rPr><a:t>Before</a:t></a:r></a:p>
          <a:p><a:pPr><a:lnSpc><a:spcPct val="100000"/></a:lnSpc></a:pPr><a:br><a:rPr sz="3000"><a:latin typeface="Arial"/></a:rPr></a:br><a:r><a:rPr sz="1000"><a:latin typeface="Arial"/></a:rPr><a:t>Styled</a:t></a:r></a:p>
          <a:p><a:pPr><a:lnSpc><a:spcPct val="100000"/></a:lnSpc><a:defRPr sz="1800"><a:latin typeface="Courier New"/></a:defRPr></a:pPr><a:br/><a:r><a:rPr sz="1000"><a:latin typeface="Arial"/></a:rPr><a:t>Inherited</a:t></a:r></a:p>
          <a:p><a:pPr><a:lnSpc><a:spcPct val="100000"/></a:lnSpc></a:pPr><a:r><a:rPr sz="1000"><a:latin typeface="Arial"/></a:rPr><a:t>After</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    `);
    const breakParagraphs = Array.from(lineBreaks.container.children) as HTMLElement[];
    const breakMetrics = breakParagraphs.map((paragraph) => {
      const rect = paragraph.getBoundingClientRect();
      const breakElement = paragraph.querySelector('br')?.parentElement;
      const textElement = Array.from(paragraph.querySelectorAll('span')).find(
        (span) => span.textContent === 'Styled' || span.textContent === 'Inherited',
      );
      return {
        height: rect.height,
        top: rect.top,
        paragraphFontSize: paragraph.style.fontSize,
        paragraphFontFamily: paragraph.style.fontFamily,
        breakTag: breakElement?.tagName,
        breakFontSize: breakElement ? getComputedStyle(breakElement).fontSize : undefined,
        breakFontFamily: breakElement ? getComputedStyle(breakElement).fontFamily : undefined,
        textTop: textElement?.getBoundingClientRect().top,
      };
    });
    lineBreaks.shape.remove();

    const fixedLineSpacing = render(`
      <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:nvSpPr><p:cNvPr id="4" name="Fixed line spacing"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="4762500" cy="4762500"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr lIns="0" tIns="0" rIns="0" bIns="0"><a:noAutofit/></a:bodyPr>
          <a:lstStyle/>
          <a:p><a:pPr><a:lnSpc><a:spcPts val="2400"/></a:lnSpc></a:pPr><a:r><a:rPr sz="1000"/><a:t>First</a:t></a:r><a:br><a:rPr sz="3000"/></a:br><a:r><a:rPr sz="1000"/><a:t>Second</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    `);
    const fixedParagraph = fixedLineSpacing.container.firstElementChild as HTMLElement;
    const fixedMetrics = {
      wrapperCount: fixedParagraph.children.length,
      wrapperHeights: Array.from(fixedParagraph.children).map(
        (line) => line.getBoundingClientRect().height,
      ),
      brCount: fixedParagraph.querySelectorAll('br').length,
    };
    fixedLineSpacing.shape.remove();

    const text = 'one two to in';
    const probe = document.createElement('span');
    probe.style.font = '20pt Arial';
    probe.style.whiteSpace = 'pre';
    probe.textContent = text;
    document.body.appendChild(probe);
    const fullTextWidth = probe.getBoundingClientRect().width;
    probe.remove();
    const height = 100;
    const inset = height * (16667 / 100000) * 0.29289;
    const width = fullTextWidth + inset;

    const wordTops = (preset: 'rect' | 'roundRect') => {
      const rendered = render(`
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr><p:cNvPr id="2" name="${preset}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.ceil(width * 9525)}" cy="952500"/></a:xfrm>
            <a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>
          </p:spPr>
          <p:txBody>
            <a:bodyPr lIns="0" tIns="0" rIns="0" bIns="0" wrap="square"><a:noAutofit/></a:bodyPr>
            <a:lstStyle/>
            <a:p><a:r><a:rPr sz="2000"><a:latin typeface="Arial"/></a:rPr><a:t>${text}</a:t></a:r></a:p>
          </p:txBody>
        </p:sp>
      `);
      const textNode = rendered.container.querySelector('span')?.firstChild;
      if (!textNode) throw new Error(`Missing ${preset} text`);
      const top = (word: string) => {
        const start = text.indexOf(word);
        const range = document.createRange();
        range.setStart(textNode, start);
        range.setEnd(textNode, start + word.length);
        return range.getBoundingClientRect().top;
      };
      const value = {
        containerWidth: rendered.container.getBoundingClientRect().width,
        inTop: top('in'),
        toTop: top('to'),
      };
      rendered.shape.remove();
      return value;
    };

    return {
      blank: paragraphRects.slice(0, 4),
      breakOnly: paragraphRects[4],
      breakMetrics,
      fixedMetrics,
      expectedRoundWidth: width - 2 * inset,
      rect: wordTops('rect'),
      roundRect: wordTops('roundRect'),
    };
  });

  expect(result.blank).toHaveLength(4);
  expect(result.blank.every(({ height }) => height > 0)).toBe(true);
  const blankHeights = result.blank.map(({ height }) => height);
  expect(Math.max(...blankHeights) - Math.min(...blankHeights)).toBeLessThanOrEqual(1);
  for (let index = 1; index < result.blank.length; index += 1) {
    expect(result.blank[index].top - result.blank[index - 1].top).toBeCloseTo(
      result.blank[index - 1].height,
      1,
    );
  }
  expect(result.breakOnly.height).toBeGreaterThan(0);
  expect(result.breakOnly.fontFamily).toContain('Arial');
  expect(result.breakMetrics).toHaveLength(4);
  const [beforeBreak, styledBreak, inheritedBreak, afterBreak] = result.breakMetrics;
  expect(styledBreak.paragraphFontSize).toBe('10pt');
  expect(styledBreak.paragraphFontFamily).toBe('');
  expect(styledBreak.breakTag).toBe('SPAN');
  expect(parseFloat(styledBreak.breakFontSize!)).toBeCloseTo(40, 1);
  expect(styledBreak.breakFontFamily).toContain('Arial');
  expect(inheritedBreak.paragraphFontSize).toBe('10pt');
  expect(inheritedBreak.paragraphFontFamily).toBe('');
  expect(inheritedBreak.breakTag).toBe('SPAN');
  expect(parseFloat(inheritedBreak.breakFontSize!)).toBeCloseTo(24, 1);
  expect(inheritedBreak.breakFontFamily).toContain('Courier New');
  expect(styledBreak.textTop! - styledBreak.top).toBeGreaterThan(
    inheritedBreak.textTop! - inheritedBreak.top,
  );
  expect(styledBreak.height).toBeGreaterThan(inheritedBreak.height);
  expect(styledBreak.top - beforeBreak.top).toBeCloseTo(beforeBreak.height, 1);
  expect(inheritedBreak.top - styledBreak.top).toBeCloseTo(styledBreak.height, 1);
  expect(afterBreak.top - inheritedBreak.top).toBeCloseTo(inheritedBreak.height, 1);
  expect(result.fixedMetrics.wrapperCount).toBe(2);
  expect(result.fixedMetrics.wrapperHeights).toEqual([32, 32]);
  expect(result.fixedMetrics.brCount).toBe(0);
  expect(result.rect.inTop).toBeCloseTo(result.rect.toTop, 1);
  expect(result.roundRect.inTop).toBeGreaterThan(result.roundRect.toTop);
  expect(result.roundRect.containerWidth).toBeCloseTo(result.expectedRoundWidth, 1);
});

test('table paragraphs without lnSpc keep the existing cumulative fallback', async ({ page }) => {
  await page.goto('/test/browser/blank.html');
  const result = await page.evaluate(async () => {
    const [{ renderTable }, { parseXml }, { createMockRenderContext }] = await Promise.all([
      import('/src/renderer/TableRenderer.ts'),
      import('/src/parser/XmlParser.ts'),
      import('/test/unit/helpers/mockContext.ts'),
    ]);
    const run = (text: string) => ({
      text,
      properties: parseXml('<rPr sz="2000"><latin typeface="Arial"/></rPr>'),
    });
    const table = renderTable(
      {
        id: '1',
        name: 'Cumulative paragraph spacing',
        nodeType: 'table',
        position: { x: 0, y: 0 },
        size: { w: 400, h: 300 },
        rotation: 0,
        flipH: false,
        flipV: false,
        source: parseXml('<graphicFrame/>'),
        columns: [400],
        rows: [
          {
            height: 300,
            cells: [
              {
                gridSpan: 1,
                rowSpan: 1,
                hMerge: false,
                vMerge: false,
                textBody: {
                  paragraphs: [
                    { runs: [run('First paragraph')], level: 0 },
                    { runs: [run('NOTE'), { text: '\n' }, run('continued')], level: 0 },
                    { runs: [run('WARNING')], level: 0 },
                  ],
                },
              },
            ],
          },
        ],
      },
      createMockRenderContext(),
    );
    document.body.replaceChildren(table);

    return Array.from(table.querySelectorAll('td > div')).map((paragraph) => {
      const rect = paragraph.getBoundingClientRect();
      return {
        fontSize: getComputedStyle(paragraph).fontSize,
        height: rect.height,
        lineHeight: getComputedStyle(paragraph).lineHeight,
        top: rect.top,
      };
    });
  });

  const lineHeight = parseFloat(result[0].lineHeight);
  expect(lineHeight).toBeCloseTo(parseFloat(result[0].fontSize), 1);
  expect(result[1].height).toBeCloseTo(result[0].height * 2, 1);
  expect(result[2].height).toBeCloseTo(result[0].height, 1);
  expect(result[1].top - result[0].top).toBeCloseTo(result[0].height, 1);
  expect(result[2].top - result[1].top).toBeCloseTo(result[1].height, 1);
});

test('embedded PPTX fonts load without host font installation', async ({ page }) => {
  await page.goto('/test/browser/blank.html');
  const result = await page.evaluate(async () => {
    const renderer = await import('/dist/aiden0z-pptx-renderer.browser.es.js');
    const response = await fetch('/docs/example/embedded-font/source.pptx');
    const presentation = renderer.buildPresentation(
      await renderer.parseZip(await response.arrayBuffer()),
    );
    const handle = renderer.renderSlide(presentation, presentation.slides[0]);
    document.body.replaceChildren(handle.element);
    await handle.ready;

    const renderFamily = presentation.embeddedFonts?.[0]?.renderFamily ?? '';
    const vietnamese = Array.from(handle.element.querySelectorAll('span')).find((span) =>
      span.textContent?.includes('Tiếng Việt'),
    );
    const registeredBeforeDispose = Array.from(document.fonts).filter(
      (face) => face.family === renderFamily,
    ).length;
    handle.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return {
      embeddedFaceCount: presentation.embeddedFonts?.length ?? 0,
      fontFamily: vietnamese ? getComputedStyle(vietnamese).fontFamily : '',
      fontLoaded: document.fonts.check(`12px "${renderFamily}"`),
      renderFamily,
      registeredBeforeDispose,
      registeredAfterDispose: Array.from(document.fonts).filter(
        (face) => face.family === renderFamily,
      ).length,
    };
  });

  expect(result.embeddedFaceCount).toBe(2);
  expect(result.renderFamily).toMatch(/^__pptx_embedded_/);
  expect(result.fontFamily).toContain(result.renderFamily);
  expect(result.fontLoaded).toBe(true);
  expect(result.registeredBeforeDispose).toBe(2);
  expect(result.registeredAfterDispose).toBe(0);
});
