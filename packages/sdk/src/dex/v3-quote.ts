import type { Address } from 'viem'
import { ProtocolType, type DEXType } from '../configs/dex-config.js'
import { batchRead, type ReadClient } from './multicall.js'
import { buildQuoteCall } from './quote.js'
import {
    buildGetPoolCalls,
    buildLiquidityCalls,
    buildPoolCandidates,
    pickBestPools,
    resolveDexIds,
    resolvePoolAddresses,
    type DiscoveredV3Pool,
} from './v3-pools.js'

/** The quoter's answer, plus the synthesized equivalent for a wrap/unwrap. */
export interface QuoteResult {
    amountOut: bigint
    sqrtPriceX96After: bigint
    initializedTicksCrossed: number
    gasEstimate: bigint
}

/** Wrapping is 1:1 — there is no pool and no price, only a WETH9 deposit/withdraw. */
export function wrapQuoteResult(amountIn: bigint, operation: 'wrap' | 'unwrap'): QuoteResult {
    return {
        amountOut: amountIn,
        sqrtPriceX96After: 0n,
        initializedTicksCrossed: 0,
        gasEstimate: operation === 'wrap' ? 50000n : 40000n,
    }
}

export function fromQuoterV2(
    tuple: readonly [bigint, bigint, number | bigint, bigint]
): QuoteResult {
    return {
        amountOut: tuple[0],
        sqrtPriceX96After: tuple[1],
        initializedTicksCrossed: Number(tuple[2]),
        gasEstimate: tuple[3],
    }
}

export interface V3QuoteParams {
    chainId: number
    /** Raw token address; the native sentinel is resolved for you. */
    tokenIn: Address
    tokenOut: Address
    amountIn: bigint
    /** Omit to quote every V3 DEX on the chain. */
    dexId?: DEXType | DEXType[]
}

export interface V3QuoteOutcome {
    dexId: DEXType
    quote: QuoteResult | null
    fee: number | null
    pool: Address | null
    error: Error | null
}

/**
 * Finds the deepest pool per DEX: one batched getPool across every (dex, fee tier)
 * pair, then one batched liquidity read over the pools that exist.
 *
 * Independent of amountIn, so callers can cache it far longer than a quote.
 */
export async function discoverV3Pools(
    client: ReadClient,
    params: Omit<V3QuoteParams, 'amountIn'>
): Promise<Map<DEXType, DiscoveredV3Pool>> {
    const { chainId, tokenIn, tokenOut, dexId } = params

    const dexIds = resolveDexIds(chainId, ProtocolType.V3, dexId)
    const candidates = buildPoolCandidates({ chainId, dexIds, tokenIn, tokenOut })
    if (candidates.length === 0) return new Map()

    const poolResults = await batchRead(client, buildGetPoolCalls(candidates))
    const resolved = resolvePoolAddresses(candidates, poolResults)
    if (resolved.length === 0) return new Map()

    const liquidityResults = await batchRead(
        client,
        buildLiquidityCalls(resolved.map(({ pool }) => pool))
    )

    return pickBestPools(resolved, liquidityResults)
}

/** Quotes `amountIn` against pools already discovered — one batched read. */
export async function quoteV3Pools(
    client: ReadClient,
    params: Omit<V3QuoteParams, 'dexId'>,
    pools: ReadonlyMap<DEXType, DiscoveredV3Pool>
): Promise<Map<DEXType, V3QuoteOutcome>> {
    const { chainId, tokenIn, tokenOut, amountIn } = params

    const entries = [...pools.entries()].flatMap(([dexId, pool]) => {
        const call = buildQuoteCall({
            protocol: ProtocolType.V3,
            chainId,
            dexId,
            tokenIn,
            tokenOut,
            amountIn,
            fee: pool.fee,
        })
        // Only undefined when the DEX has no V3 config on the chain, which discovery
        // already ruled out. Guarded anyway so a config change can't desync the indices.
        return call ? [{ dexId, pool, call }] : []
    })

    const results = await batchRead(
        client,
        entries.map(({ call }) => call)
    )

    const outcomes = new Map<DEXType, V3QuoteOutcome>()

    entries.forEach(({ dexId, pool }, index) => {
        const result = results[index]

        if (result?.status === 'success') {
            outcomes.set(dexId, {
                dexId,
                quote: fromQuoterV2(result.result as [bigint, bigint, number | bigint, bigint]),
                fee: pool.fee,
                pool: pool.pool,
                error: null,
            })
            return
        }

        outcomes.set(dexId, {
            dexId,
            quote: null,
            fee: pool.fee,
            pool: pool.pool,
            error: result?.error ?? new Error(`Quote failed for ${dexId}`),
        })
    })

    return outcomes
}

/** Discovery and quoting for every requested DEX, in three batched reads total. */
export async function getV3Quotes(
    client: ReadClient,
    params: V3QuoteParams
): Promise<Map<DEXType, V3QuoteOutcome>> {
    const pools = await discoverV3Pools(client, params)
    if (pools.size === 0) return new Map()

    return quoteV3Pools(client, params, pools)
}
