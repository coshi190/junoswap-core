import { zeroAddress, type Address } from 'viem'
import { CHAIN_IDS } from './dex-config.js'

interface Deployment {
    address: Address
    startBlock: number
}

export const BONDING_CURVE_DEPLOYMENTS: Record<number, Deployment> = {
    [CHAIN_IDS.kubTestnet]: {
        address: '0x77e5D3fC554e30aceFd5322ca65beE15ee6E39a9',
        startBlock: 29065000,
    },
    [CHAIN_IDS.bitkub]: {
        address: '0x65F6EC30A9E70822721585f6Bba15c40c2F8ab4e',
        startBlock: 32995517,
    },
}

export const AGG_ROUTER_DEPLOYMENTS: Record<number, Deployment> = {
    [CHAIN_IDS.bitkub]: {
        address: '0x869A40921A332e0D79300F91361A3DC77F2a0ebc',
        startBlock: 32685221,
    },
}

/**
 * Default launchpad chain — the fallback when no wallet is connected, and for server paths
 * with no connected chain. Client code should prefer the connected chainId and resolve
 * through getBondingCurveAddress().
 */
export const BONDING_CURVE_JUNOSWAP_CHAIN_ID = CHAIN_IDS.kubTestnet

/**
 * Returns the bonding-curve address for a chain, or undefined if the chain has no configured
 * (non-zero) deployment. The zero-address guard keeps a chain inactive until its real address
 * is filled in above.
 */
export function getBondingCurveAddress(chainId: number): Address | undefined {
    const address = BONDING_CURVE_DEPLOYMENTS[chainId]?.address
    return address && address !== zeroAddress ? address : undefined
}

export function isLaunchpadChain(chainId: number): boolean {
    return getBondingCurveAddress(chainId) !== undefined
}

/** Chains with an active (deployed) launchpad, for callers that enumerate them. */
export const LAUNCHPAD_CHAIN_IDS: number[] = Object.keys(BONDING_CURVE_DEPLOYMENTS)
    .map(Number)
    .filter(isLaunchpadChain)

/**
 * Lowercased bonding-curve addresses by chain. Log/event addresses arrive lowercased, so
 * comparing them against the checksummed values above would never match.
 */
export const BONDING_CURVE_ADDRESS_BY_CHAIN: Record<number, string> = Object.fromEntries(
    Object.entries(BONDING_CURVE_DEPLOYMENTS).map(([chainId, { address }]) => [
        Number(chainId),
        address.toLowerCase(),
    ])
)

export function getAggRouterAddress(chainId: number): Address | undefined {
    const address = AGG_ROUTER_DEPLOYMENTS[chainId]?.address
    return address && address !== zeroAddress ? address : undefined
}

export function isAggRouterChain(chainId: number): boolean {
    return getAggRouterAddress(chainId) !== undefined
}
