// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockIdentityRegistry
/// @notice LOCAL REHEARSAL ONLY (agent/scripts/rehearse.sh). A minimal ERC-8004 Identity Registry exposing the subset
/// of the reference IdentityRegistry ABI that the bnbagent SDK calls: register (3 overloads), setAgentURI, setMetadata,
/// getMetadata, getAgentWallet, ownerOf, balanceOf, tokenURI, plus the same events. It has no constructor state, so
/// `anvil_setCode` can place it at the canonical BSC testnet registry address on a local anvil started with
/// `--chain-id 97`. Agent ids start at 0 like the reference registry. Not an ERC-721 implementation: no transfers.
contract MockIdentityRegistry {
    struct MetadataEntry {
        string metadataKey;
        bytes metadataValue;
    }

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);
    event MetadataSet(
        uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue
    );

    error ERC721NonexistentToken(uint256 tokenId);
    error NotAgentOwner(uint256 agentId, address caller);
    error ReservedMetadataKey(string key);

    uint256 internal _nextId;
    mapping(uint256 agentId => address) internal _owners;
    mapping(address owner => uint256) internal _balances;
    mapping(uint256 agentId => string) internal _uris;
    mapping(uint256 agentId => address) internal _wallets;
    mapping(uint256 agentId => mapping(string key => bytes)) internal _metadata;

    function name() external pure returns (string memory) {
        return "AgentIdentity";
    }

    function symbol() external pure returns (string memory) {
        return "AGENT";
    }

    function getVersion() external pure returns (string memory) {
        return "mock-1";
    }

    function register() external returns (uint256) {
        return _register("", new MetadataEntry[](0));
    }

    function register(string calldata agentURI) external returns (uint256) {
        return _register(agentURI, new MetadataEntry[](0));
    }

    function register(string calldata agentURI, MetadataEntry[] calldata metadata)
        external
        returns (uint256)
    {
        return _register(agentURI, metadata);
    }

    function setAgentURI(uint256 agentId, string calldata newURI) external {
        _onlyOwner(agentId);
        _uris[agentId] = newURI;
        emit URIUpdated(agentId, newURI, msg.sender);
    }

    function setMetadata(uint256 agentId, string calldata metadataKey, bytes calldata metadataValue)
        external
    {
        _onlyOwner(agentId);
        _setMetadata(agentId, metadataKey, metadataValue);
    }

    function getMetadata(uint256 agentId, string calldata metadataKey) external view returns (bytes memory) {
        return _metadata[agentId][metadataKey];
    }

    function getAgentWallet(uint256 agentId) external view returns (address) {
        _requireExists(agentId);
        return _wallets[agentId];
    }

    function ownerOf(uint256 agentId) public view returns (address) {
        _requireExists(agentId);
        return _owners[agentId];
    }

    function balanceOf(address owner) external view returns (uint256) {
        return _balances[owner];
    }

    function tokenURI(uint256 agentId) external view returns (string memory) {
        _requireExists(agentId);
        return _uris[agentId];
    }

    function _register(string memory agentURI, MetadataEntry[] memory metadata)
        internal
        returns (uint256 agentId)
    {
        agentId = _nextId++;
        _owners[agentId] = msg.sender;
        _balances[msg.sender] += 1;
        _uris[agentId] = agentURI;
        _wallets[agentId] = msg.sender;
        emit Transfer(address(0), msg.sender, agentId);
        for (uint256 i = 0; i < metadata.length; i++) {
            _setMetadata(agentId, metadata[i].metadataKey, metadata[i].metadataValue);
        }
        emit Registered(agentId, agentURI, msg.sender);
    }

    function _setMetadata(uint256 agentId, string memory key, bytes memory value) internal {
        // The reference registry manages agentWallet itself (signature-gated setAgentWallet).
        if (keccak256(bytes(key)) == keccak256("agentWallet")) revert ReservedMetadataKey(key);
        _metadata[agentId][key] = value;
        emit MetadataSet(agentId, key, key, value);
    }

    function _onlyOwner(uint256 agentId) internal view {
        if (ownerOf(agentId) != msg.sender) revert NotAgentOwner(agentId, msg.sender);
    }

    function _requireExists(uint256 agentId) internal view {
        if (_owners[agentId] == address(0)) revert ERC721NonexistentToken(agentId);
    }
}
