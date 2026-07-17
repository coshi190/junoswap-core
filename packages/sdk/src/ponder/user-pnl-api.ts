import type { TokenPnl, PortfolioPnlTotals } from '../leaderboard/pnl.js'

/**
 * REST clients for the indexer's finalize routes (`/user-pnl`, `/leaderboard`). Unlike the rest of
 * this module these are plain `fetch` calls, not GraphQL through `PonderClient`, because the routes
 * return finalized PnL that the browser only displays. `baseUrl` is the indexer origin
 * (`NEXT_PUBLIC_PONDER_URL`) without the `/graphql` suffix.
 */

export interface UserPnlResponse {
    /** Keyed by lowercased token address. */
    perToken: Record<string, TokenPnl>
    totals: PortfolioPnlTotals
}

export interface LeaderboardTraderStat {
    address: string
    pnlUsd: number
    pnlPercent: number
    volumeNative: number
    tradeCount: number
    buyCount: number
    sellCount: number
}

export interface LeaderboardResponse {
    traders: LeaderboardTraderStat[]
}

async function getJson<T>(url: string): Promise<T> {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`indexer responded ${res.status}`)
    return (await res.json()) as T
}

export function fetchUserPnl(
    baseUrl: string,
    { chainId, user }: { chainId: number; user: string }
): Promise<UserPnlResponse> {
    const url = `${baseUrl}/user-pnl?chainId=${chainId}&user=${user.toLowerCase()}`
    return getJson<UserPnlResponse>(url)
}

export function fetchLeaderboardStats(
    baseUrl: string,
    { chainId, period }: { chainId: number; period?: string }
): Promise<LeaderboardResponse> {
    const periodQuery = period && period !== 'all' ? `&period=${period}` : ''
    return getJson<LeaderboardResponse>(`${baseUrl}/leaderboard?chainId=${chainId}${periodQuery}`)
}
