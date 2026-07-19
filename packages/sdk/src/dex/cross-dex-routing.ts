import type { Address } from 'viem'
import {
    ProtocolType,
    getDexsByProtocol,
    getV2Config,
    getV3Config,
    type DEXType,
} from '../configs/dex-config.js'
import { getFeeTiers, poolKey } from './v3-pools.js'
import { getSwapAddress } from './native.js'
import { buildQuoteCall } from './quote.js'
import { parseQuoteAmountOut } from './split-routing.js'
import { batchRead, type ReadClient } from './multicall.js'
import type { ContractCall } from './plan-swap.js'

/** How many intermediary tokens to try. Each one costs a quote per DEX per fee tier. */
export const MAX_CROSS_CONNECTORS = 3

/** One quotable way to get from `tokenIn` to `tokenOut`: a specific DEX, and for V3 a fee tier. */
export interface HopOption {
    dexId: DEXType
    protocol: ProtocolType
    factory: Address
    quoteAddress: Address
    tokenIn: Address
    tokenOut: Address
    fee?: number
}

/**
 * A resolved hop of a cross-DEX route. Structurally the shape the aggregator router
 * encoder consumes; kept as its own type so the SDK stays free of frontend domain types.
 */
export interface CrossDexHop {
    dexId: DEXType
    protocol: ProtocolType
    factory: Address
    tokenIn: Address
    tokenOut: Address
    fee?: number
}

export interface CrossDexLeg {
    hops: CrossDexHop[]
    predictedOut: bigint
    poolKeys: string[]
}

/** Every DEX (and for V3, every fee tier) that could quote this hop. */
export function candidateHopOptions(
    tokenInW: Address,
    tokenOutW: Address,
    chainId: number
): HopOption[] {
    if (tokenInW.toLowerCase() === tokenOutW.toLowerCase()) return []
    const options: HopOption[] = []

    for (const dexId of getDexsByProtocol(chainId, ProtocolType.V2)) {
        const cfg = getV2Config(chainId, dexId)
        if (!cfg?.factory || !cfg.router) continue
        options.push({
            dexId,
            protocol: ProtocolType.V2,
            factory: cfg.factory,
            quoteAddress: cfg.router,
            tokenIn: tokenInW,
            tokenOut: tokenOutW,
        })
    }

    for (const dexId of getDexsByProtocol(chainId, ProtocolType.V3)) {
        const cfg = getV3Config(chainId, dexId)
        if (!cfg?.factory || !cfg.quoter) continue
        for (const fee of getFeeTiers(cfg)) {
            options.push({
                dexId,
                protocol: ProtocolType.V3,
                factory: cfg.factory,
                quoteAddress: cfg.quoter,
                tokenIn: tokenInW,
                tokenOut: tokenOutW,
                fee,
            })
        }
    }

    return options
}

export function pickBestHopOption(
    options: readonly HopOption[],
    outputs: readonly (bigint | null)[]
): { option: HopOption; output: bigint } | null {
    let best: { option: HopOption; output: bigint } | null = null
    for (let i = 0; i < options.length; i++) {
        const out = outputs[i]
        if (out == null || out <= 0n) continue
        if (!best || out > best.output) best = { option: options[i]!, output: out }
    }
    return best
}

function toCrossDexHop(o: HopOption): CrossDexHop {
    return {
        dexId: o.dexId,
        protocol: o.protocol,
        factory: o.factory,
        tokenIn: o.tokenIn,
        tokenOut: o.tokenOut,
        fee: o.fee,
    }
}

function optionPoolKey(o: HopOption): string {
    return poolKey(o.factory, o.tokenIn, o.tokenOut, o.fee ?? 0)
}

export function buildCrossDexLeg(
    hop1: { option: HopOption; output: bigint },
    hop2: { option: HopOption; output: bigint }
): CrossDexLeg {
    return {
        hops: [toCrossDexHop(hop1.option), toCrossDexHop(hop2.option)],
        predictedOut: hop2.output,
        poolKeys: [optionPoolKey(hop1.option), optionPoolKey(hop2.option)],
    }
}

/**
 * Intermediary tokens worth routing through: neither endpoint, deduped, most-liquid
 * first (callers pass them in priority order), capped so the quote batch stays small.
 */
export function selectConnectors(
    tokenInW: Address,
    tokenOutW: Address,
    connectors: readonly Address[],
    max: number = MAX_CROSS_CONNECTORS
): Address[] {
    const seen = new Set([tokenInW.toLowerCase(), tokenOutW.toLowerCase()])
    const out: Address[] = []
    for (const c of connectors) {
        if (out.length >= max) break
        const l = c.toLowerCase()
        if (seen.has(l)) continue
        seen.add(l)
        out.push(c)
    }
    return out
}

