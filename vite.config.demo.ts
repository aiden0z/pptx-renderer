import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'demo'),
  base: '/pptx-renderer/',
  publicDir: resolve(__dirname, 'demo/public'),
  build: {
    outDir: resolve(__dirname, 'dist-demo'),
    emptyOutDir: true,
  },
});
