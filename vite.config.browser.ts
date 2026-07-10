import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'PptxRenderer',
      formats: ['es'],
      fileName: () => 'aiden0z-pptx-renderer.browser.es.js',
    },
    rollupOptions: {
      external: ['pdfjs-dist'],
    },
  },
});
