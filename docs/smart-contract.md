# Smart contract

`PortfolioAuditRegistry.sol` is compiled with Solidity 0.8.24 and deployed only to local Hardhat chain ID 31337.

Authorization reuses OpenZeppelin `Ownable` for owner-controlled writer administration and `AccessControl` for the writer role; the deployer begins as owner, admin, and writer.

## Public interface

- `recordTransaction(bytes32 transactionId, bytes32 portfolioRef, bytes32 dataHash, bytes32 assetSymbolHash, uint8 action)`: authorized writers only; actions are `1` BUY and `2` SELL. Rejects zero hashes, invalid action, and duplicate ID.
- `getRecord(bytes32 transactionId)`: read-only record lookup.
- `recordExists(bytes32 transactionId)`: read-only existence check.
- `setWriter(address writer, bool allowed)`: owner-controlled writer authorization.
- `TransactionRecorded`: indexed transaction ID and portfolio reference plus digest, symbol hash, action, timestamp.

The deployer owns the contract and starts as an authorized writer. The backend's account must be the same throwaway development account or be explicitly authorized by the owner. Never put a personal key in the backend or frontend.

The application transaction ID is converted to bytes32 with Keccak-256 for the registry key. The transaction data digest is SHA-256 of canonical JSON; it is not the Ethereum transaction hash. The Ethereum transaction hash identifies the on-chain call, and the block hash identifies a containing block. These values serve different purposes.

Hardhat artifacts provide the ABI. `npm run deploy:local` writes the actual address to ignored `deployment.local.json`. Each fresh local node requires redeployment.
