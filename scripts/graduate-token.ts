/**
 * graduate-token.ts — recover a launchpad token that reached the graduation
 * threshold but is stuck because its Uniswap V3 pool was *poisoned*: someone
 * (or a failed attempt) created + `initialize()`-d the pair pool at the wrong
 * price before graduation. `BondingCurveJunoswap.graduate()` only calls
 * `initialize()` when `sqrtPriceX96 == 0` (see BondingCurveJunoswap.sol:141-150),
 * so once a pool is initialised at a bad price the graduation mint lands at
 * that bad price and the 95% `amountMin` checks revert. `initialize()` is
 * one-shot, so the only fix is to *move the live pool price* to the exact
 * price graduation wants, then call `graduate()`.
 *
 * Usage:
 *   PRIVATE_KEY=0x... bun run scripts/graduate-token.ts                 # dry run
 *   PRIVATE_KEY=0x... bun run scripts/graduate-token.ts --execute        # send
 *   PRIVATE_KEY=0x... bun run scripts/graduate-token.ts --execute --token 0x...
 *
 * Env:
 *   PRIVATE_KEY   sender key (also auto-loaded from contracts/.env)
 *   RPC_URL       override default Bitkub RPC
 *   SEED_KKUB     KKUB to seed the position with, in ether (default 0.01)
 *   SEED_TOKEN    token to seed the position with, in ether (default 1000)
 *   TOLERANCE_BP  max |price-target|/target in basis points (default 100 = 1%)
 */
import { readFileSync } from 'node:fs'
import {
    createPublicClient,
    createWalletClient,
    http,
    formatUnits,
    type Address,
    type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
    BONDING_CURVE_JUNOSWAP_ABI,
    UNISWAP_V3_FACTORY_ABI,
    UNISWAP_V3_POOL_ABI,
    NONFUNGIBLE_POSITION_MANAGER_ABI,
    UNISWAP_V3_SWAP_ROUTER_ABI,
    WETH9_ABI,
    ERC20_ABI,
} from '../packages/sdk/src/abis/index.js'

const CHAIN = {
    id: 96,
    name: 'Bitkub Chain',
    nativeCurrency: { name: 'KUB', symbol: 'KUB', decimals: 18 },
    rpcUrls: { default: { http: [process.env.RPC_URL ?? 'https://rpc.bitkubchain.io'] } },
} as const

const BONDING_CURVE = '0x65F6EC30A9E70822721585f6Bba15c40c2F8ab4e' as Address
const V3_FACTORY = '0x090C6E5fF29251B1eF9EC31605Bdd13351eA316C' as Address
const V3_POS_MANAGER = '0xb6b76870549893c6b59E7e979F254d0F9Cca4Cc9' as Address
const V3_SWAP_ROUTER = '0x3F7582E36843FF79F173c7DC19f517832496f2D8' as Address

const FEE = 10_000 // pool fee tier used by graduation (BondingCurveJunoswap.sol:143)
const TICK_LOWER = -887_200 // full-range lower tick (matches graduation mint)
const TICK_UPPER = 887_200 // full-range upper tick
const Q192 = 2n ** 192n
const MAX_UINT160 = 2n ** 160n - 1n
const MAX_UINT256 = 2n ** 256n - 1n

// ─── CLI ───────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const EXECUTE = argv.includes('--execute')
const DEFAULT_TOKEN = '0x3bc50f3a9f9c6a74830da1567dc7feae5d53a80e'
const TOKEN_IDX = argv.indexOf('--token')
const TOKEN = ((TOKEN_IDX !== -1 ? argv[TOKEN_IDX + 1] : undefined) ?? DEFAULT_TOKEN) as Address
const SEED_KKUB = parseEtherEnv('SEED_KKUB', '0.01')
const SEED_TOKEN = parseEtherEnv('SEED_TOKEN', '1000')
const TOLERANCE_BP = BigInt(process.env.TOLERANCE_BP ?? '100')

