// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface IPancakeRouter02FeeWrapper {
    function WETH() external pure returns (address);

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable;

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;
}

interface IThenaRouterV2FeeWrapper {
    struct Route {
        address from;
        address to;
        bool stable;
    }

    function wETH() external view returns (address);

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external;

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external payable;

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external;
}

/**
 * @title TamiSwapFeeRouter
 * @notice Atomic 0.25% platform fee wrapper for THENA RouterV2 & PancakeSwap RouterV2 on BNB Smart Chain.
 *         Supports any BEP-20 token (including newly created & fee-on-transfer/tax tokens).
 */
contract TamiSwapFeeRouter {
    address public constant THENA_ROUTER = 0xd4ae6eCA985340Dd434D38F470aCCce4DC78D109;
    address public constant PANCAKE_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    address public constant WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    address public constant FEE_RECIPIENT = 0xcd4BDDeae498c7E303C153921b03da4b83FE846c;
    uint256 public constant FEE_BPS = 25; // 0.25%
    uint256 public constant BPS_DENOMINATOR = 10000;

    uint256 private _locked = 1;

    event PlatformFeeCollected(
        address indexed token,
        address indexed payer,
        address indexed recipient,
        uint256 feeAmount,
        address routerUsed
    );

    modifier nonReentrant() {
        require(_locked == 1, "TamiSwapFeeRouter: REENTRANT");
        _locked = 2;
        _;
        _locked = 1;
    }

    receive() external payable {}

    // ---------------- PancakeSwap V2 Swaps ----------------

    function swapExactETHForTokensOnPancake(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable nonReentrant {
        require(msg.value > 0, "TamiSwapFeeRouter: ZERO_BNB");
        require(path.length >= 2 && path[0] == WBNB, "TamiSwapFeeRouter: INVALID_PATH");

        (uint256 feeAmount, uint256 swapAmount) = _collectBnbFee(msg.value, PANCAKE_ROUTER);

        IPancakeRouter02FeeWrapper(PANCAKE_ROUTER).swapExactETHForTokensSupportingFeeOnTransferTokens{
            value: swapAmount
        }(amountOutMin, path, to, deadline);

        // Touch feeAmount to keep stack crystal clear
        require(swapAmount + feeAmount == msg.value, "TamiSwapFeeRouter: MATH");
    }

    function swapExactTokensForETHOnPancake(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external nonReentrant {
        require(amountIn > 0, "TamiSwapFeeRouter: ZERO_IN");
        require(
            path.length >= 2 && path[path.length - 1] == WBNB,
            "TamiSwapFeeRouter: INVALID_PATH"
        );

        address tokenIn = path[0];
        uint256 swapAmount = _pullTokenAndTakeFee(tokenIn, amountIn, PANCAKE_ROUTER);

        _safeApprove(tokenIn, PANCAKE_ROUTER, swapAmount);
        IPancakeRouter02FeeWrapper(PANCAKE_ROUTER).swapExactTokensForETHSupportingFeeOnTransferTokens(
            swapAmount,
            amountOutMin,
            path,
            to,
            deadline
        );
        _safeApprove(tokenIn, PANCAKE_ROUTER, 0);
    }

    function swapExactTokensForTokensOnPancake(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external nonReentrant {
        require(amountIn > 0, "TamiSwapFeeRouter: ZERO_IN");
        require(path.length >= 2, "TamiSwapFeeRouter: INVALID_PATH");

        address tokenIn = path[0];
        uint256 swapAmount = _pullTokenAndTakeFee(tokenIn, amountIn, PANCAKE_ROUTER);

        _safeApprove(tokenIn, PANCAKE_ROUTER, swapAmount);
        IPancakeRouter02FeeWrapper(PANCAKE_ROUTER)
            .swapExactTokensForTokensSupportingFeeOnTransferTokens(
                swapAmount,
                amountOutMin,
                path,
                to,
                deadline
            );
        _safeApprove(tokenIn, PANCAKE_ROUTER, 0);
    }

    // ---------------- THENA RouterV2 Swaps ----------------

    function swapExactETHForTokensOnThena(
        uint256 amountOutMin,
        IThenaRouterV2FeeWrapper.Route[] calldata routes,
        address to,
        uint256 deadline
    ) external payable nonReentrant {
        require(msg.value > 0, "TamiSwapFeeRouter: ZERO_BNB");
        require(routes.length >= 1 && routes[0].from == WBNB, "TamiSwapFeeRouter: INVALID_ROUTE");

        (uint256 feeAmount, uint256 swapAmount) = _collectBnbFee(msg.value, THENA_ROUTER);

        IThenaRouterV2FeeWrapper(THENA_ROUTER).swapExactETHForTokensSupportingFeeOnTransferTokens{
            value: swapAmount
        }(amountOutMin, routes, to, deadline);

        require(swapAmount + feeAmount == msg.value, "TamiSwapFeeRouter: MATH");
    }

    function swapExactTokensForETHOnThena(
        uint256 amountIn,
        uint256 amountOutMin,
        IThenaRouterV2FeeWrapper.Route[] calldata routes,
        address to,
        uint256 deadline
    ) external nonReentrant {
        require(amountIn > 0, "TamiSwapFeeRouter: ZERO_IN");
        require(
            routes.length >= 1 && routes[routes.length - 1].to == WBNB,
            "TamiSwapFeeRouter: INVALID_ROUTE"
        );

        address tokenIn = routes[0].from;
        uint256 swapAmount = _pullTokenAndTakeFee(tokenIn, amountIn, THENA_ROUTER);

        _safeApprove(tokenIn, THENA_ROUTER, swapAmount);
        IThenaRouterV2FeeWrapper(THENA_ROUTER).swapExactTokensForETHSupportingFeeOnTransferTokens(
            swapAmount,
            amountOutMin,
            routes,
            to,
            deadline
        );
        _safeApprove(tokenIn, THENA_ROUTER, 0);
    }

    function swapExactTokensForTokensOnThena(
        uint256 amountIn,
        uint256 amountOutMin,
        IThenaRouterV2FeeWrapper.Route[] calldata routes,
        address to,
        uint256 deadline
    ) external nonReentrant {
        require(amountIn > 0, "TamiSwapFeeRouter: ZERO_IN");
        require(routes.length >= 1, "TamiSwapFeeRouter: INVALID_ROUTE");

        address tokenIn = routes[0].from;
        uint256 swapAmount = _pullTokenAndTakeFee(tokenIn, amountIn, THENA_ROUTER);

        _safeApprove(tokenIn, THENA_ROUTER, swapAmount);
        IThenaRouterV2FeeWrapper(THENA_ROUTER).swapExactTokensForTokensSupportingFeeOnTransferTokens(
            swapAmount,
            amountOutMin,
            routes,
            to,
            deadline
        );
        _safeApprove(tokenIn, THENA_ROUTER, 0);
    }

    // ---------------- Internal Fee & Safe Transfer Helpers ----------------

    function _collectBnbFee(
        uint256 totalValue,
        address routerUsed
    ) internal returns (uint256 feeAmount, uint256 swapAmount) {
        feeAmount = (totalValue * FEE_BPS) / BPS_DENOMINATOR;
        swapAmount = totalValue - feeAmount;
        require(swapAmount > 0, "TamiSwapFeeRouter: AMOUNT_TOO_SMALL");
        if (feeAmount > 0) {
            _safeTransferBNB(FEE_RECIPIENT, feeAmount);
        }
        emit PlatformFeeCollected(address(0), msg.sender, FEE_RECIPIENT, feeAmount, routerUsed);
    }

    function _pullTokenAndTakeFee(
        address tokenIn,
        uint256 amountIn,
        address routerUsed
    ) internal returns (uint256 swapAmount) {
        uint256 balBefore = IERC20Minimal(tokenIn).balanceOf(address(this));
        _safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);
        uint256 received = IERC20Minimal(tokenIn).balanceOf(address(this)) - balBefore;
        require(received > 0, "TamiSwapFeeRouter: ZERO_RECEIVED");

        uint256 feeAmount = (received * FEE_BPS) / BPS_DENOMINATOR;
        swapAmount = received - feeAmount;
        require(swapAmount > 0, "TamiSwapFeeRouter: AMOUNT_TOO_SMALL");

        if (feeAmount > 0) {
            _safeTransfer(tokenIn, FEE_RECIPIENT, feeAmount);
        }
        emit PlatformFeeCollected(tokenIn, msg.sender, FEE_RECIPIENT, feeAmount, routerUsed);
    }

    function _safeTransferBNB(address to, uint256 value) internal {
        (bool ok, ) = to.call{value: value}(new bytes(0));
        require(ok, "TamiSwapFeeRouter: BNB_TRANSFER_FAILED");
    }

    function _safeTransfer(address token, address to, uint256 value) internal {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.transfer.selector, to, value)
        );
        require(
            ok && (data.length == 0 || abi.decode(data, (bool))),
            "TamiSwapFeeRouter: TRANSFER_FAILED"
        );
    }

    function _safeTransferFrom(address token, address from, address to, uint256 value) internal {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.transferFrom.selector, from, to, value)
        );
        require(
            ok && (data.length == 0 || abi.decode(data, (bool))),
            "TamiSwapFeeRouter: TRANSFER_FROM_FAILED"
        );
    }

    function _safeApprove(address token, address spender, uint256 value) internal {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.approve.selector, spender, value)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) {
            // Handle tokens requiring allowance reset to 0 before setting non-zero allowance
            (bool resetOk, bytes memory resetData) = token.call(
                abi.encodeWithSelector(IERC20Minimal.approve.selector, spender, 0)
            );
            require(
                resetOk && (resetData.length == 0 || abi.decode(resetData, (bool))),
                "TamiSwapFeeRouter: APPROVE_RESET_FAILED"
            );
            (ok, data) = token.call(
                abi.encodeWithSelector(IERC20Minimal.approve.selector, spender, value)
            );
            require(
                ok && (data.length == 0 || abi.decode(data, (bool))),
                "TamiSwapFeeRouter: APPROVE_FAILED"
            );
        }
    }
}
