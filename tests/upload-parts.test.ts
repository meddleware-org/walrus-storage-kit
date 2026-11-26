// @vitest-environment jsdom
// The upload widget's parts, on their own: what each renders for each state, and that the ids they make are unique per instance.
import { beforeAll, describe, expect, it } from 'vitest'
import { installDialogShim } from '@meddleware/frontend-config/vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { axe } from 'vitest-axe'
import * as axeMatchers from 'vitest-axe/matchers'
import UploadFileStep from '../src/components/upload/UploadFileStep.vue'
import UploadStorageOptions from '../src/components/upload/UploadStorageOptions.vue'
import UploadRelayStatus from '../src/components/upload/UploadRelayStatus.vue'
import UploadRecovery from '../src/components/upload/UploadRecovery.vue'
import UploadProgress from '../src/components/upload/UploadProgress.vue'
import UploadDuplicateDialog from '../src/components/upload/UploadDuplicateDialog.vue'

// Register the `toHaveNoViolations` matcher (its types are in tests/helpers/vitest-axe.d.ts).
expect.extend(axeMatchers)
// jsdom has no canvas: axe-core probes `getContext()` and jsdom logs "Not implemented"; answer `null` up front (the same result axe already gets) so the noise goes away without changing what is tested.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext
// axe options: the `region` rule is off, because a part under test is a fragment, not a whole page.
const opts = { rules: { region: { enabled: false } } }

// jsdom has no native `<dialog>` behaviour: install the shared shim so the progress and duplicate dialogs can open.
beforeAll(installDialogShim)

// Step 1: the file input reports the chosen file (or none), describes itself by its own hint, and shows a refusal.
describe('UploadFileStep', () => {
  // jsdom cannot choose a file, so the input's `files` is set by hand before each `change`: first one file, then an empty list (the picker was cleared).
  it('reports the chosen file, and none when the picker is cleared', async () => {
    const w = mount(UploadFileStep, { props: { accept: 'image/*' } })
    const input = w.get('input[type="file"]')
    const file = new File(['x'], 'a.png')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    Object.defineProperty(input.element, 'files', { value: [], configurable: true })
    await input.trigger('change')
    expect(w.emitted('select')).toEqual([[file], [null]])
    expect(input.attributes('accept')).toBe('image/*')
  })

  // Two instances on one page get two different hint ids (a hard-coded id would collide), and each input points at its own hint.
  it('describes the input by its own help text, with an id no other instance on the page shares', () => {
    const two = defineComponent({ render: () => [h(UploadFileStep, { accept: '*/*' }), h(UploadFileStep, { accept: '*/*' })] })
    const w = mount(two, { attachTo: document.body })
    const inputs = w.findAll('input')
    const ids = inputs.map((i) => i.attributes('aria-describedby'))
    expect(ids[0]).toBeTruthy()
    expect(ids[0]).not.toBe(ids[1])
    for (const id of ids) expect(w.get(`[id="${id}"]`).text()).toContain('Select a file')
    w.unmount()
  })

  it('shows a refusal as an alert', () => {
    const w = mount(UploadFileStep, { props: { accept: '*/*', error: 'File too large (max 2 KB).' } })
    expect(w.get('[role="alert"]').text()).toBe('File too large (max 2 KB).')
  })
})

