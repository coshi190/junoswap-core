/**
 * Generates packages/sdk/src/abis/*.ts from Foundry build artifacts.
 *
 * These ABIs used to be hand-maintained in two places (frontend + indexer) and had
 * silently drifted apart. Generating them from contracts/out is the single source of
 * truth: run `forge build` then `bun run codegen`. CI asserts the output is committed.
 *
 * ABIs with no Solidity source in contracts/src (the Uniswap periphery we only *call*,
 * never compile) stay hand-written in packages/sdk/src/abis — see HAND_WRITTEN below.
 */
import { $ } from 'bun'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const OUT_DIR = path.join(ROOT, 'contracts/out')
const ABI_DIR = path.join(ROOT, 'packages/sdk/src/abis')

/** artifact (contracts/out/<sol>.sol/<sol>.json) → [generated file, exported const] */
const TARGETS: Record<string, [string, string]> = {
    BondingCurveJunoswap: ['bonding-curve-junoswap', 'BONDING_CURVE_JUNOSWAP_ABI'],
    AggRouterJunoswap: ['agg-router-junoswap', 'AGG_ROUTER_JUNOSWAP_ABI'],
    ERC20Token: ['erc20', 'ERC20_ABI'],
    IUniswapV2Factory: ['uniswap-v2-factory', 'UNISWAP_V2_FACTORY_ABI'],
    IUniswapV2Pair: ['uniswap-v2-pair', 'UNISWAP_V2_PAIR_ABI'],
    IUniswapV3Factory: ['uniswap-v3-factory', 'UNISWAP_V3_FACTORY_ABI'],
    IUniswapV3Pool: ['uniswap-v3-pool', 'UNISWAP_V3_POOL_ABI'],
    INonfungiblePositionManager: [
        'nonfungible-position-manager',
        'NONFUNGIBLE_POSITION_MANAGER_ABI',
    ],
    IWETH9: ['weth9', 'WETH9_ABI'],
}

const HAND_WRITTEN = [
    'uniswap-v2-router',
    'uniswap-v3-quoter',
    'uniswap-v3-swap-router',
    'uniswap-v3-staker',
]

type AbiEntry = { type: string; name?: string }

async function main() {
    await mkdir(ABI_DIR, { recursive: true })

    const generated: string[] = []
    for (const [artifact, [file, constName]] of Object.entries(TARGETS)) {
        const artifactPath = path.join(OUT_DIR, `${artifact}.sol`, `${artifact}.json`)
        let raw: string
        try {
            raw = await readFile(artifactPath, 'utf8')
        } catch {
            throw new Error(`Missing artifact ${artifactPath} — run \`forge build\` first.`)
        }

        const abi = JSON.parse(raw).abi as AbiEntry[]
        if (!Array.isArray(abi) || abi.length === 0) {
            throw new Error(`Artifact ${artifact} has an empty ABI.`)
        }

        // Constructors carry no call/event surface and only add noise for consumers.
        const entries = abi.filter((e) => e.type !== 'constructor')

        const body = [
            `// Generated from contracts/src by \`bun run codegen\`. Do not edit by hand.`,
            `// Source artifact: ${artifact}.sol`,
            ``,
            `export const ${constName} = ${JSON.stringify(entries, null, 4)} as const`,
            ``,
        ].join('\n')

        await writeFile(path.join(ABI_DIR, `${file}.ts`), body)
        generated.push(file)
    }

    const index = [
        `// Barrel for the ABI modules. Generated files are rebuilt by \`bun run codegen\`;`,
        `// the hand-written ones have no Solidity source in this repo.`,
        ``,
        ...generated.sort().map((f) => `export * from './${f}'`),
        ...HAND_WRITTEN.map((f) => `export * from './${f}'`),
        ``,
    ].join('\n')
    await writeFile(path.join(ABI_DIR, 'index.ts'), index)

    await $`bun x prettier --write ${ABI_DIR}`.quiet()
    console.log(`Generated ${generated.length} ABIs → packages/sdk/src/abis`)
}

await main()
