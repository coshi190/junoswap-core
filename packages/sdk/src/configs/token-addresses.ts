import type { Address } from 'viem'
import { CHAIN_IDS } from './dex-config.js'

export const WRAPPED_NATIVE_ADDRESSES: Record<number, Address> = {
    [CHAIN_IDS.kubTestnet]: '0x700d3ba307e1256e509ed3e45d6f9dff441d6907',
    [CHAIN_IDS.bitkub]: '0x67ebd850304c70d983b2d1b93ea79c7cd6c3f6b5',
    [CHAIN_IDS.jbc]: '0xc4b7c87510675167643e3de6eeed4d2c06a9e747',
    [CHAIN_IDS.worldchain]: '0x4200000000000000000000000000000000000006',
    [CHAIN_IDS.base]: '0x4200000000000000000000000000000000000006',
    [CHAIN_IDS.bsc]: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
}

export const STABLECOIN_ADDRESSES: Record<number, ReadonlySet<string>> = {
    [CHAIN_IDS.kubTestnet]: new Set(['0x70138f1b88bee73dd2cb06f24146f964dde6144e']),
    [CHAIN_IDS.bitkub]: new Set(['0x7d984c24d2499d840eb3b7016077164e15e5faa6']),
    [CHAIN_IDS.jbc]: new Set([
        '0x24599b658b57f91e7643f4f154b16bcd2884f9ac',
        '0xfd8ef75c1cb00a594d02df48addc27414bd07f8a',
    ]),
}
