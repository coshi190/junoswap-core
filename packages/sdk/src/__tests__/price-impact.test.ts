import { describe, it, expect } from 'vitest'
import type { Address, PublicClient } from 'viem'
import { CHAIN_IDS, ProtocolType } from '../configs/dex-config.js'
import type { ContractCall } from '../dex/plan-swap.js'
import type { ReadResult } from '../dex/multicall.js'
import { computePriceImpactPercent, getRoutePriceImpact } from '../dex/price-impact.js'

const TOKEN_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address
const TOKEN_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address

const ok = (result: unknown): ReadResult => ({ status: 'success', result })
const fail = (message: string): ReadResult => ({ status: 'failure', error: new Error(message) })

function stubClient(results: ReadResult[]) {
    const batches: ContractCall[][] = []
    const client = {
        multicall: async ({ contracts }: { contracts: ContractCall[] }) => {
            batches.push(contracts)
            return results
        },
    } as unknown as PublicClient
    return { client, batches }
}

describe('computePriceImpactPercent', () => {
    it('is ~0 when the full-trade rate matches the reference rate', () => {
        expect(computePriceImpactPercent(2000n, 1000n, 2n, 1n)).toBeCloseTo(0)
    })

    it('reports the shortfall when the full trade gets a worse rate', () => {
        expect(computePriceImpactPercent(1900n, 1000n, 2n, 1n)).toBeCloseTo(5)
    })

    it('clamps favorable rounding to 0 rather than negative impact', () => {
        expect(computePriceImpactPercent(2100n, 1000n, 2n, 1n)).toBe(0)
    })

    it('returns undefined when the reference output is zero', () => {
        expect(computePriceImpactPercent(2000n, 1000n, 0n, 1n)).toBeUndefined()
    })

    it('returns undefined when amountIn is zero', () => {
        expect(computePriceImpactPercent(2000n, 0n, 2n, 1n)).toBeUndefined()
    })
})

describe('getRoutePriceImpact', () => {
    it('quotes the route at 0.1% and compares against the full output', async () => {
        // V3 single hop, 1000 in. Reference (1 in -> 2 out, rate 2); full 1000 in -> 1900 out (rate 1.9) -> 5%.
        const { client, batches } = stubClient([ok([2n, 0n, 0, 0n])])

        const result = await getRoutePriceImpact(client, {
            chainId: CHAIN_IDS.bitkub,
            protocol: ProtocolType.V3,
            dexId: 'junoswap',
            path: [TOKEN_A, TOKEN_B],
            fees: [3000],
            amountIn: 1000n,
            fullAmountOut: 1900n,
        })

        expect(batches).toHaveLength(1)
        expect(batches[0]).toHaveLength(1)
        expect(result).toBeCloseTo(5)
    })

    it('extracts the last element for a V2 getAmountsOut return', async () => {
        // V2 getAmountsOut returns [amountIn, amountOut]; rate 2 reference, full 5% worse.
        // udonswap is a V2 DEX on bitkub.
        const result = await getRoutePriceImpact(stubClient([ok([1n, 2n])]).client, {
            chainId: CHAIN_IDS.bitkub,
            protocol: ProtocolType.V2,
            dexId: 'udonswap',
            path: [TOKEN_A, TOKEN_B],
            amountIn: 1000n,
            fullAmountOut: 1900n,
        })

        expect(result).toBeCloseTo(5)
    })

    it('returns undefined when amountIn is too small for a nonzero reference', async () => {
        const { client, batches } = stubClient([])

        const result = await getRoutePriceImpact(client, {
            chainId: CHAIN_IDS.bitkub,
            protocol: ProtocolType.V3,
            dexId: 'junoswap',
            path: [TOKEN_A, TOKEN_B],
            fees: [3000],
            amountIn: 500n, // 500 / 1000 = 0
            fullAmountOut: 100n,
        })

        expect(batches).toHaveLength(0)
        expect(result).toBeUndefined()
    })

    it('returns undefined when the reference quote reverts', async () => {
        const result = await getRoutePriceImpact(stubClient([fail('reverted')]).client, {
            chainId: CHAIN_IDS.bitkub,
            protocol: ProtocolType.V3,
            dexId: 'junoswap',
            path: [TOKEN_A, TOKEN_B],
            fees: [3000],
            amountIn: 1000n,
            fullAmountOut: 1900n,
        })

        expect(result).toBeUndefined()
    })
})
