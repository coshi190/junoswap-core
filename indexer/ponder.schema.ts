import { onchainTable } from 'ponder'

export const launchToken = onchainTable('launch_token', (t) => ({
    tokenAddr: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    creator: t.text().notNull(),
    name: t.text().default(''),
    symbol: t.text().default(''),
    logo: t.text().default(''),
    description: t.text().default(''),
    link1: t.text().default(''),
    link2: t.text().default(''),
    link3: t.text().default(''),
    createdTime: t.integer().notNull(),
    isGraduated: t.integer().default(0),
    graduatedAt: t.integer(),
    createdAtBlock: t.integer().notNull(),
}))

export const swapEvent = onchainTable('swap_event', (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    tokenAddr: t.text().notNull(),
    sender: t.text().notNull(),
    isBuy: t.integer().notNull(),
    amountIn: t.text().notNull(),
    amountOut: t.text().notNull(),
    reserveIn: t.text().notNull(),
    reserveOut: t.text().notNull(),
    blockNumber: t.integer().notNull(),
    timestamp: t.integer().notNull(),
    transactionHash: t.text().notNull(),
}))

export const transferEvent = onchainTable('transfer_event', (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    tokenAddr: t.text().notNull(),
    from: t.text().notNull(),
    to: t.text().notNull(),
    amount: t.text().notNull(),
    blockNumber: t.integer().notNull(),
    timestamp: t.integer().notNull(),
    transactionHash: t.text().notNull(),
}))

export const tokenSnapshot = onchainTable('token_snapshot', (t) => ({
    tokenAddr: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    lastPrice: t.text().default('0'),
    lastPriceUsd: t.text().default('0'),
    marketCapNative: t.text().default('0'),
    athMarketCapNative: t.text().default('0'),
    totalBuys: t.integer().default(0),
    totalSells: t.integer().default(0),
    totalVolumeNative: t.text().default('0'),
    holderCount: t.integer().default(0),
    creatorFeeNative: t.text().default('0'),
    creatorFeeClaimedNative: t.text().default('0'),
    creatorFeeToken: t.text().default('0'),
    creatorFeeClaimedToken: t.text().default('0'),
    lastSwapAt: t.integer(),
    price1dAgo: t.text(),
    price1dAgoTimestamp: t.integer(),
    priceChange1dPct: t.text(),
    updatedAt: t.integer().notNull(),
}))

export const tokenHolder = onchainTable('token_holder', (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    tokenAddr: t.text().notNull(),
    address: t.text().notNull(),
    balance: t.text().notNull(),
}))

export const v3SwapEvent = onchainTable('v3_swap_event', (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    poolAddress: t.text().notNull(),
    tokenAddr: t.text().notNull(),
    tokenIsToken0: t.integer().notNull().default(1),
    sender: t.text().notNull(),
    recipient: t.text().notNull(),
    txFrom: t.text().notNull(),
    amount0: t.text().notNull(),
    amount1: t.text().notNull(),
    sqrtPriceX96: t.text().notNull(),
    liquidity: t.text().notNull(),
    tick: t.integer().notNull(),
    blockNumber: t.integer().notNull(),
    timestamp: t.integer().notNull(),
    transactionHash: t.text().notNull(),
    viaFrontend: t.integer().notNull().default(0),
    referrer: t.text(),
    token0Addr: t.text(),
    token1Addr: t.text(),
    protocol: t.text().notNull().default(''),
}))

export const v2SwapEvent = onchainTable('v2_swap_event', (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    poolAddress: t.text().notNull(),
    tokenAddr: t.text().notNull(),
    tokenIsToken0: t.integer().notNull().default(1),
    sender: t.text().notNull(),
    to: t.text().notNull(),
    txFrom: t.text().notNull(),
    amount0In: t.text().notNull(),
    amount1In: t.text().notNull(),
    amount0Out: t.text().notNull(),
    amount1Out: t.text().notNull(),
    blockNumber: t.integer().notNull(),
    timestamp: t.integer().notNull(),
    transactionHash: t.text().notNull(),
    viaFrontend: t.integer().notNull().default(0),
    referrer: t.text(),
    token0Addr: t.text().notNull(),
    token1Addr: t.text().notNull(),
    protocol: t.text().notNull().default(''),
}))

export const aggSwapEvent = onchainTable('agg_swap_event', (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    sender: t.text().notNull(),
    tokenIn: t.text().notNull(),
    tokenOut: t.text().notNull(),
    amountIn: t.text().notNull(),
    amountOut: t.text().notNull(),
    fee: t.text().notNull(),
    legs: t.integer().notNull(),
    referrer: t.text(),
    blockNumber: t.integer().notNull(),
    timestamp: t.integer().notNull(),
    transactionHash: t.text().notNull(),
}))