// The duration and permanence controls. `mountOptions` binds the two models to props, as the widget does with `v-model`.
describe('UploadStorageOptions', () => {
  const mountOptions = (epochs = 53, permanent = true) =>
    mount(UploadStorageOptions, {
      props: { epochs, permanent, maxEpochs: 53, 'onUpdate:epochs': (v: number) => w.setProps({ epochs: v }), 'onUpdate:permanent': (v: boolean) => w.setProps({ permanent: v }) },
      attachTo: document.body,
    })
  let w: ReturnType<typeof mountOptions>

  // "Max" sets the maximum and is disabled while at it; "Short" sets 10 epochs.
  it('presets set the duration, and Max is disabled at the maximum', async () => {
    w = mountOptions()
    const [max, short] = w.findAll('button')
    expect(max!.attributes('disabled')).toBeDefined()
    await short!.trigger('click')
    expect(w.props('epochs')).toBe(10)
    expect(max!.attributes('disabled')).toBeUndefined()
    await max!.trigger('click')
    expect(w.props('epochs')).toBe(53)
    w.unmount()
  })

  it('labels the number field, and states the limit as its hint', () => {
    w = mountOptions()
    const field = w.get('input[type="number"]')
    expect(w.get(`label[for="${field.attributes('id')}"]`).text()).toBe('Storage duration (epochs)')
    expect(w.text()).toContain('Max 53 epochs per upload')
    w.unmount()
  })

  // Clearing the number field must not set the duration to 0 (or NaN): the last value stays, so a new number can be typed.
  it('does not take an emptied field as a duration', async () => {
    w = mountOptions(20)
    await w.get('input[type="number"]').setValue('')
    expect(w.props('epochs')).toBe(20)
    w.unmount()
  })

  // Unticking the box means a deletable blob; the markup is also checked by axe.
  it('maps the checkbox to permanence', async () => {
    w = mountOptions()
    await w.get('input[type="checkbox"]').setValue(false)
    expect(w.props('permanent')).toBe(false)
    expect(await axe(w.html(), opts)).toHaveNoViolations()
    w.unmount()
  })
})

// What the relay line says: checking, a configuration error, a pass required, and the relay choice.
describe('UploadRelayStatus', () => {
  const relays = [
    { label: 'Meddleware relay', host: 'https://op.example', tip: null, tipStatus: 'unknown' as const, isPublic: false },
    { label: 'Public relay', host: 'https://pub.example', tip: null, tipStatus: 'unknown' as const, isPublic: true },
  ]
  const base = { configError: null, connected: true, pending: false, relays, host: relays[0]!.host }

  // The live region is always in the page (a region added together with its message is not announced), and its text appears and clears with the state.
  it('keeps its live region mounted and says when it is checking', async () => {
    const w = mount(UploadRelayStatus, { props: { ...base, pending: true } })
    expect(w.get('output').text()).toBe('Checking the upload relay…')
    await w.setProps({ pending: false })
    expect(w.get('output').text()).toBe('')
  })

  // A configuration fault shows plain words only: no cause, no host, and no pass prompt.
  it('shows a configuration error and nothing else about the relay', () => {
    const w = mount(UploadRelayStatus, { props: { ...base, configError: 'host must use https', relays: [] } })
    expect(w.get('[role="alert"]').text()).toBe('Uploads are unavailable right now. Try again later, or contact the site.')
    expect(w.text()).not.toContain('https') // the cause is logged by the composable, not shown
    expect(w.text()).not.toContain('access pass')
  })

  it('says a pass is required when no relay is available', () => {
    const w = mount(UploadRelayStatus, { props: { ...base, relays: [] } })
    expect(w.text()).toContain('An access pass is required')
    expect(w.find('[role="status"]').exists()).toBe(true)
  })

  // The selector shows only on the options step (`choose`) and only with more than one relay; picking the second emits the new host.
  it('offers the choice only when asked to and there is more than one relay', async () => {
    expect(mount(UploadRelayStatus, { props: base }).find('fieldset').exists()).toBe(false)
    expect(mount(UploadRelayStatus, { props: { ...base, choose: true, relays: [relays[0]!] } }).find('fieldset').exists()).toBe(false)
    const w = mount(UploadRelayStatus, { props: { ...base, choose: true } })
    expect(w.get('legend').text()).toBe('Upload relay')
    await w.findAll('input[type="radio"]')[1]!.setValue(true)
    expect(w.emitted('update:host')).toEqual([['https://pub.example']])
    expect(await axe(w.html(), opts)).toHaveNoViolations()
  })
})

// The two recovery prompts, in both states: what stopped, the button text, the disabled state while running, and one `retry` per click.
describe('UploadRecovery', () => {
  it.each([
    ['upload', false, 'Retry upload', 'registered and paid for'],
    ['upload', true, 'Retrying…', 'registered and paid for'],
    ['certify', false, 'Certify blob', 'not yet certified'],
    ['certify', true, 'Certifying…', 'not yet certified'],
  ] as const)('%s, busy=%s: "%s"', async (kind, busy, label, says) => {
    const w = mount(UploadRecovery, { props: { kind, busy } })
    expect(w.text()).toContain(says)
    const button = w.get('button')
    expect(button.text()).toBe(label)
    expect(button.attributes('disabled') !== undefined).toBe(busy)
    expect(w.find('[role="status"]').exists()).toBe(true)
    if (!busy) {
      await button.trigger('click')
      expect(w.emitted('retry')).toHaveLength(1)
    }
    expect(await axe(w.html(), opts)).toHaveNoViolations()
  })
})

