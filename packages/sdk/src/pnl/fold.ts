import { formatEther, formatUnits } from 'viem'

/**
 * Average-cost PnL accounting, shared by the indexer (which folds swaps at index time and finalizes
 * in its API routes) and any consumer that wants the same math. Split into two phases:
 *
 *   fold      — walk a user's swaps for one token into a running position + USD cost pool. The native
 *               leg is always 18-decimal (`formatEther`); the token leg uses the token's real decimals
 *               so `position` lands in the same human units as an on-chain balance.
 *   finalize  — value the remaining position at a current price to get cost basis + unrealized PnL.
 *
 * This used to live entirely client-side in the frontend's `computePortfolioPnl`; the fold now runs
 * incrementally in the indexer's swap handlers and the finalize in its `/user-pnl` / `/leaderboard`
 * routes, so the browser just displays the result.
 */

export interface TokenPnl {
    costBasisUsd: number
    totalInvestedUsd: number
    realizedUsd: number
    unrealizedUsd: number
    totalPnlUsd: number
    pnlPercent: number
}

export interface PortfolioPnlTotals {
    totalInvestedUsd: number
    realizedUsd: number
    unrealizedUsd: number
    totalPnlUsd: number
    totalPnlPercent: number
}

/**
 * The history-derived state for one (user, token). `position` is in human token units; the USD
 * fields are plain doubles. This is exactly what the indexer persists per row.
 */
export interface PnlFold {
    position: number
    costPoolUsd: number
    realizedUsd: number
    totalInvestedUsd: number
}

export const EMPTY_FOLD: PnlFold = {
    position: 0,
    costPoolUsd: 0,
    realizedUsd: 0,
    totalInvestedUsd: 0,
}

/** One swap normalised to native/token legs, with the native→USD rate at trade time. */
export interface FoldSwapInput {
    isBuy: boolean
    /** wei; native leg on a buy, token leg on a sell. */
    amountIn: string
    /** wei; token leg on a buy, native leg on a sell. */
    amountOut: string
    nativeUsd: number
}

/** Fold one swap into a running state, returning a new fold (does not mutate the input). */
export function applyFoldEvent(fold: PnlFold, e: FoldSwapInput, decimals: number): PnlFold {
    const next: PnlFold = { ...fold }
    if (e.isBuy) {
        const tokensIn = parseFloat(formatUnits(BigInt(e.amountOut), decimals))
        const nativePaid = parseFloat(formatEther(BigInt(e.amountIn)))
        const usdPaid = nativePaid * e.nativeUsd
        next.position += tokensIn
        next.costPoolUsd += usdPaid
        next.totalInvestedUsd += usdPaid
    } else {
        const tokensOut = parseFloat(formatUnits(BigInt(e.amountIn), decimals))
        const nativeRecv = parseFloat(formatEther(BigInt(e.amountOut)))
        const usdRecv = nativeRecv * e.nativeUsd
        const avgCost = next.position > 0 ? next.costPoolUsd / next.position : 0
        const soldFromPosition = Math.min(tokensOut, next.position)
        const costOfSold = avgCost * soldFromPosition
        next.realizedUsd += usdRecv - costOfSold
        next.costPoolUsd -= costOfSold
        next.position = Math.max(0, next.position - tokensOut)
    }
    return next
}

/** Value the remaining position at `currentPrice` (USD, or null when unknown) into a full `TokenPnl`. */
export function finalizeTokenPnl(
    fold: PnlFold,
    currentBalance: number,
    currentPrice: number | null
): TokenPnl {
    const avgCost = fold.position > 0 ? fold.costPoolUsd / fold.position : 0
    const costBasisUsd = avgCost * currentBalance
    const currentValueUsd = currentPrice !== null ? currentPrice * currentBalance : 0
    const unrealizedUsd = currentPrice !== null ? currentValueUsd - costBasisUsd : 0
    const totalPnlUsd = fold.realizedUsd + unrealizedUsd
    const pnlPercent = fold.totalInvestedUsd > 0 ? (totalPnlUsd / fold.totalInvestedUsd) * 100 : 0
    return {
        costBasisUsd,
        totalInvestedUsd: fold.totalInvestedUsd,
        realizedUsd: fold.realizedUsd,
        unrealizedUsd,
        totalPnlUsd,
        pnlPercent,
    }
}

/** Finalize a whole portfolio: per-token PnL plus rolled-up totals. */
export function finalizePortfolioPnl(
    foldsByToken: Map<string, PnlFold>,
    balanceByToken: Map<string, number>,
    priceUsdByToken: Map<string, number | null>
): { perToken: Map<string, TokenPnl>; totals: PortfolioPnlTotals } {
    const perToken = new Map<string, TokenPnl>()
    const totals: PortfolioPnlTotals = {
        totalInvestedUsd: 0,
        realizedUsd: 0,
        unrealizedUsd: 0,
        totalPnlUsd: 0,
        totalPnlPercent: 0,
    }

    for (const [tokenAddr, fold] of foldsByToken) {
        const currentBalance = balanceByToken.get(tokenAddr) ?? 0
        const currentPrice = priceUsdByToken.get(tokenAddr) ?? null
        const tp = finalizeTokenPnl(fold, currentBalance, currentPrice)
        perToken.set(tokenAddr, tp)
        totals.totalInvestedUsd += tp.totalInvestedUsd
        totals.realizedUsd += tp.realizedUsd
        totals.unrealizedUsd += tp.unrealizedUsd
        totals.totalPnlUsd += tp.totalPnlUsd
    }

    totals.totalPnlPercent =
        totals.totalInvestedUsd > 0 ? (totals.totalPnlUsd / totals.totalInvestedUsd) * 100 : 0

    return { perToken, totals }
}

// --- batch engine (raw swaps + historical native price) ---------------------
//
// The indexer folds swaps incrementally, but a consumer holding raw swap history can rebuild the
// same state in one pass on top of the primitives above, valuing each swap at the native→USD rate
// returned by `priceAt(timestamp)`. `rewards/trader-stats.ts` does the same for time windows.

export interface PnlSwapEvent {
    tokenAddr: string
    isBuy: boolean
    amountIn: string
    amountOut: string
    timestamp: number
}

/** Fold a user's raw swaps for every token, then finalize against current balances/prices. */
export function computePortfolioPnl(
    events: PnlSwapEvent[],
    balanceByToken: Map<string, number>,
    priceUsdByToken: Map<string, number | null>,
    priceAt: (timestamp: number) => number,
    decimalsByToken?: Map<string, number>
): { perToken: Map<string, TokenPnl>; totals: PortfolioPnlTotals } {
    const eventsByToken = new Map<string, PnlSwapEvent[]>()
    for (const event of events) {
        const key = event.tokenAddr.toLowerCase()
        const list = eventsByToken.get(key)
        if (list) list.push(event)
        else eventsByToken.set(key, [event])
    }

    const foldsByToken = new Map<string, PnlFold>()
    for (const [tokenAddr, tokenEvents] of eventsByToken) {
        const decimals = decimalsByToken?.get(tokenAddr) ?? 18
        let fold = EMPTY_FOLD
        for (const e of [...tokenEvents].sort((a, b) => a.timestamp - b.timestamp)) {
            fold = applyFoldEvent(
                fold,
                {
                    isBuy: e.isBuy,
                    amountIn: e.amountIn,
                    amountOut: e.amountOut,
                    nativeUsd: priceAt(e.timestamp),
                },
                decimals
            )
        }
        foldsByToken.set(tokenAddr, fold)
    }

    return finalizePortfolioPnl(foldsByToken, balanceByToken, priceUsdByToken)
}
