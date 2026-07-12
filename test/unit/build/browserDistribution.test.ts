// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import libraryConfig from '../../../vite.config';
import browserConfig from '../../../vite.config.browser';

const root = resolve(__dirname, '../../..');

function readText(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

function readJson<T>(path: string): T {
  return JSON.parse(readText(path)) as T;
}

interface PackageJson {
  packageManager: string;
  files: string[];
  scripts: Record<string, string>;
  exports: Record<string, unknown>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  sideEffects: string[];
  'size-limit': Array<{ path: string; limit: string; gzip: boolean }>;
}

describe('browser distribution contract', () => {
  const packageJson = readJson<PackageJson>('package.json');

  it('accepts pdfjs-dist v5 and v6 because the optional worker URLs are stable', () => {
    expect(packageJson.peerDependencies['pdfjs-dist']).toBe('>=5 <7');
    expect(packageJson.devDependencies['pdfjs-dist']).toBe('^5.4.624');
  });

  it('publishes a standalone browser ESM entry for no-bundler consumers', () => {
    expect(packageJson.exports['./browser']).toMatchObject({
      types: './dist/types/index.d.ts',
      import: './dist/aiden0z-pptx-renderer.browser.es.js',
      default: './dist/aiden0z-pptx-renderer.browser.es.js',
    });
    expect(packageJson.scripts.build).toBe('node scripts/build.mjs');
    expect(readText('scripts/build.mjs')).toContain('vite.config.browser.ts');
    expect(readText('scripts/build.mjs')).not.toMatch(/\brm\s+-rf\b|\bcp\s+/);
  });

  it('replaces Node process.env checks at build time for browser artifacts', () => {
    expect(libraryConfig.define).toMatchObject({ 'process.env.NODE_ENV': '"production"' });
    expect(browserConfig.define).toMatchObject({ 'process.env.NODE_ENV': '"production"' });
  });

  it('externalizes runtime dependencies for bundlers and bundles them in the browser build', () => {
    const isExternal = libraryConfig.build?.rollupOptions?.external;
    expect(isExternal).toBeTypeOf('function');
    expect((isExternal as (id: string) => boolean)('echarts/core')).toBe(true);
    expect((isExternal as (id: string) => boolean)('echarts/charts')).toBe(true);
    expect((isExternal as (id: string) => boolean)('jszip')).toBe(true);
    expect((isExternal as (id: string) => boolean)('pdfjs-dist')).toBe(true);
    expect(browserConfig.build?.rollupOptions?.external).toEqual(['pdfjs-dist']);
  });

  it('publishes the MPL notice, license, and exact source location for bundled MTX code', () => {
    const notice = readText('THIRD_PARTY_NOTICES.md');

    expect(packageJson.files).toContain('THIRD_PARTY_NOTICES.md');
    expect(packageJson.files).toContain('licenses');
    expect(notice).toContain('mtx-decompressor 1.4.2');
    expect(notice).toContain('Mozilla Public License 2.0');
    expect(notice).toContain('refs/tags/v1.4.2.tar.gz');
    expect(readText('licenses/mtx-decompressor-MPL-2.0.txt')).toContain(
      'Mozilla Public License Version 2.0',
    );
  });

  it('uses the tree-shakeable ECharts runtime with every supported chart type registered', () => {
    const runtime = readText('src/renderer/chart/echartsRuntime.ts');

    expect(runtime).toContain("from 'echarts/core'");
    expect(runtime).toContain("from 'echarts/charts'");
    expect(runtime).toContain("from 'echarts/components'");
    expect(runtime).toContain("from 'echarts/renderers'");
    for (const registration of [
      'BarChart',
      'LineChart',
      'PieChart',
      'RadarChart',
      'ScatterChart',
      'CandlestickChart',
      'CustomChart',
      'CanvasRenderer',
    ]) {
      expect(runtime).toContain(registration);
    }
    expect(readText('src/renderer/ChartRenderer.ts')).not.toContain(
      "import * as echarts from 'echarts'",
    );
    expect(packageJson.sideEffects).toContain('./src/renderer/chart/echartsRuntime.ts');
    expect(packageJson.sideEffects).toContain('./dist/aiden0z-pptx-renderer.browser.es.js');
  });

  it('preserves the primary library artifacts when running the second browser build', () => {
    expect(browserConfig.build?.emptyOutDir).toBe(false);
  });

  it('smoke-tests built package entry points in CI', () => {
    const ci = readText('.github/workflows/ci.yml');

    expect(packageJson.scripts['test:package']).toBe('node scripts/verify-package.mjs');
    expect(ci).toContain('pnpm test:package');
  });

  it('runs the standalone and PDF.js paths in a real Chromium browser', () => {
    const ci = readText('.github/workflows/ci.yml');

    expect(packageJson.scripts['test:browser']).toBe(
      'playwright test --config test/browser/playwright.config.ts',
    );
    expect(packageJson.devDependencies['@playwright/test']).toBeTruthy();
    expect(ci).toContain('pnpm exec playwright install --with-deps chromium');
    expect(ci.match(/pnpm test:browser/g)).toHaveLength(2);
  });

  it('tests the declared pdfjs-dist v6 contract on Node 22', () => {
    const ci = readText('.github/workflows/ci.yml');

    expect(packageJson.scripts['test:pdfjs-contract']).toBe(
      'node scripts/verify-pdfjs-contract.mjs',
    );
    expect(ci).toContain('pdfjs-v6-compat');
    expect(ci).toContain('node-version: 22');
    expect(ci).toContain('pdfjs-dist@^6');
    expect(ci.match(/pnpm test:pdfjs-contract/g)).toHaveLength(2);
  });

  it('sets a gzip budget for the standalone browser entry', () => {
    expect(packageJson['size-limit']).toContainEqual({
      path: 'dist/aiden0z-pptx-renderer.browser.es.js',
      limit: '500 kB',
      gzip: true,
    });
  });

  it('pins one pnpm version for local development and CI', () => {
    const workflows = `${readText('.github/workflows/ci.yml')}\n${readText(
      '.github/workflows/deploy-demo.yml',
    )}`;

    expect(packageJson.packageManager).toBe('pnpm@9.15.9');
    expect(workflows).not.toContain('version: 9');
  });
});