// The progress dialog: the stepper's states, the extra access step of a gated upload, the words-only fallback and the modal behaviour.
describe('UploadProgress', () => {
  const stepsOf = (w: ReturnType<typeof mount>) => w.findAll('li').map((li) => [li.get('.ui-stepper__label').text(), li.classes().find((c) => c.startsWith('is-'))])

  // Steps before the active one are done, the active one is busy, the rest pending; the stepper says "Step 3 of 4".
  it('walks the core steps: done before the active one, in progress on it, not started after', () => {
    const w = mount(UploadProgress, { props: { open: true, step: 'upload', gated: false, status: 'Uploading to the relay…' } })
    expect(stepsOf(w)).toEqual([['Encode', 'is-done'], ['Register', 'is-done'], ['Upload', 'is-busy'], ['Certify', 'is-pending']])
    expect(w.text()).toContain('Uploading to the relay…')
    expect(w.get('ol').attributes('aria-label')).toBe('Step 3 of 4')
  })

  it('has a leading Access step for a gated upload', () => {
    const w = mount(UploadProgress, { props: { open: true, step: 'access', gated: true, status: '' } })
    expect(stepsOf(w)[0]).toEqual(['Access', 'is-busy'])
    expect(w.findAll('li')).toHaveLength(5)
  })

  it('shows only the words for a caller that reports no structured step, and "Preparing…" before any', () => {
    const w = mount(UploadProgress, { props: { open: true, step: null, gated: false, status: '' } })
    expect(w.find('ol').exists()).toBe(false)
    expect(w.text()).toContain('Preparing…')
  })

  // The native dialog opens when `open` becomes true and has no close button: the person cannot dismiss an upload in progress.
  it('is a modal that is open only while uploading, and cannot be dismissed', async () => {
    const w = mount(UploadProgress, { props: { open: false, step: null, gated: false, status: '' }, attachTo: document.body })
    expect(w.get('dialog').attributes('open')).toBeUndefined()
    await w.setProps({ open: true })
    expect(w.get('dialog').attributes('open')).toBeDefined()
    expect(w.find('.mw-dialog__close').exists()).toBe(false)
    w.unmount()
  })
})

// The duplicate choice: wording and main action follow whether the existing copy is certified or pending.
describe('UploadDuplicateDialog', () => {
  it('offers Extend for a certified copy, and the three ways out', async () => {
    const w = mount(UploadDuplicateDialog, { props: { existing: { kind: 'certified', blobId: 'b', objectId: '0x1', endEpoch: 99 } } })
    expect(w.text()).toContain('available until epoch 99')
    const buttons = w.findAll('footer button')
    expect(buttons.map((b) => b.text())).toEqual(['Extend it', 'Upload a new copy', 'Cancel'])
    for (const b of buttons) await b.trigger('click')
    expect(w.emitted('manage')).toHaveLength(1)
    expect(w.emitted('upload-anyway')).toHaveLength(1)
    expect(w.emitted('cancel')).toHaveLength(1)
  })

  it('offers Certify for a pending copy', () => {
    const w = mount(UploadDuplicateDialog, { props: { existing: { kind: 'pending', blobId: 'b', objectId: '0x1', endEpoch: 0 } } })
    expect(w.text()).toContain("haven't certified it yet")
    expect(w.get('footer button').text()).toBe('Certify it')
  })
})

// A guard on every `.vue` file: no hard-coded element ids and no colour literals, so two widgets on a page cannot collide and every colour comes from the tokens.
describe('source hygiene', () => {
  it('has no hard-coded element ids (two widgets on one page would collide) and no colour literals', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.vue') ? [join(dir, e.name)] : []))
    for (const file of walk('src')) {
      const text = readFileSync(file, 'utf8')
      expect(text, `${file}: hard-coded id`).not.toMatch(/\sid="[^"]+"/)
      expect(text, `${file}: hex colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    }
  })
})
