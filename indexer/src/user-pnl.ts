/* eslint-disable @typescript-eslint/no-explicit-any */
import schema from 'ponder:schema'
import { formatEther } from 'viem'
import {
    applyFoldEvent,
    sanitizeUsdPrice,
    MAX_NATIVE_USD_PRICE,
    EMPTY_FOLD,
    type PnlFold,
} from '@coshi190/junoswap-sdk'

/**
 * Fold one native-denominated swap into a user's cumulative PnL (`userTokenPnl`) and leaderboard
 * counters (`userStat`). Called from every swap handler once the swap has been resolved to its
 * native/token legs. `amountInWei`/`amountOutWei` follow the leg convention in
 * `@coshi190/junoswap-sdk`'s `ParsedSwap`: native-in/token-out on a buy, token-in/native-out on a
 * sell. `decimals` is the token leg's real decimals so `position` stays in human units.
 */
export async function recordUserSwap(
    context: any,
    chainId: number,
    tokenAddr: string,
    user: string,
    isBuy: boolean,
    amountInWei: string,
    amountOutWei: string,
    decimals: number,
    nativeUsd: number,
    timestamp: number
): Promise<void> {
    const t = tokenAddr.toLowerCase()
    const u = user.toLowerCase()

    // A garbage native price (edge pool) must never enter a cost pool; treat it as 0 (no USD basis).
    const safeNativeUsd = sanitizeUsdPrice(nativeUsd, MAX_NATIVE_USD_PRICE) ?? 0

    // --- average-cost PnL fold ---
    const pnlId = `${chainId}-${t}-${u}`
    const existing = await context.db.find(schema.userTokenPnl, { id: pnlId })
    const prev: PnlFold = existing
        ? {
              position: existing.position,
              costPoolUsd: existing.costPoolUsd,
              realizedUsd: existing.realizedUsd,
              totalInvestedUsd: existing.totalInvestedUsd,
          }
        : EMPTY_FOLD
    const next = applyFoldEvent(
        prev,
        { isBuy, amountIn: amountInWei, amountOut: amountOutWei, nativeUsd: safeNativeUsd },
        decimals
    )
    if (existing) {
        await context.db.update(schema.userTokenPnl, { id: pnlId }).set({
            position: next.position,
            costPoolUsd: next.costPoolUsd,
            realizedUsd: next.realizedUsd,
            totalInvestedUsd: next.totalInvestedUsd,
            updatedAt: timestamp,
        })
    } else {
        await context.db
            .insert(schema.userTokenPnl)
            .values({
                id: pnlId,
                chainId,
                tokenAddr: t,
                user: u,
                position: next.position,
                costPoolUsd: next.costPoolUsd,
                realizedUsd: next.realizedUsd,
                totalInvestedUsd: next.totalInvestedUsd,
                updatedAt: timestamp,
            })
            .onConflictDoNothing()
    }

    // --- leaderboard counters ---
    const volumeNative = parseFloat(formatEther(BigInt(isBuy ? amountInWei : amountOutWei)))
    const statId = `${chainId}-${u}`
    const stat = await context.db.find(schema.userStat, { id: statId })
    if (stat) {
        await context.db.update(schema.userStat, { id: statId }).set({
            volumeNative: stat.volumeNative + volumeNative,
            tradeCount: stat.tradeCount + 1,
            buyCount: stat.buyCount + (isBuy ? 1 : 0),
            sellCount: stat.sellCount + (isBuy ? 0 : 1),
            updatedAt: timestamp,
        })
    } else {
        await context.db
            .insert(schema.userStat)
            .values({
                id: statId,
                chainId,
                user: u,
                volumeNative,
                tradeCount: 1,
                buyCount: isBuy ? 1 : 0,
                sellCount: isBuy ? 0 : 1,
                updatedAt: timestamp,
            })
            .onConflictDoNothing()
    }
}
