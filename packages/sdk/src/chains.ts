import type { Address } from 'viem'

/**
 * Chain ids by slug. The SDK deliberately keys everything on plain numeric chain ids
 * rather than viem/wagmi chain objects — the indexer runs under Ponder and cannot take
 * a wagmi dependency. The frontend's lib/wagmi.ts builds its chain objects on top of these.
 */
export const CHAIN_IDS = {
    kubTestnet: 25925,
    bitkub: 96,
    jbc: 8899,
    bsc: 56,
    base: 8453,
    worldchain: 480,
} as const

export type ChainSlug = keyof typeof CHAIN_IDS

export const CHAIN_SLUG_BY_ID: Record<number, ChainSlug> = Object.fromEntries(
    Object.entries(CHAIN_IDS).map(([slug, id]) => [id, slug as ChainSlug])
)

export const DEFAULT_RPC_URLS: Record<number, string> = {
    [CHAIN_IDS.kubTestnet]: 'https://rpc-testnet.bitkubchain.io',
    [CHAIN_IDS.bitkub]: 'https://rpc.bitkubchain.io',
    [CHAIN_IDS.jbc]: 'https://rpc-l1.jibchain.net',
    [CHAIN_IDS.bsc]: 'https://56.rpc.thirdweb.com',
    [CHAIN_IDS.base]: 'https://mainnet.base.org',
    [CHAIN_IDS.worldchain]: 'https://worldchain-mainnet.g.alchemy.com/public',
}

/** Lowercased — the indexer compares these against log addresses, which arrive lowercased. */
export const WRAPPED_NATIVE_ADDRESSES: Record<number, Address> = {
    [CHAIN_IDS.kubTestnet]: '0x700d3ba307e1256e509ed3e45d6f9dff441d6907',
    [CHAIN_IDS.bitkub]: '0x67ebd850304c70d983b2d1b93ea79c7cd6c3f6b5',
    [CHAIN_IDS.jbc]: '0xc4b7c87510675167643e3de6eeed4d2c06a9e747',
}

export const STABLECOIN_ADDRESSES: Record<number, ReadonlySet<string>> = {
    [CHAIN_IDS.kubTestnet]: new Set(['0x70138f1b88bee73dd2cb06f24146f964dde6144e']),
    [CHAIN_IDS.bitkub]: new Set(['0x7d984c24d2499d840eb3b7016077164e15e5faa6']),
    [CHAIN_IDS.jbc]: new Set([
        '0x24599b658b57f91e7643f4f154b16bcd2884f9ac',
        '0xfd8ef75c1cb00a594d02df48addc27414bd07f8a',
    ]),
}
