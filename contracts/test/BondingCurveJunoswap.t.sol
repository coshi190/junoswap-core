// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "forge-std/Test.sol";
import "../src/BondingCurveJunoswap.sol";
import "../src/ERC20Token.sol";
import "./mocks/MockV3Factory.sol";
import "./mocks/MockV3Pool.sol";
import "./mocks/MockPositionManager.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract BondingCurveJunoswapTest is Test {
    // Local event definitions for vm.expectEmit
    event Swap(
        address indexed sender,
        bool indexed isBuy,
        address indexed tokenAddr,
        uint256 amountIn,
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut
    );
    event Creation(
        address indexed creator,
        address tokenAddr,
        string logo,
        string description,
        string link1,
        string link2,
        string link3,
        uint256 createdTime
    );
    event Graduation(address indexed sender, address tokenAddr);

    BondingCurveJunoswap public pump;
    MockV3Factory public factory;
    MockV3Pool public pool;
    MockPositionManager public posManager;

    address public feeCollector;
    address public alice;
    address public bob;
    address public wrappedNative;

    uint256 constant CREATE_FEE = 0.001 ether;
    uint256 constant INITIAL_NATIVE = 0.05 ether;
    uint256 constant VIRTUAL_AMOUNT = 0.5 ether;
    uint256 constant GRADUATION_AMOUNT = 0.2 ether;
    uint256 constant PUMP_FEE = 100; // 1% in basis points
    uint256 constant INITIALTOKEN = 1_000_000_000 ether;

    // Uniswap V3 TickMath price bounds (valid initialize() range)
    uint160 constant MIN_SQRT_RATIO = 4295128739;
    uint160 constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    // Required so BondingCurveJunoswap can transfer ETH fees to this contract
    receive() external payable {}

    function setUp() public {
        factory = new MockV3Factory();
        pool = new MockV3Pool();
        posManager = new MockPositionManager();

        feeCollector = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        wrappedNative = address(0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF);

        factory.setMockPool(address(pool));
        posManager.setWrappedNative(wrappedNative);
        pump = new BondingCurveJunoswap(
            wrappedNative,
            address(factory),
            address(posManager)
        );
        pump.setCurveState(INITIAL_NATIVE, VIRTUAL_AMOUNT, GRADUATION_AMOUNT);
        pump.setFee(CREATE_FEE, PUMP_FEE);

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    // ─── Helpers ───────────────────────────────────────────────────

    function _createToken() internal returns (address) {
        return _createTokenAs(alice);
    }

    function _createTokenAs(address user) internal returns (address) {
        vm.prank(user);
        return pump.createToken{value: CREATE_FEE + INITIAL_NATIVE}(
            "TestToken", "TT", "logo", "desc", "link1", "link2", "link3"
        );
    }

    function _computeBuyOutput(uint256 msgValue, address tokenAddr)
        internal
        view
        returns (uint256)
    {
        uint256 feeAmount = (msgValue * pump.pumpFee()) / 10000;
        uint256 amountInAfterFee = msgValue - feeAmount;
        (uint256 nativeReserve, uint256 tokenReserve) =
            pump.pumpReserve(tokenAddr);
        return pump.getAmountOut(
            amountInAfterFee,
            pump.virtualAmount() + nativeReserve,
            tokenReserve
        );
    }

    function _computeSellOutput(uint256 tokenSold, address tokenAddr)
        internal
        view
        returns (uint256)
    {
        uint256 feeAmount = (tokenSold * pump.pumpFee()) / 10000;
        uint256 amountInAfterFee = tokenSold - feeAmount;
        (uint256 nativeReserve, uint256 tokenReserve) =
            pump.pumpReserve(tokenAddr);
        return pump.getAmountOut(
            amountInAfterFee,
            tokenReserve,
            pump.virtualAmount() + nativeReserve
        );
    }

    // ─── setFeeCollector ───────────────────────────────────────────

    function test_RevertSetFeeCollector_NonFeeCollector() public {
        vm.prank(alice);
        vm.expectRevert();
        pump.setFeeCollector(bob);
    }

    function test_NewFeeCollectorCanCallAdminFunctions() public {
        pump.setFeeCollector(alice);

        // New feeCollector can call admin
        vm.prank(alice);
        pump.setFee(0, 0);

        // Old feeCollector can no longer call admin
        vm.expectRevert();
        pump.setFee(1, 1);
    }

    // ─── createToken ───────────────────────────────────────────────

    function test_CreateToken_SetsReserves() public {
        address tokenAddr = _createToken();
        (uint256 nativeReserve, uint256 tokenReserve) =
            pump.pumpReserve(tokenAddr);
        assertEq(nativeReserve, INITIAL_NATIVE);
        assertEq(tokenReserve, INITIALTOKEN);
    }

    function test_CreateToken_TransfersFeeToCollector() public {
        uint256 balBefore = feeCollector.balance;
        _createToken();
        assertEq(feeCollector.balance - balBefore, CREATE_FEE);
    }

    function test_RevertCreateToken_WrongValue() public {
        // Too little
        vm.prank(alice);
        vm.expectRevert("insufficient creation cost");
        pump.createToken{value: CREATE_FEE + INITIAL_NATIVE - 1}(
            "T", "T", "", "", "", "", ""
        );

        // Too much
        vm.prank(alice);
        vm.expectRevert("insufficient creation cost");
        pump.createToken{value: CREATE_FEE + INITIAL_NATIVE + 1}(
            "T", "T", "", "", "", "", ""
        );
    }

    // ─── buy ───────────────────────────────────────────────────────

    function test_Buy_CalculatesCorrectOutput() public {
        address tokenAddr = _createToken();
        uint256 buyAmount = 0.1 ether;

        // Compute expected BEFORE the buy (reserves change during buy)
        uint256 expected = _computeBuyOutput(buyAmount, tokenAddr);

        vm.prank(alice);
        uint256 amountOut = pump.buy{value: buyAmount}(tokenAddr, 0);

        assertEq(amountOut, expected);
    }

    function test_Buy_UpdatesReserves() public {
        address tokenAddr = _createToken();
        uint256 buyAmount = 0.1 ether;

        (uint256 nativeBefore, uint256 tokenBefore) =
            pump.pumpReserve(tokenAddr);

        vm.prank(alice);
        uint256 amountOut = pump.buy{value: buyAmount}(tokenAddr, 0);

        uint256 feeAmount = (buyAmount * PUMP_FEE) / 10000;
        uint256 amountInAfterFee = buyAmount - feeAmount;

        (uint256 nativeAfter, uint256 tokenAfter) =
            pump.pumpReserve(tokenAddr);

        assertEq(nativeAfter, nativeBefore + amountInAfterFee);
        assertEq(tokenAfter, tokenBefore - amountOut);
    }

    function test_Buy_TransfersTokensToBuyer() public {
        address tokenAddr = _createToken();
        uint256 buyAmount = 0.1 ether;

        vm.prank(alice);
        uint256 amountOut = pump.buy{value: buyAmount}(tokenAddr, 0);

        assertEq(ERC20Token(tokenAddr).balanceOf(alice), amountOut);
    }

    function test_Buy_TransfersFeeToFeeCollector() public {
        address tokenAddr = _createToken();
        uint256 buyAmount = 0.1 ether;
        uint256 balBefore = feeCollector.balance;

        vm.prank(alice);
        pump.buy{value: buyAmount}(tokenAddr, 0);

        uint256 expectedFee = (buyAmount * PUMP_FEE) / 10000;
        assertEq(feeCollector.balance - balBefore, expectedFee);
    }

    function test_Buy_EmitsSwapEvent() public {
        address tokenAddr = _createToken();
        uint256 buyAmount = 0.1 ether;

        uint256 feeAmount = (buyAmount * PUMP_FEE) / 10000;
        uint256 amountInAfterFee = buyAmount - feeAmount;
        uint256 expectedOut = _computeBuyOutput(buyAmount, tokenAddr);

        // Compute expected reserves after buy
        (uint256 nativeBefore, uint256 tokenBefore) =
            pump.pumpReserve(tokenAddr);
        uint256 expectedNativeAfter = nativeBefore + amountInAfterFee;
        uint256 expectedTokenAfter = tokenBefore - expectedOut;

        vm.expectEmit(true, true, true, true);
        emit Swap(
            alice, true, tokenAddr, amountInAfterFee, expectedOut,
            expectedNativeAfter, expectedTokenAfter
        );

        vm.prank(alice);
        pump.buy{value: buyAmount}(tokenAddr, 0);
    }

    function test_RevertBuy_InsufficientOutput() public {
        address tokenAddr = _createToken();
        vm.prank(alice);
        vm.expectRevert("insufficient output amount");
        pump.buy{value: 0.1 ether}(tokenAddr, type(uint256).max);
    }

    function test_RevertBuy_GraduatedToken() public {
        address tokenAddr = _createToken();
        _graduateToken(tokenAddr);

        vm.prank(alice);
        vm.expectRevert("token already graduated");
        pump.buy{value: 0.1 ether}(tokenAddr, 0);
    }

    function test_Buy_MultipleBuysUpdateProgressively() public {
        address tokenAddr = _createToken();
        uint256 buyAmount = 0.05 ether;

        // First buy by alice
        vm.prank(alice);
        uint256 aliceOut = pump.buy{value: buyAmount}(tokenAddr, 0);

        // Second buy by bob
        vm.prank(bob);
        uint256 bobOut = pump.buy{value: buyAmount}(tokenAddr, 0);

        // Bob should get less than alice because reserves moved
        assertLt(bobOut, aliceOut);

        // Verify total reserves
        (uint256 nativeReserve, uint256 tokenReserve) =
            pump.pumpReserve(tokenAddr);

        uint256 totalFeeAlice = (buyAmount * PUMP_FEE) / 10000;
        uint256 totalFeeBob = (buyAmount * PUMP_FEE) / 10000;
        assertEq(
            nativeReserve,
            INITIAL_NATIVE + (buyAmount - totalFeeAlice) + (buyAmount - totalFeeBob)
        );
        assertEq(tokenReserve, INITIALTOKEN - aliceOut - bobOut);
    }

    // ─── sell ──────────────────────────────────────────────────────

    function test_Sell_CalculatesCorrectOutput() public {
        address tokenAddr = _setupSell();

        uint256 sellAmount = 1000 ether;

        // Compute expected BEFORE the sell (reserves change during sell)
        uint256 expected = _computeSellOutput(sellAmount, tokenAddr);

        vm.prank(alice);
        uint256 amountOut = pump.sell(tokenAddr, sellAmount, 0);

        assertEq(amountOut, expected);
    }

    function test_Sell_UpdatesReserves() public {
        address tokenAddr = _setupSell();

        (uint256 nativeBefore, uint256 tokenBefore) =
            pump.pumpReserve(tokenAddr);

        uint256 sellAmount = 1000 ether;
        vm.prank(alice);
        uint256 amountOut = pump.sell(tokenAddr, sellAmount, 0);

        uint256 feeAmount = (sellAmount * PUMP_FEE) / 10000;
        uint256 amountInAfterFee = sellAmount - feeAmount;

        (uint256 nativeAfter, uint256 tokenAfter) =
            pump.pumpReserve(tokenAddr);

        assertEq(nativeAfter, nativeBefore - amountOut);
        assertEq(tokenAfter, tokenBefore + amountInAfterFee);
    }

    function test_Sell_TransfersNativeToSeller() public {
        address tokenAddr = _setupSell();

        uint256 sellAmount = 1000 ether;
        uint256 balBefore = alice.balance;

        vm.prank(alice);
        uint256 amountOut = pump.sell(tokenAddr, sellAmount, 0);

        assertEq(alice.balance - balBefore, amountOut);
    }

    function test_Sell_TransfersTokenFeeToFeeCollector() public {
        address tokenAddr = _setupSell();

        uint256 sellAmount = 1000 ether;
        uint256 feeCollectorBalBefore = ERC20Token(tokenAddr).balanceOf(feeCollector);

        vm.prank(alice);
        pump.sell(tokenAddr, sellAmount, 0);

        uint256 expectedFee = (sellAmount * PUMP_FEE) / 10000;
        assertEq(
            ERC20Token(tokenAddr).balanceOf(feeCollector) - feeCollectorBalBefore,
            expectedFee
        );
    }

    function test_Sell_EmitsSwapEvent() public {
        address tokenAddr = _setupSell();

        uint256 sellAmount = 1000 ether;
        uint256 feeAmount = (sellAmount * PUMP_FEE) / 10000;
        uint256 amountInAfterFee = sellAmount - feeAmount;

        uint256 expectedOut = _computeSellOutput(sellAmount, tokenAddr);

        // Compute expected reserves after sell
        (uint256 nativeBefore, uint256 tokenBefore) =
            pump.pumpReserve(tokenAddr);
        uint256 expectedTokenAfter = tokenBefore + amountInAfterFee;
        uint256 expectedNativeAfter = nativeBefore - expectedOut;

        vm.expectEmit(true, true, true, true);
        emit Swap(
            alice, false, tokenAddr, amountInAfterFee, expectedOut,
            expectedTokenAfter, expectedNativeAfter
        );

        vm.prank(alice);
        pump.sell(tokenAddr, sellAmount, 0);
    }

    function test_RevertSell_InsufficientOutput() public {
        address tokenAddr = _setupSell();

        vm.prank(alice);
        vm.expectRevert("insufficient output amount");
        pump.sell(tokenAddr, 1000 ether, type(uint256).max);
    }

    function test_RevertSell_GraduatedToken() public {
        address tokenAddr = _createToken();
        _graduateToken(tokenAddr);

        vm.prank(alice);
        vm.expectRevert("token already graduated");
        pump.sell(tokenAddr, 1, 0);
    }

    // ─── graduate ──────────────────────────────────────────────────

    function test_RevertGraduate_AlreadyGraduated() public {
        address tokenAddr = _createToken();
        _graduateToken(tokenAddr);

        vm.expectRevert("token already graduated");
        pump.graduate(tokenAddr);
    }

    function test_RevertGraduate_NotReachedCap() public {
        address tokenAddr = _createToken();
        // Only buy a small amount, not enough to reach graduation
        vm.prank(alice);
        pump.buy{value: 0.01 ether}(tokenAddr, 0);

        vm.expectRevert("not reach graduation cap");
        pump.graduate(tokenAddr);
    }

    function test_Graduate_CreatesNewPool() public {
        address tokenAddr = _createToken();
        _buyToGraduation(tokenAddr);

        // Pool should not exist yet (fresh factory)
        address poolAddr = factory.getPool(
            tokenAddr < wrappedNative ? tokenAddr : wrappedNative,
            tokenAddr < wrappedNative ? wrappedNative : tokenAddr,
            10000
        );
        assertEq(poolAddr, address(0));

        pump.graduate(tokenAddr);

        // Pool should now exist
        poolAddr = factory.getPool(
            tokenAddr < wrappedNative ? tokenAddr : wrappedNative,
            tokenAddr < wrappedNative ? wrappedNative : tokenAddr,
            10000
        );
        assertTrue(poolAddr != address(0));
        assertTrue(pool.initialized());
    }

    // Ground-truth checks instead of mirroring graduate()'s own encoder. Here wrappedNative is
    // 0xFF..FF so tokenAddr < wrappedNative always → token0=token, token1=native. With ~1e27
    // tokens vs ~1e17 native the price (native/token) is < 1, so a valid sqrtPriceX96 must be
    // non-zero, below 2^96, and within V3 bounds. The old `(native/token)` integer division
    // truncated to 0 here and called initialize(0) — this asserts that never happens again.
    function test_Graduate_InitializesPoolWithCorrectSqrtPriceX96() public {
        address tokenAddr = _createToken();
        _buyToGraduation(tokenAddr);

        assertTrue(tokenAddr < wrappedNative); // guard the ordering this test relies on

        pump.graduate(tokenAddr);

        uint160 sqrtP = pool.storedSqrtPriceX96();
        assertGt(sqrtP, 0);
        assertLt(sqrtP, 2 ** 96); // price = native/token < 1
        assertGe(sqrtP, MIN_SQRT_RATIO);
        assertLt(sqrtP, MAX_SQRT_RATIO);
    }

    // Regression for the truncate-to-zero bug: graduate() must never initialize a pool at price 0.
    function test_Graduate_HandlesExistingPool_NonZeroSlot0() public {
        address tokenAddr = _createToken();
        _buyToGraduation(tokenAddr);

        // Simulate existing pool with non-zero price (already initialized)
        pool.setSlot0(uint160(1));

        // Register pool in factory so getPool returns non-zero
        (address tkn0, address tkn1) =
            tokenAddr < wrappedNative
                ? (tokenAddr, wrappedNative)
                : (wrappedNative, tokenAddr);
        factory.createPool(tkn0, tkn1, 10000);

        // Reset initialized flag to check it doesn't get set again
        // Since MockV3Pool.initialized is a bool, we need a fresh pool
        MockV3Pool freshPool = new MockV3Pool();
        freshPool.setSlot0(uint160(1)); // non-zero = already initialized
        factory.setMockPool(address(freshPool));

        // Update factory pool mapping
        factory.createPool(tkn0, tkn1, 10000);

        pump.graduate(tokenAddr);

        // Should NOT have called initialize on the fresh pool
        assertFalse(freshPool.initialized());
        // But mint should still have been called
        assertEq(posManager.mintCallCount(), 1);
    }

    function test_Graduate_HandlesExistingPool_ZeroSlot0() public {
        address tokenAddr = _createToken();
        _buyToGraduation(tokenAddr);

        // Simulate existing pool with zero price (created but not initialized)
        // Pool exists in factory but slot0.sqrtPriceX96 == 0

        // Register pool in factory
        (address tkn0, address tkn1) =
            tokenAddr < wrappedNative
                ? (tokenAddr, wrappedNative)
                : (wrappedNative, tokenAddr);
        factory.createPool(tkn0, tkn1, 10000);

        pump.graduate(tokenAddr);

        // Should have called initialize
        assertTrue(pool.initialized());
    }

    function test_Graduate_MintsLPWithCorrectParams() public {
        address tokenAddr = _createToken();
        _buyToGraduation(tokenAddr);

        // Only the price-matched share of tokens is deposited into the LP (N1). Compute it (and free
        // tokenReserve) before the 11-field MintParams destructuring to stay under the stack limit.
        uint256 nativeReserve;
        uint256 tokenLiquidity;
        {
            uint256 tokenReserve;
            (nativeReserve, tokenReserve) = pump.pumpReserve(tokenAddr);
            tokenLiquidity = Math.mulDiv(tokenReserve, nativeReserve, VIRTUAL_AMOUNT + nativeReserve);
        }

        pump.graduate(tokenAddr);

        (
            address _token0,
            address _token1,
            uint24 _fee,
            int24 _tickLower,
            int24 _tickUpper,
            uint256 _amount0Desired,
            uint256 _amount1Desired,
            uint256 _amount0Min,
            uint256 _amount1Min,
            address _recipient,
            uint256 _deadline
        ) = posManager.lastMintParams();

        // Token ordering
        if (tokenAddr < wrappedNative) {
            assertEq(_token0, tokenAddr);
            assertEq(_token1, wrappedNative);
            assertEq(_amount0Desired, tokenLiquidity);
            assertEq(_amount1Desired, nativeReserve);
        } else {
            assertEq(_token0, wrappedNative);
            assertEq(_token1, tokenAddr);
            assertEq(_amount0Desired, nativeReserve);
            assertEq(_amount1Desired, tokenLiquidity);
        }

        assertEq(_fee, 10000);
        assertEq(_tickLower, -887200);
        assertEq(_tickUpper, 887200);
        assertEq(_amount0Min, (_amount0Desired * 95) / 100);
        assertEq(_amount1Min, (_amount1Desired * 95) / 100);
        assertEq(_recipient, address(0xdead));
        assertEq(_deadline, block.timestamp + 1 hours);
    }

    function test_Graduate_DeletesReservesAndSetsFlag() public {
        address tokenAddr = _createToken();
        _buyToGraduation(tokenAddr);

        pump.graduate(tokenAddr);

        (uint256 nativeReserve, uint256 tokenReserve) =
            pump.pumpReserve(tokenAddr);
        assertEq(nativeReserve, 0);
        assertEq(tokenReserve, 0);
        assertTrue(pump.isGraduate(tokenAddr));
    }

    // M1: the position manager keeps the native it doesn't deposit, and any token the full-range mint
    // doesn't consume stays in the curve. graduate() must refund the unused native out of the manager
    // and sweep both leftovers to feeCollector (not leave them sweepable in the PM or stranded here).
    function test_Graduate_SweepsLeftoverToFeeCollector() public {
        address tokenAddr = _createToken();
        _buyToGraduation(tokenAddr);

        (uint256 nativeReserve, uint256 tokenReserve) = pump.pumpReserve(tokenAddr);

        // Simulate the V3 position consuming only half of each side.
        uint256 usedNative = nativeReserve / 2;
        uint256 usedToken = tokenReserve / 2;
        posManager.setPartialFill(usedNative, usedToken);

        uint256 feeNativeBefore = feeCollector.balance;
        uint256 feeTokenBefore = ERC20Token(tokenAddr).balanceOf(feeCollector);

        pump.graduate(tokenAddr);

        // Leftover native + token are forwarded to feeCollector...
        assertEq(feeCollector.balance - feeNativeBefore, nativeReserve - usedNative);
        assertEq(
            ERC20Token(tokenAddr).balanceOf(feeCollector) - feeTokenBefore,
            tokenReserve - usedToken
        );
        // ...the manager retains only what the position used (nothing left for anyone to sweep)...
        assertEq(address(posManager).balance, usedNative);
        // ...and no token dust is stranded in the curve.
        assertEq(ERC20Token(tokenAddr).balanceOf(address(pump)), 0);
    }

    // N1 regression: graduation must seed V3 at the curve's final marginal price
    // (virtualAmount + native)/token, NOT the raw native/token. Only the price-matched share of tokens
    // enters the LP; the rest is swept to feeCollector. Otherwise the pool would open ~60% below the
    // curve's last price. Price is checked independently of graduate()'s sqrt encoder (ground truth).
    function test_Graduate_SeedsV3AtCurvePrice_N1() public {
        address tokenAddr = _createToken();
        _buyToGraduation(tokenAddr);
        (uint256 nativeReserve, uint256 tokenReserve) = pump.pumpReserve(tokenAddr);

        uint256 feeTokenBefore = ERC20Token(tokenAddr).balanceOf(feeCollector);
        pump.graduate(tokenAddr);

        // default setup: wrappedNative = 0xFF..FF, so tokenAddr < wrappedNative → token is token0
        assertTrue(tokenAddr < wrappedNative);
        (,,,,, uint256 amount0Desired, uint256 amount1Desired,,,,) = posManager.lastMintParams();
        uint256 tokenDeposited = amount0Desired;
        uint256 nativeDeposited = amount1Desired;

        // all real native enters the LP, but strictly fewer tokens than the full reserve
        assertEq(nativeDeposited, nativeReserve);
        assertLt(tokenDeposited, tokenReserve);

        // the LP opens at the curve's final price, strictly above the old raw native/token seed price
        uint256 depositPrice = (nativeDeposited * 1e18) / tokenDeposited;
        uint256 curvePrice = ((VIRTUAL_AMOUNT + nativeReserve) * 1e18) / tokenReserve;
        uint256 rawPrice = (nativeReserve * 1e18) / tokenReserve;
        assertApproxEqRel(depositPrice, curvePrice, 1e12); // within 1e-6
        assertGt(depositPrice, rawPrice);

        // the un-deposited excess is swept to feeCollector
        assertEq(
            ERC20Token(tokenAddr).balanceOf(feeCollector) - feeTokenBefore,
            tokenReserve - tokenDeposited
        );
    }

    // ─── getAmountOut ──────────────────────────────────────────────

    function test_GetAmountOut_CorrectCalculation() public {
        // inputAmountWithFee = 1000 * 99 = 99000
        // numerator = 20000 * 99000 = 1_980_000_000
        // denominator = (10000 * 100) + 99000 = 1_099_000
        // result = 1_980_000_000 / 1_099_000 = 1801
        assertEq(pump.getAmountOut(1000, 10000, 20000), 1801);
    }

    function test_RevertGetAmountOut_ZeroReserves() public {
        vm.expectRevert("invalid reserves");
        pump.getAmountOut(1000, 0, 1000);

        vm.expectRevert("invalid reserves");
        pump.getAmountOut(1000, 1000, 0);
    }

    // ─── Edge Cases ────────────────────────────────────────────────

    function test_BuyThenSell_RoundTrip() public {
        address tokenAddr = _createToken();
        uint256 buyAmount = 0.1 ether;

        vm.prank(alice);
        uint256 tokensReceived = pump.buy{value: buyAmount}(tokenAddr, 0);

        // Alice approves and sells all received tokens
        vm.prank(alice);
        ERC20Token(tokenAddr).approve(address(pump), tokensReceived);

        uint256 aliceBalBefore = alice.balance;
        vm.prank(alice);
        uint256 nativeReceived = pump.sell(tokenAddr, tokensReceived, 0);

        assertEq(alice.balance - aliceBalBefore, nativeReceived);
        // Due to fees on both buy and sell, alice gets less back
        assertLt(nativeReceived, buyAmount);

        // Exact value computed off-chain. A 0.1 ETH buy+sell returns ~0.0964968 ETH (~96.5%
        // retained), NOT ~98%, because two fee layers apply on each leg: the explicit pumpFee
        // (→ feeCollector) AND the *99/100 inside getAmountOut (retained in the curve). Removing
        // or altering either fee changes this constant, so it locks the double-fee economics.
        assertEq(nativeReceived, 96496795268583896);
    }

    // Graduation cap is `token * graduationAmount <= native * INITIALTOKEN`. With
    // native = GRADUATION_AMOUNT the boundary lands exactly at token == INITIALTOKEN,
    // letting us pin the integer ratio to the wei and cover the truncate boundary that
    // buy()-driven tests can't reach. Reserves are written directly via vm.store.

    function test_GraduationBoundary_ExactCap_AtThreshold() public {
        address tokenAddr = _createToken();
        // token * grad == native * INITIALTOKEN → equality graduates (<=)
        _setReserves(tokenAddr, GRADUATION_AMOUNT, INITIALTOKEN);

        pump.graduate(tokenAddr);
        assertTrue(pump.isGraduate(tokenAddr));
    }

    // The regression case: under the old `floor(token/native) <= INITIALTOKEN/GRADUATION_AMOUNT`
    // check this state truncated to 5e9 <= 5e9 and wrongly graduated. The cross-multiplied
    // check correctly reverts because token*grad > native*INITIALTOKEN by exactly INITIALTOKEN.
    function test_GraduationBoundary_OneWeiShort() public {
        address tokenAddr = _createToken();
        _setReserves(tokenAddr, GRADUATION_AMOUNT - 1, INITIALTOKEN);

        vm.expectRevert("not reach graduation cap");
        pump.graduate(tokenAddr);
    }

    // Independent ground-truth vectors: expected values were computed off-chain (NOT via the
    // contract), so a wrong curve formula cannot pass by agreeing with itself. The existing
    // _computeBuyOutput/_computeSellOutput helpers call pump.getAmountOut, making the buy/sell
    // "CalculatesCorrectOutput" tests consistency checks; these are true correctness checks.
    function test_GetAmountOut_IndependentVectors() public {
        assertEq(pump.getAmountOut(100, 1000, 1000), 90);
        assertEq(pump.getAmountOut(1 ether, 3400 ether, 1e27), 291091711531054193043790);
        assertEq(pump.getAmountOut(0.5 ether, 0.55 ether, 1e27), 473684210526315789473684210);
    }

    // Independent end-to-end check: the expected token output for a 0.1 ETH buy against fresh-create
    // reserves was computed off-chain through BOTH fee layers (pumpFee + the *99/100 curve fee).
    function test_Buy_ExactOutput_IndependentVector() public {
        address tokenAddr = _createToken(); // native=0.05e18, token=1e27, virtual=0.5e18, pumpFee=100
        vm.prank(alice);
        uint256 out = pump.buy{value: 0.1 ether}(tokenAddr, 0);
        assertEq(out, 151247665931081310473603802);
    }

    // The indexer (indexer/src/launchpad.ts) decodes Creation's metadata, so a signature or payload
    // regression must fail a test. Capture the log and decode the full non-indexed payload.
    function test_CreateToken_EmitsCreation() public {
        vm.recordLogs();
        vm.prank(alice);
        address tokenAddr = pump.createToken{value: CREATE_FEE + INITIAL_NATIVE}(
            "TestToken", "TT", "logo", "desc", "link1", "link2", "link3"
        );
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32 sig = keccak256("Creation(address,address,string,string,string,string,string,uint256)");
        bool found;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] != sig) continue;
            found = true;
            assertEq(address(uint160(uint256(logs[i].topics[1]))), alice); // indexed creator
            (
                address evToken,
                string memory logo,
                string memory desc,
                string memory l1,
                string memory l2,
                string memory l3,
                uint256 ts
            ) = abi.decode(logs[i].data, (address, string, string, string, string, string, uint256));
            assertEq(evToken, tokenAddr);
            assertEq(logo, "logo");
            assertEq(desc, "desc");
            assertEq(l1, "link1");
            assertEq(l2, "link2");
            assertEq(l3, "link3");
            assertEq(ts, block.timestamp);
        }
        assertTrue(found, "Creation event not emitted");
    }

    function test_Graduate_EmitsGraduation() public {
        address tokenAddr = _createToken();
        _buyToGraduation(tokenAddr);
        // graduate() is called by this contract (feeCollector), so sender == address(this).
        vm.expectEmit(true, true, true, true);
        emit Graduation(address(this), tokenAddr);
        pump.graduate(tokenAddr);
    }

    // Reserves and graduation status are keyed per token; activity on one must not touch another.
    function test_TwoTokens_ReservesIsolated() public {
        address tokenA = _createTokenAs(alice);
        address tokenB = _createTokenAs(bob);

        _buyToGraduation(tokenA);
        pump.graduate(tokenA);

        assertTrue(pump.isGraduate(tokenA));
        assertFalse(pump.isGraduate(tokenB));
        (uint256 natB, uint256 tokB) = pump.pumpReserve(tokenB);
        assertEq(natB, INITIAL_NATIVE);
        assertEq(tokB, INITIALTOKEN);
    }

    // CHARACTERIZATION (documents current, un-hardened behavior — contract-hardening candidate):
    // graduationAmount = 0 makes the cap check `token * 0 <= native * INITIALTOKEN` always true, so
    // a freshly created token (native > 0) graduates with no real trading. A future
    // require(graduationAmount > 0) should update this test.
    function test_GraduationAmountZero_AllowsImmediateGraduation() public {
        pump.setCurveState(INITIAL_NATIVE, VIRTUAL_AMOUNT, 0);
        address tokenAddr = _createToken();
        pump.graduate(tokenAddr);
        assertTrue(pump.isGraduate(tokenAddr));
    }

    // CHARACTERIZATION (contract-hardening candidate): setFeeCollector(0) is accepted and silently
    // routes subsequent fees to the zero address (burned) instead of reverting. A future
    // require(_newFeeCollector != address(0)) should update this test.
    function test_SetFeeCollectorZero_BurnsCreationFee() public {
        pump.setFeeCollector(address(0));
        uint256 burnedBefore = address(0).balance;
        _createTokenAs(alice);
        assertEq(address(0).balance - burnedBefore, CREATE_FEE);
    }

    // CHARACTERIZATION (contract-hardening candidate): pumpFee >= 10000 (>= 100%) makes feeAmount
    // exceed msg.value, so `amountInAfterFee = msg.value - feeAmount` underflows and buy reverts with
    // an arithmetic panic — out-of-range fees brick trading rather than being rejected at setFee.
    function test_PumpFeeTooHigh_RevertsBuy() public {
        address tokenAddr = _createToken();
        pump.setFee(CREATE_FEE, 10001);
        vm.prank(alice);
        vm.expectRevert(stdError.arithmeticError);
        pump.buy{value: 0.1 ether}(tokenAddr, 0);
    }

    // getAmountOut output is strictly below the output reserve for any valid inputs, so buy()'s
    // `token -= amountOut` can never underflow on a single trade.
    function testFuzz_GetAmountOut_LtOutputReserve(
        uint256 inputAmount,
        uint256 inReserve,
        uint256 outReserve
    ) public {
        inReserve = bound(inReserve, 1, 1e30);
        outReserve = bound(outReserve, 1, 1e30);
        inputAmount = bound(inputAmount, 0, 1e30);
        assertLt(pump.getAmountOut(inputAmount, inReserve, outReserve), outReserve);
    }

    // Buying then immediately selling the exact tokens received can never return more native than
    // was paid in — fees and curve rounding always favor the curve, never the round-tripper.
    function testFuzz_BuyThenSell_NeverProfitable(uint256 buyAmount) public {
        address tokenAddr = _createToken();
        buyAmount = bound(buyAmount, 1e9, 10 ether);
        vm.deal(alice, buyAmount + 1 ether);

        vm.prank(alice);
        uint256 tokensOut = pump.buy{value: buyAmount}(tokenAddr, 0);

        vm.prank(alice);
        ERC20Token(tokenAddr).approve(address(pump), tokensOut);
        vm.prank(alice);
        uint256 nativeBack = pump.sell(tokenAddr, tokensOut, 0);

        assertLe(nativeBack, buyAmount);
    }

    // Each buy moves the price up, so an identical second buy yields no more tokens than the first.
    function testFuzz_Buy_PriceMonotonic(uint256 amount) public {
        address tokenAddr = _createToken();
        amount = bound(amount, 1e12, 1 ether);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);

        vm.prank(alice);
        uint256 firstOut = pump.buy{value: amount}(tokenAddr, 0);
        vm.prank(bob);
        uint256 secondOut = pump.buy{value: amount}(tokenAddr, 0);

        assertLe(secondOut, firstOut);
    }

    // ─── Internal Helpers for Graduation ───────────────────────────

    function _setupSell() internal returns (address) {
        address tokenAddr = _createToken();

        // Alice buys some tokens
        vm.prank(alice);
        uint256 bought = pump.buy{value: 0.1 ether}(tokenAddr, 0);

        // Alice approves pump to spend her tokens
        vm.prank(alice);
        ERC20Token(tokenAddr).approve(address(pump), bought);

        return tokenAddr;
    }

    function _buyToGraduation(address tokenAddr) internal {
        // Buy enough native to reach graduation cap
        // Graduation when: tokenReserve / nativeReserve <= INITIALTOKEN / GRADUATION_AMOUNT
        // Buy in steps until we cross the threshold
        uint256 buyStep = 0.01 ether;
        while (true) {
            (uint256 nativeRes, uint256 tokenRes) = pump.pumpReserve(tokenAddr);
            if (nativeRes > 0 && tokenRes * GRADUATION_AMOUNT <= nativeRes * INITIALTOKEN) {
                break;
            }
            vm.prank(alice);
            pump.buy{value: buyStep}(tokenAddr, 0);
        }
    }

    function _graduateToken(address tokenAddr) internal {
        _buyToGraduation(tokenAddr);
        pump.graduate(tokenAddr);
    }

    // pumpReserve is the first state var (slot 0); PumpReserve { uint256 native; uint256 token; }.
    // For key `tokenAddr` the value base is keccak256(abi.encode(tokenAddr, slot)) with native at
    // base and token at base+1. Writing reserves directly lets tests hit exact ratio boundaries.
    function _setReserves(address tokenAddr, uint256 native, uint256 token) internal {
        bytes32 base = keccak256(abi.encode(tokenAddr, uint256(0)));
        vm.store(address(pump), base, bytes32(native));
        vm.store(address(pump), bytes32(uint256(base) + 1), bytes32(token));
        vm.deal(address(pump), address(pump).balance + native); // cover mint{value: native}
    }
}

