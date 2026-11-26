// Unit tests for `useAccessGate`: ownership checks, pass selection, the purchase terms read from the chain, the purchase itself and wallet switching. The Sui client is a fake chain
// that renders the gate and `PlatformConfig` as a full node does; the wallet is a stub executor. The finding ids (F10, F11) are this repository's audit findings.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { accessGateDeployment } from '@meddleware/access-gate-client/deployments'

// Scripted ownership: each test queues the passes the wallet "holds" (`fetchAccessNfts`) and can read the purchase transaction that was built (`buildPurchaseTx`).
const fetchAccessNfts = vi.fn()
const buildPurchaseTx = vi.fn()
// Replace only the ownership read and watch the purchase builder; the gate and `PlatformConfig` reads go through the real parsers, against a fake chain, so the terms logic is exercised for real.
vi.mock('@meddleware/access-gate-client', async (importActual) => {
  const actual = await importActual<typeof import('@meddleware/access-gate-client')>()
  return {
    ...actual,
    // Ownership is a scripted list; the gate and PlatformConfig reads go through the real parsers.
    fetchAccessNfts: (...args: unknown[]) => fetchAccessNfts(...args),
    buildPurchaseTx: (...args: unknown[]) => {
      buildPurchaseTx(...args)
      return (actual.buildPurchaseTx as (...a: unknown[]) => unknown)(...args)
    },
  }
})

import {
  PURCHASE_FAILED_MESSAGE,
  TERMS_UNAVAILABLE_MESSAGE,
  useAccessGate,
  type GateClient,
  type RelayGateConfig,
} from '../src/composables/useAccessGate'
import { relayGateConfig } from '../src/constants'

// The published deployment, and fixed ids: the gate, its operator (payment recipient) and the platform treasury.
const D = accessGateDeployment('testnet')
const GATE_ID = `0x${'a1'.repeat(32)}`
const OPERATOR = `0x${'0b'.repeat(32)}`
const TREASURY = `0x${'7e'.repeat(32)}`
const gate: RelayGateConfig = relayGateConfig('testnet', { gateId: GATE_ID, soulbound: true })

/** A fake client whose gate and PlatformConfig a test can change, in the shapes a full node renders. */
function fakeChain() {
  const chain = {
    gate: {
      price_mist: '10000000',
      payment_recipient: OPERATOR,
      default_uses: '10',
      soulbound: true,
      auto_burn_at_zero: true,
      paused: false,
      frozen: false,
      nft_name: 'Relay pass',
      nft_image_url: 'https://example.org/pass.png',
      nft_description: 'A pass',
      policy: {
        freeze_requires_unpaused: false,
        lock_commission_on_freeze: false,
        pause_blocks_decryption: false,
        pause_blocks_access: false,
      },
      locked_commission: null,
      free_fee_paid: false,
    } as Record<string, unknown>,
    platform: {
      version: '1',
      treasury: TREASURY,
      commission_bps: '20',
      min_commission_mist: '1000',
      free_gate_fee_mist: '1000000000',
    } as Record<string, unknown>,
    gateType: `${D.originalId}::access_gate::Gate`,
    fail: null as Error | null,
  }
  const getObject = vi.fn(async ({ objectId }: { objectId: string }) => {
    if (chain.fail) throw chain.fail
    if (objectId === GATE_ID) return { object: { objectId, type: chain.gateType, json: chain.gate } }
    if (objectId === D.platformConfigId) {
      return { object: { objectId, type: `${D.originalId}::access_gate::PlatformConfig`, json: chain.platform } }
    }
    throw new Error(`unexpected object ${objectId}`)
  })
  const client = { core: { getObject, listOwnedObjects: vi.fn() } } as unknown as GateClient
  return { chain, client, getObject }
}

/** setup(over): a fake chain, a client that returns it, and a `useAccessGate` on testnet (the default gate, or the one given, `null` for an ungated relay). */
function setup(over: { gate?: RelayGateConfig | null } = {}) {
  const fake = fakeChain()
  const getClient = vi.fn<(network: 'testnet' | 'mainnet') => GateClient>(() => fake.client)
  const g = useAccessGate({ network: 'testnet', gate: over.gate === undefined ? gate : over.gate, getClient })
  return { ...fake, getClient, g }
}

/** deferred<T>(): a promise a test resolves by hand, to control when an in-flight call finishes. */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

