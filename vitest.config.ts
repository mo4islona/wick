import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [vue(), svelte({ preprocess: vitePreprocess(), hot: false })],
  test: {
    include: [
      'packages/core/src/**/*.test.ts',
      'packages/react/src/**/*.test.{ts,tsx}',
      'packages/vue/src/**/*.test.ts',
      'packages/svelte/src/**/*.test.ts',
      'docs/__tests__/**/*.test.{ts,tsx}',
    ],
    environmentMatchGlobs: [
      // Tests that instantiate ChartInstance need a DOM.
      ['packages/core/src/__tests__/chart-*.test.ts', 'happy-dom'],
      ['packages/core/src/__tests__/navigator/controller.test.ts', 'happy-dom'],
      ['packages/core/src/perf/__tests__/chart-*.test.ts', 'happy-dom'],
      ['packages/react/**', 'happy-dom'],
      ['packages/vue/**', 'happy-dom'],
      // Svelte 4 onMount render callbacks don't fire in happy-dom (see
      // https://github.com/capricorn86/happy-dom/issues or similar). jsdom
      // handles Svelte's scheduler correctly.
      ['packages/svelte/**', 'jsdom'],
      // Playground React tests + hooks that touch localStorage/DOM.
      ['docs/__tests__/useSettings.test.ts', 'happy-dom'],
      ['docs/__tests__/search.test.tsx', 'happy-dom'],
      // themeJson uses HTMLCanvasElement for CSS-color → hex normalization.
      ['docs/__tests__/themeJson.test.ts', 'happy-dom'],
    ],
    setupFiles: ['packages/react/test-setup.ts'],
    // Svelte 4's dev helper calls `set_current_component` with a stale component
    // across test files — scope per file so teardown between describe blocks is clean.
    server: {
      deps: {
        inline: [/@testing-library\/svelte/],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.{ts,tsx,vue,svelte}'],
      exclude: [
        'packages/*/src/**/__tests__/**',
        'packages/*/src/**/*.test.{ts,tsx}',
        'packages/*/src/**/*.bench.ts',
        'packages/*/src/**/types.ts',
        'packages/*/dist/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@wick-charts/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@wick-charts/react': resolve(__dirname, 'packages/react/src/index.ts'),
      '@wick-charts/vue': resolve(__dirname, 'packages/vue/src/index.ts'),
      '@wick-charts/svelte': resolve(__dirname, 'packages/svelte/src/index.ts'),
    },
    // In SSR builds, vite-plugin-svelte compiles to `generate: 'ssr'` which
    // turns `onMount` into a no-op. Vitest runs test files in SSR mode by
    // default — prefer the client-side ("browser") export so Svelte emits a
    // DOM runtime with working lifecycle hooks.
    conditions: ['browser', 'svelte', 'module', 'import', 'default'],
  },
  ssr: {
    noExternal: ['svelte', '@wick-charts/svelte'],
  },
});
