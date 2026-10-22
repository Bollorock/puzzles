import { defineConfig } from 'vite-plus';

export default defineConfig({
  // Relative base so the build works from any GitHub Pages sub-path.
  base: './',
  build: {
    target: 'es2022',
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
  lint: {
    ignorePatterns: ['dist/**'],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    singleQuote: true,
    ignorePatterns: ['dist/**'],
  },
});
