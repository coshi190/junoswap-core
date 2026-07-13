import type { PonderClient } from '../client'
import type {
    NativeUsdPrice,
    NativeUsdPriceSnapshot,
    TokenSnapshot,
    V3TokenSnapshot,
} from '../entities'
import { sel, type Items, type Page, type Row } from './internal'

const NATIVE_PRICE_FIELDS = [
    'chainId',
    'price',
] as const satisfies readonly (keyof NativeUsdPrice)[]

const SNAPSHOT_POINT_FIELDS = [
    'timestamp',
    'price',
] as const satisfies readonly (keyof NativeUsdPriceSnapshot)[]

const V3_TOKEN_PRICE_FIELDS = [
    'tokenAddr',
    'lastPriceUsd',
] as const satisfies readonly (keyof V3TokenSnapshot)[]

const TOKEN_PRICE_FIELDS = [
    'tokenAddr',
    'lastPriceUsd',
] as const satisfies readonly (keyof TokenSnapshot)[]

export type NativeUsdPricePoint = Row<NativeUsdPriceSnapshot, typeof SNAPSHOT_POINT_FIELDS>
export type V3TokenPrice = Row<V3TokenSnapshot, typeof V3_TOKEN_PRICE_FIELDS>
export type TokenPrice = Row<TokenSnapshot, typeof TOKEN_PRICE_FIELDS>

/** Current native-token price in USD, or null if the indexer has none for this chain. */
export async function fetchNativeUsdPrice(
    client: PonderClient,
    { chainId }: { chainId: number }
): Promise<number | null> {
    const data = await client.request<{
        nativeUsdPrices: Items<Row<NativeUsdPrice, typeof NATIVE_PRICE_FIELDS>>
    }>(
        `query NativeUsdPrice($chainId: Int!) {
            nativeUsdPrices(where: { chainId: $chainId }, limit: 1) {
                items { ${sel(NATIVE_PRICE_FIELDS)} }
            }
        }`,
        { chainId }
    )
    const row = data.nativeUsdPrices.items[0]
    if (!row) return null
    const price = parseFloat(row.price)
    return Number.isFinite(price) ? price : null
}

/** Full native/USD price history, paged through by cursor. */
export async function fetchNativeUsdPriceSnapshots(
    client: PonderClient,
    { chainId }: { chainId: number }
): Promise<NativeUsdPricePoint[]> {
    return client.fetchAllPages<{ nativeUsdPriceSnapshots: Page<NativeUsdPricePoint> }, NativeUsdPricePoint>(
        `query NativeUsdPriceSnapshots($chainId: Int!, $after: String) {
            nativeUsdPriceSnapshots(
                where: { chainId: $chainId }
                orderBy: "timestamp"
                orderDirection: "asc"
                limit: 1000
                after: $after
            ) {
                pageInfo { hasNextPage endCursor }
                items { ${sel(SNAPSHOT_POINT_FIELDS)} }
            }
        }`,
        { chainId },
        (r) => r.nativeUsdPriceSnapshots
    )
}

/** USD prices for every V3-traded token on a chain. */
export async function fetchV3TokenSnapshots(
    client: PonderClient,
    { chainId, limit = 500 }: { chainId: number; limit?: number }
): Promise<V3TokenPrice[]> {
    const data = await client.request<{ v3TokenSnapshots: Items<V3TokenPrice> }>(
        `query V3TokenSnapshots($chainId: Int!, $limit: Int!) {
            v3TokenSnapshots(where: { chainId: $chainId }, limit: $limit) {
                items { ${sel(V3_TOKEN_PRICE_FIELDS)} }
            }
        }`,
        { chainId, limit }
    )
    return data.v3TokenSnapshots.items
}

/** USD prices for specific bonding-curve tokens. */
export async function fetchTokenSnapshotsByAddresses(
    client: PonderClient,
    { tokenAddrs, limit = 500 }: { tokenAddrs: string[]; limit?: number }
): Promise<TokenPrice[]> {
    if (tokenAddrs.length === 0) return []
    const data = await client.request<{ tokenSnapshots: Items<TokenPrice> }>(
        `query TokenSnapshotsByAddresses($tokenAddrs: [String!], $limit: Int!) {
            tokenSnapshots(where: { tokenAddr_in: $tokenAddrs }, limit: $limit) {
                items { ${sel(TOKEN_PRICE_FIELDS)} }
            }
        }`,
        { tokenAddrs, limit }
    )
    return data.tokenSnapshots.items
}
