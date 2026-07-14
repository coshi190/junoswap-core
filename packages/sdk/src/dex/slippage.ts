/** Floors `amountOut` by `slippageBps` basis points (100 = 1%). */
export function calculateMinOutput(amountOut: bigint, slippageBps: number): bigint {
    return (amountOut * BigInt(10000 - slippageBps)) / 10000n
}
