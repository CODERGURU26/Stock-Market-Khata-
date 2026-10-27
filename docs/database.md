# Database

SQLite tables are initialized with `Base.metadata.create_all()` at API startup; this student project does not include migration tooling.

| Table | Purpose |
|---|---|
| `users` | Unique normalized email, Argon2 password hash, admin flag, created time |
| `portfolios` | Owner FK, name, three-letter base currency, created time |
| `assets` | Unique normalized symbol, Indian listed company name and `Stocks` category, simulated latest price and update time; demo prices are not live quotes |
| `investment_transactions` | Portfolio/asset FKs, action, exact numeric fields, trade date/currency, canonical digest/schema, audit state, actual chain transaction hash, block and contract metadata |

Foreign keys and indexes cover owners, portfolios, assets, symbols, and transaction lookup. Financial columns use `NUMERIC(24,8)` and are converted to `Decimal`. SQLite's numeric storage and serialized API responses are not binary floating-point application calculations.

`audit_status` flows through `PENDING`, `SUBMITTED`, `CONFIRMED`, `FAILED`, and `RECONCILIATION_REQUIRED`. Only confirmed transactions affect holdings. Pending state and actual receipt metadata are sufficient for this demonstration's recovery path.

The demo DB is `backend/portfolio.db`; the local node state is separate and in-memory. Reset both together and redeploy after restarting Hardhat.
