import os
from datetime import date
from decimal import Decimal

os.environ.setdefault("JWT_SECRET_KEY", "test-only-secret-key-with-at-least-32-characters")

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from web3 import Web3

from app import main


class FakeBlockchain:
    def __init__(self):
        self.records = {}

    def submit_or_recover(self, tx, asset):
        self.records[tx.id] = {
            "data_hash": f"0x{tx.canonical_hash}",
            "portfolio_ref": Web3.to_hex(Web3.keccak(text=tx.portfolio_id)),
            "asset_symbol_hash": Web3.to_hex(Web3.keccak(text=asset.symbol)),
            "action": 1 if tx.action == "BUY" else 2,
        }
        return {"tx_hash": "0x" + "1" * 64, "block_number": len(self.records), "event_verified": True}

    def read_record(self, transaction_id):
        if transaction_id not in self.records:
            return None
        return {**self.records[transaction_id], "exists": True}

    def verify_event(self, tx_hash, tx, asset):
        return tx.id in self.records


def setup_client(monkeypatch, tamper=False):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    main.Base.metadata.create_all(engine)
    test_sessions = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_db():
        db = test_sessions()
        try:
            yield db
        finally:
            db.close()

    main.app.dependency_overrides[main.get_db] = override_db
    fake_chain = FakeBlockchain()
    monkeypatch.setattr(main, "blockchain", fake_chain)
    monkeypatch.setattr(main, "JWT_SECRET_KEY", "test-only-secret-key-with-at-least-32-characters")
    monkeypatch.setattr(main, "APP_ENV", "development")
    monkeypatch.setattr(main, "DEMO_TAMPERING_ENABLED", tamper)
    return TestClient(main.app), test_sessions, fake_chain


