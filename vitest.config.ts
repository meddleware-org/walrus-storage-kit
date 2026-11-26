// Vitest configuration for the offline unit tests (`npm test`): Vue single-file components, one Vue copy, and the Meddleware packages' CSS processed through Vite.
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { inlineMeddleware } from '@meddleware/frontend-config/vitest'

export default defineConfig({
  // The Vue plugin compiles the single-file components the tests mount.
  plugins: [vue()],
  // One Vue copy for SFCs and @vue/test-utils (events/reactivity must cross the boundary).
  resolve: { dedupe: ['vue', '@vue/test-utils'] },
  test: {
    // Node, not a browser: the components are mounted with @vue/test-utils (the tests that need a DOM set up their own).
    environment: 'node',
    // Unit tests live beside the pure lib and under tests/. Localnet integration suites are gated
    // and run via vitest.integration.config.ts so the default `npm test` stays fast and offline.
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['tests/integration/**', 'node_modules/**'],
    // @meddleware/ui imports its own .css (each component brings its CSS), which Node cannot import: process it through Vite.
    server: { deps: { inline: inlineMeddleware } },
  },
})
