// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Compile-time note: place this file at contracts/src/Harness.sol (or pass the root
// as an include dir) so this relative import resolves.
import {PairPadPositionMath} from "./v2/libraries/PairPadPositionMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {SwapMath} from "@uniswap/v4-core/src/libraries/SwapMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

/// @dev Mirrors PairPadLaunchFactory._launchToken / PositionMinter.mintLaunchPosition
/// plus v4-core's swap step, so a launch's curve can be exercised with no RPC.
contract Harness {
    struct Slot { uint160 sqrt; int24 tick; uint128 liquidity; }

    function plan(bool tokenIs0, uint256 supply, uint256 phantom, int24 spacing)
        external pure returns (uint160 sqrt, int24 tl, int24 tu, uint128 L)
    {
        PairPadPositionMath.Plan memory p = PairPadPositionMath.plan(tokenIs0, supply, phantom, spacing);
        return (p.sqrtPriceX96, p.tickLower, p.tickUpper, p.liquidity);
    }

    function tokenAmount(bool tokenIs0, uint256 supply, uint256 phantom, int24 spacing)
        external pure returns (uint256)
    {
        PairPadPositionMath.Plan memory p = PairPadPositionMath.plan(tokenIs0, supply, phantom, spacing);
        return PairPadPositionMath.tokenAmountFor(tokenIs0, p);
    }

    function amounts(uint160 sqrtP, int24 tl, int24 tu, uint128 L)
        external pure returns (uint256 a0, uint256 a1)
    {
        return PairPadPositionMath.amountsForLiquidity(sqrtP, tl, tu, L);
    }

    /// @dev Exact-input swap against the single launch position, exactly as
    /// v4-core Pool.swap/SwapMath would (LP fee on input currency, one step
    /// since the position covers everything from the current price).
    function swapExactIn(
        uint160 sqrtNow, int24 tl, int24 tu, uint128 L, uint24 feePips, bool zeroForOne, uint256 amountIn
    ) external pure returns (uint160 sqrtAfter, int24 tickAfter, uint256 amountOut, uint256 feeAmount) {
        (sqrtAfter, , amountOut, feeAmount) = SwapMath.computeSwapStep(
            sqrtNow,
            zeroForOne ? TickMath.getSqrtPriceAtTick(tl) : TickMath.getSqrtPriceAtTick(tu),
            L,
            -int256(amountIn),
            feePips
        );
        if (sqrtAfter == sqrtNow) {
            tickAfter = TickMath.getTickAtSqrtPrice(sqrtNow);
        } else {
            // v4 keeps the tick at the sqrt-price boundary it just reached
            tickAfter = TickMath.getTickAtSqrtPrice(sqrtAfter);
        }
    }

    function sqrtAtTick(int24 t) external pure returns (uint160) { return TickMath.getSqrtPriceAtTick(t); }
    function tickAtSqrt(uint160 s) external pure returns (int24) { return TickMath.getTickAtSqrtPrice(s); }
    function absTick(int256 a) external pure returns (int256) { return a < 0 ? -a : a; }
}
