import { ponder } from 'ponder:registry'
import schema from 'ponder:schema'

ponder.on('AggRouterJunoswap:Aggregated', async ({ event, context }) => {
    const { sender, tokenIn, tokenOut, amountIn, amountOut, fee, legs, referrer } = event.args
    await context.db
        .insert(schema.aggSwapEvent)
        .values({
            id: `96-${event.block.number}-${event.log.logIndex}`,
            chainId: 96,
            sender: sender.toLowerCase(),
            tokenIn: tokenIn.toLowerCase(),
            tokenOut: tokenOut.toLowerCase(),
            amountIn: amountIn.toString(),
            amountOut: amountOut.toString(),
            fee: fee.toString(),
            legs: Number(legs),
            referrer: referrer.toLowerCase(),
            blockNumber: Number(event.block.number),
            timestamp: Number(event.block.timestamp),
            transactionHash: event.transaction.hash,
        })
        .onConflictDoNothing()
})
