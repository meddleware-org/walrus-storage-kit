// @vitest-environment jsdom
// TipConfigBadge (F9) and AccessGateCta (F11): what the user is told before a payment is approved.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import TipConfigBadge from '../src/components/TipConfigBadge.vue'
import AccessGateCta from '../src/components/AccessGateCta.vue'
import { MAX_TIP_MIST } from '../src/lib/relay.js'
import { TERMS_UNAVAILABLE_MESSAGE, useAccessGate, type GateClient, type PurchaseTerms } from '../src/composables/useAccessGate'
import { relayGateConfig } from '../src/constants'

afterEach(() => vi.unstubAllGlobals())

function relay(answer: unknown | number | Error) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (answer instanceof Error) throw answer
      return typeof answer === 'number' ? new Response('', { status: answer }) : new Response(JSON.stringify(answer))
    }),
  )
}

/** The badge's words: its text without the decorative symbol (which is hidden from assistive technology). */
const words = (w: ReturnType<typeof mount>) => w.text().replace(w.find('.mw-badge__symbol').exists() ? w.get('.mw-badge__symbol').text() : '', '')

async function badge(host = 'https://relay.example') {
  const w = mount(TipConfigBadge, { props: { host } })
  await flushPromises()
  return w
}

describe('TipConfigBadge (F9)', () => {
  it('shows "Checking relay…" while the probe is in flight', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const w = mount(TipConfigBadge, { props: { host: 'https://relay.example' } })
    await flushPromises()
    expect(w.text()).toBe('Checking relay…')
    expect(w.attributes('data-state')).toBe('loading')
  })

  it('shows a figure for a known tip, and "from" for a linear schedule', async () => {
    relay({ send_tip: { kind: { const: 100_000 } } })
    expect(words(await badge())).toBe('Relay online · tip 0.0001 SUI')
    relay({ send_tip: { kind: { linear: { base: 1_000_000, encoded_size_mul_per_kib: 10 } } } })
    expect(words(await badge())).toBe('Relay online · tip from 0.001 SUI')
  })

  it('says "no tip" only for a relay that advertises none', async () => {
    relay('no_tip')
    const w = await badge()
    expect(words(w)).toBe('Relay online · tip no tip')
    expect(w.attributes('data-tip')).toBe('none')
  })

  it('does not call an over-ceiling tip "no tip"', async () => {
    relay({ send_tip: { kind: { const: (MAX_TIP_MIST + 1n).toString() } } })
    const w = await badge()
    expect(words(w)).toBe('Relay online · tip above the limit')
    expect(words(w)).not.toContain('no tip')
    expect(w.attributes('data-tip')).toBe('over-ceiling')
  })

  it('does not call an unreadable tip "no tip"', async () => {
    relay({ send_tip: 'garbage' })
    const w = await badge()
    expect(words(w)).toBe('Relay online · tip unknown')
    expect(w.attributes('data-tip')).toBe('unknown')
  })

  it('marks the state with a symbol that assistive technology does not read, and a tone', async () => {
    relay(503)
    const w = await badge()
    expect(w.get('.mw-badge__symbol').attributes('aria-hidden')).toBe('true')
    expect(w.classes()).toContain('mw-badge--danger')
    relay({ send_tip: { kind: { const: 100_000 } } })
    expect((await badge()).classes()).toContain('mw-badge--ok')
    relay({ send_tip: 'garbage' })
    expect((await badge()).classes()).toContain('mw-badge--warn')
  })

  it('shows an unreachable relay', async () => {
    relay(503)
    expect(words(await badge())).toBe('Relay unreachable')
    relay(new Error('offline'))
    expect(words(await badge())).toBe('Relay unreachable')
  })

  it('shows a configuration error for an invalid host instead of staying on "Checking relay…"', async () => {
    relay('no_tip')
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const w = await badge('http://relay.example')
    expect(words(w)).toBe('Uploads are unavailable right now.')
    expect(w.attributes('data-state')).toBe('invalid')
    quiet.mockRestore()
  })

  it('shows a person only plain words for a bad relay address, and logs the detail for developers', async () => {
    relay('no_tip')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const w = await badge('http://relay.example')
    // Nothing technical reaches the page: no host, no scheme, no function name.
    expect(words(w)).toBe('Uploads are unavailable right now.')
    expect(words(w)).not.toMatch(/https|http|relay\.example|probeRelay|valid|operator/i)
    // Once, with the original error object.
    expect(log).toHaveBeenCalledTimes(1)
    const raw = log.mock.calls[0]![1] as Error
    expect(raw).toBeInstanceOf(Error)
    expect(raw.message).toContain('host must use https://')
    log.mockRestore()
  })

  it('probes again when the host changes, and ignores an older answer', async () => {
    let release!: (r: Response) => void
    const slow = new Promise<Response>((r) => (release = r))
    const fetchMock = vi.fn((url: string) => (String(url).startsWith('https://old.example') ? slow : Promise.resolve(new Response('"no_tip"'))))
    vi.stubGlobal('fetch', fetchMock)
    const w = mount(TipConfigBadge, { props: { host: 'https://old.example' } })
    await w.setProps({ host: 'https://new.example' })
    await flushPromises()
    expect(words(w)).toBe('Relay online · tip no tip')
    release(new Response(JSON.stringify({ send_tip: { kind: { const: 5 } } })))
    await flushPromises()
    expect(words(w)).toBe('Relay online · tip no tip') // the late answer for the old host did not overwrite it
  })
})

