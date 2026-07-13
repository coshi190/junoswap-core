// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "../../src/interfaces/v3-core/IUniswapV3Factory.sol";

contract MockV3Factory is IUniswapV3Factory {
    address public mockPool;
    mapping(bytes32 => address) public pools;

    function setMockPool(address _pool) external {
        mockPool = _pool;
    }

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address) {
        bytes32 key = keccak256(abi.encodePacked(tokenA, tokenB, fee));
        return pools[key];
    }

    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address) {
        bytes32 key = keccak256(abi.encodePacked(tokenA, tokenB, fee));
        pools[key] = mockPool;
        return mockPool;
    }

    function owner() external pure returns (address) {
        return address(0);
    }

    function feeAmountTickSpacing(uint24) external pure returns (int24) {
        return 0;
    }

    function setOwner(address) external pure {}

    function enableFeeAmount(uint24, int24) external pure {}
}
