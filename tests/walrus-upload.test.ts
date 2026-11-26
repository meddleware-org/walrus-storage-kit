// @vitest-environment jsdom
// The upload widget's money paths (F14): what is passed to the upload (epochs, permanence), the cost
// line, the duplicate prompt, the certify retry and the same-registration upload retry, plus the
// account/network reset and stale-result guard (F16). The relay composable is the real one, driven by a
// stubbed `fetch`; the real @meddleware/ui renders (the dialog needs the jsdom shim).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { installDialogShim } from '@meddleware/frontend-config/vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, markRaw, nextTick, ref, shallowRef } from 'vue'
import {
  attachCertifyRetry,
  attachDuplicateExisting,
  attachUploadRetry,
  type BlobUploadResult,
  type ExistingCopy,
} from '@meddleware/walrus-storage-client/flow'
import WalrusUpload from '../src/components/WalrusUpload.vue'

// jsdom has no native `<dialog>` behaviour: install the shared shim so the progress and duplicate dialogs can open.
beforeAll(installDialogShim)

// The public relay and an operator relay; most tests mount the widget with both hosts equal (no operator relay), so no gate or relay choice is involved.
const PUB = 'https://public.example.com'
const OP = 'https://operator.example.com'
// result(blobId): a finished upload's result, as the app's `performUpload` would resolve.
const result = (blobId = 'blob-1'): BlobUploadResult => ({ blobId, url: `https://agg.example/v1/blobs/${blobId}` }) as BlobUploadResult

/** The options the widget passes to `performUpload`. */
type Opts = { relayHost: string; epochs: number; force?: boolean; deletable?: boolean; onStatus: (s: unknown) => void }

/** stubRelays(table): a per-host `fetch` stub for the tip-config probes; a host not in the table advertises a constant 1000 MIST tip. */
function stubRelays(table: Record<string, unknown> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const host = String(url).replace(/\/v1\/tip-config$/, '')
      if (!(host in table)) return new Response('{"send_tip":{"kind":{"const":1000}}}')
      const answer = table[host]
      return typeof answer === 'number' ? new Response('', { status: answer }) : new Response(JSON.stringify(answer))
    }),
  )
}

/** The shape of the app's `performUpload`. */
type Perform = (bytes: Uint8Array, opts: Opts) => Promise<BlobUploadResult>

/** mountWidget(performUpload, extra): mount `WalrusUpload` for a connected wallet on a single (public) relay, with extra props on top. */
function mountWidget(performUpload: Perform, extra: Record<string, unknown> = {}) {
  return mount(WalrusUpload, {
    props: {
      hosts: { operator: PUB, public: PUB },
      connected: true,
      performUpload: performUpload as never,
      ...extra,
    },
  })
}

/** chooseFile(w, size, name): choose a file of `size` bytes by setting the input's `files` by hand (jsdom cannot pick one) and wait until the widget has read it. */
async function chooseFile(w: VueWrapper, size = 3, name = 'a.png'): Promise<void> {
  const input = w.get('input[type="file"]')
  const file = new File([new Uint8Array(size)], name)
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await vi.waitFor(() => expect(w.text()).toContain(name))
  await flushPromises()
}

// button(w, label): the first button whose text matches `label` (a missing button is a test error).
const button = (w: VueWrapper, label: RegExp) => {
  const b = w.findAll('button').find((x) => label.test(x.text()))
  if (!b) throw new Error(`no button ${label}`)
  return b
}

/** File → options → review, ready to press "Upload to Walrus". */
async function toReview(w: VueWrapper): Promise<void> {
  await chooseFile(w)
  await button(w, /^Next$/).trigger('click')
  await flushPromises()
}

/** upload(w): press "Upload to Walrus" and let the promises settle. */
async function upload(w: VueWrapper): Promise<void> {
  await button(w, /Upload to Walrus/).trigger('click')
  await flushPromises()
}

// Every test starts with the default relay stub; the real `fetch` is restored after.
beforeEach(() => stubRelays())
afterEach(() => vi.unstubAllGlobals())