// ─── Production-ordering tests (tokenAddr > wrappedNative) ────────────
// On real networks, WETH has a LOW address (e.g. 0xC02a... on mainnet).
// Created tokens have HIGHER addresses, so tokenAddr > wrappedNative.
// This contract tests that exact ordering to catch issues like the
// sqrtPriceX96 overflow that only manifests in production.

contract BondingCurveJunoswapLowWrappedTest is Test {
    event Graduation(address indexed sender, address tokenAddr);

    BondingCurveJunoswap public pump;
    MockV3Factory public factory;
    MockV3Pool public pool;
    MockPositionManager public posManager;

    address public alice;
    // Use address(1) to guarantee tokenAddr > wrappedNative
    // (CREATE never generates addresses this low)
    address public wrappedNative = address(1);

    uint256 constant CREATE_FEE = 0.001 ether;
    uint256 constant INITIAL_NATIVE = 0.05 ether;
    uint256 constant VIRTUAL_AMOUNT = 0.5 ether;
    uint256 constant GRADUATION_AMOUNT = 0.2 ether;
    uint256 constant PUMP_FEE = 100;
    uint256 constant INITIALTOKEN = 1_000_000_000 ether;

    uint160 constant MIN_SQRT_RATIO = 4295128739;
    uint160 constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    receive() external payable {}

    function setUp() public {
        factory = new MockV3Factory();
        pool = new MockV3Pool();
        posManager = new MockPositionManager();

        alice = makeAddr("alice");
        factory.setMockPool(address(pool));
        posManager.setWrappedNative(wrappedNative);
        pump = new BondingCurveJunoswap(
            wrappedNative,
            address(factory),
            address(posManager)
        );
        pump.setCurveState(INITIAL_NATIVE, VIRTUAL_AMOUNT, GRADUATION_AMOUNT);
        pump.setFee(CREATE_FEE, PUMP_FEE);

        vm.deal(alice, 100 ether);
    }

    function _createToken() internal returns (address) {
        vm.prank(alice);
        return pump.createToken{value: CREATE_FEE + INITIAL_NATIVE}(
            "TestToken", "TT", "logo", "desc", "l1", "l2", "l3"
        );
    }

    function _buyToGraduation(address tokenAddr) internal {
        uint256 buyStep = 0.01 ether;
        while (true) {
            (uint256 nativeRes, uint256 tokenRes) = pump.pumpReserve(tokenAddr);
            if (nativeRes > 0 && tokenRes * GRADUATION_AMOUNT <= nativeRes * INITIALTOKEN) {
                break;
            }
            vm.prank(alice);
            pump.buy{value: buyStep}(tokenAddr, 0);
        }
    }

    // ─── Graduation succeeds without overflow ─────────────────────────

    function test_Graduate_SucceedsWithProductionOrdering() public {
        address tokenAddr = _createToken();
        _buyToGraduation(tokenAddr);

        // This would revert with panic(0x11) if the sqrtPriceX96 overflow exists
        pump.graduate(tokenAddr);
        assertTrue(pump.isGraduate(tokenAddr));
    }

    // Ground-truth checks instead of mirroring graduate()'s encoder. wrappedNative is address(1)
    // so tokenAddr > wrappedNative always → token0=native, token1=token. Price (token/native) is
    // > 1, so a valid sqrtPriceX96 must be non-zero, above 2^96, and within V3 bounds.
    function test_Graduate_SqrtPriceX96Correct_ProductionOrdering() public {
        address tokenAddr = _createToken();
        _buyToGraduation(tokenAddr);

        assertGt(uint160(tokenAddr), uint160(wrappedNative)); // guard the ordering this test relies on

        pump.graduate(tokenAddr);

        uint160 sqrtP = pool.storedSqrtPriceX96();
        assertGt(sqrtP, 2 ** 96); // price = token/native > 1
        assertLt(sqrtP, MAX_SQRT_RATIO);
        assertGe(sqrtP, MIN_SQRT_RATIO);
    }

    function test_Graduate_MintParamsCorrect_ProductionOrdering() public {
        address tokenAddr = _createToken();
        _buyToGraduation(tokenAddr);

        // Only the price-matched share of tokens is deposited into the LP (N1). Compute it (and free
        // tokenReserve) before the 11-field MintParams destructuring to stay under the stack limit.
        uint256 nativeReserve;
        uint256 tokenLiquidity;
        {
            uint256 tokenReserve;
            (nativeReserve, tokenReserve) = pump.pumpReserve(tokenAddr);
            tokenLiquidity = Math.mulDiv(tokenReserve, nativeReserve, VIRTUAL_AMOUNT + nativeReserve);
        }

        pump.graduate(tokenAddr);

        (
            address _token0,
            address _token1,
            uint24 _fee,
            int24 _tickLower,
            int24 _tickUpper,
            uint256 _amount0Desired,
            uint256 _amount1Desired,
            uint256 _amount0Min,
            uint256 _amount1Min,
            address _recipient,
            uint256 _deadline
        ) = posManager.lastMintParams();

        // tokenAddr > wrappedNative → tkn0=wrappedNative, tkn1=tokenAddr
        assertEq(_token0, wrappedNative);
        assertEq(_token1, tokenAddr);
        assertEq(_amount0Desired, nativeReserve);
        assertEq(_amount1Desired, tokenLiquidity);

        assertEq(_fee, 10000);
        assertEq(_tickLower, -887200);
        assertEq(_tickUpper, 887200);
        assertEq(_recipient, address(0xdead));
        assertEq(_deadline, block.timestamp + 1 hours);

        // Check slippage separately to avoid stack-too-deep
        _checkSlippage(_amount0Desired, _amount0Min, _amount1Desired, _amount1Min);
    }

    function _checkSlippage(
        uint256 amount0Desired, uint256 amount0Min,
        uint256 amount1Desired, uint256 amount1Min
    ) internal pure {
        assertEq(amount0Min, (amount0Desired * 95) / 100);
        assertEq(amount1Min, (amount1Desired * 95) / 100);
    }

    // ─── Existing pool paths with production ordering ─────────────────

    function test_Graduate_ExistingPoolZeroSlot0_ProductionOrdering() public {
        address tokenAddr = _createToken();
        _buyToGraduation(tokenAddr);

        // Pre-register pool with sorted order (wrappedNative < tokenAddr)
        // The contract calls getPool(wrappedNative, tokenAddr, 10000)
        factory.createPool(wrappedNative, tokenAddr, 10000);

        pump.graduate(tokenAddr);
        assertTrue(pool.initialized());
    }
}

