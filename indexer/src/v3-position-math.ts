// Pure liquidity-ledger math for v3 positions, kept free of `ponder:` imports so it's unit
// testable (the handler file that registers events can't be loaded outside a Ponder runtime).

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** New liquidity after an IncreaseLiquidity. */
export function addLiquidity(current: string, delta: bigint): string {
    return (BigInt(current) + delta).toString()
}

/** New liquidity after a DecreaseLiquidity, clamped at zero (never negative). */
export function subLiquidity(current: string, delta: bigint): string {
    const next = BigInt(current) - delta
    return (next < 0n ? 0n : next).toString()
}
