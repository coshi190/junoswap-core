import { formatEther, parseEther } from 'viem'
import { bigIntSqrt } from '../pool/liquidity-math.js'

/**
 * Protocol fee taken by `buy`/`sell` before the curve swap, in basis points. Mirrors the contract's
 * `pumpFee`, which is settable via `setFee` but has been 100 (1%) on every deployment.
 */
export const PUMP_FEE_BPS = 100n

/** `INITIALTOKEN` — every launched token mints exactly 1B, 18-decimal, in wei. */
export const INITIAL_TOKEN_SUPPLY = 1000000000n * 10n ** 18n

/** The same supply as whole tokens, for market-cap math that works in floats. */
export const TOTAL_SUPPLY = 1_000_000_000

/**
 * Constant-product output, mirroring `BondingCurveJunoswap.getAmountOut`.
 *
 * The `* 99` / `* 100` is the curve's own swap fee (1%, the analogue of Uniswap's 0.3%) and is
 * *separate* from {@link PUMP_FEE_BPS}, which callers deduct before getting here. A buy or sell
 * therefore pays both — roughly 2% all-in, which is what the UI quotes.
 */
function getAmountOut(inputAmount: bigint, inputReserve: bigint, outputReserve: bigint): bigint {
    if (inputReserve <= 0n || outputReserve <= 0n) return 0n
    const inputAmountWithFee = inputAmount * 99n
    const numerator = outputReserve * inputAmountWithFee
    const denominator = inputReserve * 100n + inputAmountWithFee
    return numerator / denominator
}

/** Tokens received for `nativeAmountIn`, after the pump fee and the curve fee. */
export function calculateBuyOutput(
    nativeAmountIn: bigint,
    nativeReserve: bigint,
    tokenReserve: bigint,
    virtualAmount: bigint
): bigint {
    if (nativeAmountIn <= 0n || nativeReserve < 0n || tokenReserve <= 0n) return 0n
    const feeAmount = (nativeAmountIn * PUMP_FEE_BPS) / 10000n
    const amountInAfterFee = nativeAmountIn - feeAmount
    return getAmountOut(amountInAfterFee, virtualAmount + nativeReserve, tokenReserve)
}

/** Native received for `tokenAmountIn`, after the pump fee and the curve fee. */
export function calculateSellOutput(
    tokenAmountIn: bigint,
    nativeReserve: bigint,
    tokenReserve: bigint,
    virtualAmount: bigint
): bigint {
    if (tokenAmountIn <= 0n || tokenReserve <= 0n || nativeReserve <= 0n) return 0n
    const feeAmount = (tokenAmountIn * PUMP_FEE_BPS) / 10000n
    const amountInAfterFee = tokenAmountIn - feeAmount
    return getAmountOut(amountInAfterFee, tokenReserve, virtualAmount + nativeReserve)
}

/** Native reserve at which the current token reserve would satisfy the graduation ratio. */
export function calculateGraduationTarget(tokenReserve: bigint, graduationAmount: bigint): bigint {
    if (graduationAmount <= 0n) return 0n
    return (tokenReserve * graduationAmount) / INITIAL_TOKEN_SUPPLY
}

/**
 * Progress toward graduation as a 0-100 percentage of the *current* target. Because the target
 * moves with `tokenReserve`, this reading shrinks as the curve is bought up — see
 * {@link calculateStableGraduationProgress} for the fixed-denominator version the UI prefers.
 */
export function calculateGraduationProgress(
    nativeReserve: bigint,
    tokenReserve: bigint,
    graduationAmount: bigint
): number {
    if (graduationAmount <= 0n || tokenReserve <= 0n) return 0
    const progress = Number(
        (INITIAL_TOKEN_SUPPLY * nativeReserve * 100n) / (tokenReserve * graduationAmount)
    )
    return Math.min(100, progress)
}

/**
 * Solves for the native reserve at which graduation actually triggers, accounting for the curve
 * fee that keeps reserves growing slightly slower than the nominal `graduationAmount` would imply.
 *
 * Newton's method on `N * (V + N)^0.99 = G * V^0.99`, which has no closed form. The seed is the
 * fee-free solution, and 20 iterations converge well past 1e-9 for realistic inputs.
 */