// ─── Production-config tests (real deploy parameters) ────────────────
// Mirrors DeployBondingCurveJunoswap.s.sol: initialNative = 0, virtual = 3400e18, grad = 4000e18,
// createFee = 0.1e18, with wrappedNative at a LOW address (like WETH on real networks). The other
// suites run tiny test values; this one exercises the zero-initial-native first-buy path and
// production-magnitude graduation arithmetic that those never touch.
contract BondingCurveProductionConfigTest is Test {
    BondingCurveJunoswap public pump;
    MockV3Factory public factory;
    MockV3Pool public pool;
    MockPositionManager public posManager;

    address public alice;
    address public wrappedNative = address(1); // low address → tokenAddr > wrappedNative (WETH-like)

    uint256 constant CREATE_FEE = 0.1 ether;
    uint256 constant INITIAL_NATIVE = 0;
    uint256 constant VIRTUAL_AMOUNT = 3400 ether;
    uint256 constant GRADUATION_AMOUNT = 4000 ether;
    uint256 constant PUMP_FEE = 100;
    uint256 constant INITIALTOKEN = 1_000_000_000 ether;

    uint160 constant MIN_SQRT_RATIO = 4295128739;
    uint160 constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    receive() external payable {}

    function setUp() public {
        factory = new MockV3Factory();
        pool = new MockV3Pool();
        posManager = new MockPositionManager();
        factory.setMockPool(address(pool));
        posManager.setWrappedNative(wrappedNative);

        pump = new BondingCurveJunoswap(wrappedNative, address(factory), address(posManager));
        pump.setCurveState(INITIAL_NATIVE, VIRTUAL_AMOUNT, GRADUATION_AMOUNT);
        pump.setFee(CREATE_FEE, PUMP_FEE);

        alice = makeAddr("alice");
        vm.deal(alice, 100 ether);
    }

    function _createToken() internal returns (address) {
        vm.prank(alice);
        return pump.createToken{value: CREATE_FEE + INITIAL_NATIVE}(
            "TestToken", "TT", "logo", "desc", "l1", "l2", "l3"
        );
    }

    // Production seeds initialNative = 0, so the first buy must price off virtualAmount alone (input
    // reserve = virtual + 0). The default test config (initialNative = 0.05e18) never exercises this.
    function test_Create_FirstBuyWorks_ZeroInitialNative() public {
        address tokenAddr = _createToken();
        (uint256 nat0, uint256 tok0) = pump.pumpReserve(tokenAddr);
        assertEq(nat0, 0);
        assertEq(tok0, INITIALTOKEN);

        vm.prank(alice);
        uint256 out = pump.buy{value: 1 ether}(tokenAddr, 0);
        assertGt(out, 0);

        uint256 fee = (1 ether * PUMP_FEE) / 10000;
        (uint256 nat1, uint256 tok1) = pump.pumpReserve(tokenAddr);
        assertEq(nat1, 1 ether - fee);
        assertEq(tok1, INITIALTOKEN - out);
    }

    // Reaching graduation (~thousands of ETH) via direct buys would need ~400k iterations, so set a
    // production-magnitude, cap-satisfying reserve state via vm.store and graduate. Guards the
    // sqrtPriceX96 encoder against overflow/zero at real scale: MockV3Pool.initialize() reverts on
    // an out-of-range price, so a successful graduate() with an in-range price is the proof.
    function test_Graduate_ProductionMagnitude_EncoderInRange() public {
        address tokenAddr = _createToken();
        // native = GRADUATION_AMOUNT, token = INITIALTOKEN hits the cap exactly
        // (token*grad == native*INITIALTOKEN), matching how a real curve reaches graduation at scale.
        _setReserves(tokenAddr, GRADUATION_AMOUNT, INITIALTOKEN);

        pump.graduate(tokenAddr);

        uint160 sqrtP = pool.storedSqrtPriceX96();
        assertGe(sqrtP, MIN_SQRT_RATIO);
        assertLt(sqrtP, MAX_SQRT_RATIO);
        assertTrue(pump.isGraduate(tokenAddr));
    }

    function _setReserves(address tokenAddr, uint256 native, uint256 token) internal {
        bytes32 base = keccak256(abi.encode(tokenAddr, uint256(0)));
        vm.store(address(pump), base, bytes32(native));
        vm.store(address(pump), bytes32(uint256(base) + 1), bytes32(token));
        vm.deal(address(pump), address(pump).balance + native); // cover mint{value: native}
    }
}
