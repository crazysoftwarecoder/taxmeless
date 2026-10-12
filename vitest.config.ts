import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts', 'schemas/**/*.test.ts', 'scripts/**/*.test.ts'] },
});
