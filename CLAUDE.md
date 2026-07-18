# junoswap-core

Bun workspace monorepo for Junoswap, a DEX on Bitkub Chain (KUB).

## Structure

- `contracts/` — Solidity contracts (Foundry). Bonding curve + AMM router, ERC20 token, aggregator router.
- `indexer/` — Ponder indexer. Indexes on-chain events (pools, swaps, positions, candles, PnL) into Postgres, serves an API.
- `packages/sdk/` — `@coshi190/junoswap-sdk`, published chain-facing primitives (ABIs, pool math, volume/TVL helpers) shared by indexer and consumers.
- `scripts/` — codegen (ABI + Ponder types) and one-off ops scripts.

## Notes

- After editing contracts in `contracts/src/`, run `bun run codegen` at the root before touching indexer/SDK code that consumes ABIs.
- The SDK is versioned and published (see `packages/sdk/package.json`); bump its version when making a released change to its public API.
