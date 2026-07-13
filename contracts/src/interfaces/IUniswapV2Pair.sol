// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.19;

interface IUniswapV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);

    function getReserves()
        external
        view
        returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);

    /// @dev Input must already have been transferred to the pair; the pair credits
    /// `balanceOf(pair) - reserve` as the amount in and enforces the K invariant.
    function swap(
        uint256 amount0Out,
        uint256 amount1Out,
        address to,
        bytes calldata data
    ) external;
}

/// @dev Some V2 forks (udonswap, diamon on chain 96) predate flash swaps and expose
/// `swap` without the trailing `data` argument — a different selector entirely, so the
/// pair must be called through this interface instead.
interface IUniswapV2PairNoData {
    function swap(uint256 amount0Out, uint256 amount1Out, address to) external;
}
