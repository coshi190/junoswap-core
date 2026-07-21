const Q96 = 2n ** 96n

/** Integer square root by Newton's method — bigint has no native sqrt. */
export function bigIntSqrt(n: bigint): bigint {
    if (n < 0n) throw new Error('square root of negative')
    if (n < 2n) return n

    let x = 1n << ((bitLength(n) + 1n) / 2n)
    let y = (x + n / x) / 2n
    while (y < x) {
        x = y
        y = (x + n / x) / 2n
    }
    return x
}

function bitLength(n: bigint): bigint {
    let len = 0n
    while (n > 0n) {
        n >>= 1n
        len++
    }
    return len
}

/** Liquidity a given amount of token0 provides across a price range. */
export function getLiquidityForAmount0(
    sqrtPriceAX96: bigint,
    sqrtPriceBX96: bigint,
    amount0: bigint
): bigint {
    if (sqrtPriceAX96 > sqrtPriceBX96) {
        ;[sqrtPriceAX96, sqrtPriceBX96] = [sqrtPriceBX96, sqrtPriceAX96]
    }
    const intermediate = (sqrtPriceAX96 * sqrtPriceBX96) / Q96
    return (amount0 * intermediate) / (sqrtPriceBX96 - sqrtPriceAX96)
}

/** Liquidity a given amount of token1 provides across a price range. */
export function getLiquidityForAmount1(
    sqrtPriceAX96: bigint,
    sqrtPriceBX96: bigint,
    amount1: bigint
): bigint {
    if (sqrtPriceAX96 > sqrtPriceBX96) {
        ;[sqrtPriceAX96, sqrtPriceBX96] = [sqrtPriceBX96, sqrtPriceAX96]
    }
    return (amount1 * Q96) / (sqrtPriceBX96 - sqrtPriceAX96)
}

/** Amount of token0 locked by `liquidity` across a price range. */
export function getAmount0ForLiquidity(
    sqrtPriceAX96: bigint,
    sqrtPriceBX96: bigint,
    liquidity: bigint
): bigint {
    if (sqrtPriceAX96 > sqrtPriceBX96) {
        ;[sqrtPriceAX96, sqrtPriceBX96] = [sqrtPriceBX96, sqrtPriceAX96]
    }
    return (liquidity * Q96 * (sqrtPriceBX96 - sqrtPriceAX96)) / sqrtPriceBX96 / sqrtPriceAX96
}

/** Amount of token1 locked by `liquidity` across a price range. */
export function getAmount1ForLiquidity(
    sqrtPriceAX96: bigint,
    sqrtPriceBX96: bigint,
    liquidity: bigint
): bigint {
    if (sqrtPriceAX96 > sqrtPriceBX96) {
        ;[sqrtPriceAX96, sqrtPriceBX96] = [sqrtPriceBX96, sqrtPriceAX96]
    }
    return (liquidity * (sqrtPriceBX96 - sqrtPriceAX96)) / Q96
}

/**
 * Token amounts a position holds, given the pool's current price.
 *
 * Below the range the position is entirely token0, above it entirely token1, and in range it
 * straddles both — which is why an in-range position's composition drifts as the price moves.
 */
export function getAmountsForLiquidity(
    sqrtPriceX96: bigint,
    sqrtPriceAX96: bigint,
    sqrtPriceBX96: bigint,
    liquidity: bigint
): { amount0: bigint; amount1: bigint } {
    if (sqrtPriceAX96 > sqrtPriceBX96) {
        ;[sqrtPriceAX96, sqrtPriceBX96] = [sqrtPriceBX96, sqrtPriceAX96]
    }

    if (sqrtPriceX96 <= sqrtPriceAX96) {
        return {
            amount0: getAmount0ForLiquidity(sqrtPriceAX96, sqrtPriceBX96, liquidity),
            amount1: 0n,
        }
    } else if (sqrtPriceX96 < sqrtPriceBX96) {
        return {
            amount0: getAmount0ForLiquidity(sqrtPriceX96, sqrtPriceBX96, liquidity),
            amount1: getAmount1ForLiquidity(sqrtPriceAX96, sqrtPriceX96, liquidity),
        }
    } else {
        return {
            amount0: 0n,
            amount1: getAmount1ForLiquidity(sqrtPriceAX96, sqrtPriceBX96, liquidity),
        }
    }
}

/**
 * The token1 deposit that pairs with `amount0` for a position at the current price.
 *
 * Returns 0 outside the range, where the position is single-sided and the other leg is unused.
 */
export function calculateAmount1FromAmount0(
    sqrtPriceX96: bigint,
    sqrtPriceLowerX96: bigint,
    sqrtPriceUpperX96: bigint,
    amount0: bigint
): bigint {
    if (amount0 === 0n) return 0n

    if (sqrtPriceLowerX96 > sqrtPriceUpperX96) {
        ;[sqrtPriceLowerX96, sqrtPriceUpperX96] = [sqrtPriceUpperX96, sqrtPriceLowerX96]
    }

    if (sqrtPriceX96 <= sqrtPriceLowerX96) {
        return 0n
    } else if (sqrtPriceX96 >= sqrtPriceUpperX96) {
        return 0n
    } else {
        const liquidity = getLiquidityForAmount0(sqrtPriceX96, sqrtPriceUpperX96, amount0)
        return getAmount1ForLiquidity(sqrtPriceLowerX96, sqrtPriceX96, liquidity)
    }
}

/** Mirror of {@link calculateAmount1FromAmount0} for the opposite input leg. */
export function calculateAmount0FromAmount1(
    sqrtPriceX96: bigint,
    sqrtPriceLowerX96: bigint,
    sqrtPriceUpperX96: bigint,
    amount1: bigint
): bigint {
    if (amount1 === 0n) return 0n

    if (sqrtPriceLowerX96 > sqrtPriceUpperX96) {
        ;[sqrtPriceLowerX96, sqrtPriceUpperX96] = [sqrtPriceUpperX96, sqrtPriceLowerX96]
    }

    if (sqrtPriceX96 <= sqrtPriceLowerX96) {
        return 0n
    } else if (sqrtPriceX96 >= sqrtPriceUpperX96) {
        return 0n
    } else {
        const liquidity = getLiquidityForAmount1(sqrtPriceLowerX96, sqrtPriceX96, amount1)
        return getAmount0ForLiquidity(sqrtPriceX96, sqrtPriceUpperX96, liquidity)
    }
}

/** Slippage floors passed as `amount0Min`/`amount1Min` to the position manager. */
export function calculateMinAmounts(
    amount0: bigint,
    amount1: bigint,
    slippageBps: number
): { amount0Min: bigint; amount1Min: bigint } {
    const slippageMultiplier = 10000n - BigInt(slippageBps)
    return {
        amount0Min: (amount0 * slippageMultiplier) / 10000n,
        amount1Min: (amount1 * slippageMultiplier) / 10000n,
    }
}

/** Unix-seconds deadline `deadlineMinutes` from now, for position manager calls. */
export function calculateDeadline(deadlineMinutes: number): bigint {
    return BigInt(Math.floor(Date.now() / 1000) + deadlineMinutes * 60)
}
