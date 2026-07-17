import { db } from 'ponder:api'
import schema from 'ponder:schema'
import { graphql, eq, and, gte, inArray } from 'ponder'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import {
    finalizeTokenPnl,
    finalizePortfolioPnl,
    computeWindowedTraderStats,
    parseV2Swap,
    parseV3Swap,
    makePriceAt,
    sanitizePricePoints,
    WRAPPED_NATIVE_ADDRESSES,
    type PnlFold,
    type TokenPnl,
    type LeaderboardSwapEvent,
} from '@coshi190/junoswap-sdk'

const app = new Hono()

app.use('*', cors())

app.use('/', graphql({ db, schema }))
app.use('/graphql', graphql({ db, schema }))

// --- PnL finalize routes ----------------------------------------------------
//
// The swap handlers accumulate an average-cost fold per (user, token) in `userTokenPnl` and
// leaderboard counters in `userStat`. These routes finalize that fold at read time against the
// latest indexed token price, so unrealized PnL tracks the market rather than freezing at the
// user's last trade. See packages/sdk/src/leaderboard/pnl.ts for the accounting.

/** A number string of '0'/''/undefined means "no price"; anything positive is a real USD price. */
function toPrice(raw: string | null | undefined): number | null {
    if (!raw) return null
    const n = parseFloat(raw)
    return Number.isFinite(n) && n > 0 ? n : null
}

/** Latest USD price per token, preferring the V3 DEX snapshot over the bonding-curve snapshot. */
async function priceMapForTokens(
    chainId: number,
    tokenAddrs: string[]
): Promise<Map<string, number | null>> {
    const prices = new Map<string, number | null>()
    if (tokenAddrs.length === 0) return prices

    const v3Ids = tokenAddrs.map((t) => `${chainId}-${t}`)
    const [v3Snaps, bcSnaps] = await Promise.all([
        db.select().from(schema.v3TokenSnapshot).where(inArray(schema.v3TokenSnapshot.id, v3Ids)),
        db
            .select()
            .from(schema.tokenSnapshot)
            .where(inArray(schema.tokenSnapshot.tokenAddr, tokenAddrs)),
    ])

    for (const s of bcSnaps) prices.set(s.tokenAddr, toPrice(s.lastPriceUsd))
    for (const s of v3Snaps) {
        const p = toPrice(s.lastPriceUsd)
        if (p !== null) prices.set(s.tokenAddr, p)
    }
    return prices
}

function foldOf(row: {
    position: number
    costPoolUsd: number
    realizedUsd: number
    totalInvestedUsd: number
}): PnlFold {
    return {
        position: row.position,
        costPoolUsd: row.costPoolUsd,
        realizedUsd: row.realizedUsd,
        totalInvestedUsd: row.totalInvestedUsd,
    }
}

// GET /user-pnl?chainId=96&user=0x...  ->  { perToken: Record<tokenAddr, TokenPnl>, totals }
app.get('/user-pnl', async (c) => {
    const chainId = Number(c.req.query('chainId'))
    const user = c.req.query('user')?.toLowerCase()
    if (!Number.isInteger(chainId) || !user) {
        return c.json({ error: 'chainId and user are required' }, 400)
    }

    const rows = await db
        .select()
        .from(schema.userTokenPnl)
        .where(and(eq(schema.userTokenPnl.chainId, chainId), eq(schema.userTokenPnl.user, user)))

    const prices = await priceMapForTokens(
        chainId,
        rows.map((r) => r.tokenAddr)
    )

    const folds = new Map<string, PnlFold>()
    const balances = new Map<string, number>()
    for (const r of rows) {
        folds.set(r.tokenAddr, foldOf(r))
        balances.set(r.tokenAddr, r.position) // fully server-side: value the accounted position
    }

    const { perToken, totals } = finalizePortfolioPnl(folds, balances, prices)
    const perTokenObj: Record<string, TokenPnl> = {}
    for (const [tokenAddr, pnl] of perToken) perTokenObj[tokenAddr] = pnl

    return c.json({ perToken: perTokenObj, totals })
})

const PERIOD_SECONDS: Record<string, number> = { '24h': 86400, '7d': 604800, '30d': 2592000 }

/**
 * Windowed leaderboard: fold the raw swaps since `since` on the fly (the cumulative folds can't be
 * time-sliced — average-cost PnL isn't additive across buckets). Mirrors the client fold, valuing
 * each trader's in-window net position at the current token price.
 */
