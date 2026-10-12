import { defineConfig } from 'vite';

export default defineConfig({
  base: '/where-it-grows/',
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 900 },
  test: { include: ['src/**/*.test.ts', 'schemas/**/*.test.ts'] },
});
