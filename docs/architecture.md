# Architecture

The React/Vite client calls the authenticated FastAPI service over localhost HTTP. FastAPI authenticates users, enforces portfolio ownership, persists normalized transaction values in SQLite through SQLAlchemy, calculates portfolio figures with `Decimal`, and submits audit records using web3.py.

Hardhat runs a local Ethereum-compatible JSON-RPC network. The Solidity registry stores a bytes32 transaction identifier, portfolio reference hash, canonical-data SHA-256 digest, symbol hash, action, and recording timestamp. It does not store personal data, quantities, prices, fees, or currency. A local throwaway account signs the backend's registry call; the private key is backend-only.

## Transaction sequence

1. Validate owner, asset, currency, dates, positive quantity/price, and sufficient confirmed units for a sale.
2. Build canonical JSON with fixed field order, normalized decimal strings, and schema version `portfolio-tx-v1`; compute SHA-256.
3. Persist `PENDING`, then `SUBMITTED`, before attempting the RPC operation.
4. Submit `recordTransaction` unless that transaction ID already exists. Wait for the receipt, check status, verify the expected event and read the registry record back.
5. Persist the actual Ethereum transaction hash, block number, contract address, and `CONFIRMED` state. Holdings only include confirmed records.
6. If a response is interrupted or unclear, leave `RECONCILIATION_REQUIRED`. Reconciliation reads the contract and locates the original event before considering a new write. The contract rejects duplicate IDs.

SQLite and the chain do not share an atomic commit. Unsettled records block new transactions in the same portfolio to avoid overspending/reserving units inconsistently.

## Trust boundaries

The chain only proves that a local account recorded the supplied digest. It does not validate the underlying investment facts. An altered database field recalculates to a different digest while the original chain record remains available. A failed RPC read is reported as unavailable, not as a valid audit.

All secrets belong in root `.env` (ignored by Git). CORS is restricted to `FRONTEND_ORIGIN`; tokens expire after a configurable short lifetime. The demo tampering route additionally needs `APP_ENV=development`, `DEMO_TAMPERING_ENABLED=true`, and an admin user.

Asset symbols/prices are shared demo reference data. Only an administrator may change an existing symbol's simulated price, preventing regular users from changing valuations shown in another account.
