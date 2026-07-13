// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IWETH9.sol";
import "./interfaces/IUniswapV2Pair.sol";
import "./interfaces/IUniswapV2Factory.sol";
import "./interfaces/v3-core/IUniswapV3Pool.sol";
import "./interfaces/v3-core/IUniswapV3Factory.sol";

contract AggRouterJunoswap is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    address public constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    address public immutable WNATIVE;

    uint8 public constant KIND_V2 = 1;
    uint8 public constant KIND_V3 = 2;
    uint8 public constant KIND_V2_NODATA = 3;

    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO =
        1461446703485210103287273052203988822378723970342;

    uint16 public constant MAX_FEE_BPS = 100;

    mapping(address => uint8) public factoryKind;
    mapping(address => uint16) public factoryFeeBps;

    uint16 public feeBps;
    address public feeCollector;

    struct Hop {
        address factory;
        bytes swapData;
    }

    struct Leg {
        uint256 amountIn;
        Hop[] hops;
    }

    struct AggregateParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        address recipient;
        uint256 deadline;
        bool unwrapOut;
        address referrer;
    }

    event Aggregated(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee,
        uint256 legs,
        address referrer
    );
    event FactorySet(address indexed factory, uint8 kind, uint16 feeBps);
    event FeeSet(address indexed collector, uint16 feeBps);

    constructor(address _wrappedNative) {
        require(_wrappedNative != address(0), "bad wnative");
        WNATIVE = _wrappedNative;
    }

    receive() external payable {
        require(msg.sender == WNATIVE, "only wnative");
    }

    function setFactory(address factory, uint8 kind, uint16 dexFeeBps) external onlyOwner {
        require(factory != address(0), "bad factory");
        require(kind == KIND_V2 || kind == KIND_V3 || kind == KIND_V2_NODATA, "bad kind");
        require(
            _isV2(kind) ? (dexFeeBps > 0 && dexFeeBps < 10000) : dexFeeBps == 0,
            "bad fee"
        );
        factoryKind[factory] = kind;
        factoryFeeBps[factory] = dexFeeBps;
        emit FactorySet(factory, kind, dexFeeBps);
    }

    function setFee(address collector, uint16 bps) external onlyOwner {
        require(bps <= MAX_FEE_BPS, "fee too high");
        require(bps == 0 || collector != address(0), "bad collector");
        feeBps = bps;
        feeCollector = collector;
        emit FeeSet(collector, bps);
    }

    function aggregate(AggregateParams calldata p, Leg[] calldata legs)
        external
        payable
        nonReentrant
        returns (uint256 amountOut)
    {
        require(block.timestamp <= p.deadline, "expired");
        require(legs.length > 0, "no legs");
        require(p.recipient != address(0), "bad recipient");

        address tokenInW = _wrapped(p.tokenIn);
        address tokenOutW = _wrapped(p.tokenOut);
        require(tokenInW != tokenOutW, "same token");

        uint256 inBalBefore = IERC20(tokenInW).balanceOf(address(this));

        if (p.tokenIn == NATIVE) {
            require(msg.value == p.amountIn, "bad msg.value");
            IWETH9(WNATIVE).deposit{value: p.amountIn}();
        } else {
            require(msg.value == 0, "unexpected native");
            IERC20(tokenInW).safeTransferFrom(msg.sender, address(this), p.amountIn);
            require(
                IERC20(tokenInW).balanceOf(address(this)) - inBalBefore == p.amountIn,
                "fee-on-transfer"
            );
        }

        {
            uint256 sumIn;
            for (uint256 i; i < legs.length; ++i) {
                sumIn += legs[i].amountIn;
            }
            require(sumIn == p.amountIn, "sum mismatch");
        }

        uint256 fee;
        {
            uint256 outBefore = IERC20(tokenOutW).balanceOf(address(this));

            for (uint256 i; i < legs.length; ++i) {
                _executeLeg(legs[i], tokenInW, tokenOutW);
            }

            amountOut = IERC20(tokenOutW).balanceOf(address(this)) - outBefore;

            fee = (amountOut * feeBps) / 10000;
            amountOut -= fee;
        }

        require(amountOut >= p.minAmountOut, "insufficient output");

        if (fee > 0) IERC20(tokenOutW).safeTransfer(feeCollector, fee);

        if (p.tokenOut == NATIVE && p.unwrapOut) {
            IWETH9(WNATIVE).withdraw(amountOut);
            (bool ok, ) = p.recipient.call{value: amountOut}("");
            require(ok, "native send failed");
        } else {
            IERC20(tokenOutW).safeTransfer(p.recipient, amountOut);
        }

        _refundDust(tokenInW, inBalBefore, p.tokenIn == NATIVE);

        emit Aggregated(
            msg.sender,
            p.tokenIn,
            p.tokenOut,
            p.amountIn,
            amountOut,
            fee,
            legs.length,
            p.referrer
        );
    }

    struct Route {
        address pool;
        address tokenOut;
        uint8 kind;
        uint24 fee;
    }

    function _executeLeg(Leg calldata leg, address tokenInW, address tokenOutW) private {
        uint256 n = leg.hops.length;
        require(n > 0, "no hops");

        address cur = tokenInW;
        uint256 amt = leg.amountIn;
        Route memory r = _resolve(leg.hops[0], cur);

        for (uint256 i; i < n; ++i) {
            address recipient = address(this);
            Route memory next;
            if (i + 1 < n) {
                next = _resolve(leg.hops[i + 1], r.tokenOut);
                if (_isV2(next.kind)) recipient = next.pool;
            }

            if (_isV2(r.kind)) {
                if (i == 0) IERC20(cur).safeTransfer(r.pool, amt);
                amt = _swapV2(leg.hops[i].factory, r, cur, recipient);
            } else {
                amt = _swapV3(leg.hops[i].factory, r, cur, amt, recipient);
            }

            cur = r.tokenOut;
            r = next;
        }

        require(cur == tokenOutW, "leg endpoint");
    }

    function _resolve(Hop calldata hop, address tokenIn)
        private
        view
        returns (Route memory r)
    {
        r.kind = factoryKind[hop.factory];
        if (_isV2(r.kind)) {
            r.tokenOut = abi.decode(hop.swapData, (address));
            r.pool = IUniswapV2Factory(hop.factory).getPair(tokenIn, r.tokenOut);
        } else if (r.kind == KIND_V3) {
            (r.tokenOut, r.fee) = abi.decode(hop.swapData, (address, uint24));
            r.pool = IUniswapV3Factory(hop.factory).getPool(tokenIn, r.tokenOut, r.fee);
        } else {
            revert("factory not registered");
        }
        require(r.tokenOut != tokenIn, "hop same token");
        require(r.pool != address(0), "pool not found");
    }

    function _swapV2(address factory, Route memory r, address tokenIn, address recipient)
        private
        returns (uint256 amountOut)
    {
        address pool = r.pool;
        bool inIsToken0 = tokenIn == IUniswapV2Pair(pool).token0();
        amountOut = _v2AmountOut(factoryFeeBps[factory], pool, tokenIn, inIsToken0);
        require(amountOut > 0, "zero output");

        uint256 amount0Out = inIsToken0 ? 0 : amountOut;
        uint256 amount1Out = inIsToken0 ? amountOut : 0;

        if (r.kind == KIND_V2_NODATA) {
            IUniswapV2PairNoData(pool).swap(amount0Out, amount1Out, recipient);
        } else {
            IUniswapV2Pair(pool).swap(amount0Out, amount1Out, recipient, "");
        }
    }

    function _v2AmountOut(uint256 dexFeeBps, address pool, address tokenIn, bool inIsToken0)
        private
        view
        returns (uint256)
    {
        (uint112 r0, uint112 r1, ) = IUniswapV2Pair(pool).getReserves();
        (uint256 reserveIn, uint256 reserveOut) = inIsToken0
            ? (uint256(r0), uint256(r1))
            : (uint256(r1), uint256(r0));
        uint256 actualIn = IERC20(tokenIn).balanceOf(pool) - reserveIn;
        return _getAmountOut(actualIn, reserveIn, reserveOut, dexFeeBps);
    }

    function _swapV3(
        address factory,
        Route memory r,
        address tokenIn,
        uint256 amountIn,
        address recipient
    ) private returns (uint256 amountOut) {
        require(amountIn <= uint256(type(int256).max), "amount overflow");
        bool zeroForOne = tokenIn < r.tokenOut;
        bytes memory data = abi.encode(factory, tokenIn, r.tokenOut, r.fee, amountIn);

        (int256 a0, int256 a1) = IUniswapV3Pool(r.pool).swap(
            recipient,
            zeroForOne,
            int256(amountIn),
            zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1,
            data
        );

        require(uint256(zeroForOne ? a0 : a1) == amountIn, "v3 partial fill");
        amountOut = uint256(-(zeroForOne ? a1 : a0));
    }

    fallback() external {
        require(msg.data.length >= 4, "bad callback");
        (int256 amount0Delta, int256 amount1Delta, bytes memory data) =
            abi.decode(msg.data[4:], (int256, int256, bytes));
        _swapCallback(amount0Delta, amount1Delta, data);
    }

    function _swapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes memory data
    ) private {
        require(_reentrancyGuardEntered(), "no active swap");
        require(amount0Delta > 0 || amount1Delta > 0, "no payment owed");

        (address factory, address tokenIn, address tokenOut, uint24 fee, uint256 maxPay) =
            abi.decode(data, (address, address, address, uint24, uint256));

        require(factoryKind[factory] == KIND_V3, "kind/factory mismatch");
        require(
            msg.sender == IUniswapV3Factory(factory).getPool(tokenIn, tokenOut, fee),
            "callback not pool"
        );

        uint256 amountOwed = uint256(amount0Delta > 0 ? amount0Delta : amount1Delta);
        require(amountOwed <= maxPay, "overpay");
        IERC20(tokenIn).safeTransfer(msg.sender, amountOwed);
    }

    function _getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 dexFeeBps
    ) private pure returns (uint256) {
        require(amountIn > 0, "zero input");
        require(reserveIn > 0 && reserveOut > 0, "no liquidity");
        uint256 amountInWithFee = amountIn * (10000 - dexFeeBps);
        return (amountInWithFee * reserveOut) / (reserveIn * 10000 + amountInWithFee);
    }

    function _refundDust(address tokenInW, uint256 balBefore, bool nativeIn) private {
        uint256 bal = IERC20(tokenInW).balanceOf(address(this));
        if (bal <= balBefore) return;
        uint256 dust = bal - balBefore;

        if (nativeIn) {
            IWETH9(WNATIVE).withdraw(dust);
            (bool ok, ) = msg.sender.call{value: dust}("");
            require(ok, "dust refund failed");
        } else {
            IERC20(tokenInW).safeTransfer(msg.sender, dust);
        }
    }

    function _wrapped(address token) private view returns (address) {
        return token == NATIVE ? WNATIVE : token;
    }

    function _isV2(uint8 kind) private pure returns (bool) {
        return kind == KIND_V2 || kind == KIND_V2_NODATA;
    }
}
