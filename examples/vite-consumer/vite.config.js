import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { outDir: '../../dist/vite-consumer', emptyOutDir: true, assetsInlineLimit: 0 },
});
