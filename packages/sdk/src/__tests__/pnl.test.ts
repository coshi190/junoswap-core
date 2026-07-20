import { describe, it, expect } from 'vitest'
import { parseEther, parseUnits } from 'viem'
import {
    applyFoldEvent,
    finalizeTokenPnl,
    finalizePortfolioPnl,
    computePortfolioPnl,
    EMPTY_FOLD,
    type PnlFold,
    type FoldSwapInput,
    type PnlSwapEvent,
} from '../pnl/index.js'

// Build a single-token fold from a list of swaps, valuing each at its supplied native→USD rate.
function fold(events: FoldSwapInput[], decimals = 18): PnlFold {
    return events.reduce((f, e) => applyFoldEvent(f, e, decimals), EMPTY_FOLD)
}

function buy(tokens: number, kub: number, nativeUsd: number): FoldSwapInput {
    return {
        isBuy: true,
        amountIn: parseEther(String(kub)).toString(), // native paid
        amountOut: parseEther(String(tokens)).toString(), // tokens received
        nativeUsd,
    }
}

function sell(tokens: number, kub: number, nativeUsd: number): FoldSwapInput {
    return {
        isBuy: false,
        amountIn: parseEther(String(tokens)).toString(), // tokens sold
        amountOut: parseEther(String(kub)).toString(), // native received
        nativeUsd,
    }
}

