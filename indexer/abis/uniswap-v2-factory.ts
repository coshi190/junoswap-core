export const UNISWAP_V2_FACTORY_ABI = [
    {
        type: 'event',
        name: 'PairCreated',
        inputs: [
            { name: 'token0', type: 'address', indexed: true },
            { name: 'token1', type: 'address', indexed: true },
            { name: 'pair', type: 'address', indexed: false },
            { name: 'allPairsLength', type: 'uint256', indexed: false },
        ],
    },
] as const
