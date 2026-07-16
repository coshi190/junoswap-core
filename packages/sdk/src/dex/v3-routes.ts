import { zeroAddress, type Abi, type Address } from 'viem'
import { UNISWAP_V3_FACTORY_ABI } from '../abis/index.js'
import { ProtocolType, getV3Config, type DEXType } from '../configs/dex-config.js'
import { getSwapAddress } from './native.js'
import { batchRead, type ReadClient } from './multicall.js'
import { buildQuoteCall } from './quote.js'
import { getFeeTiers, poolKey, resolveDexIds } from './v3-pools.js'
import type { ContractCall } from './plan-swap.js'
import type { QuoteResult } from './v3-quote.js'

export const MAX_HOPS = 3
/** Beyond a couple of connectors the 3-hop cross product explodes, so only the top few pair up. */
export const MAX_DEEP_CONNECTORS = 3
/** Ceiling on quote calls per request — the fee cross product can grow fast on deep paths. */
export const MAX_ROUTE_QUOTES = 80

/** One quoted multi-hop path. `path`/`fees` are ready to hand straight to a swap. */
export interface V3RouteQuote {
    dexId: DEXType
    /** Resolved swap addresses, endpoints included. */
    path: Address[]
    /** Length === path.length - 1. */
    fees: number[]
    quote: QuoteResult
}

export interface V3RouteParams {
    chainId: number
    tokenIn: Address
    tokenOut: Address
    amountIn: bigint
    /** Intermediary tokens to route through. */
    connectors: Address[]
    /** Omit to enumerate every V3 DEX on the chain. */
    dexId?: DEXType | DEXType[]
    maxHops?: number
    maxRouteQuotes?: number
}

/**
 * Every candidate path: 2-hop through each connector, plus 3-hop pairs from the deepest
 * connectors. Endpoints are left unresolved so the caller can resolve the native sentinel.
 */
export function enumerateHopPaths(
    tokenIn: Address,
    tokenOut: Address,
    connectors: Address[],
    maxHops: number = MAX_HOPS
): Address[][] {
    const inL = tokenIn.toLowerCase()
    const outL = tokenOut.toLowerCase()
    const conns = connectors.filter((c) => {
        const l = c.toLowerCase()
        return l !== inL && l !== outL
    })

    const paths: Address[][] = []
    for (const c of conns) paths.push([tokenIn, c, tokenOut])

    if (maxHops >= 3) {
        const deep = conns.slice(0, MAX_DEEP_CONNECTORS)
        for (const c1 of deep) {
            for (const c2 of deep) {
                if (c1.toLowerCase() === c2.toLowerCase()) continue
                paths.push([tokenIn, c1, c2, tokenOut])
            }
        }
    }
    return paths
}

/** Every combination of one fee tier per leg. */
export function crossProduct(perLeg: number[][]): number[][] {
    return perLeg.reduce<number[][]>(
        (acc, fees) => acc.flatMap((combo) => fees.map((f) => [...combo, f])),
        [[]]
    )
}

export interface V3RouteCandidate {
    dexId: DEXType
    factory: Address
    feeTiers: number[]
    /** Resolved swap addresses, endpoints included. */
    tokens: Address[]
}

/** The cross product of the requested DEXes and every enumerated path, with native resolved. */
export function buildRouteCandidates(
    params: Omit<V3RouteParams, 'amountIn' | 'maxRouteQuotes'>
): V3RouteCandidate[] {
    const { chainId, tokenIn, tokenOut, connectors, dexId, maxHops = MAX_HOPS } = params

    const dexIds = resolveDexIds(chainId, ProtocolType.V3, dexId)
    if (dexIds.length === 0) return []

    const rawPaths = enumerateHopPaths(tokenIn, tokenOut, connectors, maxHops)
    if (rawPaths.length === 0) return []

    const candidates: V3RouteCandidate[] = []
    for (const id of dexIds) {
        const cfg = getV3Config(chainId, id)
        if (!cfg?.factory || !cfg?.quoter) continue
        const feeTiers = getFeeTiers(cfg)

        for (const rawPath of rawPaths) {
            const tokens = rawPath.map((a) => getSwapAddress(a, chainId))
            const collapsed = tokens.some(
                (t, i) => i > 0 && t.toLowerCase() === tokens[i - 1]!.toLowerCase()
            )
            if (collapsed) continue
            candidates.push({ dexId: id, factory: cfg.factory, feeTiers, tokens })
        }
    }
    return candidates
}

interface LegQuery {
    call: ContractCall
    key: string
}

