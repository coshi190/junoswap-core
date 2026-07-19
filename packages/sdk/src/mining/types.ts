import type { Address } from 'viem'

/**
 * The V3 staker's incentive struct. Identifies an incentive completely — the staker stores no id
 * of its own, it derives one by hashing these five fields (see computeIncentiveId).
 */
export interface IncentiveKey {
    rewardToken: Address
    pool: Address
    startTime: number
    endTime: number
    refundee: Address
}
