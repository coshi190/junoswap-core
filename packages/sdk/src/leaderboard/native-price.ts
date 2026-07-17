/**
 * Historical native→USD price lookup, shared by the frontend (net-worth history, portfolio) and the
 * indexer's windowed leaderboard route. `makePriceAt` turns a sorted snapshot series into a
 * step-function `priceAt(timestamp)`; `sanitizePricePoints` drops zero/non-finite and gross-outlier
 * points before it is built.
 */

export interface NativePricePoint {
    timestamp: number
    price: number
}

/** Keep finite positive prices within 100x of the median, discarding obvious bad snapshots. */
export function sanitizePricePoints<T extends { price: number }>(points: readonly T[]): T[] {
    const finite = points.filter((p) => Number.isFinite(p.price) && p.price > 0)
    if (finite.length === 0) return []
    const sorted = finite.map((p) => p.price).sort((a, b) => a - b)
    const median = sorted[sorted.length >> 1]!
    return finite.filter((p) => p.price <= median * 100 && p.price >= median / 100)
}

/**
 * Build a step-function that returns the last known native→USD price at or before a timestamp.
 * `points` must be sorted ascending by timestamp. Timestamps before the first point clamp to it;
 * an empty series returns `fallbackPrice` (or 0).
 */
export function makePriceAt(
    points: NativePricePoint[],
    fallbackPrice: number | null
): (timestamp: number) => number {
    const fallback = fallbackPrice ?? 0
    if (points.length === 0) return () => fallback

    return (timestamp: number) => {
        if (timestamp < points[0]!.timestamp) return points[0]!.price
        let lo = 0
        let hi = points.length - 1
        let ans = 0
        while (lo <= hi) {
            const mid = (lo + hi) >> 1
            if (points[mid]!.timestamp <= timestamp) {
                ans = mid
                lo = mid + 1
            } else {
                hi = mid - 1
            }
        }
        return points[ans]!.price
    }
}
