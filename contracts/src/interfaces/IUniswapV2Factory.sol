// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.19;

interface IUniswapV2Factory {
    /// @dev tokenA and tokenB may be passed in either order.
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}
