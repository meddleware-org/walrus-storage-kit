// Builds the relay access for one upload from the NFT-gate state. The gated operator relay needs proof of an access pass; this is
// the one place that decides whether an upload needs it and wires the pass, the wallet and the persisted consume together, so an
// app's `performUpload` no longer repeats it.
import { browserStorage, consumeStorageKey, createGatedAccess } from '@meddleware/walrus-storage-client/flow'
import type { GatedAccess, GatedAccessPorts, UploadProgress } from '@meddleware/walrus-storage-client/flow'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import type { Transaction } from '@mysten/sui/transactions'
import { relayOrigin } from '../lib/relay.js'
import type { WalrusNetwork } from '../lib/relay.js'
import type { useAccessGate } from './useAccessGate.js'

/** The state `useAccessGate` returns (what the access decision reads). */
export type AccessGateState = Pick<
  ReturnType<typeof useAccessGate>,
  'gate' | 'hasAccess' | 'nftId' | 'singleUse' | 'buildConsume'
>

export interface GatedAccessInput {
  /** The relay the upload goes through. */
  relayHost: string
  /** The public fallback relay: an upload through it is never gated, so it never spends a use. */
  publicHost?: string
  /** The connected account. */
  address: string
  network: WalrusNetwork
  /** Signs and runs the consume transaction (the wallet executor). */
  executor: {
    signAndExecute(tx: Transaction): Promise<{ digest?: string }>
    waitForTransaction(digest: string): Promise<unknown>
  }
  /** The wallet's personal-message signer (free: no gas, no use). */
  sign: GatedAccessPorts<Transaction>['sign']
  onStatus?: (p: UploadProgress) => void
  /** Where a single-use consume is kept between attempts (default: the page's storage, in memory where it is blocked). */
  storage?: GatedAccessPorts<Transaction>['storage']
}

/**
 * `useGatedUpload(gate)` → `{ accessFor }`. `gate` is the access-gate state, or a getter for it when it changes with the network.
 *
 * `accessFor(input)` returns the relay access for an upload, or `undefined` when none is needed: no gate is configured, the wallet
 * holds no pass, or the upload goes through the public relay. For a single-use pass the on-chain consume is persisted before the
 * upload and reused on a retry (the gateway redeems a consume digest once, on a successful upload), so an interrupted upload never
 * burns a use; a fresh use is spent only after the gateway reports the stored one redeemed.
 */
export function useGatedUpload(gate: AccessGateState | (() => AccessGateState)) {
  const state = (): AccessGateState => (typeof gate === 'function' ? gate() : gate)

  function accessFor(input: GatedAccessInput): GatedAccess | undefined {
    const s = state()
    const config = s.gate
    const nftId = s.nftId.value
    if (!config || s.hasAccess.value !== true || !nftId) return undefined
    if (input.publicHost !== undefined && relayOrigin(input.relayHost) === relayOrigin(input.publicHost)) return undefined
    return createGatedAccess<Transaction>({
      storage: input.storage ?? browserStorage(),
      key: consumeStorageKey(input.network, config.gateId, input.address),
      relayHost: input.relayHost,
      address: input.address,
      // Signed into every access proof with the relay's origin: a proof made here works nowhere else.
      gateId: normalizeSuiAddress(config.gateId),
      network: input.network,
      nftId,
      singleUse: s.singleUse.value,
      buildConsume: (id, nonce) => s.buildConsume(id, nonce),
      signAndExecute: (tx) => input.executor.signAndExecute(tx),
      waitForTransaction: (digest) => input.executor.waitForTransaction(digest),
      sign: input.sign,
      onStatus: input.onStatus,
    })
  }

  return { accessFor }
}
