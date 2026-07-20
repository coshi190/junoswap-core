/**
 * The scoring rules behind the leaderboard and referral rewards. The volume they score is folded at
 * index time into `userStat.junoVolumeNative` / `externalVolumeNative` (see the indexer's
 * `recordUserSwap`), so these are pure arithmetic over numbers that already exist.
 */

/**
 * Whether a swap's protocol counts as Junoswap's own venue (bonding curve + Junoswap V3 pools).
 * The indexer folds `userStat` on this same rule, so the two must never drift apart.
 */
export function isJunoswapProtocol(protocol: string): boolean {
    return protocol === 'junoswap'
}

/** Junoswap volume scores at 1 point / 50 native; external volume is discounted 10x. */
export function computePoints(junoVolumeNative: number, externalVolumeNative: number): number {
    return Math.floor(junoVolumeNative / 50 + externalVolumeNative / 500)
}

/** A referrer earns 10% of the summed points of everyone they referred, floored once. */
export function computeReferralPoints(refereePoints: number[]): number {
    return Math.floor(refereePoints.reduce((sum, p) => sum + p, 0) * 0.1)
}
