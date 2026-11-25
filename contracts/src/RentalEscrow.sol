// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// @title RentalEscrow
/// @notice Escrow for a single lease: holds the security deposit and prepaid rent in a stablecoin.
///
/// Lifecycle:
///   Created  --fund()-->            Active
///   Created  --cancel()-->          Cancelled
///   Active   --propose()-->         MoveOut   (either party proposes a deposit split)
///   MoveOut  --propose()-->         MoveOut   (counter-proposal, resets the clock)
///   MoveOut  --accept()-->          Settled   (counterparty agrees -> instant payout)
///   MoveOut  --claimTimeout()-->    Settled   (landlord silent on a tenant proposal -> tenant's terms apply)
///   Active/MoveOut --dispute()-->   Disputed
///   Disputed --resolve()-->         Settled   (arbiter rules)
///
/// Rent: month `i` (0-based) is due at `startTime + i * RENT_PERIOD`. Funded rent for a due month can be
/// released to the landlord by anyone (keeper-friendly); the tenant may release funded rent early.
/// On settlement, funded rent that is due goes to the landlord and prepaid rent that is not yet due is
/// refunded to the tenant.
///
/// Security model: no single party can move the deposit. It leaves the contract only through mutual
/// agreement, the arbiter's ruling, or the landlord-response timeout. Rent only ever flows to the
/// landlord according to the schedule fixed at creation.
/// @dev Deployed as EIP-1167 minimal proxies by {EscrowFactory}; configured once through {initialize}.
contract RentalEscrow is Initializable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------------------------------

    enum Status {
        Created,
        Active,
        MoveOut,
        Disputed,
        Settled,
        Cancelled
    }

    enum EvidenceKind {
        CheckIn,
        CheckOut,
        Other
    }

    /// @notice Immutable lease terms, fixed at creation.
    struct Terms {
        IERC20 token;
        address landlord;
        address tenant;
        address arbiter;
        uint256 rentAmount; // per RENT_PERIOD, in token units
        uint256 depositAmount; // in token units
        uint32 termMonths; // number of rent periods
        uint32 responseWindow; // seconds the landlord has to answer a tenant proposal
        bytes32 leaseHash; // content hash of the off-chain lease document
        uint16 feeBps; // protocol fee on released rent, snapshotted from the factory
        address feeRecipient;
    }

    /// @notice The current deposit-split proposal during move-out.
    struct Proposal {
        uint256 tenantRefund;
        uint256 landlordClaim;
        bytes32 reportHash; // hash of the (AI) inspection report backing the proposal
        address proposer;
        uint64 proposedAt;
        uint32 nonce; // increments on every proposal; guards accept() against front-running
    }

    // ---------------------------------------------------------------------------------------------
    // Constants & storage
    // ---------------------------------------------------------------------------------------------

    uint256 public constant RENT_PERIOD = 30 days;
    uint16 public constant BPS = 10_000;

    Terms internal _terms;
    Proposal internal _proposal;

    Status public status;
    uint64 public startTime;
    uint32 public monthsFunded;
    uint32 public monthsReleased;
    bytes32 public checkInHash;
    bytes32 public checkOutHash;

    // ---------------------------------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------------------------------

    event Funded(address indexed tenant, uint256 deposit, uint256 firstRent, uint64 startTime);
    event RentPaid(address indexed tenant, uint32 months, uint256 amount, uint32 monthsFunded);
    event RentReleased(address indexed caller, uint32 months, uint256 toLandlord, uint256 fee);
    event EvidenceAdded(EvidenceKind indexed kind, bytes32 contentHash, address indexed by);
    event SettlementProposed(
        address indexed proposer,
        uint32 nonce,
        uint256 tenantRefund,
        uint256 landlordClaim,
        bytes32 reportHash
    );
    event DisputeRaised(address indexed by);
    event Settled(
        uint256 tenantRefund,
        uint256 landlordClaim,
        uint256 rentToLandlord,
        uint256 rentToTenant,
        uint256 fee,
        bytes32 basis
    );
    event Cancelled();

    // ---------------------------------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------------------------------

    error InvalidStatus(Status current);
    error Unauthorized(address caller);
    error InvalidAmount();
    error InvalidNonce(uint32 expected, uint32 provided);
    error ProposerCannotAccept();
    error TimeoutNotReached(uint64 deadline);
    error TimeoutNotApplicable();
    error NothingToRelease();
    error TermFullyFunded();
    error TransferShortfall(uint256 expected, uint256 received);

    // ---------------------------------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------------------------------

    modifier only(address who) {
        if (msg.sender != who) revert Unauthorized(msg.sender);
        _;
    }

    modifier onlyParty() {
        if (msg.sender != _terms.landlord && msg.sender != _terms.tenant) revert Unauthorized(msg.sender);
        _;
    }

    modifier inStatus(Status expected) {
        if (status != expected) revert InvalidStatus(status);
        _;
    }

    // ---------------------------------------------------------------------------------------------
    // Setup
    // ---------------------------------------------------------------------------------------------

    constructor() {
        _disableInitializers();
    }

    /// @notice Called once by the factory right after cloning. Validation lives in the factory.
    function initialize(Terms calldata terms) external initializer {
        _terms = terms;
        status = Status.Created;
    }

    // ---------------------------------------------------------------------------------------------
    // Funding & rent
    // ---------------------------------------------------------------------------------------------

    /// @notice Tenant funds deposit + first month's rent. Starts the lease clock.
    function fund() external nonReentrant only(_terms.tenant) inStatus(Status.Created) {
        status = Status.Active;
        // forge-lint: disable-next-line(unsafe-typecast) -- uint64 seconds overflow in ~5e11 years
        startTime = uint64(block.timestamp);
        monthsFunded = 1;

        uint256 amount = _terms.depositAmount + _terms.rentAmount;
        _pull(amount);

        emit Funded(msg.sender, _terms.depositAmount, _terms.rentAmount, startTime);
    }

    /// @notice Tenant prepays `months` additional months of rent into escrow.
    function payRent(uint32 months) external nonReentrant only(_terms.tenant) inStatus(Status.Active) {
        if (months == 0) revert InvalidAmount();
        if (uint256(monthsFunded) + months > _terms.termMonths) revert TermFullyFunded();

        monthsFunded += months;
        uint256 amount = _terms.rentAmount * months;
        _pull(amount);

        emit RentPaid(msg.sender, months, amount, monthsFunded);
    }

    /// @notice Release funded rent to the landlord.
    /// @dev Anyone may release funded months that are due. The tenant may also release funded months early.
    function releaseRent() external nonReentrant {
        Status s = status;
        if (s != Status.Active && s != Status.MoveOut && s != Status.Disputed) revert InvalidStatus(s);

        uint32 upTo = msg.sender == _terms.tenant ? monthsFunded : _releasableUpTo();
        if (upTo <= monthsReleased) revert NothingToRelease();

        uint32 months = upTo - monthsReleased;
        monthsReleased = upTo;

        (uint256 toLandlord, uint256 fee) = _payRent(uint256(months) * _terms.rentAmount);
        emit RentReleased(msg.sender, months, toLandlord, fee);
    }

    // ---------------------------------------------------------------------------------------------
    // Evidence
    // ---------------------------------------------------------------------------------------------

    /// @notice Anchor the content hash of off-chain evidence (photos, inspection report, ...).
    /// @dev The files themselves live on BNB Greenfield (or the local fallback store), never on-chain.
    function addEvidence(EvidenceKind kind, bytes32 contentHash) external onlyParty {
        Status s = status;
        if (s == Status.Settled || s == Status.Cancelled) revert InvalidStatus(s);
        if (contentHash == bytes32(0)) revert InvalidAmount();

        if (kind == EvidenceKind.CheckIn) checkInHash = contentHash;
        else if (kind == EvidenceKind.CheckOut) checkOutHash = contentHash;

        emit EvidenceAdded(kind, contentHash, msg.sender);
    }

    // ---------------------------------------------------------------------------------------------
    // Move-out settlement
    // ---------------------------------------------------------------------------------------------

    /// @notice Propose how the deposit is split. Either party; a new proposal replaces the previous one.
    /// @param tenantRefund Amount of the deposit returned to the tenant; the rest goes to the landlord.
    /// @param reportHash Hash of the inspection report (e.g. the AI settlement JSON) backing the proposal.
    function propose(uint256 tenantRefund, bytes32 reportHash) external onlyParty {
        Status s = status;
        if (s != Status.Active && s != Status.MoveOut) revert InvalidStatus(s);
        if (tenantRefund > _terms.depositAmount) revert InvalidAmount();

        status = Status.MoveOut;
        uint32 nonce = _proposal.nonce + 1;
        uint256 landlordClaim = _terms.depositAmount - tenantRefund;
        _proposal = Proposal({
            tenantRefund: tenantRefund,
            landlordClaim: landlordClaim,
            reportHash: reportHash,
            proposer: msg.sender,
            // forge-lint: disable-next-line(unsafe-typecast) -- uint64 seconds overflow in ~5e11 years
            proposedAt: uint64(block.timestamp),
            nonce: nonce
        });

        emit SettlementProposed(msg.sender, nonce, tenantRefund, landlordClaim, reportHash);
    }

    /// @notice Counterparty accepts the current proposal; funds settle immediately.
    /// @param nonce The proposal nonce the caller reviewed, so a last-second replacement cannot be accepted blindly.
    function accept(uint32 nonce) external nonReentrant onlyParty inStatus(Status.MoveOut) {
        Proposal memory p = _proposal;
        if (nonce != p.nonce) revert InvalidNonce(p.nonce, nonce);
        if (msg.sender == p.proposer) revert ProposerCannotAccept();

        _settle(p.tenantRefund, p.landlordClaim, p.reportHash);
    }

    /// @notice If the landlord does not answer a tenant proposal within `responseWindow`, the tenant's terms apply.
    /// @dev Callable by anyone; funds only ever go to the parties.
    function claimTimeout() external nonReentrant inStatus(Status.MoveOut) {
        Proposal memory p = _proposal;
        if (p.proposer != _terms.tenant) revert TimeoutNotApplicable();
        uint64 deadline = p.proposedAt + _terms.responseWindow;
        if (block.timestamp < deadline) revert TimeoutNotReached(deadline);

        _settle(p.tenantRefund, p.landlordClaim, p.reportHash);
    }

    /// @notice Escalate to the arbiter.
    function dispute() external onlyParty {
        Status s = status;
        if (s != Status.Active && s != Status.MoveOut) revert InvalidStatus(s);
        status = Status.Disputed;
        emit DisputeRaised(msg.sender);
    }

    /// @notice Arbiter rules on the deposit split.
    /// @param rulingHash Hash of the arbiter's written ruling.
    function resolve(uint256 tenantRefund, bytes32 rulingHash)
        external
        nonReentrant
        only(_terms.arbiter)
        inStatus(Status.Disputed)
    {
        if (tenantRefund > _terms.depositAmount) revert InvalidAmount();
        _settle(tenantRefund, _terms.depositAmount - tenantRefund, rulingHash);
    }

    /// @notice Landlord withdraws an unfunded lease offer.
    function cancel() external only(_terms.landlord) inStatus(Status.Created) {
        status = Status.Cancelled;
        emit Cancelled();
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    function terms() external view returns (Terms memory) {
        return _terms;
    }

    function proposal() external view returns (Proposal memory) {
        return _proposal;
    }

    /// @notice Number of rent periods whose due date has passed (0 before funding).
    function monthsDue() public view returns (uint32) {
        if (startTime == 0) return 0;
        uint256 due = (block.timestamp - startTime) / RENT_PERIOD + 1;
        // forge-lint: disable-next-line(unsafe-typecast) -- due <= termMonths (uint32) on this branch
        return due > _terms.termMonths ? _terms.termMonths : uint32(due);
    }

    /// @notice Due date of rent period `month` (0-based).
    function dueDate(uint32 month) external view returns (uint64) {
        // forge-lint: disable-next-line(unsafe-typecast) -- RENT_PERIOD is a small constant
        return startTime + uint64(month) * uint64(RENT_PERIOD);
    }

    /// @notice Timestamp at which {claimTimeout} becomes callable, or 0 if not applicable.
    function timeoutAt() external view returns (uint64) {
        if (status != Status.MoveOut || _proposal.proposer != _terms.tenant) return 0;
        return _proposal.proposedAt + _terms.responseWindow;
    }

    // ---------------------------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------------------------

    function _releasableUpTo() internal view returns (uint32) {
        uint32 due = monthsDue();
        return due < monthsFunded ? due : monthsFunded;
    }

    /// @dev Pulls exactly `amount` from the caller; rejects fee-on-transfer style shortfalls.
    function _pull(uint256 amount) internal {
        IERC20 token = _terms.token;
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - before;
        if (received != amount) revert TransferShortfall(amount, received);
    }

    /// @dev Sends `gross` rent to the landlord minus the protocol fee.
    function _payRent(uint256 gross) internal returns (uint256 toLandlord, uint256 fee) {
        fee = (gross * _terms.feeBps) / BPS;
        toLandlord = gross - fee;
        if (fee > 0) _terms.token.safeTransfer(_terms.feeRecipient, fee);
        _terms.token.safeTransfer(_terms.landlord, toLandlord);
    }

    /// @dev Final payout. State is written before any transfer (checks-effects-interactions).
    function _settle(uint256 tenantRefund, uint256 landlordClaim, bytes32 basis) internal {
        status = Status.Settled;

        // Remaining funded rent: due months go to the landlord, prepaid future months back to the tenant.
        // (The tenant may already have released months early, so never go below monthsReleased.)
        uint32 releasableUpTo = _releasableUpTo();
        if (releasableUpTo < monthsReleased) releasableUpTo = monthsReleased;
        uint256 rentToLandlord = uint256(releasableUpTo - monthsReleased) * _terms.rentAmount;
        uint256 rentToTenant = uint256(monthsFunded - releasableUpTo) * _terms.rentAmount;
        monthsReleased = releasableUpTo;

        uint256 fee = 0;
        if (rentToLandlord > 0) (, fee) = _payRent(rentToLandlord);
        if (landlordClaim > 0) _terms.token.safeTransfer(_terms.landlord, landlordClaim);

        uint256 toTenant = tenantRefund + rentToTenant;
        if (toTenant > 0) _terms.token.safeTransfer(_terms.tenant, toTenant);

        emit Settled(tenantRefund, landlordClaim, rentToLandlord, rentToTenant, fee, basis);
    }
}
