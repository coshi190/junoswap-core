import { formatEther } from 'viem'
import { describe, it, expect } from 'vitest'
import {
    calculateBuyOutput,
    calculateSellOutput,
    calculateGraduationProgress,
    calculateExactGraduationReserve,
    calculateStableGraduationProgress,
    isReadyToGraduate,
    isSqrtPriceWithinTolerance,
    calculateGraduationSqrtPriceX96,
    INITIAL_TOKEN_SUPPLY,
} from '../launchpad/bonding-curve.js'

describe('calculateBuyOutput', () => {
    it('returns 0n when nativeAmountIn is 0n', () => {
        expect(calculateBuyOutput(0n, 100n, 1000n, 500n)).toBe(0n)
    })

    it('returns 0n when tokenReserve is 0n', () => {
        expect(calculateBuyOutput(100n, 100n, 0n, 500n)).toBe(0n)
    })

    it('returns 0n for negative nativeAmountIn', () => {
        expect(calculateBuyOutput(-1n, 100n, 1000n, 500n)).toBe(0n)
    })

    it('calculates output with 1% fee applied', () => {
        // nativeAmountIn=10000n, nativeReserve=100000n, tokenReserve=800000n, virtualAmount=200000n
        // feeAmount = 10000 * 100 / 10000 = 100
        // amountAfterFee = 9900
        // inputReserve = 200000 + 100000 = 300000
        // output = getAmountOut(9900, 300000, 800000)
        const result = calculateBuyOutput(10000n, 100000n, 800000n, 200000n)
        expect(result).toBeGreaterThan(0n)
    })

    it('charges both the pump fee and the curve fee', () => {
        // The contract deducts pumpFee (1%) in buy(), then getAmountOut takes another 1% via
        // the *99/100 term. A fee-free constant-product quote on the same reserves must
        // therefore come out meaningfully higher than what we return.
        const nativeIn = 10n ** 18n
        const nativeReserve = 100n * 10n ** 18n
        const tokenReserve = 800_000_000n * 10n ** 18n
        const virtualAmount = 3400n * 10n ** 18n

        const actual = calculateBuyOutput(nativeIn, nativeReserve, tokenReserve, virtualAmount)
        const feeFree =
            (tokenReserve * nativeIn) / (virtualAmount + nativeReserve + nativeIn)

        expect(actual).toBeLessThan(feeFree)
        // ~2% all-in: allow a band so curve curvature on this size doesn't make it brittle.
        const lossBps = Number(((feeFree - actual) * 10000n) / feeFree)
        expect(lossBps).toBeGreaterThan(150)
        expect(lossBps).toBeLessThan(250)
    })
})

describe('calculateSellOutput', () => {
    it('returns 0n when tokenAmountIn is 0n', () => {
        expect(calculateSellOutput(0n, 100n, 1000n, 500n)).toBe(0n)
    })

    it('returns 0n when tokenReserve is 0n', () => {
        expect(calculateSellOutput(100n, 100n, 0n, 500n)).toBe(0n)
    })

    it('returns 0n when nativeReserve is 0n', () => {
        expect(calculateSellOutput(100n, 0n, 1000n, 500n)).toBe(0n)
    })

    it('calculates output with 1% fee applied', () => {
        const result = calculateSellOutput(10000n, 100000n, 800000n, 200000n)
        expect(result).toBeGreaterThan(0n)
    })
})

describe('calculateGraduationProgress', () => {
    it('returns 0 when graduation amount is 0', () => {
        expect(calculateGraduationProgress(100n, INITIAL_TOKEN_SUPPLY, 0n)).toBe(0)
    })

    it('returns 0 when token reserve is 0', () => {
        expect(calculateGraduationProgress(100n, 0n, 4000n)).toBe(0)
    })

    it('calculates percentage correctly using ratio', () => {
        // 25% progress: nativeReserve = 1000, tokenReserve = INITIAL_TOKEN_SUPPLY, graduationAmount = 4000
        // progress = (INITIAL_TOKEN_SUPPLY * 1000 * 100) / (INITIAL_TOKEN_SUPPLY * 4000) = 25
        expect(calculateGraduationProgress(1000n, INITIAL_TOKEN_SUPPLY, 4000n)).toBe(25)
        expect(calculateGraduationProgress(2000n, INITIAL_TOKEN_SUPPLY, 4000n)).toBe(50)
    })

    it('caps at 100', () => {
        expect(calculateGraduationProgress(8000n, INITIAL_TOKEN_SUPPLY, 4000n)).toBe(100)
    })
})

