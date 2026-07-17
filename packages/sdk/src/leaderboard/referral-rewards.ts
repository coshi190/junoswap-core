import type { PonderClient } from '../ponder/client.js'
import { fetchReferralBindings } from '../ponder/queries/referrals.js'
import { aggregatePointsByAddress, computeReferralPoints, type SwapEventRow } from './points.js'
import { fetchSwapEventsForSenders } from './swaps.js'

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

/** A referrer's referees and their raw swap rows — the price-independent half of the rewards calc. */
export interface ReferralData {
    referees: string[]
    rows: SwapEventRow[]
}

const EMPTY_DATA: ReferralData = { referees: [], rows: [] }

/**
 * Turns a referrer's referees and their swap rows into ranked reward figures: each referee's
 * points and USD volume, plus the 10% referral cut of their combined points.
 */
export function computeReferralRewards(
    referees: string[],
    rows: SwapEventRow[],
    nativeUsdPrice: number | null
): ReferralRewardsResult {
    const price = nativeUsdPrice ?? 0
    const byAddr = aggregatePointsByAddress(rows)
    const traders: ReferredTrader[] = referees.map((addr) => {
        const agg = byAddr.get(addr)
        return {
            address: addr,
            points: agg?.points ?? 0,
            volumeUsd: (agg?.volumeNative ?? 0) * price,
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
    wrappedNative: string | null
}

/**
 * Fetches a referrer's referees and every swap they made — the network half, kept separate from
 * pricing so callers can cache it and re-run {@link computeReferralRewards} as the price moves.
 */
export async function fetchReferralData(
    client: PonderClient,
    { chainId, referrer, wrappedNative }: ReferralDataArgs
): Promise<ReferralData> {
    const bindings = await fetchReferralBindings(client, { referrer: referrer.toLowerCase() })
    const referees = bindings.map((r) => r.referee.toLowerCase())
    if (referees.length === 0) return EMPTY_DATA
    const rows = await fetchSwapEventsForSenders(client, { chainId, wrappedNative, senders: referees })
    return { referees, rows }
}

/** Convenience one-shot: {@link fetchReferralData} then {@link computeReferralRewards}. */
export async function fetchReferralRewards(
    client: PonderClient,
    { chainId, referrer, wrappedNative, nativeUsdPrice }: ReferralDataArgs & { nativeUsdPrice: number | null }
): Promise<ReferralRewardsResult> {
    const { referees, rows } = await fetchReferralData(client, { chainId, referrer, wrappedNative })
    return computeReferralRewards(referees, rows, nativeUsdPrice)
}
