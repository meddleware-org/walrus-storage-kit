// Relay-selection policy: no option while the operator health check is pending (no early fallback
// to the free public relay), operator-only once it is up and access is confirmed, nothing while a
// gate's ownership is unknown or unpaid, public only when the operator relay is down or absent.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ref, shallowRef, nextTick } from 'vue'
import { useWalrusRelay } from '../src/composables/useWalrusRelay.js'

// An operator relay and a public fallback (different origins), and a constant 1000 MIST tip for the operator relay to advertise.
const hosts = { operator: 'https://relay.example.com', public: 'https://public.example.com' }
const tipConfig = { send_tip: { address: '0x1', kind: { const: 1000 } } }

/** mockFetch(ok): make every `fetch` answer as the operator relay would: the tip config when `ok`, an HTTP 503 otherwise. */
function mockFetch(ok: boolean) {
  vi.stubGlobal('fetch', vi.fn(async () => (ok ? new Response(JSON.stringify(tipConfig)) : new Response('', { status: 503 }))))
}

// Put the real `fetch` back after each test.
afterEach(() => vi.unstubAllGlobals())

// Which relays are offered at each moment: none while the check is pending, the operator relay when up, the public relay only after a failure or when no operator relay exists.
describe('useWalrusRelay relay selection', () => {
  // Before the first answer nothing is offered (the public relay is not a fallback until the operator check has actually failed), and the state is "pending".
  it('offers nothing while the health check is pending', () => {
    const r = useWalrusRelay(hosts)
    expect(r.availableRelays.value).toEqual([])
    expect(r.relayPending.value).toBe(true)
  })

  // With no gate, a reachable operator relay is the only option and is selected.
  it('offers only the operator relay once it is up (ungated)', async () => {
    mockFetch(true)
    const r = useWalrusRelay(hosts)
    await r.checkOperatorRelayHealth()
    await nextTick()
    expect(r.availableRelays.value.map((o) => o.host)).toEqual([hosts.operator])
    expect(r.selectedRelayHost.value).toBe(hosts.operator)
    expect(r.relayPending.value).toBe(false)
  })

  // The fallback appears after the failed answer, never before.
  it('falls back to the public relay only after the check fails', async () => {
    mockFetch(false)
    const r = useWalrusRelay(hosts)
    await r.checkOperatorRelayHealth()
    await nextTick()
    expect(r.availableRelays.value.map((o) => o.host)).toEqual([hosts.public])
    expect(r.selectedRelayHost.value).toBe(hosts.public)
  })

  // The paywall: while the gate's ownership is unknown or negative nothing is offered, and once access is confirmed the operator relay is selected.
  it('withholds every relay while a gate is unresolved or unpaid, then selects the operator', async () => {
    mockFetch(true)
    const hasAccess = ref<boolean | null>(null)
    const r = useWalrusRelay(hosts, { gateConfigured: true, hasAccess })
    await r.checkOperatorRelayHealth()
    await nextTick()
    expect(r.availableRelays.value).toEqual([])
    expect(r.relayPending.value).toBe(true)

    hasAccess.value = false
    await nextTick()
    expect(r.availableRelays.value).toEqual([])
    expect(r.relayPending.value).toBe(false)
    expect(r.purchaseAccessAvailable.value).toBe(true)

    hasAccess.value = true
    await nextTick()
    expect(r.availableRelays.value.map((o) => o.host)).toEqual([hosts.operator])
    expect(r.selectedRelayHost.value).toBe(hosts.operator)
  })

  // Equal hosts mean no operator relay: the public relay is offered immediately, with no health check to wait for.
  it('uses the public relay when no operator relay is configured', () => {
    const r = useWalrusRelay({ operator: hosts.public, public: hosts.public })
    expect(r.availableRelays.value.map((o) => o.host)).toEqual([hosts.public])
    expect(r.relayPending.value).toBe(false)
  })
})

// ── F9 / F12 / F16: tip status, host validation, reactive hosts, re-checks ────────────────────────

import { effectScope } from 'vue'
import { HEALTH_RECHECK_DELAYS_MS } from '../src/composables/useWalrusRelay.js'
import { MAX_TIP_MIST } from '../src/lib/relay.js'

