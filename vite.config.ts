import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

export default defineConfig({
  resolve: {
    alias: {
      'pptxjs-reference': resolve(__dirname, 'references/pptxjs/src/index.ts'),
    },
  },
  server: {
    fs: {
      allow: ['..'],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    {
      name: 'serve-testdata',
      configureServer(server) {
        // List test files: scan cases/ subdirectories that have source.pptx
        server.middlewares.use('/api/testdata-files', (_req, res) => {
          const casesDir = resolve(__dirname, 'test/e2e/testdata/cases');
          if (!fs.existsSync(casesDir)) {
            res.setHeader('Content-Type', 'application/json');
            res.end('[]');
            return;
          }
          const dirs = fs.readdirSync(casesDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name)
            .filter(name => fs.existsSync(resolve(casesDir, name, 'source.pptx')))
            .sort();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(dirs));
        });

        // Serve e2e/testdata at /testdata/* path
        server.middlewares.use('/testdata', (req, res, next) => {
          const filePath = resolve(__dirname, 'test/e2e/testdata', (req.url || '/').slice(1));
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = filePath.split('.').pop()?.toLowerCase();
            const mimeTypes: Record<string, string> = {
              png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
              pdf: 'application/pdf', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              json: 'application/json', xml: 'text/xml',
            };
            if (ext && mimeTypes[ext]) res.setHeader('Content-Type', mimeTypes[ext]);
            const stream = fs.createReadStream(filePath);
            stream.pipe(res);
          } else {
            next();
          }
        });
      },
    },
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'PptxRenderer',
      formats: ['es', 'cjs'],
      fileName: (format) => format === 'es' ? 'aiden0z-pptx-renderer.es.js' : 'aiden0z-pptx-renderer.cjs',
    },
    rollupOptions: {
      external: ['jszip', 'pdfjs-dist'],
      output: {
        globals: { jszip: 'JSZip', 'pdfjs-dist': 'pdfjsLib' },
      },
    },
  },
});