// executor(): a wallet executor that "signs" and "executes" a purchase as transaction `BUY1` and finalises it instantly.
const executor = () => ({
  signAndExecute: vi.fn(async () => ({ digest: 'BUY1' })),
  waitForTransaction: vi.fn(async () => undefined),
})

/** `console.error` is where the cause of a failure goes; a test reads it instead of printing it. */
let consoleError: MockInstance<typeof console.error>

// Reset the scripted calls and silence `console.error`, where the cause of a failure goes (a test reads it instead of printing it).
beforeEach(() => {
  fetchAccessNfts.mockReset()
  buildPurchaseTx.mockReset()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => consoleError.mockRestore())

// Audit F10: every transaction this composable builds targets the published deployment, so a config that names anything else is refused up front.
describe('useAccessGate pinning to the published deployment (F10)', () => {
  // A config with a foreign package or a foreign `PlatformConfig` throws at construction, before any read or transaction.
  it('refuses a hand-built config that names another package or PlatformConfig', () => {
    const getClient = () => fakeChain().client
    expect(() => useAccessGate({ network: 'testnet', gate: { ...gate, packageId: '0xdead' }, getClient })).toThrow(/package/)
    expect(() => useAccessGate({ network: 'testnet', gate: { ...gate, platformConfigId: '0xbeef' }, getClient })).toThrow(
      /PlatformConfig/,
    )
    expect(() =>
      useAccessGate({ network: 'testnet', gate: { ...gate, nftType: '0xdead::access_gate::SoulboundAccessNFT' }, getClient }),
    ).toThrow(/NFT type/)
  })

  // Mainnet has no deployment yet: a gated relay there is refused, while an ungated one (no gate at all) needs no deployment.
  it('refuses a gate on a network with no recorded deployment, but an ungated relay needs none', () => {
    const getClient = () => fakeChain().client
    expect(() => useAccessGate({ network: 'mainnet', gate, getClient })).toThrow(/no access_gate deployment/)
    const open = useAccessGate({ network: 'mainnet', gate: null, getClient })
    expect(open.gateConfigured).toBe(false)
    expect(open.hasAccess.value).toBe(true)
  })

  // The host's client factory is asked for the network the gate is on, so the reads cannot go to another chain.
  it('passes the network to getClient', async () => {
    const { g, getClient } = setup()
    fetchAccessNfts.mockResolvedValueOnce([{ objectId: '0xnft', gateId: GATE_ID, variant: { kind: 'unlimited' } }])
    await g.checkOwnership('0xalice')
    expect(getClient).toHaveBeenCalledWith('testnet')
  })
})

// State belongs to a wallet: a reset clears it, and a result that arrives after the wallet changed is discarded (the generation counters).
describe('useAccessGate wallet switching', () => {
  // After a disconnect or account switch nothing about the previous wallet survives: access, uses, the pass and the terms.
  it('reset() clears access, uses, the held NFT and the terms', async () => {
    const { g } = setup()
    fetchAccessNfts.mockResolvedValueOnce([{ objectId: '0xnft', gateId: GATE_ID, variant: { kind: 'singleUse', remaining: 3n } }])
    await g.checkOwnership('0xalice')
    await g.loadTerms()
    expect(g.hasAccess.value).toBe(true)
    expect(g.terms.value).not.toBeNull()
    g.reset()
    expect(g.hasAccess.value).toBeNull()
    expect(g.nftId.value).toBeNull()
    expect(g.usesRemaining.value).toBeNull()
    expect(g.singleUse.value).toBe(false)
    expect(g.terms.value).toBeNull()
  })

  // A slow check for the previous wallet resolves after a reset and must not grant access to the new one (the generation counter).
  it('discards an ownership result that arrives after the wallet changed', async () => {
    const { g } = setup()
    const slow = deferred<unknown[]>()
    fetchAccessNfts.mockReturnValueOnce(slow.promise)
    const pending = g.checkOwnership('0xalice')
    g.reset() // wallet disconnected / switched while the check was in flight
    slow.resolve([{ objectId: '0xalice-nft', gateId: GATE_ID, variant: { kind: 'unlimited' } }])
    await pending
    expect(g.hasAccess.value).toBeNull()
    expect(g.nftId.value).toBeNull()
  })

  // The same rule for the terms: an answer that arrives after a reset is dropped.
  it('discards terms that arrive after a reset', async () => {
    const { g, getObject } = setup()
    const slow = deferred<unknown>()
    getObject.mockImplementationOnce(() => slow.promise as never)
    const pending = g.loadTerms()
    g.reset()
    slow.resolve({ object: { objectId: GATE_ID, type: `${D.originalId}::access_gate::Gate`, json: {} } })
    expect(await pending).toBeNull()
    expect(g.terms.value).toBeNull()
  })
})

// Audit F11: the price, the recipients and the fee are read from the chain, shown before the wallet opens, and only ever shown in plain words.
describe('useAccessGate purchase terms (F11)', () => {
  // The terms equal what the fake chain holds (price, the operator's and the platform's shares and addresses): nothing comes from configuration.
  it('reads the price, recipients and fee from the chain, not from configuration', async () => {
    const { g } = setup()
    const t = await g.loadTerms()
    // 10_000_000 MIST at 20 bps = 20_000, above the 1_000 floor.
    expect(t).toEqual({
      network: 'testnet',
      gateId: GATE_ID,
      priceMist: 10_000_000n,
      operator: { address: OPERATOR, mist: 9_980_000n },
      platform: { address: TREASURY, mist: 20_000n },
      paused: false,
      soulbound: true,
      defaultUses: 10n,
    })
    expect(t!.operator.mist + t!.platform.mist).toBe(t!.priceMist)
    expect(g.terms.value).toEqual(t)
    expect(g.termsError.value).toBeNull()
  })

  // The platform's share follows the contract's rule (the larger of the percentage and the floor, capped), and a frozen gate's snapshot wins when there is one.
  it('uses the minimum fee when it exceeds the percentage, and the frozen-gate snapshot when there is one', async () => {
    const { g, chain } = setup()
    chain.platform.min_commission_mist = '50000'
    expect((await g.loadTerms())!.platform.mist).toBe(50_000n)
    chain.gate.locked_commission = { bps: '100', min_mist: '0' }
    expect((await g.loadTerms())!.platform.mist).toBe(100_000n)
  })

  // Terms are read as soon as a purchase prompt will be needed (no pass), and not at all for a wallet that already holds one.
  it('reads the terms when the check finds no pass, but not when the wallet already holds one', async () => {
    const none = setup()
    fetchAccessNfts.mockResolvedValueOnce([])
    await none.g.checkOwnership('0xalice')
    await vi.waitFor(() => expect(none.g.terms.value).not.toBeNull())

    const has = setup()
    fetchAccessNfts.mockResolvedValueOnce([{ objectId: '0xnft', gateId: GATE_ID, variant: { kind: 'unlimited' } }])
    await has.g.checkOwnership('0xalice')
    expect(has.g.terms.value).toBeNull()
    expect(has.getObject).not.toHaveBeenCalled()
  })

  // A failed read leaves `terms` empty and sets `termsError` to the fixed plain sentence; the cause is logged.
  it('reports why the terms cannot be read', async () => {
    const { g, chain } = setup()
    chain.fail = new Error('rpc down')
    expect(await g.loadTerms()).toBeNull()
    expect(g.termsError.value).toBe(TERMS_UNAVAILABLE_MESSAGE)
    expect(g.terms.value).toBeNull()
    // The cause is for developers: logged once, with the original error object.
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError.mock.calls[0]![1]).toBe(chain.fail)
  })

  // `termsError` contains no gate id, host or chain detail: the person can act on it, and the developer has the console.
  it('says only plain words, with no gate id or chain detail, in termsError', async () => {
    const { g, chain } = setup()
    chain.fail = new Error('rpc down')
    await g.loadTerms()
    expect(g.termsError.value).not.toMatch(/rpc|0x|chain|gate|operator/i)
  })

  // An object that is not a `Gate` of the published package (another type at that id) is refused, not trusted.
  it('refuses a configured gate that is not a Gate of the published package', async () => {
    const { g, chain } = setup()
    chain.gateType = '0xdead::access_gate::Gate'
    expect(await g.loadTerms()).toBeNull()
    expect(g.termsError.value).toBe(TERMS_UNAVAILABLE_MESSAGE)
    expect(String(consoleError.mock.calls[0]![1])).toContain(`Gate ${GATE_ID} was not found on testnet`)
  })

  // A config that says transferable for a soulbound gate (or the reverse) is refused: buyers must be told the truth about the pass.
  it('refuses a configured pass kind that disagrees with the gate', async () => {
    const { g, chain } = setup()
    chain.gate.soulbound = false
    expect(await g.loadTerms()).toBeNull()
    expect(g.termsError.value).toBe(TERMS_UNAVAILABLE_MESSAGE)
    expect(String(consoleError.mock.calls[0]![1])).toMatch(/pass kind/)
  })

  // With no gate there is nothing to read: no client call is made.
  it('does not read anything for an ungated relay', async () => {
    const { g, getObject } = setup({ gate: null })
    expect(await g.loadTerms()).toBeNull()
    expect(getObject).not.toHaveBeenCalled()
  })
})

