import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  build: {
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./src/content.tsx', import.meta.url)),
      output: {
        assetFileNames: '[name][extname]',
        entryFileNames: 'content.js',
        format: 'iife',
        inlineDynamicImports: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
