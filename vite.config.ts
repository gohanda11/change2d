import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsInclude: ['**/*.wasm'],
    chunkSizeWarningLimit: 1000,
  },
});