function parseEtherEnv(name: string, def: string): bigint {
    const v = process.env[name] ?? def
    return BigInt(Math.round(parseFloat(v) * 1e6)) * 10n ** 12n // → 1e18
}

const c = {
    dim: (s: string) => s,
    warn: (s: string) => s,
}
const log = console.log

function sqrtBigInt(x: bigint): bigint {
    if (x < 0n) throw new Error('sqrt of negative')
    if (x < 2n) return x
    let z = (x + 1n) / 2n
    let y = x
    while (z < y) {
        y = z
        z = (x / z + z) / 2n
    }
    return y // floor
}

function encodeSqrtPriceX96(amount0: bigint, amount1: bigint): bigint {
    const ratioX192 = (amount1 * Q192) / amount0
    const sqrt = sqrtBigInt(ratioX192)
    if (sqrt > MAX_UINT160) throw new Error(`sqrtPriceX96 overflows uint160: ${sqrt}`)
    return sqrt
}

function loadPrivateKey(): Hex {
    const fromEnv = process.env.PRIVATE_KEY
    if (fromEnv) return (fromEnv.startsWith('0x') ? fromEnv : `0x${fromEnv}`) as Hex
    try {
        const env = readFileSync(new URL('../contracts/.env', import.meta.url), 'utf8')
        const m = env.match(/^PRIVATE_KEY\s*=\s*(?:0x)?([0-9a-fA-F]{64})\s*$/m)
        if (m) return `0x${m[1]}` as Hex
    } catch {
        /* ignore — fall through to error */
    }
    throw new Error('PRIVATE_KEY not set (env or contracts/.env)')
}

