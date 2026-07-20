import { describe, it, expect } from 'vitest'
import { calculatePriceFromSqrtPrice } from '../launchpad/curve-price.js'
import { priceFromSqrtPriceX96 } from '../pool/pool-tvl-math.js'

/** sqrtPriceX96 encoding a given token1/token0 ratio. */
const sqrtFor = (ratio: number) => BigInt(Math.floor(Math.sqrt(ratio) * 2 ** 96))

describe('calculatePriceFromSqrtPrice', () => {
    // The guard that does the real work. Routing through priceFromSqrtPriceX96 makes the
    // reciprocal branch 1/0 = Infinity if unguarded, and Infinity passes every caller's
    // `price <= 0` filter — it would reach a chart axis instead of being dropped.
    it('returns 0 for an uninitialised pool in both directions', () => {
        expect(calculatePriceFromSqrtPrice(0n, true)).toBe(0)
        expect(calculatePriceFromSqrtPrice(0n, false)).toBe(0)
    })

    it('returns 0 for a negative sqrtPriceX96 in both directions', () => {
        expect(calculatePriceFromSqrtPrice(-1n, true)).toBe(0)
        expect(calculatePriceFromSqrtPrice(-1n, false)).toBe(0)
    })

    it('returns 0 rather than Infinity when the ratio underflows the 1e18 fixed point', () => {
        // token1/token0 below 1e-18 truncates to 0 in the shared helper; the reciprocal
        // branch must not turn that into Infinity.
        const s = sqrtFor(1e-20)
        expect(priceFromSqrtPriceX96(s, 18, 18)).toBe(0)
        expect(calculatePriceFromSqrtPrice(s, true)).toBe(0)
        expect(calculatePriceFromSqrtPrice(s, false)).toBe(0)
    })

    it('is exactly the shared 18/18 helper when the token is token0', () => {
        for (const ratio of [4.375e-6, 1e-9, 1e-12, 1e-15, 1e-18]) {
            const s = sqrtFor(ratio)
            expect(calculatePriceFromSqrtPrice(s, true)).toBe(priceFromSqrtPriceX96(s, 18, 18))
        }
    })

    it('inverts when the token is token1', () => {
        // Float reciprocal, so compare relatively rather than exactly.
        for (const ratio of [4.375e-6, 1e-9, 1e-12]) {
            const s = sqrtFor(1 / ratio)
            const inverted = calculatePriceFromSqrtPrice(s, false)
            const direct = calculatePriceFromSqrtPrice(s, true)
            expect(Math.abs(inverted - 1 / direct) / (1 / direct)).toBeLessThan(1e-12)
            expect(Math.abs(inverted - ratio) / ratio).toBeLessThan(1e-9)
        }
    })
})