describe('calculateExactGraduationReserve', () => {
    it('returns graduationAmount unchanged when virtualAmount is 0', () => {
        const graduationAmount = 4000n * 10n ** 18n
        expect(calculateExactGraduationReserve(0n, graduationAmount)).toBe(graduationAmount)
    })

    it('returns graduationAmount unchanged when graduationAmount is 0', () => {
        expect(calculateExactGraduationReserve(3400n * 10n ** 18n, 0n)).toBe(0n)
    })

    it('solves close to the analytically-derived production estimate (~2369.9 ether)', () => {
        const virtualAmount = 3400n * 10n ** 18n
        const graduationAmount = 4000n * 10n ** 18n
        const result = calculateExactGraduationReserve(virtualAmount, graduationAmount)
        const resultEther = Number(formatEther(result))
        expect(resultEther).toBeGreaterThan(2365)
        expect(resultEther).toBeLessThan(2375)
    })

    it('is always strictly below the nominal graduationAmount ceiling', () => {
        const virtualAmount = 3400n * 10n ** 18n
        const graduationAmount = 4000n * 10n ** 18n
        const result = calculateExactGraduationReserve(virtualAmount, graduationAmount)
        expect(result).toBeGreaterThan(0n)
        expect(result).toBeLessThan(graduationAmount)
    })
})

describe('calculateStableGraduationProgress', () => {
    it('returns 0 when exactTarget is 0', () => {
        expect(calculateStableGraduationProgress(1000n, 0n)).toBe(0)
    })

    it('computes percentage against a fixed (non-shrinking) target', () => {
        const exactTarget = 4000n * 10n ** 18n
        expect(calculateStableGraduationProgress(1000n * 10n ** 18n, exactTarget)).toBe(25)
        expect(calculateStableGraduationProgress(2000n * 10n ** 18n, exactTarget)).toBe(50)
    })

    it('caps at 100 even when nativeReserve exceeds the target', () => {
        const exactTarget = 4000n * 10n ** 18n
        expect(calculateStableGraduationProgress(8000n * 10n ** 18n, exactTarget)).toBe(100)
    })
})

describe('isReadyToGraduate', () => {
    // Mirrors BondingCurveJunoswap.graduate's check:
    //   floor(token/native) <= floor(INITIALTOKEN / graduationAmount)
    // Cross-multiplied (no float) as:
    //   token * graduationAmount <= INITIAL_TOKEN_SUPPLY * native
    // INITIALTOKEN is constant: 1B tokens × 1e18.
    const ONE_ETHER = 10n ** 18n
    const CAP_150 = 150n * ONE_ETHER
    const CAP_200 = 200n * ONE_ETHER

    it('returns false when isGraduated is true', () => {
        // Even at reserves that would otherwise qualify, a graduated token is not "ready".
        expect(isReadyToGraduate(CAP_150, INITIAL_TOKEN_SUPPLY, CAP_150, true)).toBe(false)
    })

    it('returns false when graduationAmount is 0n', () => {
        // Defensive: contract would panic (division by zero) in this state.
        expect(isReadyToGraduate(CAP_150, INITIAL_TOKEN_SUPPLY, 0n, false)).toBe(false)
    })

    it('returns false when nativeReserve is 0 and tokenReserve is positive', () => {
        // Contract would panic (division by zero) — UI must say "not ready".
        expect(isReadyToGraduate(0n, INITIAL_TOKEN_SUPPLY, CAP_150, false)).toBe(false)
    })

    it('returns true at the equilibrium point (nativeReserve == cap, tokenReserve == INITIAL_TOKEN_SUPPLY)', () => {
        expect(isReadyToGraduate(CAP_150, INITIAL_TOKEN_SUPPLY, CAP_150, false)).toBe(true)
    })

    it('returns false one wei below the cap on nativeReserve', () => {
        // UI is stricter than the contract at this boundary (the contract's floored
        // division would still allow, but we want the button disabled — better to
        // make the user buy one more wei than to revert).
        expect(isReadyToGraduate(CAP_150 - 1n, INITIAL_TOKEN_SUPPLY, CAP_150, false)).toBe(false)
    })

    it('matches the contract for a non-150 cap (regression for the hardcoded-cap bug)', () => {
        // With a 200-ether cap and 200 KUB in reserves, the token is ready.
        expect(isReadyToGraduate(CAP_200, INITIAL_TOKEN_SUPPLY, CAP_200, false)).toBe(true)

        // With a 200-ether cap and only 150 KUB in reserves, the token is NOT ready
        // (150/200 < 1, so the ratio token/native = 1B/150 is above 1B/200).
        // The old hardcoded cap of 150 ether would have said TRUE here — that was
        // the bug. This assertion would have failed pre-fix.
        expect(isReadyToGraduate(CAP_150, INITIAL_TOKEN_SUPPLY, CAP_200, false)).toBe(false)
    })

    it('returns false when the contract would revert with "not reach graduation cap"', () => {
        // token/native = 1B/100 = 10M, threshold = floor(1B/150) = 6_666_666.
        // 10M > 6_666_666 → contract reverts. UI must agree.
        expect(isReadyToGraduate(100n * ONE_ETHER, INITIAL_TOKEN_SUPPLY, CAP_150, false)).toBe(
            false
        )
    })

    it('returns true for the stuck-token scenario (past cap, contract sqrt-bug blocks init)', () => {
        // Real on-chain values from a token stuck at graduation because of the
        // Math.sqrt integer-division bug in BondingCurveJunoswap.initialize. The ratio
        // check passes (the rescue flow in useGraduate handles the init bug).
        // 4010 KUB / 461M tokens with 150-ether cap.
        const nativeReserve = 4009_500000000000000000n // 4009.5 KUB
        const tokenReserve = 461_366_962461691276297068760n // ~461M tokens
        expect(isReadyToGraduate(nativeReserve, tokenReserve, CAP_150, false)).toBe(true)
    })
})

