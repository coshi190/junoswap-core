import type { Address } from 'viem'
import { CHAIN_IDS } from '../configs/dex-config.js'
import { WRAPPED_NATIVE_ADDRESSES } from '../configs/token-addresses.js'

/** Sentinel used across Junoswap to mean "the chain's native coin", not an ERC20. */
export const NATIVE_TOKEN_ADDRESS: Address = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

export function isNativeToken(address: Address): boolean {
    return address.toLowerCase() === NATIVE_TOKEN_ADDRESS
}

export function getWrappedNativeAddress(chainId: number): Address | undefined {
    return WRAPPED_NATIVE_ADDRESSES[chainId]
}

/**
 * Resolves a token to the address a router can actually trade: the native sentinel
 * becomes the chain's wrapped native, everything else passes through untouched.
 * `wnative` overrides the chain default for DEXes that deploy their own wrapper.
 */
export function getSwapAddress(token: Address, chainId: number, wnative?: Address): Address {
    if (!isNativeToken(token)) return token
    return wnative ?? WRAPPED_NATIVE_ADDRESSES[chainId] ?? token
}

export function resolveSwapPath(
    tokens: Address[],
    chainId: number,
    wnative?: Address
): Address[] {
    return tokens.map((token) => getSwapAddress(token, chainId, wnative))
}

export function isWrappedNative(token: Address, chainId: number, wnative?: Address): boolean {
    const wrapped = wnative ?? WRAPPED_NATIVE_ADDRESSES[chainId]
    if (!wrapped) return false
    return token.toLowerCase() === wrapped.toLowerCase()
}

/**
 * A native <-> wrapped-native pair is not a swap at all — it's a WETH9 deposit/withdraw.
 * Returns null for any other pair.
 */
export function getWrapOperation(
    tokenIn: Address,
    tokenOut: Address,
    chainId: number,
    wnative?: Address
): 'wrap' | 'unwrap' | null {
    if (isNativeToken(tokenIn) && isWrappedNative(tokenOut, chainId, wnative)) return 'wrap'
    if (isWrappedNative(tokenIn, chainId, wnative) && isNativeToken(tokenOut)) return 'unwrap'
    return null
}

/**
 * bitkub's KKUB withdraw is permissioned, so a swap to native must stop at the
 * wrapped token and let the user unwrap separately.
 */
const SKIP_UNWRAP_CHAINS: readonly number[] = [CHAIN_IDS.bitkub]

export function shouldSkipUnwrap(chainId: number): boolean {
    return SKIP_UNWRAP_CHAINS.includes(chainId)
}
