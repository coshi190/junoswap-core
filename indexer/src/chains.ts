export const CHAIN_IDS = {
    kubTestnet: 25925,
    bitkub: 96,
    jbc: 8899,
} as const

export const DEFAULT_RPC_URLS: Record<number, string> = {
    [CHAIN_IDS.kubTestnet]: 'https://rpc-testnet.bitkubchain.io',
    [CHAIN_IDS.bitkub]: 'https://rpc.bitkubchain.io',
    [CHAIN_IDS.jbc]: 'https://rpc-l1.jibchain.net',
}
