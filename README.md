# Blockchain-Based Investment and Portfolio Audit System

A college-level Indian stock portfolio simulation with a real Solidity audit registry on a local Hardhat Ethereum-compatible network. Demo holdings use real Indian listed companies, with simulated sample prices and transactions: no money, brokerage accounts, live quotes, or real cryptocurrency transfers are involved.

> This is an academic demonstration, not financial software. A local chain proves that a digest was written to that local chain; it does not prove that the off-chain input was truthful or that an investment is authentic.

## Features

- React + TypeScript web application with registration, login, dashboard, holdings, transaction entry/history, audit lookup, and a protected tampering demonstration.
- FastAPI backend with JWT authentication, Argon2 password hashing, ownership checks, SQLite persistence, and Decimal-based accounting.
- Solidity `PortfolioAuditRegistry` deployed to a local Hardhat network. The backend submits signed transactions with a development-only account and verifies the receipt, emitted event, and stored record.
- SHA-256 digest of versioned, deterministically serialized transaction data; the contract stores only digest and minimal reference metadata.
- Weighted-average cost basis, simulated valuation updates, and transaction reconciliation for interrupted chain/database writes.

## Project layout

```text
backend/       FastAPI API, SQLAlchemy models, service logic, tests, demo seed
blockchain/    Solidity contract, Hardhat configuration, deployment and tests
frontend/      React/Vite user interface and frontend tests
docs/          Architecture, database, calculations, contract, tests and demo guide
.env.example   Local configuration template (contains placeholders only)
```

## Requirements

- Python 3.11+ (validated with Python 3.13 in this workspace)
- Node.js 20+ and npm (validated with Node 24/npm 11)
- Internet access to install the pinned packages and Solidity compiler the first time
- Windows PowerShell examples below; macOS/Linux equivalents are included where they differ

No paid service or external RPC endpoint is used.

## First-time setup (Windows PowerShell)

Run from the project root:

```powershell
Copy-Item .env.example .env
# Edit .env: set a private random JWT_SECRET_KEY, then set CHAIN_PRIVATE_KEY and CONTRACT_ADDRESS after deployment.

py -3 -m venv backend\.venv
backend\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r backend\requirements.txt

Push-Location blockchain
npm install
Pop-Location

Push-Location frontend
npm install
Pop-Location
```

If PowerShell blocks venv activation, run commands using `backend\.venv\Scripts\python.exe` instead.

macOS/Linux: use `python3 -m venv backend/.venv`, `source backend/.venv/bin/activate`, and run `npm install` from each package directory.

## Start the local chain and deploy

Open a terminal at the project root and run:

```powershell
Push-Location blockchain
npm run node
```

Keep that process running. It prints throwaway local accounts and private keys. In a second terminal:

```powershell
Push-Location blockchain
npm run compile
npm test
npm run deploy:local
Pop-Location
```

Deployment writes the actual local contract address to `blockchain/deployment.local.json`. Edit the root `.env`:

- `CONTRACT_ADDRESS`: copy the `address` value from that JSON file.
- `CHAIN_PRIVATE_KEY`: use the corresponding throwaway Hardhat account private key from the local node output. Deploy with the default first local account if using the default Hardhat deployer.
- Never use a personal wallet key. Never commit `.env`.

The node uses chain ID `31337`. Restarting/resetting the local node clears its state; redeploy the contract and run the demo seed again. The address and records from a prior chain instance are no longer valid.

## Start the backend and frontend

Start the backend from a new terminal at the project root. Ensure `.env` is configured, then:

```powershell
backend\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --reload
```

The API is at `http://127.0.0.1:8000`; OpenAPI docs are at `http://127.0.0.1:8000/docs`. SQLite is initialized automatically at `backend/portfolio.db`.

Start the frontend from another terminal:

```powershell
Set-Location frontend
npm run dev
```

Open the Vite URL (normally `http://localhost:5173`). `VITE_API_URL` may be set in `frontend/.env.local`; the default points to `http://127.0.0.1:8000`.

## Seed the local demo

