// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// @title FleetVault
/// @notice Minimal fleet vault (testnet prototype). Investors deposit the stablecoin and receive fleet shares
/// (this ERC-20, e.g. "BKK-FLEET-1") 1:1. Rentals created with the vault as payee
/// ({EscrowFactory.createLeaseWithPayee}) pay the owner's rent and any deposit claim (damage payout) straight
/// into the vault. That income, minus the operator's maintenance fee, is shared pro rata over the shares and can
/// be claimed at any time.
///
/// How income is counted: the vault never needs a callback from the escrow. Every token above
/// `totalPrincipal` (investor deposits) + `reservedIncome` (credited but unclaimed) is new income. {sync}
/// (also run by deposit, redeem and claim) takes the operator fee from it and credits the rest to the shares
/// through a per-share accumulator, so claims stay O(1) for any number of shareholders.
///
/// Out of scope (pitch only, see docs/PRODUCT.md): deploying the principal into new scooters, secondary
/// trading, compliant issuance. Principal sits in the vault and can be redeemed 1:1.
/// @dev Income that arrives while no shares exist goes to the operator at the next sync: nobody earned it, and
/// crediting it to the next depositor would let a 1-unit deposit plus a claim take all of it.
contract FleetVault is ERC20, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;
    /// @notice Hard cap on the operator's maintenance fee: 30% of income.
    uint16 public constant MAX_OPERATOR_FEE_BPS = 3_000;
    uint256 internal constant PRECISION = 1e18;
    /// @notice Shares cannot be redeemed or transferred until this long after the holder's latest deposit.
    /// Income is credited to whoever holds shares when it arrives, and anyone can trigger an escrow payout
    /// (releaseRent, claimTimeout, ...). Without the lock, deposit -> trigger payout -> claim -> redeem in one
    /// transaction (flash loan) would skim most of the income from long-term shareholders.
    uint256 public constant SHARE_LOCK = 7 days;

    IERC20 public immutable asset;
    /// @notice Fleet operator (maintenance): receives `operatorFeeBps` of every income.
    address public immutable operator;
    uint16 public immutable operatorFeeBps;
    uint8 internal immutable _decimals;

    /// @notice Investor deposits held by the vault; redeemable 1:1 against shares.
    uint256 public totalPrincipal;
    /// @notice Income credited to shareholders and not claimed yet.
    uint256 public reservedIncome;
    /// @notice Income per share credited so far, scaled by 1e18.
    uint256 public accIncomePerShare;
    /// @notice Lifetime totals, for the investor dashboard.
    uint256 public totalDistributed;
    uint256 public totalOperatorFees;
    uint256 public totalClaimed;

    mapping(address => uint256) internal _accPaid;
    mapping(address => uint256) internal _credited;
    /// @notice Until when `investor`'s shares are locked (see {SHARE_LOCK}). Claiming income is never locked.
    mapping(address => uint256) public lockedUntil;

    event Deposited(address indexed investor, uint256 amount);
    event Redeemed(address indexed investor, uint256 shares);
    event IncomeDistributed(
        uint256 income, uint256 operatorFee, uint256 toShareholders, uint256 accIncomePerShare
    );
    event Claimed(address indexed investor, uint256 amount);

    error ZeroAddress();
    error InvalidAmount();
    error FeeTooHigh(uint16 feeBps);
    error NothingToClaim();
    error TransferShortfall(uint256 expected, uint256 received);
    error SharesLocked(uint256 until);

    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address operator_,
        uint16 operatorFeeBps_
    ) ERC20(name_, symbol_) {
        if (address(asset_) == address(0) || operator_ == address(0)) revert ZeroAddress();
        if (operatorFeeBps_ > MAX_OPERATOR_FEE_BPS) revert FeeTooHigh(operatorFeeBps_);
        asset = asset_;
        operator = operator_;
        operatorFeeBps = operatorFeeBps_;
        _decimals = IERC20Metadata(address(asset_)).decimals();
    }

    /// @notice Shares have the same decimals as the stablecoin: 1 share per 1 token deposited.
    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    // ---------------------------------------------------------------------------------------------
    // Investor actions
    // ---------------------------------------------------------------------------------------------

    /// @notice Deposit `amount` of the stablecoin and receive the same number of fleet shares.
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        _sync(); // income that arrived before this deposit belongs to the existing shareholders
        uint256 before = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = asset.balanceOf(address(this)) - before;
        if (received != amount) revert TransferShortfall(amount, received);
        totalPrincipal += amount;
        lockedUntil[msg.sender] = block.timestamp + SHARE_LOCK;
        _mint(msg.sender, amount);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Burn `shares` and get the same amount of principal back. Credited income stays claimable.
    /// Reverts with {SharesLocked} within {SHARE_LOCK} of the caller's latest deposit.
    function redeem(uint256 shares) external nonReentrant {
        if (shares == 0) revert InvalidAmount();
        _sync();
        _burn(msg.sender, shares);
        totalPrincipal -= shares;
        asset.safeTransfer(msg.sender, shares);
        emit Redeemed(msg.sender, shares);
    }

    /// @notice Claim all income credited to the caller's shares.
    function claim() external nonReentrant returns (uint256 amount) {
        _sync();
        _accrue(msg.sender);
        amount = _credited[msg.sender];
        if (amount == 0) revert NothingToClaim();
        _credited[msg.sender] = 0;
        reservedIncome -= amount;
        totalClaimed += amount;
        asset.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    /// @notice Credit income that arrived since the last sync (anyone may call it).
    function sync() external nonReentrant returns (uint256 toShareholders) {
        return _sync();
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    /// @notice Tokens held by the vault (TVL): principal + unclaimed income + income not synced yet.
    function totalAssets() external view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    /// @notice Income received but not yet split by {sync}.
    function unsyncedIncome() public view returns (uint256) {
        uint256 bal = asset.balanceOf(address(this));
        uint256 accounted = totalPrincipal + reservedIncome;
        return bal > accounted ? bal - accounted : 0;
    }

    /// @notice Income `investor` could claim right now, including their part of not-yet-synced income.
    function claimable(address investor) external view returns (uint256) {
        uint256 acc = accIncomePerShare;
        uint256 supply = totalSupply();
        if (supply > 0) {
            uint256 income = unsyncedIncome();
            acc += ((income - (income * operatorFeeBps) / BPS) * PRECISION) / supply;
        }
        return _credited[investor] + (balanceOf(investor) * (acc - _accPaid[investor])) / PRECISION;
    }

    // ---------------------------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------------------------

    function _sync() internal returns (uint256 toShareholders) {
        uint256 income = unsyncedIncome();
        if (income == 0) return 0;
        uint256 supply = totalSupply();

        // No shares: all of it goes to the operator (see the contract's @dev).
        uint256 fee = supply == 0 ? income : (income * operatorFeeBps) / BPS;
        toShareholders = income - fee;
        // Per-share rounding leaves a few base units unclaimable; they stay reserved so the vault is always solvent.
        if (supply > 0) accIncomePerShare += (toShareholders * PRECISION) / supply;
        reservedIncome += toShareholders;
        totalDistributed += toShareholders;
        totalOperatorFees += fee;

        emit IncomeDistributed(income, fee, toShareholders, accIncomePerShare);
        if (fee > 0) asset.safeTransfer(operator, fee);
    }

    function _accrue(address who) internal {
        uint256 acc = accIncomePerShare;
        uint256 owed = (balanceOf(who) * (acc - _accPaid[who])) / PRECISION;
        if (owed > 0) _credited[who] += owed;
        _accPaid[who] = acc;
    }

    /// @dev Settle both sides' income at the old balances before shares move (mint, burn and transfer).
    /// Shares leaving an account (redeem or transfer) must be past the account's deposit lock.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && block.timestamp < lockedUntil[from]) {
            revert SharesLocked(lockedUntil[from]);
        }
        // A transfer first credits income that arrived but was not synced yet, so the seller keeps it (audit #10).
        // deposit and redeem sync themselves (a mint must not: its tokens are in the balance, not in principal yet).
        if (from != address(0) && to != address(0)) _sync();
        if (from != address(0)) _accrue(from);
        if (to != address(0)) _accrue(to);
        super._update(from, to, value);
    }
}
