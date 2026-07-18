// Pure candle math, free of ponder virtual modules so it's unit-testable. The schema-bound upsert
// wrapper lives in ./candles.ts.

// Materialised timeframes (seconds): 1m / 5m / 15m / 1h / 4h / 1d. Each swap folds into all six so
// reads fetch a single resolution directly — mirrors the day-volume bucket approach.
export const CANDLE_DURATIONS = [60, 300, 900, 3600, 14400, 86400] as const

export interface Candle {
    open: number
    high: number
    low: number
    close: number
    volume: number
}

/**
 * Fold one trade's (price, volume) into a candle bucket. On a new bucket the open is `openIfNew`
 * when given and positive (the pre-swap price, for bonding-curve candles) else the trade price;
 * high/low span the open and the trade price. Matches the client's aggregate*Candlesticks batch math.
 */
export function foldCandle(
    existing: Candle | null,
    price: number,
    volume: number,
    openIfNew?: number
): Candle {
    if (!existing) {
        const open = openIfNew !== undefined && openIfNew > 0 ? openIfNew : price
        return {
            open,
            high: Math.max(open, price),
            low: Math.min(open, price),
            close: price,
            volume,
        }
    }
    return {
        open: existing.open,
        high: Math.max(existing.high, price),
        low: Math.min(existing.low, price),
        close: price,
        volume: existing.volume + volume,
    }
}
