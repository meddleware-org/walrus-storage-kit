// useGatedUpload: when an upload needs relay access, and what is handed to the flow when it does (the pass, the persisted consume's key,
// the wallet). The flow itself is covered in @meddleware/walrus-storage-client; here it is a spy.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import * as flow from '@meddleware/walrus-storage-client/flow'
import { useGatedUpload, type AccessGateState, type GatedAccessInput } from '../src/composables/useGatedUpload.js'

vi.mock('@meddleware/walrus-storage-client/flow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@meddleware/walrus-storage-client/flow')>()),
  createGatedAccess: vi.fn(() => ({ marker: 'access' })),
}))

const GATE_ID = `0x${'a1'.repeat(32)}`
const NFT = `0x${'b2'.repeat(32)}`
const config = { packageId: '0x1', platformConfigId: '0x2', nftType: '0x1::m::T', gateId: GATE_ID, soulbound: true }

function state(over: Partial<{ gate: typeof config | null; hasAccess: boolean | null; nftId: string | null; singleUse: boolean }> = {}) {
  const buildConsume = vi.fn(() => 'tx')
  const s = {
    gate: 'gate' in over ? over.gate : config,
    hasAccess: ref(over.hasAccess === undefined ? true : over.hasAccess),
    nftId: ref(over.nftId === undefined ? NFT : over.nftId),
    singleUse: ref(over.singleUse ?? true),
    buildConsume,
  }
  return { s: s as unknown as AccessGateState, buildConsume }
}

const executor = { signAndExecute: vi.fn(async () => ({ digest: 'D' })), waitForTransaction: vi.fn(async () => ({})) }
const input = (over: Partial<GatedAccessInput> = {}): GatedAccessInput => ({
  relayHost: 'https://operator.example',
  publicHost: 'https://public.example',
  address: '0xabc',
  network: 'testnet',
  executor: executor as never,
  sign: vi.fn() as never,
  storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  ...over,
})

beforeEach(() => vi.mocked(flow.createGatedAccess).mockClear())

describe('useGatedUpload.accessFor', () => {
  it('returns access for the operator relay when the wallet holds a pass', () => {
    const { accessFor } = useGatedUpload(state().s)
    expect(accessFor(input())).toEqual({ marker: 'access' })
    const ports = vi.mocked(flow.createGatedAccess).mock.calls[0]![0]
    expect(ports).toMatchObject({
      key: flow.consumeStorageKey('testnet', GATE_ID, '0xabc'),
      relayHost: 'https://operator.example',
      address: '0xabc',
      gateId: GATE_ID,
      network: 'testnet',
      nftId: NFT,
      singleUse: true,
    })
  })

  it.each([
    ['no gate is configured', { gate: null }],
    ['access is unknown', { hasAccess: null }],
    ['the wallet holds no pass', { hasAccess: false }],
    ['no pass object was found', { nftId: null }],
  ])('returns nothing when %s', (_name, over) => {
    expect(useGatedUpload(state(over).s).accessFor(input())).toBeUndefined()
    expect(flow.createGatedAccess).not.toHaveBeenCalled()
  })

  it('never gates an upload through the public relay, however its address is written', () => {
    const { accessFor } = useGatedUpload(state().s)
    expect(accessFor(input({ relayHost: 'https://public.example' }))).toBeUndefined()
    expect(accessFor(input({ relayHost: 'https://PUBLIC.example/' }))).toBeUndefined()
    expect(flow.createGatedAccess).not.toHaveBeenCalled()
  })

  it('reads the state at call time when given a getter (the network can change)', () => {
    const open = state({ gate: null })
    const gated = state()
    let current = open.s
    const { accessFor } = useGatedUpload(() => current)
    expect(accessFor(input())).toBeUndefined()
    current = gated.s
    expect(accessFor(input())).toBeDefined()
  })

  it('builds the consume through the gate state and runs it through the wallet executor', async () => {
    const { s, buildConsume } = state()
    useGatedUpload(s).accessFor(input())
    const ports = vi.mocked(flow.createGatedAccess).mock.calls[0]![0] as unknown as {
      buildConsume(id: string, nonce: string): unknown
      signAndExecute(tx: unknown): Promise<unknown>
      waitForTransaction(d: string): Promise<unknown>
    }
    expect(ports.buildConsume(NFT, 'nonce')).toBe('tx')
    expect(buildConsume).toHaveBeenCalledWith(NFT, 'nonce')
    await ports.signAndExecute('tx')
    await ports.waitForTransaction('D')
    expect(executor.signAndExecute).toHaveBeenCalledWith('tx')
    expect(executor.waitForTransaction).toHaveBeenCalledWith('D')
  })
})
