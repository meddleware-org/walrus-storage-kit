// Screenshots for LOOKING at the gallery (see @meddleware/frontend-config/shots). Run: npm run shots
import type { Page } from '@playwright/test'
import { defineShots } from '@meddleware/frontend-config/shots'

const view = (v: string, fail = 'none') => async (page: Page) => {
  await page.goto(`/?view=${v}&fail=${fail}`)
  await page.waitForSelector('main')
  await page.waitForTimeout(500)
}

/** The upload widget at its options step (a file chosen), or at its review step, or while an upload that never finishes is running. */
const upload = (to: 'options' | 'review' | 'progress', fail = 'none') => async (page: Page) => {
  await view('upload', to === 'progress' ? 'hang' : fail)(page)
  await page.setInputFiles('input[type="file"]', { name: 'icon.png', mimeType: 'image/png', buffer: Buffer.from([1, 2, 3]) })
  await page.getByLabel('Storage duration').waitFor() // choosing a file moves the widget to its options step
  if (to === 'options') return
  await page.getByRole('button', { name: 'Next' }).click()
  if (to === 'progress') await page.getByRole('button', { name: 'Upload to Walrus' }).click()
  await page.waitForTimeout(300)
}

defineShots({
  badges: view('badges'),
  cta: view('cta'),
  upload: view('upload'),
  'upload-options': upload('options'),
  'upload-review': upload('review'),
  'upload-progress': upload('progress'),
  'upload-retry': view('upload', 'retry'),
})
