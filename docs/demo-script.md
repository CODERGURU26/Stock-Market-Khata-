# Demo script

## Before the presentation

1. Install packages, copy `.env.example` to `.env`, and choose a random local JWT secret.
2. Start a Hardhat node and retain the terminal output.
3. Deploy the registry with the default local account. Copy its actual address and that same throwaway account's private key into `.env`.
4. Run FastAPI and the React client, then run `backend/scripts/seed_demo.py`.

## Walkthrough

1. Log in with `demo.admin@example.com` / `Demo-Portfolio-2026!`.
2. Show the Indian listed stock holdings (Reliance Industries, TCS, HDFC Bank, Infosys, and ICICI Bank). Clarify that sample prices and trades are simulated, then inspect average costs, realized/unrealized results, and activity.
3. Record a small BUY and then a SELL no greater than the confirmed units. Confirm the application reports an actual transaction hash and block.
4. Open the public audit page using a transaction ID. Show the SHA-256 digest, matching recomputed digest, stored on-chain digest, successful receipt, and event result.
5. Enable the development tamper switch in `.env` and restart the API. Invoke the administrator-only tamper UI action. Verify `TAMPERING_DETECTED`, with the original on-chain record still present.
6. Disable the tamper switch after the demo.

Never enable the development tamper endpoint on a network accessible to untrusted users.
