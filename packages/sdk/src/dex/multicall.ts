import type { ContractCall } from './plan-swap.js'

export type ReadResult<T = unknown> =
    | { status: 'success'; result: T }
    | { status: 'failure'; error: Error }

/**
 * The slice of a viem PublicClient the read helpers need.
 *
 * Deliberately structural rather than `PublicClient`: viem is a peer dependency, so a
 * consumer on a different viem minor than the one built against would otherwise fail to
 * assign its own client. Method shorthand (not property arrows) keeps the parameters
 * bivariant, which is what lets viem's generic signatures match.
 */
export interface ReadClient {
    multicall(args: { contracts: readonly ContractCall[]; allowFailure: true }): Promise<unknown>
    readContract(args: ContractCall): Promise<unknown>
}

/**
 * Batched read that works on every supported chain.
 *
 * bitkub and kubTestnet have no multicall3 deployment, so `client.multicall` throws
 * ChainDoesNotSupportContract there. Fall back to parallel eth_calls — a client on a
 * batching transport still coalesces those into one JSON-RPC request.
 */
export async function batchRead(
    client: ReadClient,
    calls: readonly ContractCall[]
): Promise<ReadResult[]> {
    if (calls.length === 0) return []

    try {
        const results = await client.multicall({ contracts: calls, allowFailure: true })
        return results as ReadResult[]
    } catch {
        const settled = await Promise.allSettled(calls.map((call) => client.readContract(call)))
        return settled.map((outcome) =>
            outcome.status === 'fulfilled'
                ? { status: 'success', result: outcome.value }
                : { status: 'failure', error: outcome.reason as Error }
        )
    }
}
