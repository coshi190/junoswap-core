import { formatEther } from 'viem'
import { computePoints, isJunoswapProtocol } from './points.js'
import {
    EMPTY_FOLD,
    applyFoldEvent,
    finalizePortfolioPnl,
    type PnlFold,
    type PnlSwapEvent,
} from '../pnl/index.js'

/**
 * The indexer folds swaps incrementally, but the leaderboard's time-windowed periods (24h/7d/30d)
 * can't be answered from a cumulative fold, so that path re-folds raw in-window swaps on top of the
 * same primitives, valuing each swap at the native→USD rate returned by `priceAt(timestamp)`.
 */

export interface LeaderboardSwapEvent extends PnlSwapEvent {
    sender: string
    /** Venue id, for the points split. Omitted is treated as Junoswap's own venue. */
    protocol?: string
}

export interface AddressTraderStats {
    pnlUsd: number
    pnlPercent: number
    volumeNative: number
    junoVolumeNative: number
    externalVolumeNative: number
    points: number
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
        let junoVolumeNative = 0
        let externalVolumeNative = 0
        let buyCount = 0
        let sellCount = 0
        const eventsByToken = new Map<string, LeaderboardSwapEvent[]>()
        for (const event of addrEvents) {
            const nativeAmount = parseFloat(
                formatEther(BigInt(event.isBuy ? event.amountIn : event.amountOut))
            )
            if (isJunoswapProtocol(event.protocol ?? 'junoswap')) junoVolumeNative += nativeAmount
            else externalVolumeNative += nativeAmount
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
            volumeNative: junoVolumeNative + externalVolumeNative,
            junoVolumeNative,
            externalVolumeNative,
            points: computePoints(junoVolumeNative, externalVolumeNative),
            tradeCount: addrEvents.length,
            buyCount,
            sellCount,
        })
    }

    return statsByAddress
}