const terms: PurchaseTerms = {
  network: 'testnet',
  gateId: `0x${'a1'.repeat(32)}`,
  priceMist: 10_000_001n,
  operator: { address: `0x${'0b'.repeat(32)}`, mist: 9_980_001n },
  platform: { address: `0x${'7e'.repeat(32)}`, mist: 20_000n },
  paused: false,
  soulbound: true,
  defaultUses: 10n,
}

const cta = (props: Record<string, unknown>) =>
  mount(AccessGateCta, { props: { gateConfigured: true, hasAccess: false, terms: null, ...props } })

describe('AccessGateCta (F11)', () => {
  it('is hidden unless a gate is configured and the wallet lacks a pass', () => {
    expect(cta({ gateConfigured: false, terms }).find('.wru-cta').exists()).toBe(false)
    expect(cta({ hasAccess: true, terms }).find('.wru-cta').exists()).toBe(false)
    expect(cta({ hasAccess: null, terms }).find('.wru-cta').exists()).toBe(false)
  })

  it('shows the exact payment, who receives what, the network and the pass before the wallet opens', () => {
    const w = cta({ terms })
    const text = w.text()
    expect(text).toContain('testnet')
    expect(text).toContain('You pay0.010000001 SUI (plus network gas)')
    expect(text).toContain(`Gate owner receives0.009980001 SUI ${terms.operator.address}`)
    expect(text).toContain(`Platform fee0.00002 SUI ${terms.platform.address}`)
    expect(text).toContain('10 uses, soulbound (cannot be transferred)')
    expect(w.get('button').text()).toBe('Purchase access (0.010000001 SUI)')
    expect(w.get('button').attributes('disabled')).toBeUndefined()
  })

  it('describes an unlimited transferable pass', () => {
    expect(cta({ terms: { ...terms, defaultUses: 0n, soulbound: false } }).text()).toContain('unlimited uses, transferable')
    expect(cta({ terms: { ...terms, defaultUses: 1n } }).text()).toContain('1 use,')
  })

  it('cannot purchase until the terms are read', async () => {
    const w = cta({ terms: null })
    expect(w.text()).toContain('Reading the pass price from the chain…')
    expect(w.get('button').attributes('disabled')).toBeDefined()
    await w.get('button').trigger('click')
    expect(w.emitted('purchase')).toBeUndefined()
  })

  it('cannot purchase when the terms could not be read, and says what to do', () => {
    const w = cta({ terms: null, termsError: TERMS_UNAVAILABLE_MESSAGE })
    expect(w.get('[role="alert"]').text()).toBe(TERMS_UNAVAILABLE_MESSAGE)
    expect(w.get('button').attributes('disabled')).toBeDefined()
  })

  it('shows a person only plain words for a raw chain error, while console.error receives the raw one', async () => {
    const raw = new Error('RPC 503: upstream connect error or disconnect/reset before headers')
    const getObject = vi.fn(async () => {
      throw raw
    })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const gateId = `0x${'a1'.repeat(32)}`
    const g = useAccessGate({
      network: 'testnet',
      gate: relayGateConfig('testnet', { gateId, soulbound: true }),
      getClient: () => ({ core: { getObject, listOwnedObjects: vi.fn() } }) as unknown as GateClient,
    })
    // Reading the terms fails, then so does a purchase.
    await g.loadTerms()
    const w = mount(AccessGateCta, {
      props: { gateConfigured: true, hasAccess: false, terms: null, termsError: g.termsError.value, purchaseError: g.purchaseError.value },
    })
    expect(w.get('[role="alert"]').text()).toBe(TERMS_UNAVAILABLE_MESSAGE)
    await expect(g.purchase({ signAndExecute: vi.fn(), waitForTransaction: vi.fn() }, '0xalice')).rejects.toThrow(TERMS_UNAVAILABLE_MESSAGE)
    await w.setProps({ termsError: g.termsError.value, purchaseError: g.purchaseError.value })

    const shown = w.text()
    expect(shown).toContain(TERMS_UNAVAILABLE_MESSAGE)
    expect(shown).not.toMatch(/RPC|503|upstream|Could not read|chain:|0x|operator/i)
    expect(w.findAll('[role="alert"]').map((a) => a.text())).toEqual([TERMS_UNAVAILABLE_MESSAGE, TERMS_UNAVAILABLE_MESSAGE])
    // The raw error reached the console, with the original object (from the terms read, and as the cause of the purchase failure).
    expect(log.mock.calls.some((c) => c[1] === raw)).toBe(true)
    const purchaseLog = log.mock.calls.at(-1)![1] as Error
    expect(purchaseLog.message).toBe('Could not read the pass price from the chain: RPC 503: upstream connect error or disconnect/reset before headers')
    expect(purchaseLog.cause).toBe(raw)
    log.mockRestore()
  })

  it('blocks a paused gate', async () => {
    const w = cta({ terms: { ...terms, paused: true } })
    expect(w.text()).toContain('paused')
    expect(w.get('button').attributes('disabled')).toBeDefined()
    await w.get('button').trigger('click')
    expect(w.emitted('purchase')).toBeUndefined()
  })

  it('is disabled while a purchase is in flight, and emits once when pressed', async () => {
    const busy = cta({ terms, busy: true })
    expect(busy.get('button').attributes('disabled')).toBeDefined()
    const w = cta({ terms })
    await w.get('button').trigger('click')
    expect(w.emitted('purchase')).toHaveLength(1)
  })

  it('shows why the last purchase failed', () => {
    expect(cta({ terms, purchaseError: 'The payment is less than the gate price.' }).get('[role="alert"]').text()).toBe(
      'The payment is less than the gate price.',
    )
  })
})
