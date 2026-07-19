import { encodeAbiParameters, keccak256 } from 'viem'
import type { IncentiveKey } from './types.js'

/**
 * Derives an incentive's id the way the staker's `IncentiveId.compute` does: the five key fields
 * encoded flat, *not* as a tuple. Encoding them as a tuple produces a different hash and every
 * subsequent `incentives(id)` read silently returns a zero struct.
 *
 * The indexer needs this because `IncentiveCreated` emits the key fields but not the id.
 */
export function computeIncentiveId(key: IncentiveKey): `0x${string}` {
    return keccak256(
        encodeAbiParameters(
            [
                { type: 'address', name: 'rewardToken' },
                { type: 'address', name: 'pool' },
                { type: 'uint256', name: 'startTime' },
                { type: 'uint256', name: 'endTime' },
                { type: 'address', name: 'refundee' },
            ],
            [key.rewardToken, key.pool, BigInt(key.startTime), BigInt(key.endTime), key.refundee]
        )
    )
}
