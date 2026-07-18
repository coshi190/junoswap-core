import { formatEther } from 'viem'
import { deriveNativeUsdPrice, type PoolVolumeMeta } from '../volume/pool-volume-math.js'

const Q96 = 2n ** 96n

/**
 * Minimal pool shape the TVL math needs — identical to {@link PoolVolumeMeta}, re-exported here so
 * TVL callers don't reach into the volume module. `V3PoolData` (frontend) satisfies it structurally.
 */
export type PoolTvlMeta = PoolVolumeMeta

/** Current on-chain token balance of a pool for each of its two tokens. */
export interface PoolBalances {
    balance0: bigint
    balance1: bigint
}

function isAddr(a: string, b: string | undefined): boolean {
    return !!b && a.toLowerCase() === b.toLowerCase()
}

/**
 * Price of one whole token0 denominated in token1, derived from a pool's sqrtPriceX96. Decimals
 * adjust the raw ratio to human units; the reciprocal gives token0 per token1. Returns 0 for an
 * uninitialised pool (sqrtPriceX96 <= 0). Canonical helper shared by the TVL/dashboard/chart paths.
 */
export function priceFromSqrtPriceX96(
    sqrtPriceX96: bigint,
    token0Decimals: number,
    token1Decimals: number
): number {
    if (sqrtPriceX96 <= 0n) return 0
    const SCALE = 10n ** 18n
    const rawX = (sqrtPriceX96 * sqrtPriceX96 * SCALE) / (Q96 * Q96) // (token1/token0) × 1e18, raw
    return (Number(rawX) / 1e18) * 10 ** (token0Decimals - token1Decimals)
}

/** Prices both token balances directly from a USD price map (non-native pools). */
export function computeTvlFromPrices(
    balance0: bigint,
    decimals0: number,
    balance1: bigint,
    decimals1: number,
    price0: number,
    price1: number
): number {
    const human0 = Number(balance0) / Math.pow(10, decimals0)
    const human1 = Number(balance1) / Math.pow(10, decimals1)
    return human0 * price0 + human1 * price1
}

/**
 * Converts a native-leg pool's token balances into USD via the pool's own sqrtPriceX96 (converting
 * the non-native leg into native terms) and the native/USD price. Returns null when the pool is
 * unpriceable (no price yet, or neither leg is native) — TVL callers treat null as "unknown".
 */
export function computeTvlUsd(
    balance0: bigint,
    balance1: bigint,
    sqrtPriceX96: bigint,
    isToken0Native: boolean,
    isToken1Native: boolean,
    nativeUsdPrice: number
): number | null {
    if (sqrtPriceX96 === 0n) return null
    if (!isToken0Native && !isToken1Native) return null

    let tvlNativeRaw: bigint
    if (isToken1Native) {
        const value0InNative = (balance0 * sqrtPriceX96 * sqrtPriceX96) / (Q96 * Q96)
        tvlNativeRaw = value0InNative + balance1
    } else {
        const value1InNative = (balance1 * Q96 * Q96) / (sqrtPriceX96 * sqrtPriceX96)
        tvlNativeRaw = balance0 + value1InNative
    }

    const tvlNative = Number(formatEther(tvlNativeRaw))
    return tvlNative * nativeUsdPrice
}

/**
 * Computes each pool's TVL in USD from its current token balances.
 *
 * Three pricing strategies, in priority order per pool:
 *  1. native leg + a real native/USD price → USD via {@link computeTvlUsd}.
 *  2. native leg but no native/USD price (and sqrtPriceX96 > 0) → TVL expressed in native-token units
 *     (not USD — an intentional fallback, mixed units).
 *  3. no native leg → priced directly from `priceMap` via {@link computeTvlFromPrices}.
 *
 * `balances` is keyed by lowercased pool address so callers aren't coupled to a positional read array.
 * Pools with no entry in `balances`, or that stay unpriceable, are simply absent from the result.
 */
export function computePoolTvlUsd(params: {
    pools: PoolTvlMeta[]
    balances: Map<string, PoolBalances>
    wrappedNative?: string
    usdStable?: string
    priceMap: Map<string, number>
}): Record<string, number | null> {
    const { pools, balances, wrappedNative, usdStable, priceMap } = params

    const nativeUsdPrice = deriveNativeUsdPrice(pools, wrappedNative, usdStable)
    const result: Record<string, number | null> = {}

    for (const pool of pools) {
        const bal = balances.get(pool.address.toLowerCase())
        if (!bal) continue
        const { balance0: bal0, balance1: bal1 } = bal

        const key = pool.address.toLowerCase()
        const isToken0Native = isAddr(pool.token0.address, wrappedNative)
        const isToken1Native = isAddr(pool.token1.address, wrappedNative)

        if (isToken0Native || isToken1Native) {
            if (nativeUsdPrice) {
                result[key] = computeTvlUsd(
                    bal0,
                    bal1,
                    pool.sqrtPriceX96,
                    isToken0Native,
                    isToken1Native,
                    nativeUsdPrice
                )
            } else if (pool.sqrtPriceX96 > 0n) {
                if (isToken1Native) {
                    const value0 = (bal0 * pool.sqrtPriceX96 * pool.sqrtPriceX96) / (Q96 * Q96)
                    result[key] = Number(formatEther(value0 + bal1))
                } else if (isToken0Native) {
                    const value1 = (bal1 * Q96 * Q96) / (pool.sqrtPriceX96 * pool.sqrtPriceX96)
                    result[key] = Number(formatEther(bal0 + value1))
                }
            }
        } else {
            const price0 = priceMap.get(pool.token0.address.toLowerCase())
            const price1 = priceMap.get(pool.token1.address.toLowerCase())

            if (price0 != null && price1 != null) {
                result[key] = computeTvlFromPrices(
                    bal0,
                    pool.token0.decimals,
                    bal1,
                    pool.token1.decimals,
                    price0,
                    price1
                )
            }
        }
    }

    return result
}
