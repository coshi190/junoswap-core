/* eslint-disable @typescript-eslint/no-explicit-any */
import { ponder } from 'ponder:registry'
import schema from 'ponder:schema'
import { readPosition } from './erc20-read.js'
import { ZERO_ADDRESS, addLiquidity, subLiquidity } from './v3-position-math.js'

/**
 * Ensure a v3Position row exists, seeding its immutable fields from an on-chain read.
 * Liquidity starts at 0 and is built up from Increase/Decrease deltas — the read at latest
 * reflects head state (post all later increases), so seeding liquidity from it would double
 * count as those events replay. Returns false when the immutable read fails (burned tokenId).
 */
async function ensurePosition(
    context: any,
    chainId: number,
    tokenId: bigint,
    owner: string,
    event: any
): Promise<boolean> {
    const id = `${chainId}-${tokenId}`
    const existing = await context.db.find(schema.v3Position, { id })
    if (existing) return true

    const pos = await readPosition(chainId, tokenId)
    if (!pos) return false

    await context.db
        .insert(schema.v3Position)
        .values({
            id,
            chainId,
            tokenId: tokenId.toString(),
            owner,
            token0: pos.token0.toLowerCase(),
            token1: pos.token1.toLowerCase(),
            fee: pos.fee,
            tickLower: pos.tickLower,
            tickUpper: pos.tickUpper,
            liquidity: '0',
            tokensOwed0: '0',
            tokensOwed1: '0',
            createdAtBlock: Number(event.block.number),
            updatedAt: Number(event.block.timestamp),
        })
        .onConflictDoNothing()
    return true
}

async function handleTransfer(context: any, chainId: number, event: any) {
    const { from, to, tokenId } = event.args
    const id = `${chainId}-${tokenId}`
    const owner = String(to).toLowerCase()
    const timestamp = Number(event.block.timestamp)

    // Mint (from == 0) always precedes the tx's IncreaseLiquidity, so this seeds the row.
    if (String(from).toLowerCase() === ZERO_ADDRESS) {
        await ensurePosition(context, chainId, tokenId, owner, event)
        return
    }

    const existing = await context.db.find(schema.v3Position, { id })
    if (existing) {
        await context.db.update(schema.v3Position, { id }).set({ owner, updatedAt: timestamp })
    } else {
        // Defensive: a transfer of a tokenId we never saw minted (e.g. started indexing late).
        await ensurePosition(context, chainId, tokenId, owner, event)
    }
}

async function handleIncrease(context: any, chainId: number, event: any) {
    const { tokenId, liquidity } = event.args
    const id = `${chainId}-${tokenId}`
    const timestamp = Number(event.block.timestamp)

    if (!(await ensurePosition(context, chainId, tokenId, ZERO_ADDRESS, event))) return

    const row = await context.db.find(schema.v3Position, { id })
    if (!row) return
    await context.db.update(schema.v3Position, { id }).set({
        liquidity: addLiquidity(row.liquidity, liquidity),
        updatedAt: timestamp,
    })
}

async function handleDecrease(context: any, chainId: number, event: any) {
    const { tokenId, liquidity } = event.args
    const id = `${chainId}-${tokenId}`
    const row = await context.db.find(schema.v3Position, { id })
    if (!row) return
    await context.db.update(schema.v3Position, { id }).set({
        liquidity: subLiquidity(row.liquidity, liquidity),
        updatedAt: Number(event.block.timestamp),
    })
}

async function handleCollect(context: any, chainId: number, event: any) {
    const { tokenId } = event.args
    const id = `${chainId}-${tokenId}`
    const row = await context.db.find(schema.v3Position, { id })
    if (!row) return
    // Fees are withdrawn on collect. tokensOwed is best-effort here (the UI reads live fees via
    // a collect() simulation), so simply zero it out rather than tracking exact owed growth.
    await context.db.update(schema.v3Position, { id }).set({
        tokensOwed0: '0',
        tokensOwed1: '0',
        updatedAt: Number(event.block.timestamp),
    })
}

ponder.on('NftPositionManager:Transfer', ({ event, context }) =>
    handleTransfer(context, 25925, event)
)
ponder.on('NftPositionManager:IncreaseLiquidity', ({ event, context }) =>
    handleIncrease(context, 25925, event)
)
ponder.on('NftPositionManager:DecreaseLiquidity', ({ event, context }) =>
    handleDecrease(context, 25925, event)
)
ponder.on('NftPositionManager:Collect', ({ event, context }) => handleCollect(context, 25925, event))

ponder.on('NftPositionManagerBitkub:Transfer', ({ event, context }) =>
    handleTransfer(context, 96, event)
)
ponder.on('NftPositionManagerBitkub:IncreaseLiquidity', ({ event, context }) =>
    handleIncrease(context, 96, event)
)
ponder.on('NftPositionManagerBitkub:DecreaseLiquidity', ({ event, context }) =>
    handleDecrease(context, 96, event)
)
ponder.on('NftPositionManagerBitkub:Collect', ({ event, context }) =>
    handleCollect(context, 96, event)
)

ponder.on('NftPositionManagerJbc:Transfer', ({ event, context }) =>
    handleTransfer(context, 8899, event)
)
ponder.on('NftPositionManagerJbc:IncreaseLiquidity', ({ event, context }) =>
    handleIncrease(context, 8899, event)
)
ponder.on('NftPositionManagerJbc:DecreaseLiquidity', ({ event, context }) =>
    handleDecrease(context, 8899, event)
)
ponder.on('NftPositionManagerJbc:Collect', ({ event, context }) =>
    handleCollect(context, 8899, event)
)
