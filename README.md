# junoswap-core

The chain-facing half of [Junoswap](https://junoswap.trade): the contracts, the SDK the
frontend and indexer both build on, and the indexer itself.

The frontend lives in a separate repo ([`junoswap`](https://github.com/coshi190/junoswap)) and
consumes this one through the published `@coshi190/junoswap-sdk` package.

```
contracts/      Foundry — BondingCurveJunoswap, AggRouterJunoswap, ERC20Token
packages/sdk/   @coshi190/junoswap-sdk — ABIs, deployment addresses, DEX/chain config, Ponder client
indexer/        Ponder indexer (GraphQL API, deployed to Railway)
scripts/        gen-abis.ts — contracts/out → packages/sdk/src/abis
```

These three live together because they're one dependency chain: **the contracts define the
ABIs, the SDK publishes them, the indexer consumes them.** Splitting them apart is what let the
ABIs drift out of sync in the first place — the frontend and the indexer each hand-maintained
their own pruned copy, and all six shared files had diverged.

## Setup

```bash
bun install
cd contracts && forge build   # required before codegen
cd .. && bun run codegen      # regenerates packages/sdk/src/abis
```

## ABIs are generated — don't hand-edit them

`packages/sdk/src/abis/*.ts` is generated from the Foundry build output. After changing any
contract:

```bash
cd contracts && forge build && cd .. && bun run codegen
```

CI fails if the committed ABIs don't match a fresh codegen.

Four ABIs are hand-written because we only *call* those contracts and have no Solidity source
for them: `uniswap-v2-router`, `uniswap-v3-quoter`, `uniswap-v3-swap-router`,
`uniswap-v3-staker`. They're marked as such at the top of each file.

## Deployment addresses

All in `packages/sdk/src/addresses/`:

- `deployments.ts` — Junoswap's own contracts (bonding curve, agg router), with the block the
  indexer syncs from. **Changing a `startBlock` forces a re-sync**, so don't tidy them.
- `dex-config.data.ts` — third-party DEX factories/routers per chain. The indexer reads its
  factory addresses from here too, so the two can't drift.

After a deploy: update `deployments.ts` → publish a new `@coshi190/junoswap-sdk` → bump the frontend.

## Indexer

Needs Postgres (`DATABASE_URL`); PGlite is disabled deliberately — it ran in-process and blew
Railway's memory budget.

```bash
cd indexer && bun run dev
```

Railway builds it from `indexer/Dockerfile` with the **repo root as build context** (the
Dockerfile needs to see the workspace to resolve `@coshi190/junoswap-sdk`).

## Publishing the SDK

```bash
cd packages/sdk && bun run build && npm publish --access public
```
