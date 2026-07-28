import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';


export default defineConfig(({ mode }) => {
  const isBackgroundBuild = mode === 'background';
  const entryName = isBackgroundBuild ? 'background' : 'content';
  const entryFile = isBackgroundBuild ? 'background.ts' : 'content.tsx';

  return {
    plugins: isBackgroundBuild ? [] : [react()],
    publicDir: isBackgroundBuild ? false : 'public',
    build: {
      emptyOutDir: !isBackgroundBuild,
      rollupOptions: {
        input: fileURLToPath(new URL(`./src/${entryFile}`, import.meta.url)),
        output: {
          assetFileNames: '[name][extname]',
          entryFileNames: `${entryName}.js`,
          format: 'iife',
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});