// What `performUpload` receives: the bytes, the relay, the duration (clamped to 1 to 53), permanence (the checkbox maps to `deletable`), and the guards before anything is uploaded.
describe('WalrusUpload: what is passed to the upload', () => {
  // The happy path: the app is given exactly the chosen bytes, the selected relay and the maximum duration, as a permanent (not deletable) blob.
  it('uploads the chosen bytes to the selected relay for the max duration, permanent by default', async () => {
    const perform = vi.fn<Perform>(async () => result())
    const w = mountWidget(perform)
    await flushPromises()
    await toReview(w)
    await upload(w)
    expect(perform).toHaveBeenCalledTimes(1)
    const [bytes, opts] = perform.mock.calls[0]!
    expect(bytes).toEqual(new Uint8Array(3))
    expect(opts).toMatchObject({ relayHost: PUB, epochs: 53, force: false, deletable: false })
    expect(w.emitted('uploaded')).toEqual([[result()]])
    expect(w.emitted('settled')).toHaveLength(1)
  })

  // Unticking "Permanent" asks the app for a deletable blob.
  it('maps the permanence checkbox to deletable', async () => {
    const perform = vi.fn<Perform>(async () => result())
    const w = mountWidget(perform)
    await flushPromises()
    await chooseFile(w)
    await w.get('input[type="checkbox"]').setValue(false)
    await button(w, /^Next$/).trigger('click')
    await upload(w)
    expect(perform.mock.calls[0]![1].deletable).toBe(true)
  })

  // A duration typed outside 1 to 53 is clamped, and the clamped value is what is used and shown.
  it('clamps the duration to [1, 53] and uses the clamped value', async () => {
    const perform = vi.fn<Perform>(async () => result())
    const w = mountWidget(perform)
    await flushPromises()
    await chooseFile(w)
    const epochs = w.get('input[type="number"]')
    await epochs.setValue('999')
    await nextTick()
    expect((epochs.element as HTMLInputElement).value).toBe('53')
    await epochs.setValue('0')
    await nextTick()
    expect((epochs.element as HTMLInputElement).value).toBe('1')
    await epochs.setValue('7')
    await button(w, /^Next$/).trigger('click')
    await upload(w)
    expect(perform.mock.calls[0]![1].epochs).toBe(7)
  })

  // The two presets set 10 epochs and the maximum.
  it('Short and Max set the duration', async () => {
    const w = mountWidget(vi.fn<Perform>(async () => result()))
    await flushPromises()
    await chooseFile(w)
    await button(w, /^Short$/).trigger('click')
    expect((w.get('input[type="number"]').element as HTMLInputElement).value).toBe('10')
    await button(w, /^Max$/).trigger('click')
    expect((w.get('input[type="number"]').element as HTMLInputElement).value).toBe('53')
  })

  // A file over the UX-only size guard is refused with a message and nothing is uploaded (the relay edge is the real cap).
  it('refuses a file over maxBytes before anything is uploaded', async () => {
    const perform = vi.fn<Perform>(async () => result())
    const w = mountWidget(perform, { maxBytes: 2048 })
    await flushPromises()
    const input = w.get('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [new File([new Uint8Array(4096)], 'big.bin')], configurable: true })
    await input.trigger('change')
    expect(w.get('[role="alert"]').text()).toMatch(/File too large \(max 2 KB\)/)
    expect(perform).not.toHaveBeenCalled()
  })

  // The upload button is disabled and pressing nothing calls the app while no wallet is connected.
  it('does not upload without a connected wallet', async () => {
    const w = mountWidget(vi.fn<Perform>(async () => result()), { connected: false })
    await flushPromises()
    await chooseFile(w)
    await button(w, /^Next$/).trigger('click')
    expect(button(w, /Upload to Walrus/).attributes('disabled')).toBeDefined()
  })

  // An error without a retry or duplicate marker is shown as text.
  it('shows the failure of a plain upload error', async () => {
    const w = mountWidget(vi.fn<Perform>(async () => { throw new Error('relay said no') }))
    await flushPromises()
    await toReview(w)
    await upload(w)
    expect(w.get('[role="alert"]').text()).toBe('relay said no')
    expect(w.emitted('uploaded')).toBeUndefined()
    expect(w.emitted('settled')).toHaveLength(1)
  })
})

// The estimated cost line: storage in WAL (follows the duration), the relay fee in SUI, and plain words when the fee is unknown, above the limit or absent.
describe('WalrusUpload: cost line', () => {
  // The cost line adds the storage figure (WAL, scales with the duration) to the relay fee (SUI) and notes the network fee.
  it('shows storage in WAL, the relay fee in SUI and gas, and follows the duration', async () => {
    stubRelays({ [PUB]: { send_tip: { kind: { const: 2_000_000 } } } })
    const estimate = vi.fn(async (_size: number, epochs: number) => BigInt(epochs) * 1_000_000n)
    const w = mountWidget(vi.fn<Perform>(async () => result()), { estimateStorageCost: estimate })
    await flushPromises()
    await chooseFile(w)
    await flushPromises()
    await button(w, /^Next$/).trigger('click')
    await flushPromises()
    expect(w.get('.wru-cost').text()).toBe('Estimated cost: ~0.0530 WAL storage (53 epochs) + ~0.0020 SUI relay fee (+ network fee)')
    await button(w, /^Change options$/).trigger('click')
    await w.get('input[type="number"]').setValue('10')
    await flushPromises()
    await button(w, /^Next$/).trigger('click')
    await flushPromises()
    expect(w.get('.wru-cost').text()).toBe('Estimated cost: ~0.0100 WAL storage (10 epochs) + ~0.0020 SUI relay fee (+ network fee)')
  })

  // An unreadable tip is stated, not left out, so the person does not assume it is free.
  it('says the relay fee is unknown when the relay tip cannot be read, instead of leaving it out', async () => {
    stubRelays({ [PUB]: { send_tip: 'garbage' } })
    const w = mountWidget(vi.fn<Perform>(async () => result()))
    await flushPromises()
    await toReview(w)
    expect(w.get('.wru-cost').text()).toBe('Estimated cost: relay fee unknown (+ network fee)')
  })

  // A tip above the ceiling is reported as above the safety limit.
  it('says so when the relay tip is above the safety limit', async () => {
    stubRelays({ [PUB]: { send_tip: { kind: { const: '900000000000' } } } })
    const w = mountWidget(vi.fn<Perform>(async () => result()))
    await flushPromises()
    await toReview(w)
    expect(w.get('.wru-cost').text()).toBe('Estimated cost: relay fee above the safety limit (+ network fee)')
  })

  // A relay that advertises no tip is stated as "no relay fee".
  it('says there is no relay fee for a no_tip relay', async () => {
    stubRelays({ [PUB]: 'no_tip' })
    const w = mountWidget(vi.fn<Perform>(async () => result()))
    await flushPromises()
    await toReview(w)
    expect(w.get('.wru-cost').text()).toBe('Estimated cost: no relay fee (+ network fee)')
  })

  // A slow estimate for a duration the person has since changed must not overwrite the current figure (the request counter).
  it('ignores a storage estimate that arrives for an older duration', async () => {
    stubRelays({ [PUB]: 'no_tip' })
    const pending: Array<(v: bigint) => void> = []
    const estimate = vi.fn<(size: number, epochs: number) => Promise<bigint | null>>(
      () => new Promise<bigint | null>((r) => pending.push(r as (v: bigint) => void)),
    )
    const w = mountWidget(vi.fn<Perform>(async () => result()), { estimateStorageCost: estimate })
    await flushPromises()
    await chooseFile(w)
    await flushPromises()
    await w.get('input[type="number"]').setValue('10')
    await flushPromises()
    expect(pending.length).toBeGreaterThanOrEqual(2)
    pending.at(-1)!(1_000_000n) // the current duration answers first
    await flushPromises()
    pending[0]!(9_000_000_000n) // the stale answer arrives last and must not win
    await flushPromises()
    await button(w, /^Next$/).trigger('click')
    await flushPromises()
    expect(w.get('.wru-cost').text()).toContain('~0.0010 WAL storage (10 epochs)')
  })
})

// Audit F13: the number of wallet approvals is stated exactly: two on an open relay, three or four on a gated one, exact once the pass kind is known.
describe('WalrusUpload: approvals copy (F13)', () => {
  /** hint(access, hosts): mount the widget, go to the review step and return the text of its hint lines (where the approvals copy is). */
  async function hint(access?: Record<string, unknown>, hosts = { operator: PUB, public: PUB }) {
    const w = mountWidget(vi.fn<Perform>(async () => result()), access ? { access, hosts } : { hosts })
    await flushPromises()
    await toReview(w)
    return w.findAll('.wru-hint').map((h) => h.text()).join(' ')
  }

  // Without a gate: blob registration and blob certification.
  it('is two approvals on an open relay', async () => {
    expect(await hint()).toContain('two wallet approvals (blob registration, blob certification)')
  })

  // With a gate: prove access and the two blob steps, plus spending a use when the pass is single-use; "three or four" until the kind is known.
  it('is three or four on the gated operator relay, exact once the pass kind is known', async () => {
    const hosts = { operator: OP, public: PUB }
    // markRaw: the test utils would otherwise unwrap the nested ref, which the apps' plain objects keep.
    const gated = markRaw({ gateConfigured: true, hasAccess: ref<boolean | null>(true) })
    expect(await hint(gated, hosts)).toContain('three or four wallet approvals')
    expect(await hint(markRaw({ ...gated, singleUse: ref(false) }), hosts)).toContain('three wallet approvals (prove access, blob registration, blob certification)')
    expect(await hint(markRaw({ ...gated, singleUse: ref(true) }), hosts)).toContain('four wallet approvals (spend a pass use, prove access')
  })

  // Guards against the old wording that mixed up what the approvals are.
  it('never says "three wallet approvals (relay access, …)" any more', async () => {
    expect(await hint()).not.toMatch(/relay access, blob registration/)
  })
})

// When the app reports the wallet already owns the blob, the person is offered to manage it (Extend or Certify) instead of paying for a duplicate; uploading anyway bypasses the check.
describe('WalrusUpload: duplicate blob prompt', () => {
  const certified: ExistingCopy = { kind: 'certified', blobId: 'blob-1', objectId: '0xblob', endEpoch: 99 }
  const pendingCopy: ExistingCopy = { kind: 'pending', blobId: 'blob-1', objectId: '0xblob', endEpoch: 0 }

  /** duplicate(existing): an error the app would throw when the wallet already owns the blob, carrying the existing copy. */
  function duplicate(existing: ExistingCopy) {
    const err = new Error('you own this blob')
    attachDuplicateExisting(err, existing)
    return err
  }

  // The app reports a certified duplicate: the prompt offers Extend and hands the copy to the host instead of uploading.
  it('offers Extend for a certified copy and hands it to the host instead of uploading', async () => {
    const perform = vi.fn<Perform>(async () => { throw duplicate(certified) })
    const w = mountWidget(perform)
    await flushPromises()
    await toReview(w)
    await upload(w)
    expect(w.text()).toContain('You already have this blob')
    expect(w.text()).toContain('available until epoch 99')
    await button(w, /^Extend it$/).trigger('click')
    expect(w.emitted('manage-existing')).toEqual([[certified]])
    expect(w.text()).not.toContain('You already have this blob')
    expect(perform).toHaveBeenCalledTimes(1)
    expect(w.emitted('uploaded')).toBeUndefined()
  })

  // The same for a copy that is registered but not certified.
  it('offers Certify for a pending copy', async () => {
    const w = mountWidget(vi.fn<Perform>(async () => { throw duplicate(pendingCopy) }))
    await flushPromises()
    await toReview(w)
    await upload(w)
    await button(w, /^Certify it$/).trigger('click')
    expect(w.emitted('manage-existing')).toEqual([[pendingCopy]])
  })

  // Choosing a duplicate anyway runs the upload again with `force`, so the app skips its pre-check.
  it('"Upload a new copy" uploads again with the duplicate check bypassed', async () => {
    const perform = vi.fn<Perform>()
    perform.mockRejectedValueOnce(duplicate(certified)).mockResolvedValueOnce(result('copy-2'))
    const w = mountWidget(perform)
    await flushPromises()
    await toReview(w)
    await upload(w)
    await button(w, /^Upload a new copy$/).trigger('click')
    await flushPromises()
    expect(perform).toHaveBeenCalledTimes(2)
    expect(perform.mock.calls[0]![1].force).toBe(false)
    expect(perform.mock.calls[1]![1].force).toBe(true)
    expect(w.emitted('uploaded')).toEqual([[result('copy-2')]])
  })

  // Cancelling closes the prompt without uploading or showing an error.
  it('Cancel closes the prompt without uploading or reporting an error', async () => {
    const perform = vi.fn<Perform>(async () => { throw duplicate(certified) })
    const w = mountWidget(perform)
    await flushPromises()
    await toReview(w)
    await upload(w)
    await button(w, /^Cancel$/).trigger('click')
    expect(w.text()).not.toContain('You already have this blob')
    expect(w.find('[role="alert"]').exists()).toBe(false)
    expect(perform).toHaveBeenCalledTimes(1)
  })
})

// An upload that landed but whose certification failed keeps a one-click retry that needs no re-upload and no relay fee.
describe('WalrusUpload: certify retry', () => {
  // A failed certify keeps the stored, paid-for blob and offers one more approval (network fee only) to certify it, no re-upload.
  it('offers a gas-only certify after a certify failure, and finishes without re-uploading', async () => {
    const retry = vi.fn(async () => result('certified'))
    const failure = new Error('certify rejected')
    attachCertifyRetry(failure, retry)
    const perform = vi.fn<Perform>(async () => { throw failure })
    const w = mountWidget(perform)
    await flushPromises()
    await toReview(w)
    await upload(w)
    expect(w.text()).toContain('uploaded and paid for but not yet certified')
    expect(w.emitted('uploaded')).toBeUndefined()
    await button(w, /^Certify blob$/).trigger('click')
    await flushPromises()
    expect(retry).toHaveBeenCalledTimes(1)
    expect(perform).toHaveBeenCalledTimes(1)
    expect(w.emitted('uploaded')).toEqual([[result('certified')]])
    expect(w.text()).not.toContain('Certify blob')
  })

  // If the retry is declined again the offer stays and the reason is shown.
  it('keeps the offer, and shows the reason, when the certify is declined again', async () => {
    const retry = vi.fn<() => Promise<BlobUploadResult>>().mockRejectedValueOnce(new Error('User rejected')).mockResolvedValueOnce(result('certified'))
    const failure = new Error('certify rejected')
    attachCertifyRetry(failure, retry)
    const w = mountWidget(vi.fn<Perform>(async () => { throw failure }))
    await flushPromises()
    await toReview(w)
    await upload(w)
    await button(w, /^Certify blob$/).trigger('click')
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toBe('User rejected')
    expect(w.emitted('uploaded')).toBeUndefined()
    await button(w, /^Certify blob$/).trigger('click')
    await flushPromises()
    expect(retry).toHaveBeenCalledTimes(2)
    expect(w.emitted('uploaded')).toEqual([[result('certified')]])
  })
})

// Audit F20: a relay upload that failed after the blob was registered (and paid for) can be retried on the same registration, with a fresh access proof, without paying again.
describe('WalrusUpload: same-registration upload retry (F20)', () => {
  /**
   * An error the app would throw after the relay upload failed: the user paid to register; the retry is the app's closure on that registration. It must not run the whole
   * upload again (which would register and pay a second time).
   */
  function relayFailure(retry: () => Promise<BlobUploadResult>) {
    const e = new Error('relay upload failed (503)')
    attachUploadRetry(e, retry)
    return e
  }

  // After a failed relay upload the person can retry on the same registration and finish.
  it('offers "Retry upload" with the reason, retries on the same registration, and finishes', async () => {
    const retry = vi.fn(async () => result('retried'))
    const perform = vi.fn<Perform>(async () => { throw relayFailure(retry) })
    const w = mountWidget(perform)
    await flushPromises()
    await toReview(w)
    await upload(w)
    // The offer is on the options step, where the user lands to read it.
    await button(w, /^Change options$/).trigger('click')
    expect(w.text()).toContain('registered and paid for')
    expect(w.text()).toContain('no second payment')
    expect(w.get('[role="alert"]').text()).toBe('relay upload failed (503)')
    await button(w, /^Retry upload$/).trigger('click')
    await flushPromises()
    expect(retry).toHaveBeenCalledTimes(1)
    expect(perform).toHaveBeenCalledTimes(1) // not a second upload, so not a second registration
    expect(w.emitted('uploaded')).toEqual([[result('retried')]])
    expect(w.text()).not.toContain('Retry upload')
    expect(w.emitted('settled')).toHaveLength(2) // the attempt and the retry
  })

  // A retry that fails again attaches a new retry: the offer continues with that one.
  it('keeps offering a retry on the new closure when the retry fails again', async () => {
    const second = vi.fn(async () => result('second'))
    const first = vi.fn<() => Promise<BlobUploadResult>>(async () => { throw relayFailure(second) })
    const w = mountWidget(vi.fn<Perform>(async () => { throw relayFailure(first) }))
    await flushPromises()
    await toReview(w)
    await upload(w)
    await button(w, /^Change options$/).trigger('click')
    await button(w, /^Retry upload$/).trigger('click')
    await flushPromises()
    expect(first).toHaveBeenCalledTimes(1)
    expect(w.text()).toContain('Retry upload')
    expect(w.emitted('uploaded')).toBeUndefined()
    await button(w, /^Retry upload$/).trigger('click')
    await flushPromises()
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledTimes(1)
    expect(w.emitted('uploaded')).toEqual([[result('second')]])
  })

  // When the app gives no further retry the offer stays (whether attempts are exhausted is the app's decision).
  it('keeps the offer when the retry fails without a further retry attached (attempts exhausted is the app’s call)', async () => {
    const retry = vi.fn<() => Promise<BlobUploadResult>>(async () => { throw new Error('gateway rejected the proof') })
    const w = mountWidget(vi.fn<Perform>(async () => { throw relayFailure(retry) }))
    await flushPromises()
    await toReview(w)
    await upload(w)
    await button(w, /^Change options$/).trigger('click')
    await button(w, /^Retry upload$/).trigger('click')
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toBe('gateway rejected the proof')
    // No new closure came with the error, so there is nothing more to retry on.
    expect(w.text()).not.toContain('Retry upload')
  })

  // A retry that gets as far as the upload but fails to certify changes the offer to the certify retry.
  it('hands over to the certify retry when the upload lands but certify fails', async () => {
    const certify = vi.fn(async () => result('certified'))
    const certifyFailure = new Error('certify rejected')
    attachCertifyRetry(certifyFailure, certify)
    const retry = vi.fn<() => Promise<BlobUploadResult>>(async () => { throw certifyFailure })
    const w = mountWidget(vi.fn<Perform>(async () => { throw relayFailure(retry) }))
    await flushPromises()
    await toReview(w)
    await upload(w)
    await button(w, /^Change options$/).trigger('click')
    await button(w, /^Retry upload$/).trigger('click')
    await flushPromises()
    expect(w.text()).not.toContain('Retry upload')
    await button(w, /^Next$/).trigger('click')
    expect(w.text()).toContain('not yet certified')
    await button(w, /^Certify blob$/).trigger('click')
    await flushPromises()
    expect(certify).toHaveBeenCalledTimes(1)
    expect(w.emitted('uploaded')).toEqual([[result('certified')]])
  })

  // A retry belongs to the file it was made for: a new upload or a new file clears it.
  it('a new upload or a new file clears a held retry', async () => {
    const retry = vi.fn(async () => result('retried'))
    const perform = vi.fn<Perform>()
    perform.mockRejectedValueOnce(relayFailure(retry)).mockResolvedValueOnce(result('fresh'))
    const w = mountWidget(perform)
    await flushPromises()
    await toReview(w)
    await upload(w)
    await upload(w)
    await button(w, /^Change options$/).trigger('click')
    expect(w.text()).not.toContain('Retry upload')
    expect(retry).not.toHaveBeenCalled()
  })
})

// Audit F16: a file, a held retry or an in-flight upload belongs to the wallet session that made it; when the account, network, hosts or connection change, the old session's outcome is dropped, never shown to the new one.
describe('WalrusUpload: another account or network (F16)', () => {
  // Another account or network: the file and any held retry are dropped.
  it('discards the file and a held retry when the session key changes', async () => {
    const retry = vi.fn(async () => result('retried'))
    const failure = new Error('relay upload failed')
    attachUploadRetry(failure, retry)
    const w = mountWidget(vi.fn<Perform>(async () => { throw failure }), { sessionKey: 'testnet:0xalice' })
    await flushPromises()
    await toReview(w)
    await upload(w)
    await button(w, /^Change options$/).trigger('click')
    expect(w.text()).toContain('Retry upload')

    await w.setProps({ sessionKey: 'testnet:0xbob' })
    await flushPromises()
    // Back at the file step with nothing of Alice's left to retry.
    expect(w.find('input[type="file"]').exists()).toBe(true)
    expect(w.text()).not.toContain('Retry upload')
    expect(w.text()).not.toContain('a.png')
    expect(w.find('[role="alert"]').exists()).toBe(false)
    expect(retry).not.toHaveBeenCalled()
  })

  // The same for a held certify retry.
  it('discards a held certify retry on a network change', async () => {
    const failure = new Error('certify rejected')
    attachCertifyRetry(failure, vi.fn(async () => result()))
    const w = mountWidget(vi.fn<Perform>(async () => { throw failure }), { sessionKey: 'testnet:0xalice' })
    await flushPromises()
    await toReview(w)
    await upload(w)
    expect(w.text()).toContain('Certify blob')
    await w.setProps({ sessionKey: 'mainnet:0xalice' })
    await flushPromises()
    expect(w.text()).not.toContain('Certify blob')
  })

  // An upload that finishes for the previous session must not emit `uploaded` for the new one.
  it('does not report the result of an upload that finishes after the session changed', async () => {
    let finish!: (r: BlobUploadResult) => void
    const perform = vi.fn<Perform>(() => new Promise((r) => (finish = r)))
    const w = mountWidget(perform, { sessionKey: 'testnet:0xalice' })
    await flushPromises()
    await toReview(w)
    await upload(w)
    expect(w.text()).toContain('Uploading to Walrus')
    await w.setProps({ sessionKey: 'testnet:0xbob' })
    finish(result('alice-blob'))
    await flushPromises()
    expect(w.emitted('uploaded')).toBeUndefined()
    expect(w.emitted('settled')).toHaveLength(1) // the host still refreshes its views
    expect(w.find('dialog[open]').exists()).toBe(false) // the progress dialog closed
  })

  // The same for failures, duplicate prompts and retry offers that arrive late.
  it('drops a failure, a duplicate prompt and a retry offer that arrive after the session changed', async () => {
    let fail!: (e: unknown) => void
    const w = mountWidget(vi.fn<Perform>(() => new Promise((_r, rej) => (fail = rej))), { sessionKey: 'a' })
    await flushPromises()
    await toReview(w)
    await upload(w)
    await w.setProps({ sessionKey: 'b' })
    const failure = new Error('too late')
    attachUploadRetry(failure, vi.fn(async () => result()))
    fail(failure)
    await flushPromises()
    expect(w.find('[role="alert"]').exists()).toBe(false)
    expect(w.text()).not.toContain('Retry upload')
  })

  // A retry in flight when the session changes is ignored when it finishes.
  it('ignores a retry that finishes after the session changed', async () => {
    let finish!: (r: BlobUploadResult) => void
    const retry = vi.fn(() => new Promise<BlobUploadResult>((r) => (finish = r)))
    const failure = new Error('relay upload failed')
    attachUploadRetry(failure, retry)
    const w = mountWidget(vi.fn<Perform>(async () => { throw failure }), { sessionKey: 'a' })
    await flushPromises()
    await toReview(w)
    await upload(w)
    await button(w, /^Change options$/).trigger('click')
    await button(w, /^Retry upload$/).trigger('click')
    await w.setProps({ sessionKey: 'b' })
    finish(result('alice-blob'))
    await flushPromises()
    expect(w.emitted('uploaded')).toBeUndefined()
  })

  // Disconnecting the wallet drops the file.
  it('discards the file on disconnect', async () => {
    const w = mountWidget(vi.fn<Perform>(async () => result()), { sessionKey: 'a' })
    await flushPromises()
    await chooseFile(w)
    expect(w.text()).toContain('a.png')
    await w.setProps({ connected: false })
    await flushPromises()
    expect(w.find('input[type="file"]').exists()).toBe(true)
    expect(w.text()).not.toContain('a.png')
  })

  // New relay hosts (a network switch) drop the file and the new pair is probed.
  it('starts over for a new relay host pair: the file goes, and the new pair is probed', async () => {
    const w = mountWidget(vi.fn<Perform>(async () => result()), { sessionKey: 'a' })
    await flushPromises()
    await chooseFile(w)
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const before = fetchMock.mock.calls.length
    await w.setProps({ hosts: { operator: 'https://op2.example.com', public: 'https://pub2.example.com' } })
    await flushPromises()
    expect(w.find('input[type="file"]').exists()).toBe(true)
    expect(fetchMock.mock.calls.slice(before).some(([u]) => String(u).startsWith('https://pub2.example.com'))).toBe(true)
  })

  // The `access` prop is read live, so the offer follows a switch to another network's gate.
  it('follows the gate wiring of another network', async () => {
    stubRelays({ [OP]: { send_tip: { kind: { const: 1 } } } })
    const first = markRaw({ gateConfigured: true, hasAccess: ref<boolean | null>(false) })
    const second = markRaw({ gateConfigured: true, hasAccess: ref<boolean | null>(true) })
    // A parent that swaps the prop, as an app does: `setProps` would merge the two objects instead.
    const wiring = shallowRef(first)
    const Parent = defineComponent({
      setup: () => () =>
        h(WalrusUpload, {
          hosts: { operator: OP, public: PUB },
          connected: true,
          access: wiring.value,
          performUpload: (async () => result()) as never,
        }),
    })
    const w = mount(Parent)
    await flushPromises()
    await chooseFile(w)
    expect(w.text()).toContain('An access pass is required')
    wiring.value = second
    await flushPromises()
    expect(w.text()).not.toContain('An access pass is required')
  })
})

// The relay settings the widget follows: invalid hosts show a configuration error (not the pass prompt), and an insecure host fails loudly instead of offering the free relay.
describe('WalrusUpload: relay settings', () => {
  // Hosts that become invalid show the configuration error, never the purchase prompt.
  it('shows a configuration error, not the pass prompt, when the hosts become invalid', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const w = mountWidget(vi.fn<Perform>(async () => result()), { sessionKey: 'a' })
    await flushPromises()
    await w.setProps({ hosts: { operator: 'http://insecure.example.com', public: PUB } })
    await flushPromises()
    await chooseFile(w)
    expect(w.get('[role="alert"]').text()).toMatch(/Uploads are unavailable right now/)
    expect(w.text()).not.toContain('An access pass is required')
    expect(button(w, /^Next$/).attributes('disabled')).toBeDefined()
    expect(w.get('[role="alert"]').text()).not.toMatch(/https|insecure\.example|operator relay host/)
    quiet.mockRestore()
  })

  // An insecure host throws at mount, a loud failure rather than the free relay.
  it('does not mount with an insecure host (a loud failure, not the free relay)', () => {
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => mountWidget(vi.fn<Perform>(async () => result()), { hosts: { operator: 'http://insecure.example.com', public: PUB } })).toThrow(
      /operator relay host/,
    )
    quiet.mockRestore()
  })
})
