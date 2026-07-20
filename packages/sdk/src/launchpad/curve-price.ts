import { formatEther } from 'viem'
import { TOTAL_SUPPLY } from './bonding-curve.js'
import { priceFromSqrtPriceX96 } from '../pool/pool-tvl-math.js'

/**
 * Virtual native reserve seeded into every curve, which is what gives a brand-new token a finite
 * starting price instead of dividing by an empty reserve.
 *
 * Hardcoded rather than read per-token: it is a constructor parameter on the contract, but every
 * deployment so far uses 3400e18, and historical chart points were all computed against this value.
 * Changing it retroactively re-prices every candle ever rendered.
 */
export const VIRTUAL_AMOUNT = 3400n * 10n ** 18n

/** The reserve snapshot a curve swap carries, as the indexer records it. */
export interface CurveSwapEvent {
    timestamp: number
    isBuy: boolean
    amountIn: bigint
    amountOut: bigint
    reserveIn: bigint
    reserveOut: bigint
    sender?: string
}

/** Curve price in native per token, from the reserves left behind by a swap. */
export function calculatePrice(event: CurveSwapEvent): number {
    const nativeReserve = event.isBuy ? event.reserveIn : event.reserveOut
    const tokenReserve = event.isBuy ? event.reserveOut : event.reserveIn
    if (nativeReserve === 0n || tokenReserve === 0n) return 0
    const effectiveReserve = parseFloat(formatEther(nativeReserve + VIRTUAL_AMOUNT))
    const tokenRes = parseFloat(formatEther(tokenReserve))
    if (tokenRes === 0) return 0
    return effectiveReserve / tokenRes
}

/** Market cap in native, i.e. {@link calculatePrice} across the full fixed supply. */
export function calculateMarketCapValue(event: CurveSwapEvent): number {
    return calculatePrice(event) * TOTAL_SUPPLY
}

/**
 * Curve price *before* the swap, by unwinding the trade from the post-swap reserves. Candle opens
 * need this so a bucket's first trade shows the price it started at rather than where it landed.
 */
export function calculatePreSwapPrice(event: CurveSwapEvent): number {
    let preNative: bigint, preToken: bigint
    if (event.isBuy) {
        preNative = event.reserveIn - event.amountIn
        preToken = event.reserveOut + event.amountOut
    } else {
        preNative = event.reserveOut + event.amountOut
        preToken = event.reserveIn - event.amountIn
    }
    if (preNative < 0n || preToken <= 0n) return 0
    const effectiveReserve = parseFloat(formatEther(preNative + VIRTUAL_AMOUNT))
    const tokenRes = parseFloat(formatEther(preToken))
    if (tokenRes === 0) return 0
    return effectiveReserve / tokenRes
}

/**
 * Post-graduation price in native per token, read from the V3 pool's sqrtPriceX96.
 *
 * A launchpad-shaped wrapper over {@link priceFromSqrtPriceX96}: the pair is always 18/18 here, and
 * callers know which side the token sits on rather than passing decimals. The `tokenIsToken0` branch
 * is bit-identical to the shared helper; the reciprocal branch differs from the old hand-rolled
 * integer inversion only in the last place (~2e-16).
 *
 * Both zero guards matter. An uninitialised pool must read as 0, not Infinity — every caller filters
 * on `price <= 0`, which Infinity would sail straight through and into a chart axis.
 */
export function calculatePriceFromSqrtPrice(sqrtPriceX96: bigint, tokenIsToken0: boolean): number {
    if (sqrtPriceX96 <= 0n) return 0
    const price = priceFromSqrtPriceX96(sqrtPriceX96, 18, 18)
    if (tokenIsToken0) return price
    return price > 0 ? 1 / price : 0
}