async function windowedLeaderboardTraders(chainId: number, since: number) {
    const wn = WRAPPED_NATIVE_ADDRESSES[chainId]?.toLowerCase() ?? null

    const [bcRows, v2Rows, v3Rows] = await Promise.all([
        db
            .select()
            .from(schema.swapEvent)
            .where(and(eq(schema.swapEvent.chainId, chainId), gte(schema.swapEvent.timestamp, since))),
        db
            .select()
            .from(schema.v2SwapEvent)
            .where(
                and(eq(schema.v2SwapEvent.chainId, chainId), gte(schema.v2SwapEvent.timestamp, since))
            ),
        db
            .select()
            .from(schema.v3SwapEvent)
            .where(
                and(eq(schema.v3SwapEvent.chainId, chainId), gte(schema.v3SwapEvent.timestamp, since))
            ),
    ])

    const events: LeaderboardSwapEvent[] = []
    for (const r of bcRows) {
        events.push({
            tokenAddr: r.tokenAddr,
            sender: r.sender,
            isBuy: r.isBuy === 1,
            amountIn: r.amountIn,
            amountOut: r.amountOut,
            timestamp: r.timestamp,
        })
    }
    if (wn) {
        for (const r of v2Rows) {
            const p = parseV2Swap(r, wn)
            if (p) {
                events.push({
                    tokenAddr: p.tokenAddr,
                    sender: p.sender,
                    isBuy: p.isBuy,
                    amountIn: p.amountIn,
                    amountOut: p.amountOut,
                    timestamp: p.timestamp,
                })
            }
        }
        for (const r of v3Rows) {
            const p = parseV3Swap(r, wn)
            if (p) {
                events.push({
                    tokenAddr: p.tokenAddr,
                    sender: p.sender,
                    isBuy: p.isBuy,
                    amountIn: p.amountIn,
                    amountOut: p.amountOut,
                    timestamp: p.timestamp,
                })
            }
        }
    }
    if (events.length === 0) return []

    // Native→USD at each swap's time, from the snapshot series (falling back to the current price).
    const [currentNative] = await db
        .select()
        .from(schema.nativeUsdPrice)
        .where(eq(schema.nativeUsdPrice.chainId, chainId))
        .limit(1)
    const snapRows = await db
        .select()
        .from(schema.nativeUsdPriceSnapshot)
        .where(
            and(
                eq(schema.nativeUsdPriceSnapshot.chainId, chainId),
                gte(schema.nativeUsdPriceSnapshot.timestamp, since)
            )
        )
    const points = sanitizePricePoints(
        snapRows.map((s) => ({ timestamp: s.timestamp, price: parseFloat(s.price) }))
    ).sort((a, b) => a.timestamp - b.timestamp)
    const priceAt = makePriceAt(points, currentNative ? parseFloat(currentNative.price) : 0)

    // Token decimals + current USD prices for the tokens actually traded in-window.
    const tokenAddrs = [...new Set(events.map((e) => e.tokenAddr))]
    const tokenRows = await db
        .select()
        .from(schema.v3Token)
        .where(
            inArray(
                schema.v3Token.id,
                tokenAddrs.map((t) => `${chainId}-${t}`)
            )
        )
    const decimalsByToken = new Map<string, number>()
    for (const t of tokenRows) decimalsByToken.set(t.address, t.decimals ?? 18)

    const prices = await priceMapForTokens(chainId, tokenAddrs)

    const statsByAddr = computeWindowedTraderStats(events, priceAt, prices, decimalsByToken)
    return [...statsByAddr].map(([address, s]) => ({ address, ...s }))
}

// GET /leaderboard?chainId=96[&period=24h|7d|30d]  ->  { traders: TraderStat[] }
// No period (or unknown) = all-time from the cumulative folds; a window folds raw swaps on the fly.
app.get('/leaderboard', async (c) => {
    const chainId = Number(c.req.query('chainId'))
    if (!Number.isInteger(chainId)) {
        return c.json({ error: 'chainId is required' }, 400)
    }

    const windowSeconds = PERIOD_SECONDS[c.req.query('period') ?? '']
    if (windowSeconds) {
        const since = Math.floor(Date.now() / 1000) - windowSeconds
        return c.json({ traders: await windowedLeaderboardTraders(chainId, since) })
    }

    const [pnlRows, statRows] = await Promise.all([
        db.select().from(schema.userTokenPnl).where(eq(schema.userTokenPnl.chainId, chainId)),
        db.select().from(schema.userStat).where(eq(schema.userStat.chainId, chainId)),
    ])

    const prices = await priceMapForTokens(chainId, [
        ...new Set(pnlRows.map((r) => r.tokenAddr)),
    ])

    // Sum finalized PnL across each user's tokens (balance = accounted position).
    const pnlByUser = new Map<string, { pnlUsd: number; investedUsd: number }>()
    for (const r of pnlRows) {
        const price = prices.get(r.tokenAddr) ?? null
        const tp = finalizeTokenPnl(foldOf(r), r.position, price)
        const agg = pnlByUser.get(r.user) ?? { pnlUsd: 0, investedUsd: 0 }
        agg.pnlUsd += tp.totalPnlUsd
        agg.investedUsd += tp.totalInvestedUsd
        pnlByUser.set(r.user, agg)
    }

    const traders = statRows.map((s) => {
        const agg = pnlByUser.get(s.user) ?? { pnlUsd: 0, investedUsd: 0 }
        return {
            address: s.user,
            pnlUsd: agg.pnlUsd,
            pnlPercent: agg.investedUsd > 0 ? (agg.pnlUsd / agg.investedUsd) * 100 : 0,
            volumeNative: s.volumeNative,
            tradeCount: s.tradeCount,
            buyCount: s.buyCount,
            sellCount: s.sellCount,
        }
    })

    return c.json({ traders })
})

export default app
