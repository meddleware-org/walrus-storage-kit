// Unit tests for `src/constants.ts`: `relayGateConfig` builds the relay gate config from the published deployment, and `assertPinnedGate` refuses any config that does not
// match it (audit F10). Pure functions: no DOM, no network.
import { describe, it, expect } from 'vitest'
import { accessGateDeployment } from '@meddleware/access-gate-client/deployments'
import { assertPinnedGate, relayGateConfig } from '../src/constants'

// The relay gate config builder: the package, the `PlatformConfig` and the NFT type come only from the published deployment.
describe('relayGateConfig', () => {
  // The config equals the deployment record field for field: calls target the latest `publishedAt`, the NFT type is at the original id, and `soulbound` picks the NFT struct.
  it('pins the package and PlatformConfig to the published deployment', () => {
    const d = accessGateDeployment('testnet')
    const gate = relayGateConfig('testnet', { gateId: '0xgate', soulbound: true })
    expect(gate).toEqual({
      packageId: d.publishedAt,
      platformConfigId: d.platformConfigId,
      nftType: `${d.originalId}::access_gate::SoulboundAccessNFT`,
      gateId: '0xgate',
      soulbound: true,
    })
    expect(relayGateConfig('testnet', { gateId: '0xgate', soulbound: false }).nftType).toBe(
      `${d.originalId}::access_gate::AccessNFT`,
    )
  })

  // Mainnet has no `access_gate` deployment yet, so building a config for it fails instead of guessing ids.
  it('refuses a network without a recorded deployment', () => {
    expect(() => relayGateConfig('mainnet', { gateId: '0xgate', soulbound: false })).toThrow(
      /no access_gate deployment recorded for mainnet/,
    )
  })

  // The price is read from the gate on the chain at purchase time; a configured price would be a second, possibly wrong, source of truth.
  it('carries no price: it is read from the gate on the chain', () => {
    expect(Object.keys(relayGateConfig('testnet', { gateId: '0xgate', soulbound: true }))).not.toContain('priceMist')
  })
})

// Audit F10: a hand-built config that points anywhere but the published deployment is refused before any purchase or consume is built.
describe('assertPinnedGate (F10)', () => {
  const good = () => relayGateConfig('testnet', { gateId: '0xgate', soulbound: true })

  // The positive control: the builder's own output (both soulbound settings) passes.
  it('accepts what relayGateConfig builds', () => {
    expect(() => assertPinnedGate('testnet', good())).not.toThrow()
    expect(() => assertPinnedGate('testnet', { ...good(), soulbound: false, nftType: relayGateConfig('testnet', { gateId: '0x1', soulbound: false }).nftType })).not.toThrow()
  })

  // Ids are compared as addresses, not as strings, so `0x2` and its zero-padded spelling are the same.
  it('accepts the same ids written without zero padding', () => {
    const d = accessGateDeployment('testnet')
    const short = (id: string) => `0x${id.slice(2).replace(/^0+/, '')}`
    expect(() =>
      assertPinnedGate('testnet', { ...good(), packageId: short(d.publishedAt), platformConfigId: short(d.platformConfigId) }),
    ).not.toThrow()
  })

  it('refuses a foreign package', () => {
    expect(() => assertPinnedGate('testnet', { ...good(), packageId: '0xdead' })).toThrow(/package .* is not the published testnet deployment/)
  })

  it('refuses a foreign PlatformConfig', () => {
    expect(() => assertPinnedGate('testnet', { ...good(), platformConfigId: '0xbeef' })).toThrow(/PlatformConfig/)
  })

  // Three look-alikes: another package, another module and another struct of the right package: the first fails the pinning check, the other two are not access NFT types at all.
  it('refuses an NFT type from another package, another module or another struct', () => {
    const d = accessGateDeployment('testnet')
    expect(() => assertPinnedGate('testnet', { ...good(), nftType: '0xdead::access_gate::SoulboundAccessNFT' })).toThrow(/NFT type/)
    expect(() => assertPinnedGate('testnet', { ...good(), nftType: `${d.originalId}::other::SoulboundAccessNFT` })).toThrow(/not an access NFT type/)
    expect(() => assertPinnedGate('testnet', { ...good(), nftType: `${d.originalId}::access_gate::Gate` })).toThrow(/not an access NFT type/)
  })

  it('refuses an NFT type that disagrees with the soulbound flag', () => {
    expect(() => assertPinnedGate('testnet', { ...good(), soulbound: false })).toThrow(/NFT type/)
  })

  it('refuses a network with no recorded deployment', () => {
    expect(() => assertPinnedGate('mainnet', good())).toThrow(/no access_gate deployment recorded for mainnet/)
  })
})
