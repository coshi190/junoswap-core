import type { PonderClient } from '../client.js'
import type { Incentive } from '../entities.js'
import { sel, type Items, type Row } from './internal.js'

const INCENTIVE_FIELDS = [
    'incentiveId',
    'rewardToken',
    'pool',
    'startTime',
    'endTime',
    'refundee',
    'reward',
    'refunded',
    'endedAt',
] as const satisfies readonly (keyof Incentive)[]

export type IncentiveRow = Row<Incentive, typeof INCENTIVE_FIELDS>

/**
 * Every LP mining incentive the staker has emitted on a chain. Replaces the hardcoded
 * KNOWN_INCENTIVES map the frontend used to ship — incentives created on-chain by anyone now
 * show up without a redeploy.
 *
 * Returns the immutable key only. The live struct (totalRewardUnclaimed, numberOfStakes) is still
 * an on-chain read, and isActive/isEnded are derived from startTime/endTime at render time.
 */
export async function fetchIncentives(
    client: PonderClient,
    { chainId, limit = 200 }: { chainId: number; limit?: number }
): Promise<IncentiveRow[]> {
    const data = await client.request<{ incentives: Items<IncentiveRow> }>(
        `query Incentives($chainId: Int!, $limit: Int!) {
            incentives(where: { chainId: $chainId }, limit: $limit) {
                items { ${sel(INCENTIVE_FIELDS)} }
            }
        }`,
        { chainId, limit }
    )
    return data.incentives.items
}
