import { describe, it, expect } from 'vitest'
import { creatorFeeShareForSwap, pumpFeeFromNetAmountIn } from '../src/creator-fee'

const E18 = 10n ** 18n

describe('pumpFeeFromNetAmountIn', () => {
    it('reconstructs the 1% fee the contract deducted from the gross amount', () => {
        // Contract: gross = 100 KUB → fee = 1 KUB, net (emitted) = 99 KUB
        const gross = 100n * E18
        const contractFee = (gross * 100n) / 10000n
        const net = gross - contractFee
        expect(pumpFeeFromNetAmountIn(net)).toBe(contractFee)
    })

    it('returns 0 for zero or negative input', () => {
        expect(pumpFeeFromNetAmountIn(0n)).toBe(0n)
        expect(pumpFeeFromNetAmountIn(-5n)).toBe(0n)
    })
})

describe('creatorFeeShareForSwap', () => {
    it('gives the creator half the pump fee, in whatever asset netAmountIn is denominated', () => {
        // buy: net amountIn 99 KUB → pump fee 1 KUB → creator share 0.5 KUB
        expect(creatorFeeShareForSwap(99n * E18)).toBe(E18 / 2n)
    })

    it('applies identically to a token-denominated sell amount (no cross-asset conversion)', () => {
        // sell: net token amountIn 9.9M → pump fee 100k tokens → creator share 50k tokens
        expect(creatorFeeShareForSwap(9_900_000n * E18)).toBe(50_000n * E18)
    })

    it('returns 0 for a zero net amount', () => {
        expect(creatorFeeShareForSwap(0n)).toBe(0n)
    })
})
