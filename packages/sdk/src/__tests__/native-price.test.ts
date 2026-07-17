import { describe, it, expect } from 'vitest'
import { makePriceAt, sanitizePricePoints } from '../leaderboard/native-price.js'

describe('leaderboard/native-price', () => {
    it('makePriceAt returns the last price at or before a timestamp', () => {
        const priceAt = makePriceAt(
            [
                { timestamp: 10, price: 1 },
                { timestamp: 20, price: 2 },
                { timestamp: 30, price: 3 },
            ],
            null
        )
        expect(priceAt(5)).toBe(1) // before first point clamps to it
        expect(priceAt(10)).toBe(1)
        expect(priceAt(25)).toBe(2)
        expect(priceAt(30)).toBe(3)
        expect(priceAt(999)).toBe(3)
    })

    it('makePriceAt falls back to the given price for an empty series', () => {
        expect(makePriceAt([], 7)(123)).toBe(7)
        expect(makePriceAt([], null)(123)).toBe(0)
    })

    it('sanitizePricePoints drops non-finite, non-positive, and gross outliers', () => {
        const points = [
            { timestamp: 1, price: 1 },
            { timestamp: 2, price: 0 }, // dropped (non-positive)
            { timestamp: 3, price: 2 },
            { timestamp: 4, price: Infinity }, // dropped (non-finite)
            { timestamp: 5, price: 1e6 }, // dropped (>100x median)
            { timestamp: 6, price: 3 },
            { timestamp: 7, price: 2 },
        ]
        expect(sanitizePricePoints(points).map((p) => p.timestamp)).toEqual([1, 3, 6, 7])
    })
})
