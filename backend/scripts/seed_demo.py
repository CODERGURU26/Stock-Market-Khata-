from __future__ import annotations

import sys
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.main import (
    Asset,
    Base,
    InvestmentTransaction,
    Portfolio,
    SessionLocal,
    User,
    blockchain,
    password_hash,
    transaction_digest,
)

DEMO_EMAIL = "demo.admin@example.com"
DEMO_PASSWORD = "Demo-Portfolio-2026!"
REMOVED_SYMBOLS = {"ALPHA", "BETA", "GAMMA", "BOND1", "NIFTYBEES"}


def stable_id(label: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"portfolio-audit-demo:{label}"))


def main() -> None:
    if not blockchain.configured() or not blockchain.status().get("connected"):
        raise SystemExit("Local blockchain is unavailable. Start Hardhat, deploy the contract, configure .env, then retry.")
    Base.metadata.create_all(bind=SessionLocal.kw["bind"])
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == DEMO_EMAIL))
        if user is None:
            user = User(email=DEMO_EMAIL, password_hash=password_hash.hash(DEMO_PASSWORD), is_admin=True)
            db.add(user)
            db.flush()
        else:
            user.is_admin = True

        definitions = [
            ("RELIANCE", "Reliance Industries Limited", "Stocks", "1000"),
            ("TCS", "Tata Consultancy Services Limited", "Stocks", "3500"),
            ("HDFCBANK", "HDFC Bank Limited", "Stocks", "1500"),
            ("INFY", "Infosys Limited", "Stocks", "1600"),
            ("ICICIBANK", "ICICI Bank Limited", "Stocks", "1200"),
        ]
        removed_assets = list(db.scalars(select(Asset).where(Asset.symbol.in_(REMOVED_SYMBOLS))))
        removed_asset_ids = {asset.id for asset in removed_assets}
        for tx in db.scalars(
            select(InvestmentTransaction).where(InvestmentTransaction.asset_id.in_(removed_asset_ids))
        ):
            db.delete(tx)
        db.flush()
        for asset in removed_assets:
            db.delete(asset)
        db.flush()

        assets = {}
        for symbol, name, category, price in definitions:
            asset = db.scalar(select(Asset).where(Asset.symbol == symbol))
            if asset is None:
                asset = Asset(symbol=symbol, name=name, category=category, latest_price=Decimal(price))
                db.add(asset)
                db.flush()
            else:
                asset.name = name
                asset.category = category
            assets[symbol] = asset

        portfolio = db.scalar(
            select(Portfolio).where(
                Portfolio.user_id == user.id, Portfolio.name == "Indian Stocks Demo Portfolio"
            )
        )
        if portfolio is None:
            portfolio = db.scalar(
                select(Portfolio).where(
                    Portfolio.user_id == user.id,
                    Portfolio.name == "India Listed Examples (simulated prices)",
                )
            )
            if portfolio is not None:
                portfolio.name = "Indian Stocks Demo Portfolio"
        if portfolio is None:
            portfolio = Portfolio(user_id=user.id, name="Indian Stocks Demo Portfolio", base_currency="INR")
            db.add(portfolio)
            db.flush()

        old_portfolio = db.scalar(
            select(Portfolio).where(Portfolio.user_id == user.id, Portfolio.name == "Academic Demo Portfolio")
        )
        if old_portfolio is not None and not db.scalar(
            select(InvestmentTransaction.id).where(InvestmentTransaction.portfolio_id == old_portfolio.id).limit(1)
        ):
            db.delete(old_portfolio)

        demo_trades = [
            ("india-reliance-buy", "RELIANCE", "BUY", "2", "1000", "2.00"),
            ("india-tcs-buy", "TCS", "BUY", "1", "3500", "2.00"),
            ("india-hdfcbank-buy", "HDFCBANK", "BUY", "3", "1500", "2.00"),
            ("india-infy-buy", "INFY", "BUY", "2", "1600", "2.00"),
            ("india-icicibank-buy", "ICICIBANK", "BUY", "2", "1200", "2.00"),
        ]
        db.commit()
        for label, symbol, action, quantity, unit_price, fee in demo_trades:
            tx_id = stable_id(label)
            tx = db.get(InvestmentTransaction, tx_id)
            if tx is None:
                tx = InvestmentTransaction(
                    id=tx_id,
                    portfolio_id=portfolio.id,
                    asset_id=assets[symbol].id,
                    action=action,
                    quantity=Decimal(quantity),
                    unit_price=Decimal(unit_price),
                    fee=Decimal(fee),
                    transaction_date=date.today(),
                    currency="INR",
                    audit_status="PENDING",
                )
                db.add(tx)
                db.flush()
                tx.canonical_hash = transaction_digest(tx, assets[symbol])
                db.commit()
            if tx.canonical_hash != transaction_digest(tx, assets[symbol]):
                raise SystemExit(
                    f"Demo record {label} has changed off-chain; reset the local demo database and chain first."
                )
            tx.audit_status = "SUBMITTED"
            db.commit()
            try:
                result = blockchain.submit_or_recover(tx, assets[symbol])
            except Exception:
                tx.audit_status = "RECONCILIATION_REQUIRED"
                db.commit()
                raise
            tx.blockchain_tx_hash = result["tx_hash"]
            tx.block_number = result["block_number"]
            tx.contract_address = blockchain.contract.address
            tx.audit_status = "CONFIRMED"
            db.commit()
        print(f"Seeded {DEMO_EMAIL} / {DEMO_PASSWORD}")
        print(f"Portfolio: {portfolio.name}")
        print(f"Confirmed audit transactions: {len(demo_trades)}")


if __name__ == "__main__":
    main()
