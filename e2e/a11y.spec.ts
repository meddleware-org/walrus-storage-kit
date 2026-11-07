// The shared accessibility sweep over every state of the three components in the gallery: WCAG 2.2 AA and AAA (gating) in every colour
// mode × season, reflow at 320 px, 200% text, forced colours, reduced motion and the keyboard pass.
import { expect, type Page } from '@playwright/test'
import { defineA11ySuite } from '@meddleware/frontend-config/a11y'

const view = (v: string, fail = 'none') => async (page: Page) => {
  await page.goto(`/?view=${v}&fail=${fail}`)
  await page.waitForSelector('main')
}

/** The upload widget with a file chosen, at its options step, its review step, or after a click on Upload with a failure scripted. */
const upload = (to: 'file' | 'options' | 'review' | 'attempt', fail = 'none', shows?: string) => async (page: Page) => {
  await view('upload', fail)(page)
  if (to === 'file') {
    await expect(page.locator('input[type="file"]')).toBeAttached()
    return
  }
  await page.setInputFiles('input[type="file"]', { name: 'icon.png', mimeType: 'image/png', buffer: Buffer.from([1, 2, 3]) })
  await expect(page.getByLabel('Storage duration')).toBeVisible() // choosing a file moves the widget to its options step
  if (to === 'options') return
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByText('Estimated cost')).toBeVisible()
  if (to === 'review') return
  await page.getByRole('button', { name: 'Upload to Walrus' }).click()
  if (fail === 'retry') await page.getByRole('button', { name: 'Change options' }).click()
  await expect(page.getByText(shows!).first()).toBeVisible()
}

defineA11ySuite(
  {
    'relay badges': async (page) => {
      await view('badges')(page)
      for (const text of ['Relay unreachable', 'tip unknown', 'tip above the limit', 'Relay not available', 'Checking relay…']) {
        await expect(page.getByText(text)).toBeVisible()
      }
    },
    'purchase prompt': async (page) => {
      await view('cta')(page)
      await expect(page.getByText('Gate owner receives').first()).toBeVisible()
      await expect(page.getByText('The pass price could not be read from the chain')).toBeVisible()
    },
    'upload: file step': upload('file'),
    'upload: options step': upload('options'),
    'upload: review step': upload('review'),
    'upload: retry': upload('attempt', 'retry', 'Retry upload'),
    'upload: certify': upload('attempt', 'certify', 'Certify blob'),
    'upload: duplicate dialog': upload('attempt', 'duplicate', 'You already have this blob'),
    'upload: progress dialog': upload('attempt', 'hang', 'Uploading to Walrus'),
  },
  // The badges are a static summary and the progress dialog only reports progress: nothing to operate, so no keyboard pass.
  { aaa: 'gate', noKeyboard: ['relay badges', 'upload: progress dialog'] },
)