/** One connector's options, plus where its results start in the batch. */
interface OptionBatch<T> {
    context: T
    options: HopOption[]
    start: number
}

/**
 * Builds one quote call per option and records where each group lands in the flat batch,
 * so results can be mapped back afterwards. Options the DEX can't quote on this chain are
 * dropped rather than throwing — one misconfigured DEX shouldn't sink the whole route.
 */
function buildRound<T>(
    groups: readonly { context: T; options: HopOption[]; amountIn: bigint }[],
    chainId: number
): { calls: ContractCall[]; batches: OptionBatch<T>[] } {
    const calls: ContractCall[] = []
    const batches: OptionBatch<T>[] = []

    for (const { context, options, amountIn } of groups) {
        const quotable: HopOption[] = []
        const start = calls.length
        for (const o of options) {
            const call = buildQuoteCall({
                protocol: o.protocol,
                chainId,
                dexId: o.dexId,
                tokenIn: o.tokenIn,
                tokenOut: o.tokenOut,
                amountIn,
                fee: o.fee,
            })
            if (!call) continue
            quotable.push(o)
            calls.push(call)
        }
        if (quotable.length > 0) batches.push({ context, options: quotable, start })
    }

    return { calls, batches }
}

export interface CrossDexQuoteParams {
    chainId: number
    tokenIn: Address
    tokenOut: Address
    amountIn: bigint
    /** Candidate intermediary tokens in priority order; app-owned config. */
    connectors: readonly Address[]
    maxConnectors?: number
}

/**
 * Best two-hop route whose hops may sit on different DEXes — buy the connector on
 * whichever venue is cheapest, sell it on whichever pays most.
 *
 * Two batched rounds: quote `tokenIn -> connector` across every DEX and fee tier and keep
 * the winner per connector, then quote each winner's output onward to `tokenOut` and keep
 * the single best pair. Returns null when no pair of hops quotes successfully.
 */
export async function getCrossDexQuote(
    client: ReadClient,
    params: CrossDexQuoteParams
): Promise<CrossDexLeg | null> {
    const { chainId, amountIn, connectors, maxConnectors } = params
    if (amountIn <= 0n) return null

    const tokenInW = getSwapAddress(params.tokenIn, chainId)
    const tokenOutW = getSwapAddress(params.tokenOut, chainId)
    if (tokenInW.toLowerCase() === tokenOutW.toLowerCase()) return null

    const selected = selectConnectors(tokenInW, tokenOutW, connectors, maxConnectors)
    if (selected.length === 0) return null

    const round1 = buildRound(
        selected.map((connector) => ({
            context: connector,
            options: candidateHopOptions(tokenInW, connector, chainId),
            amountIn,
        })),
        chainId
    )
    if (round1.calls.length === 0) return null

    const results1 = await batchRead(client, round1.calls)

    const hop1PerConnector: { connector: Address; option: HopOption; mid: bigint }[] = []
    for (const { context: connector, options, start } of round1.batches) {
        const outs = options.map((o, i) => parseQuoteAmountOut(o.protocol, results1[start + i]))
        const best = pickBestHopOption(options, outs)
        if (best) hop1PerConnector.push({ connector, option: best.option, mid: best.output })
    }
    if (hop1PerConnector.length === 0) return null

    const round2 = buildRound(
        hop1PerConnector.map((hop1) => ({
            context: hop1,
            options: candidateHopOptions(hop1.connector, tokenOutW, chainId),
            amountIn: hop1.mid,
        })),
        chainId
    )
    if (round2.calls.length === 0) return null

    const results2 = await batchRead(client, round2.calls)

    type Pair = { hop1: { option: HopOption; output: bigint }; hop2: { option: HopOption; output: bigint } }
    let best: Pair | null = null
    for (const { context: hop1, options, start } of round2.batches) {
        const outs = options.map((o, i) => parseQuoteAmountOut(o.protocol, results2[start + i]))
        const bestHop2 = pickBestHopOption(options, outs)
        if (!bestHop2) continue
        if (!best || bestHop2.output > best.hop2.output) {
            best = { hop1: { option: hop1.option, output: hop1.mid }, hop2: bestHop2 }
        }
    }
    if (!best) return null

    return buildCrossDexLeg(best.hop1, best.hop2)
}
