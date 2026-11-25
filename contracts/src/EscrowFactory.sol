// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {RentalEscrow} from "./RentalEscrow.sol";

/// @title EscrowFactory
/// @notice Creates one {RentalEscrow} per lease as an EIP-1167 minimal proxy (~10x cheaper than a full
/// deployment) and indexes leases by participant so the frontend can list them without an indexer.
///
/// Business model: a one-time protocol fee per lease of `feeBps` of ONE month's rent (default 10%), deducted
/// from the landlord's first rent payout. Platform role: KeyEscrow's dispute desk is the `defaultArbiter`,
/// used whenever a landlord does not name an arbiter of their own.
///
/// Pilot caps (mainnet pilot): the owner sets a maximum deposit and rent per period for new leases, and a maximum
/// for the value all live escrows hold together ({activeValue}: deposits + unreleased rent). {createLease} checks the
/// first two, {RentalEscrow.fund} / {RentalEscrow.payRent} the last; payouts are never blocked by a cap. Lowering
/// `maxActiveValue` to 0 stops all new funding at once. `type(uint256).max` = unlimited (anvil, testnet).
/// @dev The owner can only tune the fee, the default arbiter and the caps for *future* funding; existing escrows
/// snapshot their terms at creation and are never upgradeable, so the owner has no power over funds already in escrow.
contract EscrowFactory is Ownable2Step {
    /// @notice Input for {createLease}. The caller becomes the landlord.
    struct LeaseParams {
        address tenant;
        address arbiter; // address(0) = the factory's defaultArbiter (KeyEscrow dispute desk)
        uint256 rentAmount;
        uint256 depositAmount;
        uint32 termMonths;
        uint32 responseWindow; // seconds; 0 = DEFAULT_RESPONSE_WINDOW
        uint32 arbiterWindow; // seconds; 0 = DEFAULT_ARBITER_WINDOW
        bytes32 leaseHash;
    }

    /// @notice Hard cap on the one-time fee: 10% of one month's rent.
    uint16 public constant MAX_FEE_BPS = 1_000;
    uint32 public constant MIN_TERM_MONTHS = 1;
    uint32 public constant MAX_TERM_MONTHS = 60;
    uint32 public constant MIN_RESPONSE_WINDOW = 1 days;
    uint32 public constant MAX_RESPONSE_WINDOW = 60 days;
    uint32 public constant DEFAULT_RESPONSE_WINDOW = 7 days;
    uint32 public constant MIN_ARBITER_WINDOW = 1 days;
    uint32 public constant MAX_ARBITER_WINDOW = 90 days;
    uint32 public constant DEFAULT_ARBITER_WINDOW = 14 days;

    /// @notice Escrow implementation every lease clones.
    address public immutable implementation;
    /// @notice Stablecoin all leases from this factory are denominated in (MockUSDT on testnet).
    IERC20 public immutable token;

    /// @notice One-time protocol fee for new leases, in bps of ONE month's rent.
    uint16 public feeBps;
    /// @notice KeyEscrow treasury receiving the protocol fee.
    address public feeRecipient;
    /// @notice KeyEscrow dispute desk; arbiter of every lease created without an explicit arbiter.
    address public defaultArbiter;

    /// @notice Pilot caps, in token units (see the contract notes). `type(uint256).max` = unlimited.
    uint256 public maxDeposit;
    uint256 public maxRentPerPeriod;
    uint256 public maxActiveValue;
    /// @notice Deposits + unreleased rent held by all escrows of this factory right now.
    uint256 public activeValue;

    address[] internal _leases;
    mapping(address => address[]) internal _leasesByLandlord;
    mapping(address => address[]) internal _leasesByTenant;
    mapping(address => address[]) internal _leasesByArbiter;
    mapping(address => bool) public isLease;

    event LeaseCreated(
        address indexed escrow,
        address indexed landlord,
        address indexed tenant,
        address arbiter,
        uint256 rentAmount,
        uint256 depositAmount,
        uint32 termMonths,
        uint32 responseWindow,
        uint32 arbiterWindow,
        bytes32 leaseHash
    );
    /// @notice Emitted by {createLeaseWithPayee}: the rental's owner payouts go to `payee`, not the owner.
    event PayeeSet(address indexed escrow, address indexed payee);
    event FeeUpdated(uint16 feeBps, address feeRecipient);
    event DefaultArbiterUpdated(address defaultArbiter);
    event CapsUpdated(uint256 maxDeposit, uint256 maxRentPerPeriod, uint256 maxActiveValue);

    error ZeroAddress();
    error RolesNotDistinct();
    error InvalidAmount();
    error InvalidTerm(uint32 termMonths);
    error InvalidResponseWindow(uint32 responseWindow);
    error InvalidArbiterWindow(uint32 arbiterWindow);
    error FeeTooHigh(uint16 feeBps);
    error DepositAboveCap(uint256 depositAmount, uint256 maxDeposit);
    error RentAboveCap(uint256 rentAmount, uint256 maxRentPerPeriod);
    error NotLease(address caller);

    constructor(
        IERC20 token_,
        address owner_,
        uint16 feeBps_,
        address feeRecipient_,
        address defaultArbiter_,
        uint256 maxDeposit_,
        uint256 maxRentPerPeriod_,
        uint256 maxActiveValue_
    ) Ownable(owner_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
        _setFee(feeBps_, feeRecipient_);
        _setDefaultArbiter(defaultArbiter_);
        _setCaps(maxDeposit_, maxRentPerPeriod_, maxActiveValue_);
        implementation = address(new RentalEscrow());
    }

    /// @notice Create a lease offer. The tenant activates it by calling {RentalEscrow.fund}.
    /// @dev `responseWindow` / `arbiterWindow` of 0 select the defaults (7 and 14 days).
    function createLease(LeaseParams calldata p) external returns (address escrow) {
        return _createLease(p, msg.sender);
    }

    /// @notice Same as {createLease}, but the owner's payouts (rent and any deposit claim) go to `payee`
    /// instead of the owner, e.g. a {FleetVault} whose shareholders own the scooter. The owner keeps every
    /// role in the rental (propose, accept, dispute, cancel); only the money is routed.
    /// The payee may not be the renter or the arbiter: an arbiter who receives the owner's deposit claim would
    /// rule on its own payout.
    function createLeaseWithPayee(LeaseParams calldata p, address payee) external returns (address escrow) {
        if (payee == address(0)) revert ZeroAddress();
        return _createLease(p, payee);
    }

    function _createLease(LeaseParams calldata p, address payee) internal returns (address escrow) {
        RentalEscrow.Terms memory t = _checkedTerms(p, msg.sender);
        if (payee == t.tenant || payee == t.arbiter) revert RolesNotDistinct();

        escrow = Clones.clone(implementation);
        RentalEscrow(escrow).initialize(t, payee);

        isLease[escrow] = true;
        _leases.push(escrow);
        _leasesByLandlord[t.landlord].push(escrow);
        _leasesByTenant[t.tenant].push(escrow);
        _leasesByArbiter[t.arbiter].push(escrow);

        // The only external call above is to our own freshly cloned escrow, so log ordering cannot be spoofed.
        // forge-lint: disable-next-item(reentrancy-events)
        emit LeaseCreated(
            escrow,
            t.landlord,
            t.tenant,
            t.arbiter,
            t.rentAmount,
            t.depositAmount,
            t.termMonths,
            t.responseWindow,
            t.arbiterWindow,
            t.leaseHash
        );
        // forge-lint: disable-next-line(reentrancy-events)
        if (payee != t.landlord) emit PayeeSet(escrow, payee);
    }

    /// @dev Validates the parameters and fills in the defaults and the current fee settings.
    function _checkedTerms(LeaseParams calldata p, address landlord)
        internal
        view
        returns (RentalEscrow.Terms memory)
    {
        address arbiter = p.arbiter == address(0) ? defaultArbiter : p.arbiter;
        if (p.tenant == address(0) || arbiter == address(0)) revert ZeroAddress();
        if (p.tenant == landlord || arbiter == landlord || arbiter == p.tenant) {
            revert RolesNotDistinct();
        }
        if (p.rentAmount == 0 || p.depositAmount == 0) revert InvalidAmount();
        if (p.depositAmount > maxDeposit) revert DepositAboveCap(p.depositAmount, maxDeposit);
        if (p.rentAmount > maxRentPerPeriod) revert RentAboveCap(p.rentAmount, maxRentPerPeriod);
        if (p.termMonths < MIN_TERM_MONTHS || p.termMonths > MAX_TERM_MONTHS) {
            revert InvalidTerm(p.termMonths);
        }
        uint32 responseWindow = p.responseWindow == 0 ? DEFAULT_RESPONSE_WINDOW : p.responseWindow;
        if (responseWindow < MIN_RESPONSE_WINDOW || responseWindow > MAX_RESPONSE_WINDOW) {
            revert InvalidResponseWindow(responseWindow);
        }
        uint32 arbiterWindow = p.arbiterWindow == 0 ? DEFAULT_ARBITER_WINDOW : p.arbiterWindow;
        if (arbiterWindow < MIN_ARBITER_WINDOW || arbiterWindow > MAX_ARBITER_WINDOW) {
            revert InvalidArbiterWindow(arbiterWindow);
        }
        return RentalEscrow.Terms({
            token: token,
            landlord: landlord,
            tenant: p.tenant,
            arbiter: arbiter,
            rentAmount: p.rentAmount,
            depositAmount: p.depositAmount,
            termMonths: p.termMonths,
            responseWindow: responseWindow,
            arbiterWindow: arbiterWindow,
            leaseHash: p.leaseHash,
            feeBps: feeBps,
            feeRecipient: feeRecipient
        });
    }

    /// @notice Update the one-time protocol fee (bps of one month's rent) for leases created from now on.
    function setFee(uint16 feeBps_, address feeRecipient_) external onlyOwner {
        _setFee(feeBps_, feeRecipient_);
    }

    /// @notice Update the dispute desk used for leases created from now on. address(0) disables the default,
    /// so every new lease must then name an arbiter explicitly.
    function setDefaultArbiter(address defaultArbiter_) external onlyOwner {
        _setDefaultArbiter(defaultArbiter_);
    }

    /// @notice Set the pilot caps (raise or lower, any time). They apply to new leases and to new funding.
    function setCaps(uint256 maxDeposit_, uint256 maxRentPerPeriod_, uint256 maxActiveValue_)
        external
        onlyOwner
    {
        _setCaps(maxDeposit_, maxRentPerPeriod_, maxActiveValue_);
    }

    // --- Value book (called by this factory's escrows) ---------------------------------------------

    /// @notice An escrow takes in `amount` (fund / payRent); reverts above `maxActiveValue`.
    function lockValue(uint256 amount) external {
        if (!isLease[msg.sender]) revert NotLease(msg.sender);
        uint256 v = activeValue + amount;
        if (v > maxActiveValue) revert RentalEscrow.ActiveValueAboveCap(v, maxActiveValue);
        activeValue = v;
    }

    /// @notice An escrow paid out `amount`. Never reverts for a lease, so a cap can never block a payout.
    function unlockValue(uint256 amount) external {
        if (!isLease[msg.sender]) revert NotLease(msg.sender);
        uint256 v = activeValue;
        // Each escrow unlocks exactly what it locked; saturating anyway, a payout must never fail on bookkeeping.
        activeValue = v > amount ? v - amount : 0;
    }

    // --- Views -----------------------------------------------------------------------------------

    function leaseCount() external view returns (uint256) {
        return _leases.length;
    }

    /// @notice Paginated list of all leases.
    function leases(uint256 offset, uint256 limit) external view returns (address[] memory) {
        return _slice(_leases, offset, limit);
    }

    function leasesByLandlord(address who) external view returns (address[] memory) {
        return _leasesByLandlord[who];
    }

    function leasesByTenant(address who) external view returns (address[] memory) {
        return _leasesByTenant[who];
    }

    function leasesByArbiter(address who) external view returns (address[] memory) {
        return _leasesByArbiter[who];
    }

    // --- Internals -------------------------------------------------------------------------------

    function _setFee(uint16 feeBps_, address feeRecipient_) internal {
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh(feeBps_);
        if (feeBps_ > 0 && feeRecipient_ == address(0)) revert ZeroAddress();
        feeBps = feeBps_;
        feeRecipient = feeRecipient_;
        emit FeeUpdated(feeBps_, feeRecipient_);
    }

    function _setCaps(uint256 maxDeposit_, uint256 maxRentPerPeriod_, uint256 maxActiveValue_) internal {
        maxDeposit = maxDeposit_;
        maxRentPerPeriod = maxRentPerPeriod_;
        maxActiveValue = maxActiveValue_;
        emit CapsUpdated(maxDeposit_, maxRentPerPeriod_, maxActiveValue_);
    }

    function _setDefaultArbiter(address defaultArbiter_) internal {
        defaultArbiter = defaultArbiter_;
        emit DefaultArbiterUpdated(defaultArbiter_);
    }

    function _slice(address[] storage arr, uint256 offset, uint256 limit)
        internal
        view
        returns (address[] memory out)
    {
        uint256 len = arr.length;
        if (offset >= len) return new address[](0);
        uint256 end = offset + limit > len ? len : offset + limit;
        out = new address[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            out[i - offset] = arr[i];
        }
    }
}
