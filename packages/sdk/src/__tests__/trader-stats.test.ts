import { describe, it, expect } from 'vitest'
import { parseEther } from 'viem'
import { computeWindowedTraderStats, type LeaderboardSwapEvent } from '../rewards/trader-stats.js'
import type { PnlSwapEvent } from '../pnl/index.js'

describe('rewards/trader-stats', () => {
    const TOKEN = '0xtoken'
    const ALICE = '0xalice'
    const BOB = '0xbob'
    const flatRate = (_t: number) => 2

    function bEvent(tokens: number, kub: number, timestamp: number): PnlSwapEvent {
        return {
            tokenAddr: TOKEN,
            isBuy: true,
            amountIn: parseEther(String(kub)).toString(),
            amountOut: parseEther(String(tokens)).toString(),
            timestamp,
        }
    }
    function sEvent(tokens: number, kub: number, timestamp: number): PnlSwapEvent {
        return {
            tokenAddr: TOKEN,
            isBuy: false,
            amountIn: parseEther(String(tokens)).toString(),
            amountOut: parseEther(String(kub)).toString(),
            timestamp,
        }
    }
    const lb = (e: PnlSwapEvent, sender: string): LeaderboardSwapEvent => ({ ...e, sender })

    it('computeWindowedTraderStats folds in-window swaps, values the net position, isolates addresses', () => {
        const events: LeaderboardSwapEvent[] = [
            lb(bEvent(100, 10, 1), ALICE), // buy 100 for 10 KUB * $2 = $20, avg $0.2
            lb(sEvent(50, 8, 2), ALICE), // sell 50 for 8 KUB * $2 = $16; realized $16 - $10 = $6
            lb(bEvent(200, 30, 1), BOB),
        ]
        const prices = new Map([[TOKEN, 0.3]]) // remaining 50 @ $0.3 = $15, basis $10 -> unrealized $5
        const stats = computeWindowedTraderStats(events, flatRate, prices)

        // Balance comes from the in-window net position (100 - 50 = 50), not any passed-in balance.
        expect(stats.get(ALICE)!.pnlUsd).toBeCloseTo(11) // realized $6 + unrealized $5
        expect(stats.get(ALICE)!.volumeNative).toBeCloseTo(18)
        expect(stats.get(ALICE)!.tradeCount).toBe(2)
        expect(stats.get(ALICE)!.buyCount).toBe(1)
        expect(stats.get(ALICE)!.sellCount).toBe(1)
        expect(stats.get(BOB)!.volumeNative).toBeCloseTo(30)
        expect(stats.get(ALICE)!.pnlUsd).not.toBeCloseTo(stats.get(BOB)!.pnlUsd)
    })
})
