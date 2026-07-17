import { formatEther } from 'viem'

/** A swap normalised to the native leg, in the shape the points aggregator consumes. */
export interface SwapEventRow {
    tokenAddr: string
    sender: string
    isBuy: number
    amountIn: string
    amountOut: string
    timestamp: number
    protocol: string
}

export interface TraderAgg {
    volumeNative: number
    points: number
    tradeCount: number
    buyCount: number
    sellCount: number
}

/** Junoswap volume scores at 1 point / 50 native; external volume is discounted 10x. */
export function computePoints(junoVolumeNative: number, externalVolumeNative: number): number {
    return Math.floor(junoVolumeNative / 50 + externalVolumeNative / 500)
}

/** A referrer earns 10% of the summed points of everyone they referred, floored once. */
export function computeReferralPoints(refereePoints: number[]): number {
    return Math.floor(refereePoints.reduce((sum, p) => sum + p, 0) * 0.1)
}

export function aggregatePointsByAddress(rows: SwapEventRow[]): Map<string, TraderAgg> {
    interface Acc {
        junoVolumeNative: number
        externalVolumeNative: number
        tradeCount: number
        buyCount: number
        sellCount: number
    }
    const acc = new Map<string, Acc>()
    for (const e of rows) {
        const sender = e.sender.toLowerCase()
        const isBuy = e.isBuy === 1
        const nativeAmount = safeFormatEther(isBuy ? e.amountIn : e.amountOut)
        let a = acc.get(sender)
        if (!a) {
            a = {
                junoVolumeNative: 0,
                externalVolumeNative: 0,
                tradeCount: 0,
                buyCount: 0,
                sellCount: 0,
            }
            acc.set(sender, a)
        }
        if (e.protocol === 'junoswap') a.junoVolumeNative += nativeAmount
        else a.externalVolumeNative += nativeAmount
        a.tradeCount++
        if (isBuy) a.buyCount++
        else a.sellCount++
    }
    const out = new Map<string, TraderAgg>()
    for (const [addr, a] of acc) {
        out.set(addr, {
            volumeNative: a.junoVolumeNative + a.externalVolumeNative,
            points: computePoints(a.junoVolumeNative, a.externalVolumeNative),
            tradeCount: a.tradeCount,
            buyCount: a.buyCount,
            sellCount: a.sellCount,
        })
    }
    return out
}

export function safeFormatEther(value: string): number {
    try {
        return parseFloat(formatEther(BigInt(value)))
    } catch {
        return 0
    }
}
