import { describe, it, expect } from 'vitest'
import {
    computePoints,
    computeReferralPoints,
    aggregatePointsByAddress,
    type SwapEventRow,
} from '../leaderboard/points'

const TOKEN = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

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

describe('aggregatePointsByAddress', () => {
    const NATIVE_100 = '100000000000000000000' // 100e18
    const NATIVE_500 = '500000000000000000000' // 500e18

    it('splits volume by source, lowercases addresses, and floors points once', () => {
        const rows: SwapEventRow[] = [
            // junoswap buy: native paid is amountIn (100 native, full rate)
            {
                tokenAddr: TOKEN,
                sender: '0xABC',
                isBuy: 1,
                amountIn: NATIVE_100,
                amountOut: '5',
                timestamp: 100,
                protocol: 'junoswap',
            },
            // external sell: native received is amountOut (500 native, 10x discount)
            {
                tokenAddr: TOKEN,
                sender: '0xabc',
                isBuy: 0,
                amountIn: '7',
                amountOut: NATIVE_500,
                timestamp: 200,
                protocol: 'jibswap',
            },
        ]
        const agg = aggregatePointsByAddress(rows).get('0xabc')!
        // displayed volume is the real total (no discount): 100 + 500
        expect(agg.volumeNative).toBe(600)
        // points discount external: floor(100/50 + 500/500) = floor(2 + 1) = 3
        expect(agg.points).toBe(computePoints(100, 500))
        expect(agg.points).toBe(3)
        expect(agg).toMatchObject({ tradeCount: 2, buyCount: 1, sellCount: 1 })
    })
})
