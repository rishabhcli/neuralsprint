import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const loopbackHost = '127.0.0.1' as const;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  cacheDir: '.dev/cache/vite-default',
  server: {
    host: loopbackHost,
    port: 4210,
    strictPort: true,
    fs: {
      strict: true,
    },
    watch: {
      ignored: ['**/.dev/**'],
    },
  },
  preview: {
    host: loopbackHost,
    port: 4211,
    strictPort: true,
  },
  build: {
    assetsDir: 'assets',
    emptyOutDir: true,
    outDir: 'dist',
    rolldownOptions: {
      checks: {
        pluginTimings: false,
      },
    },
    sourcemap: false,
    target: 'es2024',
  },
});
