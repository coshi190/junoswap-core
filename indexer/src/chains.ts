export const WRAPPED_NATIVE_ADDRESSES: Record<number, string> = {
    25925: '0x700d3ba307e1256e509ed3e45d6f9dff441d6907',
    96: '0x67ebd850304c70d983b2d1b93ea79c7cd6c3f6b5',
    8899: '0xc4b7c87510675167643e3de6eeed4d2c06a9e747',
}

export const STABLECOIN_ADDRESSES: Record<number, Set<string>> = {
    25925: new Set(['0x70138f1b88bee73dd2cb06f24146f964dde6144e']),
    96: new Set(['0x7d984c24d2499d840eb3b7016077164e15e5faa6']),
    8899: new Set([
        '0x24599b658b57f91e7643f4f154b16bcd2884f9ac',
        '0xfd8ef75c1cb00a594d02df48addc27414bd07f8a',
    ]),
}
