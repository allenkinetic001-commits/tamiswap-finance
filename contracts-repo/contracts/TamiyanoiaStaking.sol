// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

/**
 * @title TamiyanoiaStaking
 * @notice Single-sided TAMIYANOIA staking contract for TamiSwap (BNB Smart Chain).
 *         - Self-contained (no external imports) for 1-click Remix deployment.
 *         - Balance-delta safe for taxed BEP-20 tokens.
 *         - Staked principal is strictly protected (owner cannot withdraw staking token).
 *         - Optional 0%–2% fee routed to treasury (defaults to 0% fee, flexible unstaking).
 */
contract TamiyanoiaStaking {
    IERC20 public immutable stakingToken;
    address public owner;
    address public pendingOwner;
    address public treasury;

    uint256 public periodFinish;
    uint256 public rewardRate;
    uint256 public rewardsDuration = 30 days;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;

    uint256 public lockDuration; // 0 = Flexible (withdraw anytime)
    uint16 public stakeFeeBps;   // Max 200 (2.00%)
    uint16 public unstakeFeeBps; // Max 200 (2.00%)

    uint256 private _totalStaked;
    uint256 private _locked;

    mapping(address => uint256) private _balances;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;
    mapping(address => uint256) public unlockTime;

    event Staked(address indexed user, uint256 amountReceived, uint256 feePaid);
    event Withdrawn(address indexed user, uint256 amount, uint256 feePaid);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardsFunded(uint256 amountAdded, uint256 durationSeconds, uint256 newRewardRate, uint256 periodFinish);
    event FeeConfigUpdated(uint16 stakeFeeBps, uint16 unstakeFeeBps, address treasury);
    event LockDurationUpdated(uint256 lockDurationSeconds);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier nonReentrant() {
        require(_locked == 0, "Reentrant");
        _locked = 1;
        _;
        _locked = 0;
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    /**
     * @param _stakingToken TAMIYANOIA token (0x8bea530150675c1eC537Bde45c0480164590c898)
     * @param _treasury Treasury wallet (0xcd4BDDeae498c7E303C153921b03da4b83FE846c)
     * @param _initialOwner Admin wallet (pass 0xcd4BDDeae498c7E303C153921b03da4b83FE846c or deployer)
     */
    constructor(
        address _stakingToken,
        address _treasury,
        address _initialOwner
    ) {
        require(_stakingToken != address(0), "Invalid token");
        require(_treasury != address(0), "Invalid treasury");
        stakingToken = IERC20(_stakingToken);
        treasury = _treasury;
        owner = _initialOwner == address(0) ? msg.sender : _initialOwner;
        lockDuration = 0; // Flexible by default
        stakeFeeBps = 0;  // 0% fee by default (owner can enable up to 25 bps / 200 bps)
        unstakeFeeBps = 0;
    }

    function totalStaked() external view returns (uint256) {
        return _totalStaked;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function rewardReserve() public view returns (uint256) {
        uint256 bal = stakingToken.balanceOf(address(this));
        return bal > _totalStaked ? bal - _totalStaked : 0;
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (_totalStaked == 0) {
            return rewardPerTokenStored;
        }
        return
            rewardPerTokenStored +
            (((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18) / _totalStaked);
    }

    function earned(address account) public view returns (uint256) {
        return
            ((_balances[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18) +
            rewards[account];
    }

    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot stake 0");

        uint256 beforeBal = stakingToken.balanceOf(address(this));
        require(stakingToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        uint256 afterBal = stakingToken.balanceOf(address(this));
        uint256 received = afterBal > beforeBal ? afterBal - beforeBal : 0;
        require(received > 0, "Zero received");

        uint256 fee = (received * stakeFeeBps) / 10000;
        if (fee > 0) {
            require(stakingToken.transfer(treasury, fee), "Fee transfer failed");
        }
        uint256 netStaked = received - fee;
        require(netStaked > 0, "Net staked is 0");

        _totalStaked += netStaked;
        _balances[msg.sender] += netStaked;

        if (lockDuration > 0) {
            unlockTime[msg.sender] = block.timestamp + lockDuration;
        }

        emit Staked(msg.sender, netStaked, fee);
    }

    function withdraw(uint256 amount) public nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        require(_balances[msg.sender] >= amount, "Insufficient staked balance");
        if (lockDuration > 0) {
            require(block.timestamp >= unlockTime[msg.sender], "Stake still locked");
        }

        _totalStaked -= amount;
        _balances[msg.sender] -= amount;

        uint256 fee = (amount * unstakeFeeBps) / 10000;
        uint256 payout = amount - fee;

        if (fee > 0) {
            require(stakingToken.transfer(treasury, fee), "Fee transfer failed");
        }
        require(stakingToken.transfer(msg.sender, payout), "Withdraw transfer failed");

        emit Withdrawn(msg.sender, payout, fee);
    }

    function claimReward() public nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            uint256 available = rewardReserve();
            uint256 toPay = reward > available ? available : reward;
            require(toPay > 0, "Reward reserve empty");
            rewards[msg.sender] = reward - toPay;
            require(stakingToken.transfer(msg.sender, toPay), "Reward transfer failed");
            emit RewardPaid(msg.sender, toPay);
        }
    }

    function exit() external {
        uint256 bal = _balances[msg.sender];
        if (bal > 0) {
            withdraw(bal);
        }
        claimReward();
    }

    /**
     * @notice Owner deposits TAMIYANOIA reward tokens and starts/extends reward streaming.
     * @param amount Amount of TAMIYANOIA to pull from owner wallet (0 if already sent to contract).
     * @param durationDays Number of days to stream rewards (e.g., 30 or 90).
     */
    function fundRewards(uint256 amount, uint256 durationDays)
        external
        onlyOwner
        nonReentrant
        updateReward(address(0))
    {
        require(durationDays >= 1 && durationDays <= 365, "Duration 1-365 days");
        uint256 duration = durationDays * 1 days;

        uint256 added = 0;
        if (amount > 0) {
            uint256 beforeBal = stakingToken.balanceOf(address(this));
            require(stakingToken.transferFrom(msg.sender, address(this), amount), "Reward transfer failed");
            uint256 afterBal = stakingToken.balanceOf(address(this));
            added = afterBal > beforeBal ? afterBal - beforeBal : 0;
            require(added > 0, "Zero rewards received");
        }

        uint256 leftover = 0;
        if (block.timestamp < periodFinish) {
            uint256 remaining = periodFinish - block.timestamp;
            leftover = remaining * rewardRate;
        }

        uint256 totalRewardPool = added + leftover;
        uint256 reserve = rewardReserve();
        if (totalRewardPool > reserve) {
            totalRewardPool = reserve;
        }
        require(totalRewardPool > 0, "No reward tokens available");

        rewardsDuration = duration;
        rewardRate = totalRewardPool / duration;
        require(rewardRate > 0, "Reward rate is 0");

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;

        emit RewardsFunded(added, duration, rewardRate, periodFinish);
    }

    function setFeeConfig(uint16 _stakeFeeBps, uint16 _unstakeFeeBps, address _treasury) external onlyOwner {
        require(_stakeFeeBps <= 200 && _unstakeFeeBps <= 200, "Max fee 2%");
        require(_treasury != address(0), "Invalid treasury");
        stakeFeeBps = _stakeFeeBps;
        unstakeFeeBps = _unstakeFeeBps;
        treasury = _treasury;
        emit FeeConfigUpdated(_stakeFeeBps, _unstakeFeeBps, _treasury);
    }

    function setLockDuration(uint256 _lockDurationSeconds) external onlyOwner {
        require(_lockDurationSeconds <= 90 days, "Max 90 days");
        lockDuration = _lockDurationSeconds;
        emit LockDurationUpdated(_lockDurationSeconds);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Not pending owner");
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function recoverNonStakingToken(address tokenAddress, uint256 tokenAmount) external onlyOwner {
        require(tokenAddress != address(stakingToken), "Cannot withdraw staking token");
        require(IERC20(tokenAddress).transfer(owner, tokenAmount), "Recover failed");
    }
}