async function main() {
    const account = privateKeyToAccount(loadPrivateKey())
    const publicClient = createPublicClient({ chain: CHAIN, transport: http() })
    const walletClient = createWalletClient({ chain: CHAIN, account, transport: http() })
    const sender = account.address

    log(`\n${'='.repeat(72)}`)
    log(`graduate-token — ${EXECUTE ? c.warn('⚠ EXECUTE (broadcasting)') : c.dim('DRY-RUN (no tx)')}`)
    log(`${'='.repeat(72)}`)
    log(`chain ............ Bitkub (96)`)
    log(`sender ........... ${sender}`)
    log(`bonding curve .... ${BONDING_CURVE}`)
    log(`token ............ ${TOKEN}`)
    if (!EXECUTE) log(c.dim(`(add --execute to broadcast; review the plan below first)\n`))

    const call = makeCaller(publicClient, walletClient)

    // ── 1. read curve state ────────────────────────────────────────────────────
    const wrappedNative = (await publicClient.readContract({
        address: BONDING_CURVE,
        abi: BONDING_CURVE_JUNOSWAP_ABI,
        functionName: 'wrappedNative',
    })) as Address
    const virtualAmount = (await readCurve(publicClient, 'virtualAmount')) as bigint
    const graduationAmount = (await readCurve(publicClient, 'graduationAmount')) as bigint
    const INITIALTOKEN = (await readCurve(publicClient, 'INITIALTOKEN')) as bigint
    const [reserveNative, reserveToken] = (await publicClient.readContract({
        address: BONDING_CURVE,
        abi: BONDING_CURVE_JUNOSWAP_ABI,
        functionName: 'pumpReserve',
        args: [TOKEN],
    })) as [bigint, bigint]
    const isGraduate = (await publicClient.readContract({
        address: BONDING_CURVE,
        abi: BONDING_CURVE_JUNOSWAP_ABI,
        functionName: 'isGraduate',
        args: [TOKEN],
    })) as boolean

    log(`\n— curve state —`)
    log(`wrappedNative .... ${wrappedNative}`)
    log(`virtualAmount .... ${formatUnits(virtualAmount, 18)}`)
    log(`graduationAmount . ${formatUnits(graduationAmount, 18)} KUB`)
    log(`reserve.native ... ${formatUnits(reserveNative, 18)} KUB`)
    log(`reserve.token .... ${formatUnits(reserveToken, 18)}`)
    log(`isGraduate ....... ${isGraduate}`)

    if (isGraduate) throw new Error('token already graduated — nothing to do')
    const capMet = reserveToken * graduationAmount <= reserveNative * INITIALTOKEN
    log(`graduation cap ... ${capMet ? 'MET ✓' : 'NOT MET ✗'}`)
    if (!capMet) throw new Error('graduation cap not reached — cannot graduate')

    // ── 2. compute target sqrtPriceX96 (mirror graduate()) ─────────────────────
    const tokenIsToken0 = TOKEN.toLowerCase() < wrappedNative.toLowerCase()
    const [tkn0, tkn1] = tokenIsToken0 ? [TOKEN, wrappedNative] : [wrappedNative, TOKEN]
    const nativeReserve = reserveNative
    // Math.mulDiv(token, native, virtual + native)
    const tokenLiquidity = (reserveToken * nativeReserve) / (virtualAmount + nativeReserve)
    const [a0, a1] = tokenIsToken0
        ? [tokenLiquidity, nativeReserve]
        : [nativeReserve, tokenLiquidity]
    const targetSqrtPriceX96 = encodeSqrtPriceX96(a0, a1)

    log(`\n— target (graduate price) —`)
    log(`token0 ........... ${tkn0}`)
    log(`token1 ........... ${tkn1}`)
    log(`tokenLiquidity ... ${formatUnits(tokenLiquidity, 18)}`)
    log(`target sqrtP X96 . ${targetSqrtPriceX96}`)

    // ── 3. locate pool ─────────────────────────────────────────────────────────
    const poolRaw = (await publicClient.readContract({
        address: V3_FACTORY,
        abi: UNISWAP_V3_FACTORY_ABI,
        functionName: 'getPool',
        args: [tkn0, tkn1, FEE],
    })) as Address
    const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
    const poolExists = poolRaw !== ZERO_ADDR

    let currentSqrtPriceX96 = 0n
    let poolLiquidity = 0n
    const pool = poolRaw
    if (poolExists) {
        const slot0 = (await publicClient.readContract({
            address: pool,
            abi: UNISWAP_V3_POOL_ABI,
            functionName: 'slot0',
        })) as readonly [bigint, number, number, number, number, number, boolean]
        currentSqrtPriceX96 = slot0[0]
        poolLiquidity = (await publicClient.readContract({
            address: pool,
            abi: UNISWAP_V3_POOL_ABI,
            functionName: 'liquidity',
        })) as bigint
    }

    log(`\n— pool —`)
    log(`pool address ..... ${poolExists ? pool : 'NONE (not created yet)'}`)
    if (poolExists) {
        log(`current sqrtP X96  ${currentSqrtPriceX96}`)
        log(`pool liquidity ..... ${poolLiquidity}`)
    }

    const priceAlreadyCorrect =
        currentSqrtPriceX96 !== 0n && diffBp(currentSqrtPriceX96, targetSqrtPriceX96) <= TOLERANCE_BP
    const needSeed = poolExists && currentSqrtPriceX96 !== 0n && poolLiquidity === 0n
    const needSwap = poolExists && currentSqrtPriceX96 !== 0n && !priceAlreadyCorrect

    if (!poolExists || currentSqrtPriceX96 === 0n) {
        log(
            c.dim(
                `\nPool is ${poolExists ? 'uninitialised' : 'absent'} → graduate() will create`,
            ) + c.dim(` + initialise it at the correct price itself. No fix needed.`),
        )
        return graduate({ call, publicClient, log, EXECUTE, TOKEN })
    }
    if (priceAlreadyCorrect) {
        log(c.dim(`\nPool price already matches target (within ${TOLERANCE_BP} bp). No fix needed.`))
        return graduate({ call, publicClient, log, EXECUTE, TOKEN })
    }

    const zeroForOne = targetSqrtPriceX96 < currentSqrtPriceX96 // swap token0→token1 (price ↓)
    const tokenIn = zeroForOne ? tkn0 : tkn1
    const tokenOut = zeroForOne ? tkn1 : tkn0
    log(`\n— price fix needed —`)
    log(`direction ........ ${zeroForOne ? 'token0→token1 (price ↓)' : 'token1→token0 (price ↑)'}`)
    log(`input token ...... ${tokenIn} (${tokenIn === TOKEN ? 'TOKEN' : 'KKUB'})`)
    log(`need seed ........ ${needSeed ? 'yes (pool has no liquidity)' : 'no'}`)
    log(`target/current ... ${formatBp(currentSqrtPriceX96, targetSqrtPriceX96)} bp apart`)

    if (!EXECUTE) {
        log(
            c.dim(
                `\n[dry-run] would: ${needSeed ? 'seed → ' : ''}swap to target → graduate${needSeed ? ' → withdraw seed' : ''}`,
            ),
        )
        log(c.dim(`re-run with --execute to broadcast.\n`))
        return
    }

    // ══ EXECUTE ════════════════════════════════════════════════════════════════
    let kubBal = (await publicClient.getBalance({ address: sender })) as bigint
    let kkubBal = await bal(publicClient, wrappedNative, sender)
    let tokenBal = await bal(publicClient, TOKEN, sender)
    log(`\n— balances —`)
    log(`KUB .... ${formatUnits(kubBal, 18)}`)
    log(`KKUB ... ${formatUnits(kkubBal, 18)}`)
    log(`TOKEN .. ${formatUnits(tokenBal, 18)}`)

    const GAS_RESERVE = parseEtherEnv('_gas', '0.05')
    let seedTokenId: bigint | undefined

    // ── 4. seed a full-range position if the pool is empty ─────────────────────
    if (needSeed) {
        if (tokenBal < SEED_TOKEN)
            throw new Error(
                `need ≥ ${formatUnits(SEED_TOKEN, 18)} token to seed; have ${formatUnits(tokenBal, 18)}`,
            )
        if (kkubBal < SEED_KKUB) {
            const wrapAmt = SEED_KKUB - kkubBal
            if (kubBal - GAS_RESERVE < wrapAmt)
                throw new Error(`not enough KUB to wrap ${formatUnits(wrapAmt, 18)}`)
            log(`\n→ wrap ${formatUnits(wrapAmt, 18)} KUB → KKUB`)
            await call({ address: wrappedNative, abi: WETH9_ABI, functionName: 'deposit', value: wrapAmt })
            kkubBal += wrapAmt
        }

        await ensureAllowance(publicClient, call, sender, TOKEN, V3_POS_MANAGER, SEED_TOKEN, log)
        await ensureAllowance(publicClient, call, sender, wrappedNative, V3_POS_MANAGER, SEED_KKUB, log)

        log(
            `\n→ seed full-range position (${formatUnits(SEED_KKUB, 18)} KKUB / ${formatUnits(SEED_TOKEN, 18)} token)`,
        )
        const { result } = await call({
            address: V3_POS_MANAGER,
            abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
            functionName: 'mint',
            args: [
                {
                    token0: tkn0,
                    token1: tkn1,
                    fee: FEE,
                    tickLower: TICK_LOWER,
                    tickUpper: TICK_UPPER,
                    amount0Desired: tkn0 === TOKEN ? SEED_TOKEN : SEED_KKUB,
                    amount1Desired: tkn1 === TOKEN ? SEED_TOKEN : SEED_KKUB,
                    amount0Min: 0n,
                    amount1Min: 0n,
                    recipient: sender,
                    deadline: BigInt(Math.floor(Date.now() / 1000) + 1200),
                },
            ],
        })
        seedTokenId = (result as readonly [bigint, bigint, bigint, bigint])[0]
        log(`   seed tokenId = ${seedTokenId}`)

        tokenBal = await bal(publicClient, TOKEN, sender)
        kkubBal = await bal(publicClient, wrappedNative, sender)
        poolLiquidity = (await publicClient.readContract({
            address: pool,
            abi: UNISWAP_V3_POOL_ABI,
            functionName: 'liquidity',
        })) as bigint
    }

    // ── 5. swap to target (sqrtPriceLimitX96 caps the price move) ──────────────
    if (needSwap) {
        const swapInputBal = tokenIn === TOKEN ? tokenBal : kkubBal
        if (swapInputBal <= 0n)
            throw new Error(`no ${tokenIn === TOKEN ? 'TOKEN' : 'KKUB'} balance to swap with`)
        await ensureAllowance(publicClient, call, sender, tokenIn, V3_SWAP_ROUTER, swapInputBal, log)

        log(`\n→ swap to target price (limit = target, amountIn cap = full balance)`)
        await call({
            address: V3_SWAP_ROUTER,
            abi: UNISWAP_V3_SWAP_ROUTER_ABI,
            functionName: 'exactInputSingle',
            args: [
                {
                    tokenIn,
                    tokenOut,
                    fee: FEE,
                    recipient: sender,
                    amountIn: swapInputBal,
                    amountOutMinimum: 0n,
                    sqrtPriceLimitX96: targetSqrtPriceX96,
                },
            ],
        })

        const slot0 = (await publicClient.readContract({
            address: pool,
            abi: UNISWAP_V3_POOL_ABI,
            functionName: 'slot0',
        })) as readonly [bigint, number, number, number, number, number, boolean]
        const off = diffBp(slot0[0], targetSqrtPriceX96)
        log(`   price now sqrtP X96 = ${slot0[0]}  (target ${targetSqrtPriceX96}, off ${off} bp)`)
        if (off > TOLERANCE_BP)
            throw new Error(
                `price did not reach target (off ${off} bp > ${TOLERANCE_BP}) — aborting before graduate`,
            )
    }

    // ── 6. graduate ────────────────────────────────────────────────────────────
    await graduate({ call, publicClient, log, EXECUTE, TOKEN })

    // ── 7. withdraw seed + unwrap leftover KKUB ───────────────────────────────
    if (seedTokenId !== undefined) {
        log(`\n→ withdraw seed position #${seedTokenId}`)
        const pos = (await publicClient.readContract({
            address: V3_POS_MANAGER,
            abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
            functionName: 'positions',
            args: [seedTokenId],
        })) as readonly [
            bigint, // 0 nonce
            Address, // 1 operator
            Address, // 2 token0
            Address, // 3 token1
            number, // 4 fee
            number, // 5 tickLower
            number, // 6 tickUpper
            bigint, // 7 liquidity
            bigint, // 8 feeGrowthInside0X128
            bigint, // 9 feeGrowthInside1X128
            bigint, // 10 tokensOwed0
            bigint, // 11 tokensOwed1
        ]
        const seedL = pos[7]
        if (seedL > 0n) {
            await call({
                address: V3_POS_MANAGER,
                abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
                functionName: 'decreaseLiquidity',
                args: [{ tokenId: seedTokenId, liquidity: seedL, amount0Min: 0n, amount1Min: 0n }],
            })
        }
        await call({
            address: V3_POS_MANAGER,
            abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
            functionName: 'collect',
            args: [
                {
                    tokenId: seedTokenId,
                    recipient: sender,
                    amount0Max: MAX_UINT256,
                    amount1Max: MAX_UINT256,
                },
            ],
        })
        await call({
            address: V3_POS_MANAGER,
            abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
            functionName: 'burn',
            args: [seedTokenId],
        })
        log(`   seed withdrawn & burned`)
    }

    const kkubLeft = await bal(publicClient, wrappedNative, sender)
    if (kkubLeft > 0n) {
        log(`\n→ unwrap ${formatUnits(kkubLeft, 18)} KKUB → KUB`)
        await call({ address: wrappedNative, abi: WETH9_ABI, functionName: 'withdraw', args: [kkubLeft] })
    }

    log(`\n— done —`)
    await reportBalances(publicClient, sender, TOKEN, wrappedNative)
}

