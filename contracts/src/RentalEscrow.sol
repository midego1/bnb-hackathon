// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// @notice The part of {EscrowFactory} an escrow calls: it books the value every escrow holds against the pilot cap.
interface IValueBook {
    function lockValue(uint256 amount) external;
    function unlockValue(uint256 amount) external;
}

/// @title RentalEscrow
/// @notice Escrow for a single lease: holds the security deposit and prepaid rent in a stablecoin.
///
/// Lifecycle:
///   Created  --fund()-->            Active
///   Created  --cancel()-->          Cancelled
///   Active   --propose()-->         MoveOut   (either party proposes a deposit split)
///   MoveOut  --propose()-->         MoveOut   (counter-proposal, resets the clock)
///   MoveOut  --accept()-->          Settled   (counterparty agrees -> instant payout)
///   MoveOut  --claimTimeout()-->    Settled   (landlord silent on a tenant proposal -> full deposit to tenant)
///   Active/MoveOut --dispute()-->   Disputed
///   Disputed --resolve()-->         Settled   (arbiter rules before the arbiter deadline)
///   Disputed --claimArbiterTimeout()--> Settled (arbiter silent past the deadline -> full deposit to tenant)
///
/// Rent: each lease has its own rent period (`rentPeriod`: 7, 14 or 30 days) and `rentAmount` per period.
/// Period `i` (0-based) is due at `startTime + i * rentPeriod`. Funded rent for a due period can be
/// released to the landlord by anyone (keeper-friendly); the tenant may release funded rent early.
/// The rent clock stops when the move-out starts (the first {propose} or {dispute}, see `moveOutAt`): how long
/// settlement then takes (response window, counter-proposals, arbiter window) never turns prepaid rent into rent
/// due. On settlement, funded rent that was due at the move-out goes to the landlord and the rest of the prepaid
/// rent is refunded to the tenant.
///
/// Protocol fee: once per lease, `feeBps` of ONE month's rent (monthly equivalent: `rentAmount * 30 days /
/// rentPeriod`) is deducted from the first rent payout to the
/// landlord and sent to `feeRecipient` (both snapshotted from the factory at creation). The fee is never
/// taken from the deposit and never charged to the tenant.
///
/// Security model: no single party can move the deposit. It leaves the contract only through mutual
/// agreement, the arbiter's ruling, or one of the two timeouts. Rent only ever flows to the
/// landlord according to the schedule fixed at creation.
///
/// Timeouts (both put the burden of proof on the landlord, who holds no funds and must actively claim):
///   - Landlord-response timeout: a tenant proposal left unanswered (no accept, counter-proposal or
///     dispute) for `responseWindow` seconds returns the FULL deposit to the tenant, regardless of the
///     split the tenant proposed. A silent landlord has not substantiated any claim. The deadline is hard:
///     from that moment propose/accept/dispute revert, so a late landlord cannot race {claimTimeout}.
///   - Arbiter-deadline fallback: a dispute the arbiter has not resolved within `arbiterWindow` seconds
///     can be closed by anyone, returning the FULL deposit to the tenant. From that moment the arbiter can
///     no longer rule, so the outcome is deterministic and cannot be raced.
///   In both cases rent already released stays released, funded rent that is due goes to the landlord and
///   prepaid rent that is not yet due goes back to the tenant (exactly as in every other settlement).
///   This is a product policy, not a technical necessity: to change it (e.g. split 50/50 or return the
///   deposit to the landlord), change the amounts passed to {_settle} in {claimTimeout} and
///   {claimArbiterTimeout}.
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
        uint256 rentAmount; // per rent period, in token units
        uint256 depositAmount; // in token units
        uint32 termPeriods; // number of rent periods
        uint32 rentPeriod; // seconds per rent period: 7, 14 or 30 days (checked by the factory)
        uint32 responseWindow; // seconds the landlord has to answer a tenant proposal
        uint32 arbiterWindow; // seconds the arbiter has to resolve an open dispute
        bytes32 leaseHash; // content hash of the off-chain lease document
        uint16 feeBps; // one-time protocol fee as bps of ONE month's rent, snapshotted from the factory
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

    /// @notice The fee is a share of one month's rent; a month is 30 days whatever the lease's rent period.
    uint256 public constant MONTH = 30 days;
    uint16 public constant BPS = 10_000;

    /// @notice `basis` of the {Settled} event when the landlord-response timeout settled the lease.
    bytes32 public constant LANDLORD_TIMEOUT_BASIS = keccak256("keyescrow.timeout.landlord-response");
    /// @notice `basis` of the {Settled} event when the arbiter-deadline fallback settled the lease.
    bytes32 public constant ARBITER_TIMEOUT_BASIS = keccak256("keyescrow.timeout.arbiter-deadline");

    /// @notice The factory that deployed this implementation; every clone books its funds there (pilot caps).
    /// @dev Immutable in the implementation's code, so every clone reads the same factory for free.
    IValueBook public immutable factory;

    Terms internal _terms;
    Proposal internal _proposal;

    Status public status;
    uint64 public startTime;
    uint64 public disputedAt; // timestamp the current dispute was raised (0 if never disputed)
    /// @notice When the move-out started (first {propose} or {dispute}); the rent clock stops here. 0 while active.
    uint64 public moveOutAt;
    uint32 public periodsFunded;
    uint32 public periodsReleased;
    bool public feeCharged; // the one-time protocol fee has been taken from a rent payout
    bytes32 public checkInHash;
    bytes32 public checkOutHash;
    /// @notice Where the owner's money (rent and any deposit claim) is paid: the owner, or e.g. a {FleetVault}.
    /// Set once at creation; the owner keeps every role in the rental, only the payout address differs.
    address public payee;

    // ---------------------------------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------------------------------

    event Funded(address indexed tenant, uint256 deposit, uint256 firstRent, uint64 startTime);
    event RentPaid(address indexed tenant, uint32 periods, uint256 amount, uint32 periodsFunded);
    event RentReleased(address indexed caller, uint32 periods, uint256 toLandlord, uint256 fee);
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
    event ProtocolFeePaid(address indexed recipient, uint256 amount);

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
    error ArbiterDeadlinePassed(uint64 deadline);
    error NothingToRelease();
    error TermFullyFunded();
    error TransferShortfall(uint256 expected, uint256 received);
    error ResponseWindowClosed(uint64 deadline);
    /// @notice Raised by the factory (its pilot cap) and bubbled up through {fund} / {payRent}; declared here so
    /// clients decode it with the escrow's ABI.
    error ActiveValueAboveCap(uint256 activeValue, uint256 cap);

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
        factory = IValueBook(msg.sender);
        _disableInitializers();
    }

    /// @notice Called once by the factory right after cloning. Validation lives in the factory.
    /// @param payee_ Receives the owner's payouts; the factory passes the owner itself unless a payee was chosen.
    // forge-lint: disable-next-line(missing-zero-check) -- the factory always passes the owner or a checked payee
    function initialize(Terms calldata terms_, address payee_) external initializer {
        _terms = terms_;
        payee = payee_;
        status = Status.Created;
    }

    // ---------------------------------------------------------------------------------------------
    // Funding & rent
    // ---------------------------------------------------------------------------------------------

    /// @notice Tenant funds deposit + the first period's rent. Starts the lease clock.
    function fund() external nonReentrant only(_terms.tenant) inStatus(Status.Created) {
        status = Status.Active;
        // forge-lint: disable-next-line(unsafe-typecast) -- uint64 seconds overflow in ~5e11 years
        startTime = uint64(block.timestamp);
        periodsFunded = 1;

        uint256 amount = _terms.depositAmount + _terms.rentAmount;
        _pull(amount);

        emit Funded(msg.sender, _terms.depositAmount, _terms.rentAmount, startTime);
        factory.lockValue(amount); // reverts above the factory's pilot cap
    }

    /// @notice Tenant prepays `periods` additional periods of rent into escrow.
    function payRent(uint32 periods) external nonReentrant only(_terms.tenant) inStatus(Status.Active) {
        if (periods == 0) revert InvalidAmount();
        if (uint256(periodsFunded) + periods > _terms.termPeriods) revert TermFullyFunded();

        periodsFunded += periods;
        uint256 amount = _terms.rentAmount * periods;
        _pull(amount);

        emit RentPaid(msg.sender, periods, amount, periodsFunded);
        factory.lockValue(amount);
    }

    /// @notice Release funded rent to the landlord.
    /// @dev Anyone may release funded periods that are due. The tenant may also release funded periods early.
    function releaseRent() external nonReentrant {
        Status s = status;
        if (s != Status.Active && s != Status.MoveOut && s != Status.Disputed) revert InvalidStatus(s);

        uint32 upTo = msg.sender == _terms.tenant ? periodsFunded : _releasableUpTo();
        if (upTo <= periodsReleased) revert NothingToRelease();

        uint32 periods = upTo - periodsReleased;
        periodsReleased = upTo;

        uint256 gross = uint256(periods) * _terms.rentAmount;
        (uint256 toLandlord, uint256 fee) = _payRent(gross);
        emit RentReleased(msg.sender, periods, toLandlord, fee);
        factory.unlockValue(gross);
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
        _requireResponseWindowOpen();
        if (tenantRefund > _terms.depositAmount) revert InvalidAmount();

        if (s == Status.Active) _startMoveOut();
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
        _requireResponseWindowOpen();

        _settle(p.tenantRefund, p.landlordClaim, p.reportHash);
    }

    /// @notice Landlord-response timeout. If the landlord neither accepts, counter-proposes nor disputes a
    /// tenant proposal within `responseWindow`, the FULL deposit goes back to the tenant.
    /// @dev Callable by anyone from `proposedAt + responseWindow` (inclusive); funds only ever go to the
    /// parties. The tenant's proposed split is deliberately ignored: by staying silent the landlord has not
    /// substantiated any claim on the deposit. Rent is settled as in every other path (see {_settle}).
    function claimTimeout() external nonReentrant inStatus(Status.MoveOut) {
        Proposal memory p = _proposal;
        if (p.proposer != _terms.tenant) revert TimeoutNotApplicable();
        uint64 deadline = p.proposedAt + _terms.responseWindow;
        if (block.timestamp < deadline) revert TimeoutNotReached(deadline);

        _settle(_terms.depositAmount, 0, LANDLORD_TIMEOUT_BASIS);
    }

    /// @notice Escalate to the arbiter. Starts the `arbiterWindow` clock.
    function dispute() external onlyParty {
        Status s = status;
        if (s != Status.Active && s != Status.MoveOut) revert InvalidStatus(s);
        _requireResponseWindowOpen();
        if (s == Status.Active) _startMoveOut();
        status = Status.Disputed;
        // forge-lint: disable-next-line(unsafe-typecast) -- uint64 seconds overflow in ~5e11 years
        disputedAt = uint64(block.timestamp);
        emit DisputeRaised(msg.sender);
    }

    /// @notice Arbiter rules on the deposit split. Only possible before {arbiterDeadline}.
    /// @param rulingHash Hash of the arbiter's written ruling.
    function resolve(uint256 tenantRefund, bytes32 rulingHash)
        external
        nonReentrant
        only(_terms.arbiter)
        inStatus(Status.Disputed)
    {
        uint64 deadline = arbiterDeadline();
        if (block.timestamp >= deadline) revert ArbiterDeadlinePassed(deadline);
        if (tenantRefund > _terms.depositAmount) revert InvalidAmount();
        _settle(tenantRefund, _terms.depositAmount - tenantRefund, rulingHash);
    }

    /// @notice Arbiter-deadline fallback. If the arbiter has not resolved the dispute within
    /// `arbiterWindow`, anyone can close it and the FULL deposit goes back to the tenant.
    /// @dev Policy choice: the burden of proof is on the landlord. A deposit claim that the arbiter never
    /// upheld is not paid out. Rent already released stays released; funded rent that is due still goes to
    /// the landlord and prepaid future rent to the tenant (see {_settle}). Callable from
    /// `disputedAt + arbiterWindow` (inclusive), at which point {resolve} stops working.
    function claimArbiterTimeout() external nonReentrant inStatus(Status.Disputed) {
        uint64 deadline = arbiterDeadline();
        if (block.timestamp < deadline) revert TimeoutNotReached(deadline);

        _settle(_terms.depositAmount, 0, ARBITER_TIMEOUT_BASIS);
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

    /// @notice Number of rent periods whose due date has passed (0 before funding). Frozen at `moveOutAt`.
    function periodsDue() public view returns (uint32) {
        if (startTime == 0) return 0;
        uint256 t = moveOutAt == 0 ? block.timestamp : moveOutAt;
        uint256 due = (t - startTime) / _terms.rentPeriod + 1;
        // forge-lint: disable-next-line(unsafe-typecast) -- due <= termPeriods (uint32) on this branch
        return due > _terms.termPeriods ? _terms.termPeriods : uint32(due);
    }

    /// @notice Due date of rent period `period` (0-based).
    function dueDate(uint32 period) external view returns (uint64) {
        return startTime + uint64(period) * _terms.rentPeriod;
    }

    /// @notice Timestamp at which {claimTimeout} becomes callable, or 0 if not applicable. From that moment the
    /// landlord-response window is closed: {propose}, {accept} and {dispute} revert and only {claimTimeout} remains.
    function timeoutAt() public view returns (uint64) {
        if (status != Status.MoveOut || _proposal.proposer != _terms.tenant) return 0;
        return _proposal.proposedAt + _terms.responseWindow;
    }

    /// @notice While disputed: timestamp from which {claimArbiterTimeout} is callable and {resolve} is not.
    /// 0 if the lease is not in dispute.
    function arbiterDeadline() public view returns (uint64) {
        if (status != Status.Disputed) return 0;
        return disputedAt + _terms.arbiterWindow;
    }

    // ---------------------------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------------------------

    /// @dev Once a tenant proposal's response window has closed, nobody can race {claimTimeout} with a late
    /// counter-proposal, accept or dispute (same rule as the arbiter deadline).
    function _requireResponseWindowOpen() internal view {
        uint64 deadline = timeoutAt();
        if (deadline != 0 && block.timestamp >= deadline) revert ResponseWindowClosed(deadline);
    }

    /// @dev Stops the rent clock (audit #9): otherwise delaying settlement (a silent landlord, counter-proposals,
    /// a dispute the arbiter sits on) would turn the tenant's refundable prepaid rent into rent due.
    function _startMoveOut() internal {
        // forge-lint: disable-next-line(unsafe-typecast) -- uint64 seconds overflow in ~5e11 years
        moveOutAt = uint64(block.timestamp);
    }

    function _releasableUpTo() internal view returns (uint32) {
        uint32 due = periodsDue();
        return due < periodsFunded ? due : periodsFunded;
    }

    /// @dev Pulls exactly `amount` from the caller; rejects fee-on-transfer style shortfalls.
    function _pull(uint256 amount) internal {
        IERC20 token = _terms.token;
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - before;
        if (received != amount) revert TransferShortfall(amount, received);
    }

    /// @dev Sends `gross` rent (always >= one period) to the landlord. The first payout of the lease also pays the
    /// one-time protocol fee (`feeBps` of the monthly-equivalent rent, rounded down) out of the landlord's share.
    /// It always fits in that first payout: at most 10% x 30/7 = 43% of one period's rent (MAX_FEE_BPS, 7-day period).
    function _payRent(uint256 gross) internal returns (uint256 toLandlord, uint256 fee) {
        if (!feeCharged) {
            feeCharged = true;
            fee = (_terms.rentAmount * MONTH * _terms.feeBps) / (uint256(_terms.rentPeriod) * BPS);
        }
        toLandlord = gross - fee;
        if (fee > 0) {
            _terms.token.safeTransfer(_terms.feeRecipient, fee);
            emit ProtocolFeePaid(_terms.feeRecipient, fee);
        }
        _terms.token.safeTransfer(payee, toLandlord);
    }

    /// @dev Final payout. State is written before any transfer (checks-effects-interactions).
    function _settle(uint256 tenantRefund, uint256 landlordClaim, bytes32 basis) internal {
        status = Status.Settled;

        // Remaining funded rent: periods due at the move-out go to the landlord, the rest back to the tenant.
        // (The tenant may already have released periods early, so never go below periodsReleased.)
        uint32 releasableUpTo = _releasableUpTo();
        if (releasableUpTo < periodsReleased) releasableUpTo = periodsReleased;
        uint256 rentToLandlord = uint256(releasableUpTo - periodsReleased) * _terms.rentAmount;
        uint256 rentToTenant = uint256(periodsFunded - releasableUpTo) * _terms.rentAmount;
        periodsReleased = releasableUpTo;

        uint256 fee = 0;
        if (rentToLandlord > 0) (, fee) = _payRent(rentToLandlord);
        if (landlordClaim > 0) _terms.token.safeTransfer(payee, landlordClaim);

        uint256 toTenant = tenantRefund + rentToTenant;
        if (toTenant > 0) _terms.token.safeTransfer(_terms.tenant, toTenant);

        emit Settled(tenantRefund, landlordClaim, rentToLandlord, rentToTenant, fee, basis);
        factory.unlockValue(_terms.depositAmount + rentToLandlord + rentToTenant); // everything this escrow held
    }
}
