import type { PonderClient } from '../ponder/client.js'
import { fetchReferralBindings } from '../ponder/queries/referrals.js'
import { fetchUserStats, type UserStatRow } from '../ponder/queries/user-stats.js'
import { computePoints, computeReferralPoints } from './points.js'

export interface ReferredTrader {
    address: string
    points: number
    volumeUsd: number
}

export interface ReferralRewardsResult {
    referralPoints: number
    refereeCount: number
    referees: ReferredTrader[]
}

/**
 * A referrer's referees and their folded stats — the price-independent half of the rewards calc.
 * `stats` comes straight from the indexer's `userStat` fold, so no raw swap scan is involved.
 */
export interface ReferralData {
    referees: string[]
    stats: UserStatRow[]
}

const EMPTY_DATA: ReferralData = { referees: [], stats: [] }

/**
 * Turns a referrer's referees and their folded stats into ranked reward figures: each referee's
 * points and USD volume, plus the 10% referral cut of their combined points. A referee with no
 * folded row simply hasn't traded, and scores zero.
 */
export function computeReferralRewards(
    referees: string[],
    stats: UserStatRow[],
    nativeUsdPrice: number | null
): ReferralRewardsResult {
    const price = nativeUsdPrice ?? 0
    const byAddr = new Map(stats.map((s) => [s.user.toLowerCase(), s]))
    const traders: ReferredTrader[] = referees.map((addr) => {
        const s = byAddr.get(addr)
        return {
            address: addr,
            points: s ? computePoints(s.junoVolumeNative, s.externalVolumeNative) : 0,
            volumeUsd: (s?.volumeNative ?? 0) * price,
        }
    })
    traders.sort((a, b) => b.points - a.points)
    return {
        referralPoints: computeReferralPoints(traders.map((r) => r.points)),
        refereeCount: traders.length,
        referees: traders,
    }
}

export interface ReferralDataArgs {
    chainId: number
    referrer: string
}

/**
 * Fetches a referrer's referees and their folded stats — the network half, kept separate from
 * pricing so callers can cache it and re-run {@link computeReferralRewards} as the price
 * moves. Two bounded queries regardless of how much the referees have traded.
 */
export async function fetchReferralData(
    client: PonderClient,
    { chainId, referrer }: ReferralDataArgs
): Promise<ReferralData> {
    const bindings = await fetchReferralBindings(client, { referrer: referrer.toLowerCase() })
    const referees = bindings.map((r) => r.referee.toLowerCase())
    if (referees.length === 0) return EMPTY_DATA
    const stats = await fetchUserStats(client, { chainId, users: referees })
    return { referees, stats }
}

/** Convenience one-shot: {@link fetchReferralData} then {@link computeReferralRewards}. */
export async function fetchReferralRewards(
    client: PonderClient,
    { chainId, referrer, nativeUsdPrice }: ReferralDataArgs & { nativeUsdPrice: number | null }
): Promise<ReferralRewardsResult> {
    const { referees, stats } = await fetchReferralData(client, { chainId, referrer })
    return computeReferralRewards(referees, stats, nativeUsdPrice)
}
