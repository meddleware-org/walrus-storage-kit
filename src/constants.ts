/**
 * The relay gate configuration, pinned to the published `access_gate` deployment.
 *
 * Role: the only place a relay gate config is built or checked. The package id, the `PlatformConfig` and the NFT type come from `@meddleware/access-gate-client/deployments`
 * (generated from `access-gate-sui`'s published records), never from a caller, an environment variable or this repository (CLAUDE.md, "Gate config pinning").
 *
 * Main exports: `relayGateConfig` (build the config for a network), `assertPinnedGate` (check any config against the deployment), `RelayGateInput`.
 *
 * Related: `composables/useAccessGate.ts` (runs `assertPinnedGate` before every purchase and consume), `lib/relay.ts` (`WalrusNetwork`).
 */
import { accessNftType, normalizeAccessNftType } from '@meddleware/access-gate-client'
import { accessGateDeployment } from '@meddleware/access-gate-client/deployments'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import type { WalrusNetwork } from './lib/relay.js'
import type { RelayGateConfig } from './composables/useAccessGate.js'

/** The operator-chosen part of a relay gate. */
export interface RelayGateInput {
  /** The operator's shared `Gate` object id. */
  gateId: string
  /** Whether the gate mints soulbound passes. */
  soulbound: boolean
}

/**
 * The relay gate config for `network`. The package and `PlatformConfig` are always Meddleware's
 * published deployment (from `@meddleware/access-gate-client/deployments`) and cannot be passed
 * in. Calls target the latest package version; the NFT type is at the original id. The purchase
 * price is not part of the config: it is read from the gate on the chain.
 *
 * @throws {Error} if there is no `access_gate` deployment recorded for `network`.
 */
export function relayGateConfig(network: WalrusNetwork, input: RelayGateInput): RelayGateConfig {
  const deployment = accessGateDeployment(network)
  return {
    packageId: deployment.publishedAt,
    platformConfigId: deployment.platformConfigId,
    nftType: accessNftType(deployment.originalId, input.soulbound),
    gateId: input.gateId,
    soulbound: input.soulbound,
  }
}

/**
 * Check that `gate` names the published `access_gate` deployment for `network`: the package, the
 * `PlatformConfig` and the NFT type (at the original id, matching `soulbound`). {@link relayGateConfig}
 * always satisfies this; a hand-built config that points elsewhere does not. `useAccessGate` runs it,
 * so every purchase and consume the library builds targets the published deployment.
 *
 * @throws {Error} if `network` has no recorded deployment or `gate` differs from it.
 */
export function assertPinnedGate(network: WalrusNetwork, gate: RelayGateConfig): void {
  const deployment = accessGateDeployment(network)
  // Ids are compared in their normalised long form, so `0x2` and its zero-padded spelling are the same address.
  const same = (a: string, b: string): boolean => normalizeSuiAddress(a) === normalizeSuiAddress(b)
  if (!same(gate.packageId, deployment.publishedAt)) {
    throw new Error(`access gate: package ${gate.packageId} is not the published ${network} deployment`)
  }
  if (!same(gate.platformConfigId, deployment.platformConfigId)) {
    throw new Error(`access gate: PlatformConfig ${gate.platformConfigId} is not the published ${network} deployment`)
  }
  // The type is normalised too (the package part of `0x…::access_gate::AccessNFT` in long form); a string that is not an access NFT type at all is its own error.
  let nftType: string
  try {
    nftType = normalizeAccessNftType(gate.nftType)
  } catch {
    throw new Error(`access gate: ${gate.nftType} is not an access NFT type`)
  }
  // The NFT type is at the package's ORIGINAL id (types never move on an upgrade), while calls target the latest `publishedAt`, which is why the two checks differ.
  if (nftType !== accessNftType(deployment.originalId, gate.soulbound)) {
    throw new Error(`access gate: NFT type ${gate.nftType} does not match the published ${network} deployment`)
  }
}
