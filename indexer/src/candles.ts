/* eslint-disable @typescript-eslint/no-explicit-any */
import schema from 'ponder:schema'
import { CANDLE_DURATIONS, foldCandle } from './candle-math.js'

/**
 * Upsert a token's native-denominated OHLC candle across every timeframe. `source` ('v3' | 'bc')
 * keeps the graduated DEX series separate from the bonding-curve series so the client can stitch
 * them at graduation. No-ops on a non-positive price.
 */
export async function foldTokenCandle(
    context: any,
    chainId: number,
    tokenAddr: string,
    source: 'v3' | 'bc',
    timestamp: number,
    price: number,
    volumeNative: number,
    openIfNew?: number
) {
    if (!(price > 0)) return

    for (const duration of CANDLE_DURATIONS) {
        const bucketTs = Math.floor(timestamp / duration) * duration
        const id = `${chainId}-${tokenAddr}-${source}-${duration}-${bucketTs}`
        const existing = await context.db.find(schema.tokenCandle, { id })
        const folded = foldCandle(
            existing
                ? {
                      open: existing.open,
                      high: existing.high,
                      low: existing.low,
                      close: existing.close,
                      volume: existing.volumeNative,
                  }
                : null,
            price,
            volumeNative,
            openIfNew
        )

        if (!existing) {
            await context.db
                .insert(schema.tokenCandle)
                .values({
                    id,
                    chainId,
                    tokenAddr,
                    source,
                    duration,
                    bucketTs,
                    open: folded.open,
                    high: folded.high,
                    low: folded.low,
                    close: folded.close,
                    volumeNative: folded.volume,
                    updatedAt: timestamp,
                })
                .onConflictDoNothing()
        } else {
            await context.db.update(schema.tokenCandle, { id }).set({
                open: folded.open,
                high: folded.high,
                low: folded.low,
                close: folded.close,
                volumeNative: folded.volume,
                updatedAt: timestamp,
            })
        }
    }
}