Once the chain is running, deployed, and configured in `.env`, seed an administrator and one Indian stocks portfolio with Reliance Industries (`RELIANCE`), Tata Consultancy Services (`TCS`), HDFC Bank (`HDFCBANK`), Infosys (`INFY`), and ICICI Bank (`ICICIBANK`). All seeded prices and trades are illustrative sample data, not current market quotes or investment recommendations. The seed creates audit records on your local Hardhat chain:

```powershell
backend\.venv\Scripts\python.exe backend\scripts\seed_demo.py
```

Demo credentials: `demo.admin@example.com` / `Demo-Portfolio-2026!`. Change/delete this demo database before any shared use; do not reuse these credentials elsewhere. Re-running the seed is idempotent while its database and local chain remain intact.

To reset the demo safely, stop all services, remove only the generated `backend/portfolio.db` file, stop and restart the local Hardhat node, redeploy, update `.env` with the new deployment address, and run the seed script again:

```powershell
Remove-Item backend\portfolio.db
```

That command deliberately targets only the generated demo database. A chain restart clears its in-memory state. Do not remove unrelated workspace files.

## Tests and build

```powershell
Push-Location blockchain; npm test; Pop-Location
backend\.venv\Scripts\python.exe -m pytest backend\tests -q
Push-Location frontend; npm test -- --run; npm run build; Pop-Location
```

The backend tests use a deterministic fake blockchain adapter for unit/API behavior. Hardhat contract tests run against its in-process local EVM. The demo seeding and manual workflow exercise the deployed HTTP-RPC Hardhat node. These checks are distinct; a mocked API test is not a local-chain integration test.

## End-to-end demo checklist

1. Start the Hardhat node, deploy the contract, configure `.env`, and seed.
2. Log in using the demo credentials and open the Indian Stocks Demo Portfolio.
3. Check holdings, transaction history, and transaction audit details.
4. Open an audit report: database digest, recalculated digest, contract record, event, receipt, transaction hash, and block number should agree.
5. To demonstrate tampering, set `DEMO_TAMPERING_ENABLED=true` in `.env`, restart the backend, then use the administrator-only demo tamper action to change a stored off-chain price.
6. Re-run the audit: the database digest should no longer match the original; the on-chain record and original receipt remain unchanged.
7. Set `DEMO_TAMPERING_ENABLED=false` again after the demonstration.

The tamper API is disabled unless both development mode and this explicit opt-in are enabled, and it requires the seeded administrator account. It cannot change the contract. Do not expose this development API publicly.

## Important behavior and limitations

- Every transaction is first persisted as pending. The API reports it as confirmed only after a successful chain receipt, expected event, and stored-record verification.
- If submission outcome is uncertain, it remains `RECONCILIATION_REQUIRED`; further transactions for that portfolio are blocked until reconciliation. The contract's unique transaction ID prevents duplicates. `/api/blockchain/reconcile` checks the existing record and event before submitting again.
- The database and blockchain cannot commit atomically. A chain reset is not automatically reconciled against an old database; reset the generated demo database too.
- Simulated prices are manually entered and are not market prices. Dashboard returns values calculated from stored transaction and valuation data.
- Shared simulated asset prices can be changed only by the seeded administrator; this avoids allowing one regular user to alter another user's displayed portfolio value.
- The weighted-average cost basis includes purchase fees in acquired basis and subtracts sale fees from sale proceeds.
- This project has no migrations, multi-currency conversion, external market feeds, mainnet support, custody, real orders, or production key management.
- Public audit lookup exposes digest-level metadata only. Portfolio and account details require authentication.
- The application and demo seed are scoped to Indian listed stocks. Enter and verify NSE/BSE symbols yourself; no exchange directory or live market-data feed is integrated.

See [docs/architecture.md](docs/architecture.md), [docs/database.md](docs/database.md), [docs/smart-contract.md](docs/smart-contract.md), [docs/financial-calculations.md](docs/financial-calculations.md), [docs/testing.md](docs/testing.md), [docs/demo-script.md](docs/demo-script.md), and [docs/troubleshooting.md](docs/troubleshooting.md).
#   S t o c k - M a r k e t - K h a t a -  
 