def register(client, email="student@example.com"):
    response = client.post("/api/auth/register", json={"email": email, "password": "valid-password-123"})
    assert response.status_code == 201
    return response.json()["access_token"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def create_portfolio(client, token):
    response = client.post("/api/portfolios", headers=auth(token), json={"name": "Demo", "base_currency": "INR"})
    assert response.status_code == 201
    return response.json()["id"]


def transaction_body(action, quantity, price):
    return {
        "symbol": "RELIANCE", "asset_name": "Reliance Industries Limited", "category": "Stocks",
        "action": action, "quantity": str(quantity), "unit_price": str(price), "fee": "1.25",
        "transaction_date": date.today().isoformat(), "currency": "INR",
    }


def test_registration_login_and_portfolio_ownership(monkeypatch):
    client, _, _ = setup_client(monkeypatch)
    token = register(client)
    assert client.get("/api/auth/me", headers=auth(token)).status_code == 200
    login = client.post("/api/auth/login", json={"email": "student@example.com", "password": "valid-password-123"})
    assert login.status_code == 200
    portfolio_id = create_portfolio(client, token)
    mixed_currency = client.post(
        "/api/portfolios",
        headers=auth(token),
        json={"name": "Mixed currency", "base_currency": "USD"},
    )
    assert mixed_currency.status_code == 422
    other_token = register(client, "other@example.org")
    response = client.get(f"/api/portfolios/{portfolio_id}", headers=auth(other_token))
    assert response.status_code == 404
    asset = client.post(
        "/api/assets",
        headers=auth(token),
        json={"symbol": "TCS", "name": "Tata Consultancy Services Limited", "category": "Stocks", "latest_price": "10"},
    ).json()
    price_change = client.patch(
        f"/api/assets/{asset['id']}/price",
        headers=auth(other_token),
        json={"latest_price": "20"},
    )
    assert price_change.status_code == 403
    non_stock = client.post(
        "/api/assets",
        headers=auth(token),
        json={"symbol": "INFY", "name": "Infosys Limited", "category": "Other", "latest_price": "10"},
    )
    assert non_stock.status_code == 422


def test_buy_sell_decimal_average_cost_and_reject_oversell(monkeypatch):
    client, _, _ = setup_client(monkeypatch)
    token = register(client)
    portfolio_id = create_portfolio(client, token)

    for qty, price in (("2", "10"), ("2", "20")):
        response = client.post(
            f"/api/portfolios/{portfolio_id}/transactions",
            headers=auth(token),
            json=transaction_body("BUY", qty, price),
        )
        assert response.status_code == 201
        assert response.json()["audit_status"] == "CONFIRMED"

    oversell = client.post(
        f"/api/portfolios/{portfolio_id}/transactions",
        headers=auth(token),
        json=transaction_body("SELL", "5", "25"),
    )
    assert oversell.status_code == 422

    sell = client.post(
        f"/api/portfolios/{portfolio_id}/transactions",
        headers=auth(token),
        json=transaction_body("SELL", "1", "25"),
    )
    assert sell.status_code == 201
    report = client.get(f"/api/portfolios/{portfolio_id}/holdings", headers=auth(token)).json()
    assert report[0]["quantity"] == "3"
    assert Decimal(report[0]["average_cost"]) == Decimal("15.625")
    assert Decimal(report[0]["realized_pnl"]) == Decimal("8.125")


def test_hash_verification_detects_off_chain_tampering(monkeypatch):
    client, sessions, _ = setup_client(monkeypatch, tamper=True)
    token = register(client)
    portfolio_id = create_portfolio(client, token)
    created = client.post(
        f"/api/portfolios/{portfolio_id}/transactions",
        headers=auth(token),
        json=transaction_body("BUY", "1", "10"),
    ).json()
    valid = client.get(f"/api/transactions/{created['id']}/audit", headers=auth(token)).json()
    assert valid["status"] == "VALID"
    unauthorized = client.post(
        f"/api/demo/tamper/{created['id']}",
        headers=auth(token),
        json={"unit_price": "99"},
    )
    assert unauthorized.status_code == 403

    with sessions() as db:
        user = db.query(main.User).filter_by(email="student@example.com").one()
        user.is_admin = True
        db.commit()
    tamper = client.post(
        f"/api/demo/tamper/{created['id']}",
        headers=auth(token),
        json={"unit_price": "99"},
    )
    assert tamper.status_code == 200
    audit = client.get(f"/api/transactions/{created['id']}/audit", headers=auth(token)).json()
    assert audit["status"] == "TAMPERING_DETECTED"
    assert audit["database_matches_original"] is False
    assert audit["on_chain_record_exists"] is True
    main.app.dependency_overrides.clear()


def test_chain_failure_persists_unconfirmed_transaction_for_reconciliation(monkeypatch):
    client, sessions, fake_chain = setup_client(monkeypatch)
    def unavailable(*_args):
        raise main.BlockchainUnavailable("local chain unavailable")
    fake_chain.submit_or_recover = unavailable
    token = register(client)
    portfolio_id = create_portfolio(client, token)
    response = client.post(
        f"/api/portfolios/{portfolio_id}/transactions",
        headers=auth(token),
        json=transaction_body("BUY", "1", "10"),
    )
    assert response.status_code == 503
    transaction_id = response.json()["detail"]["transaction_id"]
    with sessions() as db:
        tx = db.get(main.InvestmentTransaction, transaction_id)
        assert tx.audit_status == "RECONCILIATION_REQUIRED"
    fake_chain.submit_or_recover = FakeBlockchain().submit_or_recover
    reconcile = client.post("/api/blockchain/reconcile", headers=auth(token))
    assert reconcile.status_code == 200
    assert reconcile.json()["confirmed"] == 1
    second_reconcile = client.post("/api/blockchain/reconcile", headers=auth(token))
    assert second_reconcile.status_code == 200
    assert second_reconcile.json()["confirmed"] == 0
    main.app.dependency_overrides.clear()


def test_audit_reports_chain_unavailable_without_claiming_success(monkeypatch):
    client, _, fake_chain = setup_client(monkeypatch)
    token = register(client)
    portfolio_id = create_portfolio(client, token)
    created = client.post(
        f"/api/portfolios/{portfolio_id}/transactions",
        headers=auth(token),
        json=transaction_body("BUY", "1", "10"),
    ).json()

    def unavailable(_transaction_id):
        raise main.BlockchainUnavailable("local chain unavailable")

    fake_chain.read_record = unavailable
    audit = client.get(f"/api/transactions/{created['id']}/audit", headers=auth(token)).json()
    assert audit["status"] == "UNAVAILABLE"
    assert audit["on_chain_record_exists"] is None
    assert audit["message"] == "Audit unavailable — blockchain connection failed."
    summary = client.get("/api/dashboard/summary", headers=auth(token)).json()
    assert summary["audit_status"] == "UNAVAILABLE"
    main.app.dependency_overrides.clear()
    main.app.dependency_overrides.clear()
