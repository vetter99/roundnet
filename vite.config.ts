import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build works on itch.io and any static host subpath.
  base: './',
  plugins: [],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
