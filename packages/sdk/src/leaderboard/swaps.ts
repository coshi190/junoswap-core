import { isLaunchpadChain } from '../configs/deployments.js'
import { isPonderError, type PonderClient } from '../ponder/client.js'
import {
    fetchBondingCurveSwaps,
    fetchV3Swaps,
    fetchV2Swaps,
    type SwapScanFilter,
    type V2Swap,
    type V3Swap,
} from '../ponder/queries/swaps.js'
import type { SwapEventRow } from './points.js'

/** A swap decoded to its native/token legs with buy/sell direction resolved. */
export interface ParsedSwap {
    tokenAddr: string
    sender: string
    isBuy: boolean
    amountIn: string
    amountOut: string
    timestamp: number
    protocol: string
}

/** Who and since-when to scope a normalised swap scan by. */
export interface SwapFilter {
    sender?: string
    senderIn?: string[]
    since?: number
}

function toScanFilter(chainId: number, filter: SwapFilter): SwapScanFilter {
    return {
        chainId,
        sender: filter.sender,
        senders: filter.senderIn,
        since: filter.since && filter.since > 0 ? filter.since : undefined,
    }
}

const abs = (x: bigint) => (x < 0n ? -x : x)

export function parseV3Swap(e: V3Swap, wrappedNative: string): ParsedSwap | null {
    const token0 = e.token0Addr?.toLowerCase()
    const token1 = e.token1Addr?.toLowerCase()
    let nativeIsToken0: boolean
    if (token1 === wrappedNative) nativeIsToken0 = false
    else if (token0 === wrappedNative) nativeIsToken0 = true
    else return null
    const nativeAmt = BigInt(nativeIsToken0 ? e.amount0 : e.amount1)
    const tokenAmt = BigInt(nativeIsToken0 ? e.amount1 : e.amount0)
    const isBuy = tokenAmt < 0n // token leaves the pool => user receives it
    return {
        tokenAddr: e.tokenAddr.toLowerCase(),
        sender: e.txFrom,
        isBuy,
        amountIn: (isBuy ? abs(nativeAmt) : abs(tokenAmt)).toString(),
        amountOut: (isBuy ? abs(tokenAmt) : abs(nativeAmt)).toString(),
        timestamp: e.timestamp,
        protocol: e.protocol || 'junoswap',
    }
}

export function parseV2Swap(e: V2Swap, wrappedNative: string): ParsedSwap | null {
    const token0 = e.token0Addr.toLowerCase()
    const token1 = e.token1Addr.toLowerCase()
    let nativeIn: bigint, nativeOut: bigint, tokenIn: bigint, tokenOut: bigint
    let tokenAddr: string
    if (token0 === wrappedNative) {
        nativeIn = BigInt(e.amount0In)
        nativeOut = BigInt(e.amount0Out)
        tokenIn = BigInt(e.amount1In)
        tokenOut = BigInt(e.amount1Out)
        tokenAddr = token1
    } else if (token1 === wrappedNative) {
        nativeIn = BigInt(e.amount1In)
        nativeOut = BigInt(e.amount1Out)
        tokenIn = BigInt(e.amount0In)
        tokenOut = BigInt(e.amount0Out)
        tokenAddr = token0
    } else {
        return null
    }
    const isBuy = nativeIn > 0n // native flows into the pool => user buys token
    return {
        tokenAddr,
        sender: e.txFrom,
        isBuy,
        amountIn: (isBuy ? nativeIn : tokenIn).toString(),
        amountOut: (isBuy ? tokenOut : nativeOut).toString(),
        timestamp: e.timestamp,
        protocol: e.protocol || 'unknown',
    }
}

export function toRow(p: ParsedSwap): SwapEventRow {
    return {
        tokenAddr: p.tokenAddr,
        sender: p.sender,
        isBuy: p.isBuy ? 1 : 0,
        amountIn: p.amountIn,
        amountOut: p.amountOut,
        timestamp: p.timestamp,
        protocol: p.protocol,
    }
}

/** Args shared by the per-source normalised fetchers. `wrappedNative` is unused by bonding curve. */
export interface NormalizedScanArgs {
    chainId: number
    wrappedNative: string | null
    filter: SwapFilter
}

/**
 * The Ponder circuit breaker throws on indexer trouble; the leaderboard treats that as "no data"
 * rather than a hard failure, so each source swallows `isPonderError` and returns `[]`.
 */
export async function fetchNormalizedBondingCurveSwaps(
    client: PonderClient,
    { chainId, filter }: Omit<NormalizedScanArgs, 'wrappedNative'>
): Promise<ParsedSwap[]> {
    try {
        const rows = await fetchBondingCurveSwaps(client, toScanFilter(chainId, filter))
        return rows.map((e) => ({
            tokenAddr: e.tokenAddr.toLowerCase(),
            sender: e.sender,
            isBuy: e.isBuy === 1,
            amountIn: e.amountIn,
            amountOut: e.amountOut,
            timestamp: e.timestamp,
            protocol: 'junoswap',
        }))
    } catch (e) {
        if (isPonderError(e)) return []
        throw e
    }
}

export async function fetchNormalizedV3Swaps(
    client: PonderClient,
    { chainId, wrappedNative, filter }: NormalizedScanArgs
): Promise<ParsedSwap[]> {
    if (!wrappedNative) return []
    try {
        const rows = await fetchV3Swaps(client, toScanFilter(chainId, filter))
        const out: ParsedSwap[] = []
        for (const r of rows) {
            const p = parseV3Swap(r, wrappedNative)
            if (p) out.push(p)
        }
        return out
    } catch (e) {
        if (isPonderError(e)) return []
        throw e
    }
}

export async function fetchNormalizedV2Swaps(
    client: PonderClient,
    { chainId, wrappedNative, filter }: NormalizedScanArgs
): Promise<ParsedSwap[]> {
    if (!wrappedNative) return []
    try {
        const rows = await fetchV2Swaps(client, toScanFilter(chainId, filter))
        const out: ParsedSwap[] = []
        for (const r of rows) {
            const p = parseV2Swap(r, wrappedNative)
            if (p) out.push(p)
        }
        return out
    } catch (e) {
        if (isPonderError(e)) return []
        throw e
    }
}

/** Every leaderboard-eligible swap made by any of `senders`, as aggregation-ready rows. */
export async function fetchSwapEventsForSenders(
    client: PonderClient,
    { chainId, wrappedNative, senders }: { chainId: number; wrappedNative: string | null; senders: string[] }
): Promise<SwapEventRow[]> {
    if (senders.length === 0) return []
    const filter: SwapFilter = { senderIn: senders }
    const [bondingCurve, v3, v2] = await Promise.all([
        isLaunchpadChain(chainId)
            ? fetchNormalizedBondingCurveSwaps(client, { chainId, filter })
            : Promise.resolve([] as ParsedSwap[]),
        fetchNormalizedV3Swaps(client, { chainId, wrappedNative, filter }),
        fetchNormalizedV2Swaps(client, { chainId, wrappedNative, filter }),
    ])
    return [...bondingCurve, ...v3, ...v2].map(toRow)
}
