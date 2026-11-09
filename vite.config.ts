import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  base: './',
  envDir: '..',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
  },
  server: { host: true },
});
