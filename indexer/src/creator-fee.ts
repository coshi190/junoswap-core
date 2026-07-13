// Mirror BondingCurveJunoswap's deploy-time values. Both are feeCollector-mutable
// on-chain (setFee/setCurveState) with no emitted event, so an admin fee change would
// silently desync creatorFeeNative from the real rate with nothing to catch it.
export const PUMP_FEE_BPS = 100n
export const CREATOR_FEE_SHARE_BPS = 5000n
export const VIRTUAL_AMOUNT = 3400n * 10n ** 18n

// Inverse of the contract's floor-division fee calc; not injective at multiples-of-100
// boundaries, so this can overcount by 1 wei for gross amounts ≡ 99 (mod 100).
export function pumpFeeFromNetAmountIn(netAmountIn: bigint): bigint {
    if (netAmountIn <= 0n) return 0n
    return (netAmountIn * PUMP_FEE_BPS) / (10000n - PUMP_FEE_BPS)
}

// Creator's 50% share of the on-chain pump fee, in whatever asset netAmountIn is
// denominated in. buy() takes its fee from native KUB, sell() from the launch token
// itself — no on-chain conversion between them, so this performs none either. Callers
// must route the result to the matching ledger column.
export function creatorFeeShareForSwap(netAmountIn: bigint): bigint {
    const fee = pumpFeeFromNetAmountIn(netAmountIn)
    if (fee === 0n) return 0n
    return (fee * CREATOR_FEE_SHARE_BPS) / 10000n
}
