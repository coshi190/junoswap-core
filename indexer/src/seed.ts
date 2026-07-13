import externalPools from '../external-pools.json'

interface V2Entry {
    pair: string
    token0: string
    token1: string
}
interface V3Entry {
    pool: string
    token0: string
    token1: string
    fee: number
    tickSpacing: number
}

const V2_DEX_CHAIN: Record<string, number> = {
    jibswap: 8899,
    udonswap: 96,
    ponder: 96,
    diamon: 96,
}

const v2Pools = new Map<string, { token0: string; token1: string; dex: string }>()
for (const [dex, chainId] of Object.entries(V2_DEX_CHAIN)) {
    for (const e of (externalPools as unknown as Record<string, V2Entry[]>)[dex] ?? []) {
        const key = `${chainId}-${e.pair.toLowerCase()}`
        const prior = v2Pools.get(key)
        if (prior && prior.dex !== dex) {
            throw new Error(
                `external-pools.json: pool ${e.pair} listed under both "${prior.dex}" and "${dex}"`
            )
        }
        v2Pools.set(key, {
            token0: e.token0.toLowerCase(),
            token1: e.token1.toLowerCase(),
            dex,
        })
    }
}

const v3Pools = new Map<string, V3Entry>()
for (const e of (externalPools as { kublerx?: V3Entry[] }).kublerx ?? []) {
    v3Pools.set(`96-${e.pool.toLowerCase()}`, {
        pool: e.pool.toLowerCase(),
        token0: e.token0.toLowerCase(),
        token1: e.token1.toLowerCase(),
        fee: e.fee,
        tickSpacing: e.tickSpacing,
    })
}

export function getSeedV2Pool(chainId: number, address: string) {
    return v2Pools.get(`${chainId}-${address.toLowerCase()}`)
}

export function getSeedV2Dex(chainId: number, address: string) {
    return v2Pools.get(`${chainId}-${address.toLowerCase()}`)?.dex
}

export function getSeedV3Pool(chainId: number, address: string) {
    return v3Pools.get(`${chainId}-${address.toLowerCase()}`)
}