describe('pnl fold + finalize', () => {
    it('buy-only: unrealized only, no realized', () => {
        // invested 10 KUB * $2 = $20, avg cost $0.2/token; balance 100 @ $0.5 = $50 value
        const pnl = finalizeTokenPnl(fold([buy(100, 10, 2)]), 100, 0.5)
        expect(pnl.totalInvestedUsd).toBeCloseTo(20)
        expect(pnl.costBasisUsd).toBeCloseTo(20)
        expect(pnl.realizedUsd).toBeCloseTo(0)
        expect(pnl.unrealizedUsd).toBeCloseTo(30)
        expect(pnl.totalPnlUsd).toBeCloseTo(30)
        expect(pnl.pnlPercent).toBeCloseTo(150)
    })

    it('partial sell: realizes proceeds minus avg cost of sold', () => {
        // invested $20, avg $0.2. Sell 50 for 8 KUB*$2=$16; costOfSold=$10 -> realized $6.
        // remaining position 50, costPool $10; balance 50 @ $0.3 = $15 value, basis $10 -> unrealized $5.
        const pnl = finalizeTokenPnl(fold([buy(100, 10, 2), sell(50, 8, 2)]), 50, 0.3)
        expect(pnl.realizedUsd).toBeCloseTo(6)
        expect(pnl.costBasisUsd).toBeCloseTo(10)
        expect(pnl.unrealizedUsd).toBeCloseTo(5)
        expect(pnl.totalPnlUsd).toBeCloseTo(11)
    })

    it('full exit: realized captured with zero remaining position', () => {
        // invested $20; proceeds 30 KUB*$2=$60; costOfSold $20 -> realized $40.
        const pnl = finalizeTokenPnl(fold([buy(100, 10, 2), sell(100, 30, 2)]), 0, null)
        expect(pnl.realizedUsd).toBeCloseTo(40)
        expect(pnl.unrealizedUsd).toBeCloseTo(0)
        expect(pnl.totalPnlUsd).toBeCloseTo(40)
    })

    it('values each buy at its historical KUB/USD rate, not the current one', () => {
        // Two buys of 50 tokens for 10 KUB each, but KUB was $1 then $3.
        const pnl = finalizeTokenPnl(fold([buy(50, 10, 1), buy(50, 10, 3)]), 100, 0.5)
        // Historical: $10 + $30 = $40 (NOT 20 KUB * current $3 = $60).
        expect(pnl.totalInvestedUsd).toBeCloseTo(40)
        expect(pnl.costBasisUsd).toBeCloseTo(40)
        expect(pnl.unrealizedUsd).toBeCloseTo(10)
    })

    it('selling more than the accounted position never yields negative basis', () => {
        // Buy 50, then sell 100 (extra 50 arrived via transfer, no cost basis).
        // avg cost $0.4/token; proceeds 40 KUB*$2=$80; costOfSold capped at 50*$0.4=$20 -> realized $60.
        const pnl = finalizeTokenPnl(fold([buy(50, 10, 2), sell(100, 40, 2)]), 0, null)
        expect(pnl.realizedUsd).toBeCloseTo(60)
        expect(pnl.costBasisUsd).toBeCloseTo(0)
        expect(pnl.unrealizedUsd).toBeCloseTo(0)
    })

    it('decodes the token leg at its real decimals (6-dec USDT), not 18', () => {
        // 10 KUB * $2 = $20 for 1000 USDT (6-dec) now worth $1000 -> unrealized +$980.
        const buyUsdt: FoldSwapInput = {
            isBuy: true,
            amountIn: parseEther('10').toString(),
            amountOut: parseUnits('1000', 6).toString(),
            nativeUsd: 2,
        }
        const pnl = finalizeTokenPnl(fold([buyUsdt], 6), 1000, 1)
        expect(pnl.totalInvestedUsd).toBeCloseTo(20)
        expect(pnl.costBasisUsd).toBeCloseTo(20)
        expect(pnl.unrealizedUsd).toBeCloseTo(980)

        // Regression guard: folding the 6-dec token at 18 decimals blows up the basis.
        const broken = finalizeTokenPnl(fold([buyUsdt], 18), 1000, 1)
        expect(broken.unrealizedUsd).toBeLessThan(-1e9)
    })

    it('missing price leaves unrealized and total at zero', () => {
        const pnl = finalizeTokenPnl(fold([buy(100, 10, 2)]), 100, null)
        expect(pnl.unrealizedUsd).toBeCloseTo(0)
        expect(pnl.totalPnlUsd).toBeCloseTo(0)
    })

    it('finalizePortfolioPnl rolls closed and open positions into totals', () => {
        const TOKEN = '0xtoken'
        const OTHER = '0xother'
        const folds = new Map<string, PnlFold>([
            [TOKEN, fold([buy(100, 10, 2), sell(100, 30, 2)])], // realized $40, position 0
            [OTHER, fold([buy(100, 10, 2)])], // invested $20
        ])
        const balances = new Map([[OTHER, 100]])
        const prices = new Map<string, number | null>([[OTHER, 0.5]]) // $50 value -> unrealized $30

        const { totals } = finalizePortfolioPnl(folds, balances, prices)
        expect(totals.realizedUsd).toBeCloseTo(40)
        expect(totals.unrealizedUsd).toBeCloseTo(30)
        expect(totals.totalPnlUsd).toBeCloseTo(70)
        expect(totals.totalInvestedUsd).toBeCloseTo(40)
    })
})

describe('pnl batch engine', () => {
    const TOKEN = '0xtoken'

    function bEvent(tokens: number, kub: number, timestamp: number): PnlSwapEvent {
        return {
            tokenAddr: TOKEN,
            isBuy: true,
            amountIn: parseEther(String(kub)).toString(),
            amountOut: parseEther(String(tokens)).toString(),
            timestamp,
        }
    }

    it('computePortfolioPnl values each buy at its historical rate', () => {
        const events = [bEvent(50, 10, 1), bEvent(50, 10, 2)]
        const priceAt = (t: number) => (t <= 1 ? 1 : 3)
        const { perToken } = computePortfolioPnl(
            events,
            new Map([[TOKEN, 100]]),
            new Map([[TOKEN, 0.5]]),
            priceAt
        )
        expect(perToken.get(TOKEN)!.totalInvestedUsd).toBeCloseTo(40) // $10 + $30, not 20*$3
        expect(perToken.get(TOKEN)!.unrealizedUsd).toBeCloseTo(10)
    })
})