// ─── helpers ───────────────────────────────────────────────────────────────────
type PublicClient = ReturnType<typeof createPublicClient>
type WalletClient = ReturnType<typeof createWalletClient>

async function readCurve(publicClient: PublicClient, functionName: string) {
    return publicClient.readContract({
        address: BONDING_CURVE,
        abi: BONDING_CURVE_JUNOSWAP_ABI,
        functionName: functionName as never,
    })
}

async function bal(publicClient: PublicClient, token: Address, who: Address) {
    return (await publicClient.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [who],
    })) as bigint
}

/** Simulate, then broadcast, then wait — returns { receipt, result }. */
function makeCaller(publicClient: PublicClient, walletClient: WalletClient) {
    return async function call(args: {
        address: Address
        abi: unknown
        functionName: string
        args?: unknown[]
        value?: bigint
    }) {
        const params = {
            account: walletClient.account!,
            address: args.address,
            abi: args.abi as never,
            functionName: args.functionName as never,
            args: (args.args ?? []) as never,
            value: args.value,
        }
        const sim = await publicClient.simulateContract(params)
        // graduate()'s full-range V3 mint is gas-heavy and eth_estimateGas sits right
        // at the edge — without a buffer the tx OOGs (we hit this: 529993/530029).
        const est = await publicClient.estimateContractGas(params)
        const hash = await walletClient.writeContract({ ...sim.request, gas: (est * 150n) / 100n })
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success')
            throw new Error(`tx ${hash} reverted (status ${receipt.status})`)
        return { receipt, result: sim.result }
    }
}

