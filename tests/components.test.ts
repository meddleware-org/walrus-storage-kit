// @vitest-environment jsdom
// Accessibility smoke tests for the relay components' rendered markup (axe). Network-facing
// composables are mocked; the real @meddleware/ui primitives render.
import { beforeAll, describe, it, expect, vi } from 'vitest'
import { installDialogShim } from '@meddleware/frontend-config/vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { axe } from 'vitest-axe'
import * as axeMatchers from 'vitest-axe/matchers'
import WalrusUpload from '../src/components/WalrusUpload.vue'
import AccessGateCta from '../src/components/AccessGateCta.vue'
import TipConfigBadge from '../src/components/TipConfigBadge.vue'
import type { PurchaseTerms } from '../src/composables/useAccessGate'

// Register the `toHaveNoViolations` matcher (its types are in tests/helpers/vitest-axe.d.ts).
expect.extend(axeMatchers)

// Purchase terms for the prompt's markup tests (the values do not matter here, only that every part renders).
const terms: PurchaseTerms = {
  network: 'testnet',
  gateId: `0x${'a1'.repeat(32)}`,
  priceMist: 10_000_000n,
  operator: { address: `0x${'0b'.repeat(32)}`, mist: 9_980_000n },
  platform: { address: `0x${'7e'.repeat(32)}`, mist: 20_000n },
  paused: false,
  soulbound: true,
  defaultUses: 10n,
}

// jsdom has no canvas: axe-core probes getContext() during some checks, and jsdom logs
// "Not implemented" before returning null. Return null up front — the same result axe already
// gets — so the noise goes away without changing what is tested.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext
// axe options: the `region` rule (all content in landmarks) is off, because a component under test is a fragment, not a whole page.
const opts = { rules: { region: { enabled: false } } }

// jsdom has no native `<dialog>` behaviour: install the shared shim so the progress and duplicate dialogs can open.
beforeAll(installDialogShim)

// Mock the relay composable: no network, one public relay on offer, so `WalrusUpload` renders its first step deterministically.
vi.mock('../src/composables/useWalrusRelay.js', async () => {
  const { ref, computed } = await import('vue')
  return {
    useWalrusRelay: () => ({
      selectedRelayHost: ref('https://relay.example'),
      availableRelays: computed(() => [
        { label: 'Public relay', host: 'https://relay.example', tip: null, isPublic: true },
      ]),
      estimatedCost: computed(() => null),
      fileSizeBytes: ref(0),
      checkOperatorRelayHealth: async () => {},
    }),
  }
})

// Keep the real helpers but make the badge's probe answer "unreachable", so it never touches the network.
vi.mock('../src/lib/relay.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/relay.js')>()),
  probeRelay: async () => ({ accessible: false, tip: null, tipStatus: 'unknown', tipKind: null }),
}))

describe('walrus-storage-kit components (axe)', () => {
  it('WalrusUpload (initial file step) has no violations', async () => {
    const w = mount(WalrusUpload, {
      props: {
        hosts: { operator: 'https://relay.example', public: 'https://relay.example' },
        connected: true,
        performUpload: async () => {
          throw new Error('not called')
        },
      },
    })
    await flushPromises()
    expect(await axe(w.html(), opts)).toHaveNoViolations()
  })

  it('AccessGateCta (no access, terms read) has no violations', async () => {
    const w = mount(AccessGateCta, { props: { gateConfigured: true, hasAccess: false, terms } })
    expect(await axe(w.html(), opts)).toHaveNoViolations()
  })

  // Every state of the prompt: terms still loading, terms unreadable, gate paused, last purchase failed.
  it('AccessGateCta (terms loading, terms error, paused, purchase error) has no violations', async () => {
    for (const props of [
      { terms: null },
      { terms: null, termsError: 'rpc down' },
      { terms: { ...terms, paused: true } },
      { terms, purchaseError: 'The payment is less than the gate price.' },
    ]) {
      const w = mount(AccessGateCta, { props: { gateConfigured: true, hasAccess: false, ...props } })
      expect(await axe(w.html(), opts)).toHaveNoViolations()
    }
  })

  it('TipConfigBadge has no violations', async () => {
    const w = mount(TipConfigBadge, { props: { host: 'https://relay.example' } })
    await flushPromises()
    expect(await axe(w.html(), opts)).toHaveNoViolations()
  })
})
