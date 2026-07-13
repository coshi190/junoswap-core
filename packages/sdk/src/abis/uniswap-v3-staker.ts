// Hand-written: no Solidity source for this contract in contracts/src (we only call it).
/**
 * Uniswap V3 Staker ABI
 * Contract for staking Uniswap V3 LP positions to earn rewards
 * https://github.com/Uniswap/v3-staker
 */
export const UNISWAP_V3_STAKER_ABI = [
    // Stake a deposited NFT into an incentive
    {
        type: 'function',
        name: 'stakeToken',
        stateMutability: 'nonpayable',
        inputs: [
            {
                name: 'key',
                type: 'tuple',
                components: [
                    { name: 'rewardToken', type: 'address' },
                    { name: 'pool', type: 'address' },
                    { name: 'startTime', type: 'uint256' },
                    { name: 'endTime', type: 'uint256' },
                    { name: 'refundee', type: 'address' },
                ],
            },
            { name: 'tokenId', type: 'uint256' },
        ],
        outputs: [],
    },

    // Unstake a staked NFT from an incentive
    {
        type: 'function',
        name: 'unstakeToken',
        stateMutability: 'nonpayable',
        inputs: [
            {
                name: 'key',
                type: 'tuple',
                components: [
                    { name: 'rewardToken', type: 'address' },
                    { name: 'pool', type: 'address' },
                    { name: 'startTime', type: 'uint256' },
                    { name: 'endTime', type: 'uint256' },
                    { name: 'refundee', type: 'address' },
                ],
            },
            { name: 'tokenId', type: 'uint256' },
        ],
        outputs: [],
    },

    // Claim accumulated rewards
    {
        type: 'function',
        name: 'claimReward',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'rewardToken', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'amountRequested', type: 'uint256' },
        ],
        outputs: [{ name: 'reward', type: 'uint256' }],
    },

    // Withdraw a deposited NFT (must be unstaked first)
    {
        type: 'function',
        name: 'withdrawToken',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'tokenId', type: 'uint256' },
            { name: 'to', type: 'address' },
            { name: 'data', type: 'bytes' },
        ],
        outputs: [],
    },

    // Transfer ownership of a deposited NFT
    {
        type: 'function',
        name: 'transferDeposit',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'tokenId', type: 'uint256' },
            { name: 'to', type: 'address' },
        ],
        outputs: [],
    },

    // Create a new incentive
    {
        type: 'function',
        name: 'createIncentive',
        stateMutability: 'nonpayable',
        inputs: [
            {
                name: 'key',
                type: 'tuple',
                components: [
                    { name: 'rewardToken', type: 'address' },
                    { name: 'pool', type: 'address' },
                    { name: 'startTime', type: 'uint256' },
                    { name: 'endTime', type: 'uint256' },
                    { name: 'refundee', type: 'address' },
                ],
            },
            { name: 'reward', type: 'uint256' },
        ],
        outputs: [],
    },

    // End an incentive and refund remaining rewards
    {
        type: 'function',
        name: 'endIncentive',
        stateMutability: 'nonpayable',
        inputs: [
            {
                name: 'key',
                type: 'tuple',
                components: [
                    { name: 'rewardToken', type: 'address' },
                    { name: 'pool', type: 'address' },
                    { name: 'startTime', type: 'uint256' },
                    { name: 'endTime', type: 'uint256' },
                    { name: 'refundee', type: 'address' },
                ],
            },
        ],
        outputs: [{ name: 'refund', type: 'uint256' }],
    },

    // Multicall for batching transactions
    {
        type: 'function',
        name: 'multicall',
        stateMutability: 'payable',
        inputs: [{ name: 'data', type: 'bytes[]' }],
        outputs: [{ name: 'results', type: 'bytes[]' }],
    },

    // Get reward info for a staked position
    {
        type: 'function',
        name: 'getRewardInfo',
        stateMutability: 'view',
        inputs: [
            {
                name: 'key',
                type: 'tuple',
                components: [
                    { name: 'rewardToken', type: 'address' },
                    { name: 'pool', type: 'address' },
                    { name: 'startTime', type: 'uint256' },
                    { name: 'endTime', type: 'uint256' },
                    { name: 'refundee', type: 'address' },
                ],
            },
            { name: 'tokenId', type: 'uint256' },
        ],
        outputs: [
            { name: 'reward', type: 'uint256' },
            { name: 'secondsInsideX128', type: 'uint160' },
        ],
    },

    // Get deposit info for a token
    {
        type: 'function',
        name: 'deposits',
        stateMutability: 'view',
        inputs: [{ name: 'tokenId', type: 'uint256' }],
        outputs: [
            { name: 'owner', type: 'address' },
            { name: 'numberOfStakes', type: 'uint48' },
            { name: 'tickLower', type: 'int24' },
            { name: 'tickUpper', type: 'int24' },
        ],
    },

    // Get incentive info by ID
    {
        type: 'function',
        name: 'incentives',
        stateMutability: 'view',
        inputs: [{ name: 'incentiveId', type: 'bytes32' }],
        outputs: [
            { name: 'totalRewardUnclaimed', type: 'uint256' },
            { name: 'totalSecondsClaimedX128', type: 'uint160' },
            { name: 'numberOfStakes', type: 'uint96' },
        ],
    },

    // Get stake info for a position in an incentive
    {
        type: 'function',
        name: 'stakes',
        stateMutability: 'view',
        inputs: [
            { name: 'tokenId', type: 'uint256' },
            { name: 'incentiveId', type: 'bytes32' },
        ],
        outputs: [
            { name: 'secondsPerLiquidityInsideInitialX128', type: 'uint160' },
            { name: 'liquidity', type: 'uint128' },
        ],
    },

    // Get claimable rewards for an owner
    {
        type: 'function',
        name: 'rewards',
        stateMutability: 'view',
        inputs: [
            { name: 'rewardToken', type: 'address' },
            { name: 'owner', type: 'address' },
        ],
        outputs: [{ name: 'rewardsOwed', type: 'uint256' }],
    },

    // Get the NonfungiblePositionManager address
    {
        type: 'function',
        name: 'nonfungiblePositionManager',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'address' }],
    },

    // Get the factory address
    {
        type: 'function',
        name: 'factory',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'address' }],
    },

    // Get max incentive duration
    {
        type: 'function',
        name: 'maxIncentiveDuration',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'uint256' }],
    },

    // Get max incentive start lead time
    {
        type: 'function',
        name: 'maxIncentiveStartLeadTime',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'uint256' }],
    },

    {
        type: 'event',
        name: 'IncentiveCreated',
        inputs: [
            { name: 'rewardToken', type: 'address', indexed: true },
            { name: 'pool', type: 'address', indexed: true },
            { name: 'startTime', type: 'uint256', indexed: false },
            { name: 'endTime', type: 'uint256', indexed: false },
            { name: 'refundee', type: 'address', indexed: false },
            { name: 'reward', type: 'uint256', indexed: false },
        ],
    },

    {
        type: 'event',
        name: 'IncentiveEnded',
        inputs: [
            { name: 'incentiveId', type: 'bytes32', indexed: true },
            { name: 'refund', type: 'uint256', indexed: false },
        ],
    },

    {
        type: 'event',
        name: 'DepositTransferred',
        inputs: [
            { name: 'tokenId', type: 'uint256', indexed: true },
            { name: 'oldOwner', type: 'address', indexed: true },
            { name: 'newOwner', type: 'address', indexed: true },
        ],
    },

    {
        type: 'event',
        name: 'TokenStaked',
        inputs: [
            { name: 'tokenId', type: 'uint256', indexed: true },
            { name: 'incentiveId', type: 'bytes32', indexed: true },
            { name: 'liquidity', type: 'uint128', indexed: false },
        ],
    },

    {
        type: 'event',
        name: 'TokenUnstaked',
        inputs: [
            { name: 'tokenId', type: 'uint256', indexed: true },
            { name: 'incentiveId', type: 'bytes32', indexed: true },
        ],
    },

    {
        type: 'event',
        name: 'RewardClaimed',
        inputs: [
            { name: 'to', type: 'address', indexed: true },
            { name: 'reward', type: 'uint256', indexed: false },
        ],
    },
] as const

/**
 * IncentiveKey type for TypeScript
 */
