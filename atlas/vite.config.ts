import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/civilization/' : '/',
  plugins: [preact()],
  server: { fs: { allow: ['..'] } },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
}));