/** getPool calls for every distinct (factory, leg, fee), deduped so shared legs read once. */
function collectLegQueries(candidates: readonly V3RouteCandidate[]): LegQuery[] {
    const seen = new Map<string, LegQuery>()
    for (const c of candidates) {
        for (let i = 0; i < c.tokens.length - 1; i++) {
            const a = c.tokens[i]!
            const b = c.tokens[i + 1]!
            for (const fee of c.feeTiers) {
                const key = poolKey(c.factory, a, b, fee)
                if (seen.has(key)) continue
                seen.set(key, {
                    key,
                    call: {
                        address: c.factory,
                        abi: UNISWAP_V3_FACTORY_ABI as Abi,
                        functionName: 'getPool',
                        args: [a, b, fee],
                    },
                })
            }
        }
    }
    return [...seen.values()]
}

interface RouteMeta {
    candidate: V3RouteCandidate
    fees: number[]
}

/**
 * Keeps only fee combos whose every leg has a live pool, capping the total. `existing` is the
 * set of poolKeys that resolved to a real address in the discovery batch.
 */
export function buildRouteMetas(
    candidates: readonly V3RouteCandidate[],
    existing: ReadonlySet<string>,
    maxRouteQuotes: number = MAX_ROUTE_QUOTES
): RouteMeta[] {
    const metas: RouteMeta[] = []
    for (const c of candidates) {
        const perLegFees: number[][] = []
        let dead = false
        for (let i = 0; i < c.tokens.length - 1; i++) {
            const fees = c.feeTiers.filter((fee) =>
                existing.has(poolKey(c.factory, c.tokens[i]!, c.tokens[i + 1]!, fee))
            )
            if (fees.length === 0) {
                dead = true
                break
            }
            perLegFees.push(fees)
        }
        if (dead) continue

        for (const fees of crossProduct(perLegFees)) {
            metas.push({ candidate: c, fees })
            if (metas.length >= maxRouteQuotes) return metas
        }
    }
    return metas
}

/**
 * Discovery and quoting for every multi-hop path through the given connectors: one batched
 * getPool over every (leg, tier), then one batched quote over the surviving fee combos.
 */
export async function getV3Routes(
    client: ReadClient,
    params: V3RouteParams
): Promise<V3RouteQuote[]> {
    const { chainId, amountIn, maxRouteQuotes = MAX_ROUTE_QUOTES } = params

    const candidates = buildRouteCandidates(params)
    if (candidates.length === 0) return []

    const legQueries = collectLegQueries(candidates)
    const poolResults = await batchRead(
        client,
        legQueries.map((q) => q.call)
    )

    const existing = new Set<string>()
    legQueries.forEach((q, index) => {
        const result = poolResults[index]
        if (result?.status !== 'success') return
        const pool = result.result as Address | undefined
        if (pool && pool.toLowerCase() !== zeroAddress) existing.add(q.key)
    })

    const metas = buildRouteMetas(candidates, existing, maxRouteQuotes)
    if (metas.length === 0) return []

    const quoteEntries = metas.flatMap((meta) => {
        const { candidate, fees } = meta
        const call = buildQuoteCall({
            protocol: ProtocolType.V3,
            chainId,
            dexId: candidate.dexId,
            tokenIn: candidate.tokens[0]!,
            tokenOut: candidate.tokens[candidate.tokens.length - 1]!,
            amountIn,
            path: candidate.tokens,
            fees,
        })
        // Undefined only when the DEX has no V3 config, which candidate building already ruled out.
        return call ? [{ meta, call }] : []
    })

    const quoteResults = await batchRead(
        client,
        quoteEntries.map((e) => e.call)
    )

    const routes: V3RouteQuote[] = []
    quoteResults.forEach((result, index) => {
        if (result?.status !== 'success') return
        // quoteExactInput returns (amountOut, sqrtPriceX96AfterList[], ticksCrossedList[], gas) —
        // the middle fields are per-leg arrays, so only amountOut and gas are scalars.
        const [amountOut, , , gasEstimate] = result.result as [bigint, bigint[], number[], bigint]
        if (!amountOut || amountOut === 0n) return

        const { candidate, fees } = quoteEntries[index]!.meta
        routes.push({
            dexId: candidate.dexId,
            path: candidate.tokens,
            fees,
            quote: {
                amountOut,
                sqrtPriceX96After: 0n,
                initializedTicksCrossed: 0,
                gasEstimate: gasEstimate ?? 0n,
            },
        })
    })

    return routes.sort((a, b) => {
        if (a.quote.amountOut === b.quote.amountOut) return 0
        return a.quote.amountOut > b.quote.amountOut ? -1 : 1
    })
}
