// Hand-written: the generic ERC-20 ABI used to read/write arbitrary tokens.
//
// It is the generated ERC20Token ABI plus one nonstandard entry: KUSDT on KUB exposes
// `allowances(owner, spender)` (plural) instead of the ERC-20 `allowance`. Call sites choose the
// function name at runtime (getAllowanceFunctionName), so both must exist in a single ABI or the
// read's return type widens and the call fails to encode.
import { ERC20_TOKEN_ABI } from './erc20-token'

const ALLOWANCES_NONSTANDARD = {
    type: 'function',
    name: 'allowances',
    stateMutability: 'view',
    inputs: [
        { name: 'owner', type: 'address', internalType: 'address' },
        { name: 'spender', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
} as const

export const ERC20_ABI = [...ERC20_TOKEN_ABI, ALLOWANCES_NONSTANDARD] as const
