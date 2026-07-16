import { describe, it, expect } from 'vitest'
import { addLiquidity, subLiquidity } from '../src/v3-position-math'

describe('addLiquidity', () => {
    it('accumulates increase deltas onto the stored string liquidity', () => {
        expect(addLiquidity('0', 1000n)).toBe('1000')
        expect(addLiquidity('1000', 250n)).toBe('1250')
    })

    it('handles values beyond Number precision', () => {
        const big = 10n ** 30n
        expect(addLiquidity(big.toString(), big)).toBe((big * 2n).toString())
    })
})

describe('subLiquidity', () => {
    it('subtracts a decrease delta', () => {
        expect(subLiquidity('1250', 250n)).toBe('1000')
    })

    it('clamps at zero rather than going negative (full burn / over-decrease)', () => {
        expect(subLiquidity('1000', 1000n)).toBe('0')
        expect(subLiquidity('1000', 5000n)).toBe('0')
    })
})