describe('isSqrtPriceWithinTolerance', () => {
    const TARGET = 1_000_000n

    it('returns false for a non-positive target', () => {
        // No meaningful band around zero — callers must treat this as "cannot compare".
        expect(isSqrtPriceWithinTolerance(1n, 0n, 400n)).toBe(false)
    })

    it('accepts drift in either direction within the band', () => {
        // 4% of 1_000_000 = 40_000.
        expect(isSqrtPriceWithinTolerance(TARGET + 39_999n, TARGET, 400n)).toBe(true)
        expect(isSqrtPriceWithinTolerance(TARGET - 39_999n, TARGET, 400n)).toBe(true)
    })

    it('is inclusive at the band edge', () => {
        expect(isSqrtPriceWithinTolerance(TARGET + 40_000n, TARGET, 400n)).toBe(true)
    })

    it('rejects one wei past the band', () => {
        expect(isSqrtPriceWithinTolerance(TARGET + 40_001n, TARGET, 400n)).toBe(false)
    })
})

describe('calculateGraduationSqrtPriceX96', () => {
    // Real stuck-token reserves: tokenAddr < wrappedNative, the ordering that shipped a bad pool.
    const tokenAddr = '0x3671E189BFb60fB434A902F2274f6546FCE779db' as `0x${string}`
    const wrappedNative = '0x700D3ba307E1256e509eD3E45D6f9dff441d6907' as `0x${string}`
    const nativeReserve = 4009500000000000000000n // ~4010 KUB
    const tokenReserve = 461366962461691276297068760n // ~461M tokens

    it('stays non-zero where the contract formula truncated to 0', () => {
        expect(
            calculateGraduationSqrtPriceX96(tokenAddr, wrappedNative, nativeReserve, tokenReserve)
        ).toBeGreaterThan(0n)
    })

    it('matches the value the rescue script computed for the stuck token', () => {
        expect(
            calculateGraduationSqrtPriceX96(tokenAddr, wrappedNative, nativeReserve, tokenReserve)
        ).toBe(233561602564036164489853658n)
    })

    it('clamps to uint160, the type the pool accepts', () => {
        const result = calculateGraduationSqrtPriceX96(
            tokenAddr,
            wrappedNative,
            nativeReserve,
            tokenReserve
        )
        expect(result).toBeLessThanOrEqual((1n << 160n) - 1n)
    })

    it('inverts the ratio when tokenAddr sorts above wrappedNative', () => {
        const highAddr = '0x99999999990FC47611b74827486218f3398A4abD' as `0x${string}`
        const low = calculateGraduationSqrtPriceX96(
            tokenAddr,
            wrappedNative,
            nativeReserve,
            tokenReserve
        )
        const high = calculateGraduationSqrtPriceX96(
            highAddr,
            wrappedNative,
            nativeReserve,
            tokenReserve
        )
        expect(high).toBeGreaterThan(0n)
        expect(high).not.toBe(low)
    })

    it('throws for zero reserves', () => {
        expect(() =>
            calculateGraduationSqrtPriceX96(tokenAddr, wrappedNative, 0n, tokenReserve)
        ).toThrow('Invalid reserves')
        expect(() =>
            calculateGraduationSqrtPriceX96(tokenAddr, wrappedNative, nativeReserve, 0n)
        ).toThrow('Invalid reserves')
    })

    it('depends only on the reserve ratio, not its magnitude', () => {
        expect(calculateGraduationSqrtPriceX96(tokenAddr, wrappedNative, 1000n, 2000n)).toBe(
            calculateGraduationSqrtPriceX96(tokenAddr, wrappedNative, 1000000n, 2000000n)
        )
    })
})
