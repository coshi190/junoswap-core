import { concat, isAddress, type Address, type Hex } from 'viem'

/**
 * The swap-attribution wire format. Both halves live here on purpose: the frontend *writes*
 * the suffix onto swap calldata and the indexer *reads* it back off. They used to be two
 * hand-kept copies in two codebases that both hardcoded the marker; if they ever disagreed,
 * referral attribution would silently stop working with nothing failing loudly.
 *
 * Magic prefix the indexer scans for at the tail of a swap's calldata: ASCII "juno".
 * Standard Uniswap V2/V3 router ABIs ignore trailing calldata, so appending
 * `MARKER + referrer` after the encoded args is a no-op for execution but lets the indexer
 * attribute the swap to this frontend (and to a referral link). Same idea as 1inch/0x
 * affiliate tags. Applied to every router (including Junoswap's own).
 */
export const JUNOSWAP_CALLDATA_MARKER = '0x6a756e6f' as const // "juno"

/** Used when no (or an invalid) ?ref= param is present. Zero address = "frontend originated, no referrer". */
export const DEFAULT_REFERRER: Address = '0x0000000000000000000000000000000000000000'

/** marker (4 bytes) + referrer (20 bytes) = 24-byte suffix. */
export function buildTrackingSuffix(referrer: Address): Hex {
    return concat([JUNOSWAP_CALLDATA_MARKER, referrer])
}

export function appendTrackingTag(data: Hex, referrer: Address): Hex {
    return concat([data, buildTrackingSuffix(referrer)])
}

export function normalizeReferrer(raw: string | null | undefined): Address {
    return raw && isAddress(raw) ? (raw as Address) : DEFAULT_REFERRER
}

// --- reader half (indexer) ---

const MARKER_HEX = JUNOSWAP_CALLDATA_MARKER.slice(2)
/** marker + referrer, in hex characters: (4 + 20) * 2. */
const SUFFIX_HEX_LEN = (4 + 20) * 2

export function parseTrackingTag(
    input: string | undefined | null
): { referrer: string | null } | null {
    if (!input) return null
    const data = input.toLowerCase()
    if (data.length < 2 + SUFFIX_HEX_LEN) return null
    const suffix = data.slice(-SUFFIX_HEX_LEN)
    if (!suffix.startsWith(MARKER_HEX)) return null
    const referrer = '0x' + suffix.slice(MARKER_HEX.length)
    return { referrer: referrer === DEFAULT_REFERRER ? null : referrer }
}

/** A self-referral is not a binding. */
export function resolveBinding(
    referee: string,
    referrer: string | null
): { referee: string; referrer: string } | null {
    if (!referrer) return null
    const a = referee.toLowerCase()
    const b = referrer.toLowerCase()
    return a === b ? null : { referee: a, referrer: b }
}
