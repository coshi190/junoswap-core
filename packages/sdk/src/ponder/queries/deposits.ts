import type { PonderClient } from '../client.js'
import type { Deposit } from '../entities.js'
import { sel, type Items, type Row } from './internal.js'

const DEPOSIT_FIELDS = ['tokenId', 'owner', 'updatedAt'] as const satisfies readonly (keyof Deposit)[]

export type DepositRow = Row<Deposit, typeof DEPOSIT_FIELDS>

/**
 * Every V3 LP position an address currently has deposited in the staker. Replaces the frontend's
 * localStorage cache plus its `fromBlock: 'earliest'` DepositTransferred log scan — the kub RPC
 * isn't a full archive node, so that scan was never reliable.
 *
 * Withdrawn positions keep their row with owner set to the zero address, so filtering by owner
 * returns live deposits only.
 */
export async function fetchDepositsByOwner(
    client: PonderClient,
    { chainId, owner, limit = 500 }: { chainId: number; owner: string; limit?: number }
): Promise<DepositRow[]> {
    const data = await client.request<{ deposits: Items<DepositRow> }>(
        `query DepositsByOwner($chainId: Int!, $owner: String!, $limit: Int!) {
            deposits(where: { chainId: $chainId, owner: $owner }, limit: $limit) {
                items { ${sel(DEPOSIT_FIELDS)} }
            }
        }`,
        { chainId, owner: owner.toLowerCase(), limit }
    )
    return data.deposits.items
}
