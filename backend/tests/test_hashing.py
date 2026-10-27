from datetime import date
from decimal import Decimal

from app.main import Asset, InvestmentTransaction, canonical_transaction, transaction_digest


def build_records(quantity, price, fee):
    asset = Asset(symbol="TCS", name="Tata Consultancy Services Limited", category="Stocks")
    tx = InvestmentTransaction(
        id="tx-123",
        portfolio_id="portfolio-456",
        asset_id="asset-789",
        action="BUY",
        quantity=Decimal(quantity),
        unit_price=Decimal(price),
        fee=Decimal(fee),
        transaction_date=date(2026, 1, 5),
        currency="INR",
        hash_schema_version="portfolio-tx-v1",
    )
    return tx, asset


def test_canonical_json_uses_decimal_text_and_is_deterministic():
    first, asset = build_records("1.5000", "125.000", "0.00")
    second, _ = build_records("1.5", "125", "0")

    assert canonical_transaction(first, asset) == canonical_transaction(second, asset)
    assert b'"quantity":"1.5"' in canonical_transaction(first, asset)
    assert b'"unit_price":"125"' in canonical_transaction(first, asset)
    assert b'"fee":"0"' in canonical_transaction(first, asset)
    assert transaction_digest(first, asset) == transaction_digest(second, asset)


def test_financial_field_change_changes_digest():
    original, asset = build_records("1", "125", "0")
    changed, _ = build_records("1", "126", "0")

    assert transaction_digest(original, asset) != transaction_digest(changed, asset)