async function ensureAllowance(
    publicClient: PublicClient,
    call: ReturnType<typeof makeCaller>,
    sender: Address,
    token: Address,
    spender: Address,
    needed: bigint,
    log: (...a: unknown[]) => void,
) {
    const current = (await publicClient.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [sender, spender],
    })) as bigint
    if (current >= needed) return
    log(`→ approve ${spender.slice(0, 10)}… to spend ${token === TOKEN ? 'TOKEN' : token.slice(0, 10)}…`)
    await call({
        address: token,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spender, MAX_UINT256],
    })
}

async function graduate(ctx: {
    call: ReturnType<typeof makeCaller>
    publicClient: PublicClient
    log: (...a: unknown[]) => void
    EXECUTE: boolean
    TOKEN: Address
}) {
    const { call, publicClient, log, EXECUTE, TOKEN } = ctx
    log(`\n→ graduate(${TOKEN})`)
    if (!EXECUTE) {
        log(c.dim(`   [dry-run] would call BondingCurveJunoswap.graduate() — no state change`))
        return
    }
    const { receipt } = await call({
        address: BONDING_CURVE,
        abi: BONDING_CURVE_JUNOSWAP_ABI,
        functionName: 'graduate',
        args: [TOKEN],
    })
    const ok = (await publicClient.readContract({
        address: BONDING_CURVE,
        abi: BONDING_CURVE_JUNOSWAP_ABI,
        functionName: 'isGraduate',
        args: [TOKEN],
    })) as boolean
    log(`   graduate tx ${receipt.transactionHash}  → isGraduate=${ok}`)
    if (!ok) throw new Error('graduate() returned but isGraduate is still false')
}

function diffBp(a: bigint, b: bigint): bigint {
    if (b === 0n) return 999_999n
    const d = a > b ? a - b : b - a
    return (d * 10_000n) / b
}
function formatBp(a: bigint, b: bigint): string {
    return diffBp(a, b).toString()
}

async function reportBalances(
    publicClient: PublicClient,
    who: Address,
    token: Address,
    wnative: Address,
) {
    const kub = await publicClient.getBalance({ address: who })
    const kkub = await bal(publicClient, wnative, who)
    const tok = await bal(publicClient, token, who)
    log(`KUB=${formatUnits(kub, 18)}  KKUB=${formatUnits(kkub, 18)}  TOKEN=${formatUnits(tok, 18)}`)
}

main().catch((e) => {
    console.error('\n✗', e instanceof Error ? e.message : e)
    process.exit(1)
})
