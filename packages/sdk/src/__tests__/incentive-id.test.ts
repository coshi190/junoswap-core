import { describe, expect, it } from 'vitest'
import { computeIncentiveId } from '../mining/incentive-id.js'
import type { IncentiveKey } from '../mining/types.js'

/**
 * Golden vector: the live kubTestnet (25925) incentive. Verified against the deployed staker at
 * 0xe445e132E9D4d0863E0BE079faf716A97250f37E — `incentives(id)` returns a non-zero struct
 * (numberOfStakes 3) for this id, which is what pins the encoding as flat-not-tuple.
 *
 * A wrong derivation fails silently everywhere else in the stack: reads just return a zero struct
 * and the farms list renders empty, so this test is the only thing that catches it.
 */
const TESTNET_KEY: IncentiveKey = {
    rewardToken: '0x23352915164527e0AB53Ca5519aec5188aa224A2',
    pool: '0x81182579f4271B910bF108913Be78F0D9C44AaBa',
    startTime: 1764152820,
    endTime: 1795688820,
    refundee: '0xCA811301C650C92fD45ed32A81C0B757C61595b6',
}

describe('computeIncentiveId', () => {
    it('matches the on-chain id for a live incentive', () => {
        expect(computeIncentiveId(TESTNET_KEY)).toBe(
            '0x26d52c050f9b613112df94d71586188fc3896697329fa5b7bc29476dfde5fb70'
        )
    })

    it('changes when any key field changes', () => {
        const base = computeIncentiveId(TESTNET_KEY)
        expect(
            computeIncentiveId({ ...TESTNET_KEY, startTime: TESTNET_KEY.startTime + 1 })
        ).not.toBe(base)
        expect(computeIncentiveId({ ...TESTNET_KEY, refundee: TESTNET_KEY.pool })).not.toBe(base)
    })
})
