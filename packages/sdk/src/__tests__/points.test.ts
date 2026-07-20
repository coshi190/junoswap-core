import { describe, it, expect } from 'vitest'
import {
    computePoints,
    computeReferralPoints,
    isJunoswapProtocol,
} from '../rewards/points.js'

describe('computePoints', () => {
    it('scores junoswap volume at 1 point per 50 native', () => {
        expect(computePoints(100, 0)).toBe(2)
    })

    it('discounts external volume 10x (1 point per 500 native)', () => {
        // The same 1000 native earns 20 points on junoswap but only 2 externally.
        expect(computePoints(1000, 0)).toBe(20)
        expect(computePoints(0, 1000)).toBe(2)
    })

    it('sums both sources before flooring', () => {
        // 25/50 + 250/500 = 0.5 + 0.5 = 1, though each source alone floors to 0.
        expect(computePoints(25, 250)).toBe(1)
        expect(computePoints(50, 500)).toBe(2)
    })
})

describe('computeReferralPoints', () => {
    it('awards 10% of the summed referee points, floored once', () => {
        expect(computeReferralPoints([1200, 340])).toBe(154) // floor(1540 * 0.1)
    })

    it('floors the aggregate, not per referee', () => {
        // Each alone (5*0.1=0.5) floors to 0, but the sum (1) survives.
        expect(computeReferralPoints([5, 5])).toBe(1)
        expect(computeReferralPoints([])).toBe(0)
    })
})

describe('isJunoswapProtocol', () => {
    it('counts only junoswap as the first-party venue', () => {
        expect(isJunoswapProtocol('junoswap')).toBe(true)
        // everything else is external, including the parser fallback for an unlabelled V2 swap
        expect(isJunoswapProtocol('jibswap')).toBe(false)
        expect(isJunoswapProtocol('kublerx')).toBe(false)
        expect(isJunoswapProtocol('unknown')).toBe(false)
        expect(isJunoswapProtocol('')).toBe(false)
    })
})
