// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.19;

interface IUniswapV2Factory {
    /// @dev Not called on-chain — declared so the generated ABI can decode it off-chain
    /// (the indexer tracks pair deployments through this event).
    event PairCreated(address indexed token0, address indexed token1, address pair, uint256);

    /// @dev tokenA and tokenB may be passed in either order.
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}
