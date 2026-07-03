import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const workflow = readFileSync(resolve(repoRoot, '.github/workflows/deploy-demo.yml'), 'utf-8');
const demoHtml = readFileSync(resolve(repoRoot, 'demo/index.html'), 'utf-8');
const demoViteConfig = readFileSync(resolve(repoRoot, 'vite.config.demo.ts'), 'utf-8');
const releaseDocs = readFileSync(resolve(repoRoot, 'docs/RELEASING.md'), 'utf-8');

describe('demo preview deployment surface', () => {
  it('deploys fix branches to the shared test demo path', () => {
    expect(workflow).toContain('fix/**');
    expect(workflow).toContain('target_dir=test');
    expect(workflow).toContain('demo_base=/pptx-renderer/test/');
    expect(workflow).toContain('DEMO_BUILD_CHANNEL: ${{ steps.meta.outputs.channel }}');
    expect(workflow).toContain('DEMO_BASE: ${{ steps.meta.outputs.demo_base }}');
  });

  it('preserves root and test Pages subtrees across deployments', () => {
    expect(workflow).toContain('gh-pages');
    expect(workflow).toContain('pages-site');
    expect(workflow).toContain('find pages-site -mindepth 1 -maxdepth 1');
    expect(workflow).toContain("! -name 'test'");
    expect(workflow).toContain('cp -R dist-demo/. pages-site/test/');
  });

  it('configures demo base path and build metadata through Vite env', () => {
    expect(demoViteConfig).toContain("from './demo/buildInfo'");
    expect(demoViteConfig).toContain('getDemoBase(process.env)');
    expect(demoViteConfig).toContain('__PPTX_RENDERER_DEMO_BUILD__');
  });

  it('shows test build provenance in the demo UI', () => {
    expect(demoHtml).toContain('id="test-build-banner"');
    expect(demoHtml).toContain('TEST BUILD');
    expect(demoHtml).toContain('__PPTX_RENDERER_DEMO_BUILD__');
    expect(demoHtml).toContain('renderDemoBuildInfo');
  });

  it('documents the fix branch preview workflow', () => {
    expect(releaseDocs).toContain('https://aiden0z.github.io/pptx-renderer/test/');
    expect(releaseDocs).toContain('fix/**');
    expect(releaseDocs).toContain('TEST BUILD');
    expect(releaseDocs).toContain('does not publish npm');
  });
});
