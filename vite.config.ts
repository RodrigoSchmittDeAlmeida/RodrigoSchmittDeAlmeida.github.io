import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  assetsInclude: ['**/*.glb'],
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
