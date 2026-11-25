// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {RentalEscrow} from "./RentalEscrow.sol";

/// @title EscrowFactory
/// @notice Creates one {RentalEscrow} per lease as an EIP-1167 minimal proxy (~10x cheaper than a full
/// deployment) and indexes leases by participant so the frontend can list them without an indexer.
/// @dev The owner can only tune the protocol fee for *future* leases; existing escrows snapshot their fee
/// at creation and are never upgradeable, so the owner has no power over funds already in escrow.
contract EscrowFactory is Ownable2Step {
    /// @notice Input for {createLease}. The caller becomes the landlord.
    struct LeaseParams {
        address tenant;
        address arbiter;
        uint256 rentAmount;
        uint256 depositAmount;
        uint32 termMonths;
        uint32 responseWindow;
        bytes32 leaseHash;
    }

    uint16 public constant MAX_FEE_BPS = 100; // 1%
    uint32 public constant MIN_TERM_MONTHS = 1;
    uint32 public constant MAX_TERM_MONTHS = 60;
    uint32 public constant MIN_RESPONSE_WINDOW = 1 days;
    uint32 public constant MAX_RESPONSE_WINDOW = 60 days;

    /// @notice Escrow implementation every lease clones.
    address public immutable implementation;
    /// @notice Stablecoin all leases from this factory are denominated in (MockUSDT on testnet).
    IERC20 public immutable token;

    uint16 public feeBps;
    address public feeRecipient;

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
        bytes32 leaseHash
    );
    event FeeUpdated(uint16 feeBps, address feeRecipient);

    error ZeroAddress();
    error RolesNotDistinct();
    error InvalidAmount();
    error InvalidTerm(uint32 termMonths);
    error InvalidResponseWindow(uint32 responseWindow);
    error FeeTooHigh(uint16 feeBps);

    constructor(IERC20 token_, address owner_, uint16 feeBps_, address feeRecipient_) Ownable(owner_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
        _setFee(feeBps_, feeRecipient_);
        implementation = address(new RentalEscrow());
    }

    /// @notice Create a lease offer. The tenant activates it by calling {RentalEscrow.fund}.
    function createLease(LeaseParams calldata p) external returns (address escrow) {
        address landlord = msg.sender;
        if (p.tenant == address(0) || p.arbiter == address(0)) revert ZeroAddress();
        if (p.tenant == landlord || p.arbiter == landlord || p.arbiter == p.tenant) {
            revert RolesNotDistinct();
        }
        if (p.rentAmount == 0 || p.depositAmount == 0) revert InvalidAmount();
        if (p.termMonths < MIN_TERM_MONTHS || p.termMonths > MAX_TERM_MONTHS) {
            revert InvalidTerm(p.termMonths);
        }
        if (p.responseWindow < MIN_RESPONSE_WINDOW || p.responseWindow > MAX_RESPONSE_WINDOW) {
            revert InvalidResponseWindow(p.responseWindow);
        }

        escrow = Clones.clone(implementation);
        RentalEscrow(escrow)
            .initialize(
                RentalEscrow.Terms({
                    token: token,
                    landlord: landlord,
                    tenant: p.tenant,
                    arbiter: p.arbiter,
                    rentAmount: p.rentAmount,
                    depositAmount: p.depositAmount,
                    termMonths: p.termMonths,
                    responseWindow: p.responseWindow,
                    leaseHash: p.leaseHash,
                    feeBps: feeBps,
                    feeRecipient: feeRecipient
                })
            );

        isLease[escrow] = true;
        _leases.push(escrow);
        _leasesByLandlord[landlord].push(escrow);
        _leasesByTenant[p.tenant].push(escrow);
        _leasesByArbiter[p.arbiter].push(escrow);

        // The only external call above is to our own freshly cloned escrow, so log ordering cannot be spoofed.
        // forge-lint: disable-next-item(reentrancy-events)
        emit LeaseCreated(
            escrow,
            landlord,
            p.tenant,
            p.arbiter,
            p.rentAmount,
            p.depositAmount,
            p.termMonths,
            p.responseWindow,
            p.leaseHash
        );
    }

    /// @notice Update the protocol fee applied to rent of leases created from now on.
    function setFee(uint16 feeBps_, address feeRecipient_) external onlyOwner {
        _setFee(feeBps_, feeRecipient_);
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
