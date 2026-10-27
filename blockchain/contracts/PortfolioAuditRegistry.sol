// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract PortfolioAuditRegistry is AccessControl, Ownable {
    bytes32 public constant WRITER_ROLE = keccak256("PORTFOLIO_AUDIT_WRITER");

    struct AuditRecord {
        bytes32 portfolioRef;
        bytes32 dataHash;
        bytes32 assetSymbolHash;
        uint8 action;
        uint64 recordedAt;
        bool exists;
    }

    mapping(bytes32 => AuditRecord) private records;

    event TransactionRecorded(
        bytes32 indexed transactionId,
        bytes32 indexed portfolioRef,
        bytes32 dataHash,
        bytes32 assetSymbolHash,
        uint8 action,
        uint64 recordedAt
    );

    error InvalidInput();
    error DuplicateTransaction();

    constructor() Ownable(msg.sender) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(WRITER_ROLE, msg.sender);
    }

    function setWriter(address writer, bool allowed) external onlyOwner {
        if (writer == address(0)) revert InvalidInput();
        if (allowed) {
            _grantRole(WRITER_ROLE, writer);
        } else {
            _revokeRole(WRITER_ROLE, writer);
        }
    }

    function authorizedWriters(address writer) external view returns (bool) {
        return hasRole(WRITER_ROLE, writer);
    }

    function recordTransaction(
        bytes32 transactionId,
        bytes32 portfolioRef,
        bytes32 dataHash,
        bytes32 assetSymbolHash,
        uint8 action
    ) external onlyRole(WRITER_ROLE) {
        if (
            transactionId == bytes32(0) ||
            portfolioRef == bytes32(0) ||
            dataHash == bytes32(0) ||
            assetSymbolHash == bytes32(0) ||
            (action != 1 && action != 2)
        ) revert InvalidInput();
        if (records[transactionId].exists) revert DuplicateTransaction();

        uint64 timestamp = uint64(block.timestamp);
        records[transactionId] = AuditRecord({
            portfolioRef: portfolioRef,
            dataHash: dataHash,
            assetSymbolHash: assetSymbolHash,
            action: action,
            recordedAt: timestamp,
            exists: true
        });
        emit TransactionRecorded(
            transactionId,
            portfolioRef,
            dataHash,
            assetSymbolHash,
            action,
            timestamp
        );
    }

    function getRecord(bytes32 transactionId) external view returns (AuditRecord memory) {
        return records[transactionId];
    }

    function recordExists(bytes32 transactionId) external view returns (bool) {
        return records[transactionId].exists;
    }
}
