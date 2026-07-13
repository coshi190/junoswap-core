const MARKER = '6a756e6f'
const ZERO = '0x0000000000000000000000000000000000000000'
const SUFFIX_HEX_LEN = 48

export function parseTrackingTag(
    input: string | undefined | null
): { referrer: string | null } | null {
    if (!input) return null
    const data = input.toLowerCase()
    if (data.length < 2 + SUFFIX_HEX_LEN) return null
    const suffix = data.slice(-SUFFIX_HEX_LEN)
    if (!suffix.startsWith(MARKER)) return null
    const referrer = '0x' + suffix.slice(MARKER.length)
    return { referrer: referrer === ZERO ? null : referrer }
}

export function resolveBinding(
    referee: string,
    referrer: string | null
): { referee: string; referrer: string } | null {
    if (!referrer) return null
    const a = referee.toLowerCase()
    const b = referrer.toLowerCase()
    return a === b ? null : { referee: a, referrer: b }
}
