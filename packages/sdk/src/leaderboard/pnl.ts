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

// --- batch engines (raw swaps + historical native price) --------------------
//
// The indexer folds swaps incrementally, but the leaderboard's time-windowed periods (24h/7d/30d)
// can't be answered from a cumulative fold, so that path still folds raw swaps client-side. These
// batch helpers do that on top of the same primitives, valuing each swap at the native→USD rate
// returned by `priceAt(timestamp)`.

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

export interface LeaderboardSwapEvent extends PnlSwapEvent {
    sender: string
}

export interface AddressTraderStats {
    pnlUsd: number
    pnlPercent: number
    volumeNative: number
    tradeCount: number
    buyCount: number
    sellCount: number
}

/**
 * Per-address trader stats for a time window: fold each trader's in-window swaps and value the
 * resulting in-window net position at the current token price. Used by the indexer's windowed
 * `/leaderboard` branch, where the cost basis resets at the window boundary (the all-time branch
 * uses the persisted cumulative folds instead). `priceAt` supplies the native→USD rate at each
 * swap's timestamp; `currentPriceByToken` is the latest token USD price for unrealized PnL.
 */
export function computeWindowedTraderStats(
    events: LeaderboardSwapEvent[],
    priceAt: (timestamp: number) => number,
    currentPriceByToken: Map<string, number | null>,
    decimalsByToken?: Map<string, number>
): Map<string, AddressTraderStats> {
    const eventsByAddress = new Map<string, LeaderboardSwapEvent[]>()
    for (const event of events) {
        const key = event.sender.toLowerCase()
        const list = eventsByAddress.get(key)
        if (list) list.push(event)
        else eventsByAddress.set(key, [event])
    }

    const statsByAddress = new Map<string, AddressTraderStats>()
    for (const [address, addrEvents] of eventsByAddress) {
        let volumeNative = 0
        let buyCount = 0
        let sellCount = 0
        const eventsByToken = new Map<string, LeaderboardSwapEvent[]>()
        for (const event of addrEvents) {
            volumeNative += parseFloat(
                formatEther(BigInt(event.isBuy ? event.amountIn : event.amountOut))
            )
            if (event.isBuy) buyCount++
            else sellCount++
            const token = event.tokenAddr.toLowerCase()
            const list = eventsByToken.get(token)
            if (list) list.push(event)
            else eventsByToken.set(token, [event])
        }

        const foldsByToken = new Map<string, PnlFold>()
        const balanceByToken = new Map<string, number>()
        for (const [token, tokenEvents] of eventsByToken) {
            const decimals = decimalsByToken?.get(token) ?? 18
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
            foldsByToken.set(token, fold)
            balanceByToken.set(token, fold.position) // value the in-window position
        }

        const { totals } = finalizePortfolioPnl(foldsByToken, balanceByToken, currentPriceByToken)

        statsByAddress.set(address, {
            pnlUsd: totals.totalPnlUsd,
            pnlPercent: totals.totalPnlPercent,
            volumeNative,
            tradeCount: addrEvents.length,
            buyCount,
            sellCount,
        })
    }

    return statsByAddress
}
