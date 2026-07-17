import { describe, it, expect } from 'vitest'
import type { PonderClient } from '../ponder/client'
import {
    computeReferralRewards,
    fetchReferralRewards,
} from '../leaderboard/referral-rewards'
import type { SwapEventRow } from '../leaderboard/points'

const WN = '0x67ebd850304c70d983b2d1b93ea79c7cd6c3f6b5'
const TOKEN = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

describe('computeReferralRewards', () => {
    it('ranks referees by points, prices volume, and takes the 10% cut', () => {
        const rows: SwapEventRow[] = [
            // 0xbob: junoswap buy of 5000 native => floor(5000/50) = 100 points
            {
                tokenAddr: TOKEN,
                sender: '0xBOB',
                isBuy: 1,
                amountIn: '5000000000000000000000', // 5000e18
                amountOut: '5',
                timestamp: 1,
                protocol: 'junoswap',
            },
            // 0xamy: junoswap buy of 500 native => floor(500/50) = 10 points
            {
                tokenAddr: TOKEN,
                sender: '0xAMY',
                isBuy: 1,
                amountIn: '500000000000000000000', // 500e18
                amountOut: '5',
                timestamp: 2,
                protocol: 'junoswap',
            },
        ]
        const result = computeReferralRewards(['0xamy', '0xbob'], rows, 2)
        // sorted points desc: bob (100) before amy (10)
        expect(result.referees.map((r) => r.address)).toEqual(['0xbob', '0xamy'])
        expect(result.referees[0]).toMatchObject({ points: 100, volumeUsd: 10000 })
        expect(result.referees[1]).toMatchObject({ points: 10, volumeUsd: 1000 })
        expect(result.refereeCount).toBe(2)
        expect(result.referralPoints).toBe(11) // floor((100 + 10) * 0.1)
    })

    it('scores an unseen referee at zero and treats a null price as zero volume', () => {
        const result = computeReferralRewards(['0xghost'], [], null)
        expect(result.referees).toEqual([{ address: '0xghost', points: 0, volumeUsd: 0 }])
        expect(result.referralPoints).toBe(0)
    })
})

/** Routes a Ponder list query to its fixture rows by matching the entity in the query text. */
function stubClient(rows: {
    bindings: unknown[]
    v2: unknown[]
    v3: unknown[]
    bc: unknown[]
}): PonderClient {
    return {
        request: async () => ({}) as never,
        fetchAllPages: async (query: string) => {
            if (query.includes('v2SwapEvents')) return rows.v2 as never[]
            if (query.includes('v3SwapEvents')) return rows.v3 as never[]
            if (query.includes('referralBindings')) return rows.bindings as never[]
            if (query.includes('swapEvents')) return rows.bc as never[] // bonding curve
            return [] as never[]
        },
    }
}

describe('fetchReferralRewards', () => {
    it('returns an empty result when the referrer has no referees', async () => {
        const client = stubClient({ bindings: [], v2: [], v3: [], bc: [] })
        const result = await fetchReferralRewards(client, {
            chainId: 96,
            referrer: '0xReferrer',
            wrappedNative: WN,
            nativeUsdPrice: 2,
        })
        expect(result).toEqual({ referralPoints: 0, refereeCount: 0, referees: [] })
    })

    it('aggregates a referee\'s swaps end-to-end', async () => {
        const client = stubClient({
            bindings: [{ referee: '0xRef1' }],
            // one junoswap V2 buy: native (token0) 5000 in, token out
            v2: [
                {
                    txFrom: '0xRef1',
                    token0Addr: WN,
                    token1Addr: TOKEN,
                    amount0In: '5000000000000000000000', // 5000e18 native
                    amount1In: '0',
                    amount0Out: '0',
                    amount1Out: '5',
                    timestamp: 100,
                    protocol: 'junoswap',
                },
            ],
            v3: [],
            bc: [],
        })
        const result = await fetchReferralRewards(client, {
            chainId: 96,
            referrer: '0xReferrer',
            wrappedNative: WN,
            nativeUsdPrice: 2,
        })
        expect(result.refereeCount).toBe(1)
        expect(result.referees[0]).toMatchObject({
            address: '0xref1',
            points: 100, // floor(5000 / 50)
            volumeUsd: 10000, // 5000 native * 2
        })
        expect(result.referralPoints).toBe(10) // floor(100 * 0.1)
    })
})
