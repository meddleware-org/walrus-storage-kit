import { definePlaywrightConfig } from '@meddleware/frontend-config/playwright'

// The component gallery is built and served with `vite preview`; Chromium locally, all five browser projects in CI (E2E_BROWSERS=all to
// run them locally). The screenshot capture (`npm run shots`) is for looking, not asserting, and only runs when asked.
export default definePlaywrightConfig({ port: 4175, kind: 'gallery' })
