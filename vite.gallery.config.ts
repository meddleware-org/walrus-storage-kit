// Vite configuration for the component gallery (`npm run build:gallery`); the Playwright run serves the result with `vite preview` (see playwright.config.ts).
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Builds the gallery used by the Playwright + axe contrast gate (not part of the package).
export default defineConfig({
  // The gallery's own folder is the project root (its index.html is the entry).
  root: 'gallery',
  // The Vue plugin compiles the single-file components.
  plugins: [vue()],
  // Output next to the repository root (ignored by git), emptied before each build.
  build: { outDir: '../gallery-dist', emptyOutDir: true },
})
