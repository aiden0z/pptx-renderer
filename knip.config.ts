import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: ['src/index.ts'],
  project: ['src/**/*.ts'],
  // Browser tests use Vite root-relative imports that resolve in Chromium rather than Node.
  ignoreUnresolved: ['^/(src|test)/'],
  // PDF.js is an optional runtime URL resolved inside a Web Worker, so Knip cannot see the import.
  ignoreDependencies: ['pdfjs-dist', 'pixelmatch'],
  // Keep this allow-list narrow so Knip still reports new accidental type exports.
  ignoreIssues: {
    'src/core/Renderer.ts': ['types'],
    'src/core/Viewer.ts': ['types'],
    'src/renderer/StyleResolver.ts': ['types'],
    'src/shapes/presets.ts': ['types'],
    'src/utils/e2eCompare.ts': ['types'],
    'src/utils/emfParser.ts': ['types'],
    'src/utils/previewScale.ts': ['types'],
  },
};

export default config;
