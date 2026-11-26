// Unit tests for the relay-selection policy of `useWalrusRelay` (`availableRelays`, `selectedRelayHost`): which relays are offered for each combination of operator
// reachability and gate access. The composable is used directly, without a component; the health flag is set by hand.
import { describe, it, expect } from 'vitest'
import { ref, nextTick } from 'vue'
import { useWalrusRelay } from '../src/composables/useWalrusRelay.js'

// The two hosts: an operator relay (charges the tip, gated) and the public fallback.
const OP = 'https://operator.example'
const PUB = 'https://public.example'

// The anti-bypass policy of `availableRelays`: the free public relay is offered only when the operator relay is not configured or is down, never to dodge the paywall.
describe('useWalrusRelay availableRelays policy (anti-bypass)', () => {
  // The normal gated case: reachable and a pass held, so the operator relay is the only option and is selected. The test sets `operatorRelayAccessible` directly instead of waiting for a probe.
  it('operator up + access satisfied ⇒ operator relay only', async () => {
    const hasAccess = ref<boolean | null>(true)
    const r = useWalrusRelay({ operator: OP, public: PUB }, { gateConfigured: true, hasAccess })
    r.operatorRelayAccessible.value = true
    await nextTick()

    expect(r.availableRelays.value).toHaveLength(1)
    expect(r.availableRelays.value[0]).toMatchObject({ host: OP, isPublic: false })
    expect(r.selectedRelayHost.value).toBe(OP)
  })

  // The labels are plain words ("Meddleware relay", "Public relay (fallback)"), with no internal word such as "operator".
  it('labels the Meddleware relay in plain words, never "operator" or a note about supporting the app', async () => {
    const hasAccess = ref<boolean | null>(true)
    const r = useWalrusRelay({ operator: OP, public: PUB }, { gateConfigured: true, hasAccess })
    r.operatorRelayAccessible.value = true
    await nextTick()
    expect(r.availableRelays.value.map((o) => o.label)).toEqual(['Meddleware relay'])
    r.operatorRelayAccessible.value = false
    await nextTick()
    expect(r.availableRelays.value.map((o) => o.label)).toEqual(['Public relay (fallback)'])
  })

  // A reachable operator relay and no pass: nothing is on offer, so the purchase prompt drives the next step and the free relay is withheld on purpose.
  it('operator up + NO access ⇒ no relay available (paywall holds)', () => {
    const hasAccess = ref<boolean | null>(false)
    const r = useWalrusRelay({ operator: OP, public: PUB }, { gateConfigured: true, hasAccess })
    r.operatorRelayAccessible.value = true

    // The free public relay is deliberately withheld so the user can't dodge the paywall.
    expect(r.availableRelays.value).toHaveLength(0)
  })

  // If the operator relay is down the public relay becomes a genuine fallback, and the selection moves to it.
  it('operator configured but unreachable ⇒ public relay fallback', async () => {
    const hasAccess = ref<boolean | null>(true)
    const r = useWalrusRelay({ operator: OP, public: PUB }, { gateConfigured: true, hasAccess })
    r.operatorRelayAccessible.value = false
    await nextTick()

    expect(r.availableRelays.value).toHaveLength(1)
    expect(r.availableRelays.value[0]).toMatchObject({ host: PUB, isPublic: true })
    expect(r.selectedRelayHost.value).toBe(PUB)
  })

  // When both hosts are the same there is no operator relay, so only the public one is offered, whatever the health flag says.
  it('operator not configured (operator === public) ⇒ public only, even if "reachable"', () => {
    const r = useWalrusRelay({ operator: PUB, public: PUB }, {})
    r.operatorRelayAccessible.value = true

    expect(r.availableRelays.value).toHaveLength(1)
    expect(r.availableRelays.value[0]!.isPublic).toBe(true)
  })

  // With no gate every reachable operator relay is open: access is satisfied by default.
  it('no gate configured ⇒ operator relay offered when reachable', async () => {
    // gateConfigured falsy ⇒ accessSatisfied is true by default.
    const r = useWalrusRelay({ operator: OP, public: PUB }, {})
    r.operatorRelayAccessible.value = true
    await nextTick()

    expect(r.availableRelays.value[0]).toMatchObject({ host: OP, isPublic: false })
    expect(r.selectedRelayHost.value).toBe(OP)
  })
})