/** mockRelays(table): a per-host `fetch` stub: each host answers the given body (or HTTP status), and a host not in the table fails as an unreachable network. */
/** Answer each relay host's `/v1/tip-config` from a table; a missing host is unreachable. */
function mockRelays(table: Record<string, unknown | number>) {
  const fetchMock = vi.fn(async (url: string) => {
    const host = String(url).replace(/\/v1\/tip-config$/, '')
    if (!(host in table)) throw new Error(`unreachable: ${host}`)
    const answer = table[host]
    return typeof answer === 'number' ? new Response('', { status: answer }) : new Response(JSON.stringify(answer))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

// constTip(n): a constant tip schedule of `n` MIST, as a relay's body.
const constTip = (n: number | string) => ({ send_tip: { kind: { const: n } } })

// Audit F12: an invalid host is a loud error, never a reason to hand out the free relay; plain http is allowed for loopback only.
describe('useWalrusRelay host validation (F12)', () => {
  // An insecure operator host throws at construction, because quietly falling back to the free relay would bypass the paywall.
  it('refuses an http operator host instead of silently offering the free relay', () => {
    expect(() => useWalrusRelay({ operator: 'http://relay.example.com', public: hosts.public })).toThrow(/operator relay host/)
  })

  // The same for the public host: http (remote) or a string that is not a URL is refused.
  it('refuses an http or malformed public host', () => {
    expect(() => useWalrusRelay({ operator: hosts.operator, public: 'http://public.example.com' })).toThrow(/public relay host/)
    expect(() => useWalrusRelay({ operator: hosts.operator, public: 'public.example.com' })).toThrow(/invalid URL/)
  })

  it('accepts http on loopback, including [::1]', () => {
    expect(() => useWalrusRelay({ operator: 'http://[::1]:3000', public: 'http://localhost:3001' })).not.toThrow()
  })

  // Hosts are compared by origin, so `https://Relay/` and `https://relay` are one relay, not an operator relay and a fallback.
  it('treats a trailing-slash or case variant of the same host as no operator relay', () => {
    const r = useWalrusRelay({ operator: 'https://Public.Example.com/', public: 'https://public.example.com' })
    expect(r.relayPending.value).toBe(false)
    expect(r.availableRelays.value.map((o) => o.isPublic)).toEqual([true])
  })
})

// Audit F9: the fee line reflects what the relay reported, and an unknown or out-of-range tip is never shown as free.
describe('useWalrusRelay tip status (F9)', () => {
  afterEach(() => vi.unstubAllGlobals())

  // The public relay's tip is probed once like the operator's, not assumed to be zero.
  it('reads the public relay tip instead of assuming it is free', async () => {
    mockRelays({ [hosts.operator]: 503, [hosts.public]: constTip(7000) })
    const r = useWalrusRelay(hosts)
    await r.checkOperatorRelayHealth()
    await nextTick()
    r.stop()
    expect(r.availableRelays.value).toEqual([
      expect.objectContaining({ host: hosts.public, isPublic: true, tip: 7000n, tipStatus: 'known' }),
    ])
    expect(r.availableRelays.value[0]!.label).not.toMatch(/free/i)
    r.fileSizeBytes.value = 1000
    expect(r.estimatedCost.value?.mist).toBe(7000n)
    expect(r.relayFeeStatus.value).toBe('known')
  })

  // An unreadable tip is "unknown", never a free relay.
  it('does not show an unreadable public tip as zero', async () => {
    mockRelays({ [hosts.operator]: 503, [hosts.public]: 'garbage' })
    const r = useWalrusRelay(hosts)
    await r.checkOperatorRelayHealth()
    await nextTick()
    r.stop()
    r.fileSizeBytes.value = 1000
    expect(r.availableRelays.value[0]).toMatchObject({ tip: null, tipStatus: 'unknown' })
    expect(r.estimatedCost.value).toBeNull()
    expect(r.relayFeeStatus.value).toBe('unknown')
  })

  it('reports an operator tip above the ceiling as over-ceiling, and a genuine no_tip as none', async () => {
    mockRelays({ [hosts.operator]: constTip((MAX_TIP_MIST + 1n).toString()), [hosts.public]: 'no_tip' })
    const r = useWalrusRelay(hosts)
    await r.checkOperatorRelayHealth()
    await nextTick()
    r.fileSizeBytes.value = 1000
    expect(r.availableRelays.value[0]).toMatchObject({ host: hosts.operator, tip: null, tipStatus: 'over-ceiling' })
    expect(r.relayFeeStatus.value).toBe('over-ceiling')
    expect(r.estimatedCost.value).toBeNull()

    mockRelays({ [hosts.operator]: 'no_tip', [hosts.public]: 'no_tip' })
    const none = useWalrusRelay(hosts)
    await none.checkOperatorRelayHealth()
    await nextTick()
    none.fileSizeBytes.value = 1000
    expect(none.relayFeeStatus.value).toBe('none')
    expect(none.estimatedCost.value).toMatchObject({ mist: 0n, label: 'No relay fee' })
  })

  // The fee status is "pending" until the probe has answered.
  it('is pending until the tip has been read', () => {
    const r = useWalrusRelay({ operator: hosts.public, public: hosts.public })
    expect(r.relayFeeStatus.value).toBe('pending')
    expect(r.availableRelays.value[0]!.tipStatus).toBe('pending')
  })
})

// A transient failure must not hand the free relay to the user for the rest of the session: a failed operator relay is re-checked with backoff, a working one is not.
describe('useWalrusRelay re-checks a failed operator relay (F12)', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  // A re-check that succeeds moves the offer from the fallback back to the operator relay.
  it('moves from the public fallback to the operator relay when it comes back', async () => {
    vi.useFakeTimers()
    const table: Record<string, unknown> = { [hosts.operator]: 503, [hosts.public]: constTip(1) }
    mockRelays(table)
    const r = useWalrusRelay(hosts)
    await r.checkOperatorRelayHealth()
    await nextTick()
    expect(r.availableRelays.value.map((o) => o.host)).toEqual([hosts.public])

    table[hosts.operator] = constTip(1000)
    await vi.advanceTimersByTimeAsync(HEALTH_RECHECK_DELAYS_MS[0]! + 1)
    await nextTick()
    expect(r.operatorRelayAccessible.value).toBe(true)
    expect(r.availableRelays.value.map((o) => o.host)).toEqual([hosts.operator])
    expect(r.selectedRelayHost.value).toBe(hosts.operator)
    r.stop()
  })

  // Coming back while the wallet has no pass withdraws the free relay again: the purchase prompt, not a bypass.
  it('does not hand out the free relay to an unpaid user when the operator relay comes back', async () => {
    vi.useFakeTimers()
    const table: Record<string, unknown> = { [hosts.operator]: 503, [hosts.public]: constTip(1) }
    mockRelays(table)
    const r = useWalrusRelay(hosts, { gateConfigured: true, hasAccess: ref(false) })
    await r.checkOperatorRelayHealth()
    await nextTick()
    table[hosts.operator] = constTip(1000)
    await vi.advanceTimersByTimeAsync(HEALTH_RECHECK_DELAYS_MS[0]! + 1)
    await nextTick()
    expect(r.availableRelays.value).toEqual([])
    expect(r.purchaseAccessAvailable.value).toBe(true)
    r.stop()
  })

  // The re-checks follow `HEALTH_RECHECK_DELAYS_MS` and then the last result stands; fake timers step through them.
  it('backs off through the delays, then stops', async () => {
    vi.useFakeTimers()
    const fetchMock = mockRelays({ [hosts.public]: constTip(1) }) // operator unreachable throughout
    const r = useWalrusRelay(hosts)
    await r.checkOperatorRelayHealth()
    const operatorCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith(hosts.operator)).length
    expect(operatorCalls()).toBe(1)
    let expected = 1
    for (const delay of HEALTH_RECHECK_DELAYS_MS) {
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(operatorCalls()).toBe(expected)
      await vi.advanceTimersByTimeAsync(1)
      expected++
      expect(operatorCalls()).toBe(expected)
    }
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(operatorCalls()).toBe(expected)
    // The public relay's tip was read once, not on every re-check.
    expect(fetchMock.mock.calls.filter(([u]) => String(u).startsWith(hosts.public)).length).toBe(1)
  })

  it('stop() cancels the pending re-check, and so does disposing the owning scope', async () => {
    vi.useFakeTimers()
    const fetchMock = mockRelays({ [hosts.public]: constTip(1) })
    const scope = effectScope()
    const r = scope.run(() => useWalrusRelay(hosts))!
    await r.checkOperatorRelayHealth()
    const before = fetchMock.mock.calls.length
    scope.stop()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(fetchMock.mock.calls.length).toBe(before)
  })

  // A relay that answered is not re-checked, so a later outage keeps it selected and uploads fail closed.
  it('does not re-check an operator relay that answered', async () => {
    vi.useFakeTimers()
    const fetchMock = mockRelays({ [hosts.operator]: constTip(1), [hosts.public]: constTip(1) })
    const r = useWalrusRelay(hosts)
    await r.checkOperatorRelayHealth()
    const before = fetchMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(fetchMock.mock.calls.length).toBe(before)
  })
})

// Audit F16: hosts and gate wiring may change while the composable lives (a network switch), so they are read live and a stale answer is discarded.
describe('useWalrusRelay follows its inputs (F16)', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const other = { operator: 'https://relay2.example.com', public: 'https://public2.example.com' }

  // A network switch (new hosts) resets the selection, the tip configs and the health check.
  it('starts over for a new host pair: selection, tips and the health check', async () => {
    mockRelays({
      [hosts.operator]: constTip(1000),
      [hosts.public]: constTip(1),
      [other.operator]: 503,
      [other.public]: constTip(5),
    })
    const current = ref(hosts)
    const r = useWalrusRelay(current)
    await r.checkOperatorRelayHealth()
    await nextTick()
    expect(r.selectedRelayHost.value).toBe(hosts.operator)

    current.value = other
    await nextTick()
    // The previous network's result is gone at once; nothing is offered until the new pair answers.
    expect(r.operatorRelayAccessible.value).toBeNull()
    expect(r.availableRelays.value).toEqual([])
    await vi.waitFor(() => expect(r.operatorRelayAccessible.value).toBe(false))
    await nextTick()
    r.stop()
    expect(r.availableRelays.value.map((o) => o.host)).toEqual([other.public])
    expect(r.selectedRelayHost.value).toBe(other.public)
  })

  // A new object with equal hosts is not a change: no restart.
  it('does not re-check on a new object with the same hosts', async () => {
    const fetchMock = mockRelays({ [hosts.operator]: constTip(1), [hosts.public]: constTip(1) })
    const current = ref({ ...hosts })
    const r = useWalrusRelay(() => current.value)
    await r.checkOperatorRelayHealth()
    const calls = fetchMock.mock.calls.length
    current.value = { ...hosts }
    await nextTick()
    expect(fetchMock.mock.calls.length).toBe(calls)
    expect(r.operatorRelayAccessible.value).toBe(true)
  })

  // A slow answer for the old pair is dropped (the health generation).
  it('discards a probe answer that arrives after the hosts changed', async () => {
    const slow = new Promise<Response>(() => {})
    const fetchMock = vi.fn((url: string) => (String(url).startsWith(hosts.operator) ? slow : Promise.resolve(new Response('{}', { status: 503 }))))
    vi.stubGlobal('fetch', fetchMock)
    const current = ref(hosts)
    const r = useWalrusRelay(current)
    void r.checkOperatorRelayHealth()
    current.value = other
    await nextTick()
    await vi.waitFor(() => expect(r.operatorRelayAccessible.value).toBe(false))
    r.stop()
  })

  // A later invalid pair sets `configError` and offers nothing, instead of throwing or offering the free relay.
  it('offers no relay, not the free one, when later hosts are invalid', async () => {
    mockRelays({ [hosts.operator]: constTip(1), [hosts.public]: constTip(1) })
    const current = ref<{ operator: string; public: string }>(hosts)
    const r = useWalrusRelay(current)
    await r.checkOperatorRelayHealth()
    await nextTick()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    current.value = { operator: 'http://relay.example.com', public: hosts.public }
    await nextTick()
    expect(r.configError.value).toMatch(/operator relay host/)
    expect(log).toHaveBeenCalledTimes(1) // the cause goes to the console once, as the original error
    expect(log.mock.calls[0]![1]).toBeInstanceOf(Error)
    log.mockRestore()
    expect(r.availableRelays.value).toEqual([])
    expect(r.relayPending.value).toBe(false)

    // Fixing the hosts recovers.
    current.value = hosts
    await nextTick()
    await vi.waitFor(() => expect(r.operatorRelayAccessible.value).toBe(true))
    expect(r.configError.value).toBeNull()
    expect(r.availableRelays.value.map((o) => o.host)).toEqual([hosts.operator])
  })

  // The gate options are read live, so switching to another network's gate changes the offer.
  it('reads the gate wiring live, so a switch to another network’s gate is followed', async () => {
    mockRelays({ [hosts.operator]: constTip(1), [hosts.public]: constTip(1) })
    // A shallow ref: the nested `hasAccess` ref must stay a ref, as it is in the apps' gate state.
    const wiring = shallowRef({ gateConfigured: true, hasAccess: ref<boolean | null>(false) })
    const r = useWalrusRelay(hosts, () => wiring.value)
    await r.checkOperatorRelayHealth()
    await nextTick()
    expect(r.availableRelays.value).toEqual([])
    wiring.value = { gateConfigured: true, hasAccess: ref<boolean | null>(true) }
    await nextTick()
    expect(r.availableRelays.value.map((o) => o.host)).toEqual([hosts.operator])
    wiring.value = { gateConfigured: false, hasAccess: ref<boolean | null>(null) }
    await nextTick()
    expect(r.accessSatisfied.value).toBe(true)
  })
})