export function calculateExactGraduationReserve(
    virtualAmount: bigint,
    graduationAmount: bigint
): bigint {
    if (virtualAmount <= 0n || graduationAmount <= 0n) return graduationAmount

    const V = Number(formatEther(virtualAmount))
    const G = Number(formatEther(graduationAmount))
    const FEE_EXP = 0.99
    const target = G * Math.pow(V, FEE_EXP)

    let N = (-V + Math.sqrt(V * V + 4 * V * G)) / 2

    for (let i = 0; i < 20; i++) {
        const base = V + N
        const f = N * Math.pow(base, FEE_EXP) - target
        const fPrime = Math.pow(base, FEE_EXP) + N * FEE_EXP * Math.pow(base, FEE_EXP - 1)
        const step = f / fPrime
        N = Math.max(0, N - step)
        if (Math.abs(step) < 1e-9) break
    }

    return parseEther(N.toFixed(18))
}

/** Progress against a fixed target, so the bar never moves backwards as the curve fills. */
export function calculateStableGraduationProgress(
    nativeReserve: bigint,
    exactTarget: bigint
): number {
    if (exactTarget <= 0n) return 0
    const progress = Number((nativeReserve * 100n) / exactTarget)
    return Math.min(100, progress)
}

/**
 * Mirrors `BondingCurveJunoswap.graduate`'s cap check:
 *   `token * graduationAmount <= native * INITIALTOKEN`
 * kept cross-multiplied so there's no floored division to disagree about.
 *
 * Slightly stricter than the contract at the exact boundary: the contract's floored division can
 * still admit a state one wei short, and we'd rather disable the button than let the call revert.
 */
export function isReadyToGraduate(
    nativeReserve: bigint,
    tokenReserve: bigint,
    graduationAmount: bigint,
    isGraduated: boolean
): boolean {
    if (isGraduated || graduationAmount === 0n) return false
    return tokenReserve * graduationAmount <= INITIAL_TOKEN_SUPPLY * nativeReserve
}

/**
 * Whether `current` sits within `toleranceBps` of `target`. Used by the graduation flow to decide
 * whether the freshly-seeded V3 pool's price is close enough to the curve price to leave alone.
 */
export function isSqrtPriceWithinTolerance(
    current: bigint,
    target: bigint,
    toleranceBps: bigint
): boolean {
    if (target <= 0n) return false
    const diff = current > target ? current - target : target - current
    return diff <= (target * toleranceBps) / 10000n
}

/**
 * How far the graduated pool's price may drift from the curve price before the graduation flow
 * corrects it with a nudge swap. 4% absorbs the rounding in the contract's sqrt seeding.
 */
export const PRICE_TOLERANCE_BPS = 400n

/**
 * The sqrtPriceX96 a graduating token's V3 pool should be seeded at, from the curve's final reserves.
 *
 * Reserves are assigned to token0/token1 by canonical address order *before* the ratio is taken —
 * getting that backwards inverts the price, which is how a past graduation shipped a pool at the
 * reciprocal of its intended price. Scaling all the way up to Q192 before the integer sqrt keeps the
 * Q96 result's precision; dividing first would truncate small ratios to zero and `initialize(0)`
 * reverts. Result is clamped to uint160, the type the pool accepts.
 */
export function calculateGraduationSqrtPriceX96(
    tokenAddr: `0x${string}`,
    wrappedNative: `0x${string}`,
    nativeReserve: bigint,
    tokenReserve: bigint
): bigint {
    if (nativeReserve <= 0n || tokenReserve <= 0n) {
        throw new Error('Invalid reserves for sqrtPriceX96 calculation')
    }

    const tokenIsToken0 = tokenAddr.toLowerCase() < wrappedNative.toLowerCase()

    const amount0 = tokenIsToken0 ? tokenReserve : nativeReserve
    const amount1 = tokenIsToken0 ? nativeReserve : tokenReserve

    const Q192 = 2n ** 192n
    const priceX192 = (amount1 * Q192) / amount0

    const sqrtPriceX96 = bigIntSqrt(priceX192)

    const MAX_UINT160 = (1n << 160n) - 1n
    return sqrtPriceX96 > MAX_UINT160 ? MAX_UINT160 : sqrtPriceX96
}
