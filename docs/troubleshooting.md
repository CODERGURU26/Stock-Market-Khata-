# Troubleshooting

- **API says authentication is not configured:** set `JWT_SECRET_KEY` in root `.env` to a random value of at least 32 characters and restart FastAPI.
- **Blockchain is not configured:** keep the Hardhat node running, deploy the contract, set `CONTRACT_ADDRESS`, and set the matching throwaway local `CHAIN_PRIVATE_KEY`.
- **Transaction is `RECONCILIATION_REQUIRED`:** confirm local node availability and backend configuration, then call `POST /api/blockchain/reconcile` while authenticated. Do not submit a replacement transaction blindly.
- **Writer authorization fails:** deploy with the local account whose private key is configured for the backend. Otherwise, call owner-only `setWriter` from the deployer account using a local Hardhat console.
- **Contract artifact missing:** from `blockchain/`, run `npm install` and `npm run compile`.
- **Audit unavailable:** verify the local node is responsive at `http://127.0.0.1:8545`, the configured address belongs to the current node instance, and the ABI artifact exists. Unavailable is distinct from a tamper mismatch.
- **Address changed after restart:** Hardhat node state is in-memory. Redeploy and update `.env`; do not assume old block numbers, transactions, or contract records persist.
- **Frontend CORS error:** ensure Vite uses the same origin as `FRONTEND_ORIGIN` (default `http://localhost:5173`) and restart the backend after changes.
- **SQLite file locked:** stop duplicate API processes before resetting. Only remove `backend/portfolio.db` when intentionally resetting the local demo; restart the chain and redeploy as described in the root README.