// The purchase: the wallet opens only for terms the person has seen; the purchase is built from the freshly read price; aborts are reported in words; a slow index never costs a second pass.
describe('useAccessGate purchase', () => {
  // With no terms shown the purchase reads them, publishes them and throws: the executor is never called.
  it('never opens the wallet for terms the user has not seen', async () => {
    const { g } = setup()
    fetchAccessNfts.mockResolvedValue([])
    const ex = executor()
    await expect(g.purchase(ex, '0xalice')).rejects.toThrow(/terms have changed/)
    expect(ex.signAndExecute).not.toHaveBeenCalled()
    // The terms were read and published, so the next attempt is against what is now on screen.
    expect(g.terms.value?.priceMist).toBe(10_000_000n)
    expect(g.purchaseError.value).toMatch(/terms have changed/)
  })

  // The transaction is built for the price just read from the chain, after it equalled the terms the person saw.
  it('builds the purchase from the on-chain price and the shown terms', async () => {
    const { g } = setup()
    fetchAccessNfts.mockResolvedValueOnce([]).mockResolvedValue([{ objectId: '0xnft', gateId: GATE_ID, variant: { kind: 'unlimited' } }])
    await g.loadTerms()
    const ex = executor()
    await g.purchase(ex, '0xalice')
    expect(buildPurchaseTx).toHaveBeenCalledTimes(1)
    expect(buildPurchaseTx).toHaveBeenCalledWith(gate, 10_000_000n)
    expect(ex.signAndExecute).toHaveBeenCalledTimes(1)
    expect(g.hasAccess.value).toBe(true)
    expect(g.purchaseError.value).toBeNull()
  })

  // If the price moved between the prompt and the click, the new terms are shown and the purchase stops: the wallet never opens at a price the person did not see.
  it('stops, and shows the new terms, when the price changed after the terms were shown', async () => {
    const { g, chain } = setup()
    await g.loadTerms()
    chain.gate.price_mist = '20000000' // the operator raised the price
    const ex = executor()
    await expect(g.purchase(ex, '0xalice')).rejects.toThrow(/terms have changed/)
    expect(ex.signAndExecute).not.toHaveBeenCalled()
    expect(g.terms.value?.priceMist).toBe(20_000_000n)

    fetchAccessNfts.mockResolvedValue([{ objectId: '0xnft', gateId: GATE_ID, variant: { kind: 'unlimited' } }])
    await g.purchase(ex, '0xalice')
    expect(buildPurchaseTx).toHaveBeenCalledWith(gate, 20_000_000n)
  })

  // The same stop for a changed recipient or platform fee, not only the price.
  it('stops when the recipient or the fee changed, not only the price', async () => {
    const { g, chain } = setup()
    await g.loadTerms()
    chain.gate.payment_recipient = `0x${'cc'.repeat(32)}`
    await expect(g.purchase(executor(), '0xalice')).rejects.toThrow(/terms have changed/)
    await g.loadTerms()
    chain.platform.commission_bps = '100'
    await expect(g.purchase(executor(), '0xalice')).rejects.toThrow(/terms have changed/)
  })

  // A paused gate cannot be bought from: the person is told, and no prompt opens.
  it('refuses a paused gate before any wallet prompt', async () => {
    const { g, chain } = setup()
    await g.loadTerms()
    chain.gate.paused = true
    const ex = executor()
    await expect(g.purchase(ex, '0xalice')).rejects.toThrow(/paused/)
    expect(g.purchaseError.value).toBe('Purchases are paused right now. Try again later.')
    expect(ex.signAndExecute).not.toHaveBeenCalled()
    expect(g.terms.value?.paused).toBe(true)
  })

  // If the price cannot be read right before signing the purchase stops with the plain sentence (the cause is the console's).
  it('refuses when the price cannot be read, without a wallet prompt', async () => {
    const { g, chain } = setup()
    await g.loadTerms()
    chain.fail = new Error('rpc down')
    const ex = executor()
    await expect(g.purchase(ex, '0xalice')).rejects.toThrow(TERMS_UNAVAILABLE_MESSAGE)
    expect(g.purchaseError.value).toBe(TERMS_UNAVAILABLE_MESSAGE)
    expect(ex.signAndExecute).not.toHaveBeenCalled()
    // Once, with the original error: its message and its cause carry the technical detail.
    expect(consoleError).toHaveBeenCalledTimes(1)
    const logged = consoleError.mock.calls[0]![1] as Error
    expect(logged.message).toBe('Could not read the pass price from the chain: rpc down')
    expect(logged.cause).toBe(chain.fail)
  })

  // An abort of the access-gate package (for example an insufficient payment) is translated to a sentence; any other error is passed on unchanged.
  it('reports an access_gate abort in words and leaves other errors alone', async () => {
    const { g } = setup()
    await g.loadTerms()
    const abort = { $kind: 'MoveAbort', MoveAbort: { abortCode: '2', location: { package: D.originalId, module: 'access_gate' } } }
    const aborting = { signAndExecute: vi.fn(async () => { throw abort }), waitForTransaction: vi.fn() }
    await expect(g.purchase(aborting, '0xalice')).rejects.toThrow('The payment is less than the gate price.')
    expect(g.purchaseError.value).toBe('The payment is less than the gate price.')

    expect(consoleError.mock.calls[0]![1]).toBe(abort)

    const rejected = new Error('User rejected the request')
    const declining = { signAndExecute: vi.fn(async () => { throw rejected }), waitForTransaction: vi.fn() }
    await expect(g.purchase(declining, '0xalice')).rejects.toBe(rejected)
    // The person is not shown the wallet's text, only what to do; the developer gets the error.
    expect(g.purchaseError.value).toBe(PURCHASE_FAILED_MESSAGE)
    expect(consoleError).toHaveBeenLastCalledWith(expect.any(String), rejected)
  })

  // An abort code from a different package that happens to share a number is not read as an access-gate abort.
  it('does not claim an abort from another package', async () => {
    const { g } = setup()
    await g.loadTerms()
    const foreign = { $kind: 'MoveAbort', MoveAbort: { abortCode: '2', location: { package: '0xdead', module: 'access_gate' } } }
    const aborting = { signAndExecute: vi.fn(async () => { throw foreign }), waitForTransaction: vi.fn() }
    await expect(g.purchase(aborting, '0xalice')).rejects.toBe(foreign)
  })

  // After a purchase executes but before the pass is visible, another call only re-checks ownership; it buys again only after `PENDING_PURCHASE_MS`.
  it('never buys a second pass while the first is still being indexed', async () => {
    vi.useFakeTimers()
    try {
      const { g } = setup()
      fetchAccessNfts.mockResolvedValue([]) // the new pass is not visible yet
      await g.loadTerms()
      const ex = executor()
      const first = g.purchase(ex, '0xalice')
      await vi.advanceTimersByTimeAsync(10_000)
      await first
      expect(ex.signAndExecute).toHaveBeenCalledTimes(1)
      expect(g.pendingPurchase.value?.digest).toBe('BUY1')

      // The user clicks buy again: it re-checks and refuses instead of buying.
      await expect(g.purchase(ex, '0xalice')).rejects.toThrow(/went through but the pass is not visible yet/)
      expect(g.purchaseError.value).not.toContain('BUY1') // the digest is for the console, not the page
      expect(String(consoleError.mock.calls.at(-1)![1])).toContain('BUY1')
      expect(ex.signAndExecute).toHaveBeenCalledTimes(1)

      // Once the pass appears, the pending purchase clears and access is granted.
      fetchAccessNfts.mockResolvedValue([{ objectId: '0xnft', gateId: GATE_ID, variant: { kind: 'unlimited' } }])
      await g.purchase(ex, '0xalice')
      expect(g.hasAccess.value).toBe(true)
      expect(g.pendingPurchase.value).toBeNull()
      expect(ex.signAndExecute).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  // Sui's owned-object index can lag finality: the check is retried a few times, and the wait error is surfaced only if the pass never appears.
  it('retries the ownership check while the index catches up, and surfaces the wait error only if it never does', async () => {
    vi.useFakeTimers()
    try {
      const { g } = setup()
      await g.loadTerms()
      const ex = { signAndExecute: vi.fn(async () => ({ digest: 'BUY2' })), waitForTransaction: vi.fn(async () => { throw new Error('wait failed') }) }
      fetchAccessNfts.mockResolvedValue([])
      const attempt = g.purchase(ex, '0xalice')
      const settled = expect(attempt).rejects.toThrow('wait failed')
      await vi.advanceTimersByTimeAsync(20_000)
      await settled
      expect(fetchAccessNfts).toHaveBeenCalledTimes(5)

      // A pass that shows up on the third look wins; the wait error is not thrown.
      const { g: g2 } = setup()
      await g2.loadTerms()
      fetchAccessNfts.mockReset()
      fetchAccessNfts.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValue([{ objectId: '0xnft', gateId: GATE_ID, variant: { kind: 'unlimited' } }])
      const ok = g2.purchase(ex, '0xalice')
      await vi.advanceTimersByTimeAsync(20_000)
      await ok
      expect(g2.hasAccess.value).toBe(true)
      expect(fetchAccessNfts).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  // A pending purchase belongs to the wallet that made it: after a switch it no longer blocks buying.
  it('a wallet switch clears a pending purchase', async () => {
    vi.useFakeTimers()
    try {
      const { g } = setup()
      fetchAccessNfts.mockResolvedValue([])
      await g.loadTerms()
      const p = g.purchase(executor(), '0xalice')
      await vi.advanceTimersByTimeAsync(10_000)
      await p
      g.reset()
      expect(g.pendingPurchase.value).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  // `purchase` on a relay with no gate throws: there is nothing to buy.
  it('refuses to purchase on an ungated relay', async () => {
    const { g } = setup({ gate: null })
    await expect(g.purchase(executor(), '0xalice')).rejects.toThrow(/No access gate configured/)
  })
})

// Which pass counts and which is used first: usable passes only, the most-depleted single-use pass first, unlimited last.
describe('useAccessGate pass selection', () => {
  const nft = (id: string, variant: unknown) => ({ objectId: id, gateId: GATE_ID, variant })

  // A spent single-use pass is a receipt, not access; of the usable ones the most-depleted is used first (fewer stranded uses), and unlimited passes last.
  it('ignores exhausted receipts, consumes the most-depleted single-use pass first and keeps unlimited last', async () => {
    const { g } = setup()
    fetchAccessNfts.mockResolvedValueOnce([
      nft('0xunl', { kind: 'unlimited' }),
      nft('0xspent', { kind: 'singleUse', remaining: 0n }),
      nft('0xbig', { kind: 'singleUse', remaining: 9n }),
      nft('0xsmall', { kind: 'singleUse', remaining: 2n }),
    ])
    await g.checkOwnership('0xalice')
    expect(g.nftId.value).toBe('0xsmall')
    expect(g.usesRemaining.value).toBe(2n)
    expect(g.singleUse.value).toBe(true)
  })

  // Only exhausted passes means no access; holding an unlimited pass means access without spending a use.
  it('has no access with only exhausted passes, and an unlimited pass only signs', async () => {
    const { g } = setup()
    fetchAccessNfts.mockResolvedValueOnce([nft('0xspent', { kind: 'singleUse', remaining: 0n })])
    await g.checkOwnership('0xalice')
    expect(g.hasAccess.value).toBe(false)
    fetchAccessNfts.mockResolvedValueOnce([nft('0xunl', { kind: 'unlimited' })])
    await g.checkOwnership('0xalice')
    expect(g.hasAccess.value).toBe(true)
    expect(g.singleUse.value).toBe(false)
    expect(g.usesRemaining.value).toBeNull()
  })

  // If the check itself fails the person has no access, but the purchase path stays available (the gateway re-verifies on the server anyway).
  it('fails closed on a failed ownership check but keeps the purchase path', async () => {
    const { g } = setup()
    fetchAccessNfts.mockRejectedValueOnce(new Error('rpc down'))
    await g.checkOwnership('0xalice')
    expect(g.hasAccess.value).toBe(false)
    expect(g.nftId.value).toBeNull()
    expect(g.error.value).toBe('rpc down')
  })
})
