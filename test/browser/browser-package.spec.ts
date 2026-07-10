import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

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
