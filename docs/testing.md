# Testing

## Solidity

From `blockchain/`: `npm test`. Hardhat runs contract tests in a local in-process EVM for owner/writer access, duplicate and invalid input, event values, retrieval, and persistence across writes.

## Backend

From the project root: `backend/.venv/Scripts/python.exe -m pytest backend/tests -q` on Windows, or `backend/.venv/bin/python -m pytest backend/tests -q` on macOS/Linux.

API/financial tests use SQLite in memory and a deterministic test adapter in place of JSON-RPC. They cover authentication/ownership, average cost and realized P&L, oversell rejection, exact canonical hashing, tamper mismatch, and an unavailable chain leaving an unconfirmed reconcileable record. These tests are not evidence of local RPC integration.

## Frontend

From `frontend/`: `npm test -- --run` and `npm run build`. The tests cover key form/audit/error states. A browser E2E scenario can be performed manually using the runbook in `demo-script.md`.

## Local-chain integration check

Start Hardhat with `npm run node`, deploy using `npm run deploy:local`, configure `.env`, and run `backend/scripts/seed_demo.py`. The seed script submits five Indian-stock transactions to the actual local JSON-RPC chain and verifies receipts/events through the backend adapter. Check transaction audit details before tampering. Do not report a live-chain test as passed unless these steps were actually executed.