export const v2Pool = onchainTable('v2_pool', (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    address: t.text().notNull(),
    token0: t.text().notNull(),
    token1: t.text().notNull(),
    createdAtBlock: t.integer().notNull(),
    createdAtTimestamp: t.integer().notNull(),
    protocol: t.text().notNull().default(''),
}))

export const v3Token = onchainTable('v3_token', (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    address: t.text().notNull(),
    symbol: t.text().default(''),
    name: t.text().default(''),
    decimals: t.integer().default(18),
    createdAt: t.integer().notNull(),
}))

export const v3Pool = onchainTable('v3_pool', (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    address: t.text().notNull(),
    token0: t.text().notNull(),
    token1: t.text().notNull(),
    fee: t.integer().notNull(),
    tickSpacing: t.integer().notNull(),
    createdAtBlock: t.integer().notNull(),
    createdAtTimestamp: t.integer().notNull(),
    protocol: t.text().notNull().default(''),
}))

export const v3Position = onchainTable('v3_position', (t) => ({
    id: t.text().primaryKey(), // `${chainId}-${tokenId}`
    chainId: t.integer().notNull(),
    tokenId: t.text().notNull(),
    owner: t.text().notNull(), // lowercased; zero address once burned/transferred out
    token0: t.text().notNull(),
    token1: t.text().notNull(),
    fee: t.integer().notNull(),
    tickLower: t.integer().notNull(),
    tickUpper: t.integer().notNull(),
    liquidity: t.text().notNull().default('0'), // maintained via Increase/Decrease deltas
    tokensOwed0: t.text().notNull().default('0'), // best-effort; UI uses a live collect() sim
    tokensOwed1: t.text().notNull().default('0'),
    createdAtBlock: t.integer().notNull(),
    updatedAt: t.integer().notNull(),
}))

export const v3PoolDayVolume = onchainTable('v3_pool_day_volume', (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    poolAddress: t.text().notNull(),
    dayTimestamp: t.integer().notNull(),
    volumeToken0: t.text().notNull(),
    volumeToken1: t.text().notNull(),
    swapCount: t.integer().notNull(),
    updatedAt: t.integer().notNull(),
}))

export const nativeUsdPrice = onchainTable('native_usd_price', (t) => ({
    chainId: t.integer().primaryKey(),
    price: t.text().notNull(),
    poolAddress: t.text().notNull(),
    updatedAt: t.integer().notNull(),
}))

export const nativeUsdPriceSnapshot = onchainTable('native_usd_price_snapshot', (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    price: t.text().notNull(),
    timestamp: t.integer().notNull(),
    blockNumber: t.integer().notNull(),
}))

export const v3TokenSnapshot = onchainTable('v3_token_snapshot', (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    tokenAddr: t.text().notNull(),
    lastPriceNative: t.text().default('0'),
    lastPriceUsd: t.text().default('0'),
    lastSwapAt: t.integer(),
    updatedAt: t.integer().notNull(),
}))

export const referralBinding = onchainTable('referral_binding', (t) => ({
    referee: t.text().primaryKey(),
    referrer: t.text().notNull(),
    boundAtBlock: t.integer().notNull(),
    boundAtTimestamp: t.integer().notNull(),
    chainId: t.integer().notNull(),
}))

// Average-cost PnL fold per (chain, token, user), accumulated in the swap handlers. `position` is in
// human token units (formatUnits) so it lines up with a live balance; the USD fields are doubles.
// Real (not text) because these are genuine floats — the finalize step in the API routes reads them
// straight into `PnlFold`. See packages/sdk/src/leaderboard/pnl.ts for the accounting model.
export const userTokenPnl = onchainTable('user_token_pnl', (t) => ({
    id: t.text().primaryKey(), // `${chainId}-${tokenAddr}-${user}`, all lowercased
    chainId: t.integer().notNull(),
    tokenAddr: t.text().notNull(),
    user: t.text().notNull(),
    position: t.real().notNull().default(0),
    costPoolUsd: t.real().notNull().default(0),
    realizedUsd: t.real().notNull().default(0),
    totalInvestedUsd: t.real().notNull().default(0),
    updatedAt: t.integer().notNull(),
}))

// Per (chain, user) leaderboard counters folded alongside the PnL. `volumeNative` is the summed
// native leg of every swap; PnL for the leaderboard is derived by finalizing that user's
// userTokenPnl rows at read time.
export const userStat = onchainTable('user_stat', (t) => ({
    id: t.text().primaryKey(), // `${chainId}-${user}`, lowercased
    chainId: t.integer().notNull(),
    user: t.text().notNull(),
    volumeNative: t.real().notNull().default(0),
    tradeCount: t.integer().notNull().default(0),
    buyCount: t.integer().notNull().default(0),
    sellCount: t.integer().notNull().default(0),
    updatedAt: t.integer().notNull(),
}))
