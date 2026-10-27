from __future__ import annotations

import hashlib
import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Annotated, Any
from urllib.parse import urlparse

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from jose import JWTError, jwt
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from pwdlib import PasswordHash
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, create_engine, event, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from web3 import Web3
from web3.exceptions import TransactionNotFound

load_dotenv()
logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
APP_ENV = os.getenv("APP_ENV", "development")
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{PROJECT_ROOT.as_posix()}/backend/portfolio.db")
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "60"))
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
DEMO_TAMPERING_ENABLED = os.getenv("DEMO_TAMPERING_ENABLED", "false").lower() == "true"
CHAIN_RPC_URL = os.getenv("CHAIN_RPC_URL", "http://127.0.0.1:8545")
CHAIN_PRIVATE_KEY = os.getenv("CHAIN_PRIVATE_KEY", "")
CONTRACT_ADDRESS = os.getenv("CONTRACT_ADDRESS", "")
CONTRACT_ABI_PATH = Path(os.getenv(
    "CONTRACT_ABI_PATH",
    str(PROJECT_ROOT / "blockchain" / "artifacts" / "contracts" / "PortfolioAuditRegistry.sol" / "PortfolioAuditRegistry.json"),
))
if not CONTRACT_ABI_PATH.is_absolute():
    CONTRACT_ABI_PATH = PROJECT_ROOT / CONTRACT_ABI_PATH

_local_hosts = {"localhost", "127.0.0.1", "::1"}
_rpc = urlparse(CHAIN_RPC_URL)
if _rpc.scheme != "http" or _rpc.hostname not in _local_hosts:
    raise RuntimeError("CHAIN_RPC_URL must point to a local HTTP development node.")
_frontend = urlparse(FRONTEND_ORIGIN)
if (
    _frontend.scheme not in {"http", "https"}
    or _frontend.hostname not in _local_hosts
    or _frontend.path not in {"", "/"}
    or _frontend.username
    or _frontend.password
):
    raise RuntimeError("FRONTEND_ORIGIN must be a local frontend origin.")
if not DATABASE_URL.startswith("sqlite"):
    raise RuntimeError("This academic demo currently supports SQLite only.")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def enable_sqlite_foreign_keys(connection, _record) -> None:
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
password_hash = PasswordHash.recommended()


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Portfolio(Base):
    __tablename__ = "portfolios"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    base_currency: Mapped[str] = mapped_column(String(3), default="INR")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Asset(Base):
    __tablename__ = "assets"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    symbol: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    category: Mapped[str] = mapped_column(String(30))
    latest_price: Mapped[Decimal] = mapped_column(Numeric(24, 8), default=Decimal("0"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class InvestmentTransaction(Base):
    __tablename__ = "investment_transactions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    portfolio_id: Mapped[str] = mapped_column(ForeignKey("portfolios.id", ondelete="CASCADE"), index=True)
    asset_id: Mapped[str] = mapped_column(ForeignKey("assets.id"), index=True)
    action: Mapped[str] = mapped_column(String(4))
    quantity: Mapped[Decimal] = mapped_column(Numeric(24, 8))
    unit_price: Mapped[Decimal] = mapped_column(Numeric(24, 8))
    fee: Mapped[Decimal] = mapped_column(Numeric(24, 8), default=Decimal("0"))
    transaction_date: Mapped[date] = mapped_column(Date)
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    canonical_hash: Mapped[str] = mapped_column(String(64), default="")
    hash_schema_version: Mapped[str] = mapped_column(String(30), default="portfolio-tx-v1")
    audit_status: Mapped[str] = mapped_column(String(30), default="PENDING")
    blockchain_tx_hash: Mapped[str | None] = mapped_column(String(66), nullable=True)
    block_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    contract_address: Mapped[str | None] = mapped_column(String(42), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class RegisterBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)


class LoginBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class PortfolioBody(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    base_currency: str = Field(default="INR", pattern=r"^[A-Z]{3}$")


class AssetBody(BaseModel):
    symbol: str = Field(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9._-]+$")
    name: str = Field(min_length=1, max_length=100)
    category: str = Field(pattern=r"^Stocks$")
    latest_price: Decimal = Field(ge=0, max_digits=24, decimal_places=8)

    @field_validator("symbol")
    @classmethod
    def normalize_symbol(cls, value: str) -> str:
        return value.upper()


class PriceBody(BaseModel):
    latest_price: Decimal = Field(ge=0, max_digits=24, decimal_places=8)


class TransactionBody(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)
    asset_name: str = Field(min_length=1, max_length=100)
    category: str = Field(pattern=r"^Stocks$")
    action: str = Field(pattern=r"^(BUY|SELL)$")
    quantity: Decimal = Field(gt=0, max_digits=24, decimal_places=8)
    unit_price: Decimal = Field(gt=0, max_digits=24, decimal_places=8)
    fee: Decimal = Field(default=Decimal("0"), ge=0, max_digits=24, decimal_places=8)
    transaction_date: date
    currency: str = Field(default="INR", pattern=r"^[A-Z]{3}$")

    @field_validator("symbol")
    @classmethod
    def normalize_symbol(cls, value: str) -> str:
        return value.upper()


class TamperBody(BaseModel):
    unit_price: Decimal = Field(gt=0, max_digits=24, decimal_places=8)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


DB = Annotated[Session, Depends(get_db)]


def require_jwt_secret() -> str:
    if len(JWT_SECRET_KEY) < 32:
        raise HTTPException(status_code=503, detail="Authentication is not configured. Set a JWT secret of at least 32 characters.")
    return JWT_SECRET_KEY


def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required.")
    try:
        claims = jwt.decode(authorization[7:], require_jwt_secret(), algorithms=[JWT_ALGORITHM])
        user_id = claims.get("sub")
        if not isinstance(user_id, str):
            raise ValueError("Invalid subject")
    except (JWTError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid or expired access token.")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="User no longer exists.")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def owned_portfolio(db: Session, user: User, portfolio_id: str) -> Portfolio:
    portfolio = db.scalar(select(Portfolio).where(Portfolio.id == portfolio_id, Portfolio.user_id == user.id))
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found.")
    return portfolio


def decimal_text(value: Decimal) -> str:
    normalized = value.normalize()
    return format(normalized, "f") if normalized != 0 else "0"


def canonical_transaction(tx: InvestmentTransaction, asset: Asset) -> bytes:
    ordered = {
        "schema_version": tx.hash_schema_version,
        "transaction_id": tx.id,
        "portfolio_id": tx.portfolio_id,
        "asset_symbol": asset.symbol,
        "action": tx.action,
        "quantity": decimal_text(Decimal(tx.quantity)),
        "unit_price": decimal_text(Decimal(tx.unit_price)),
        "currency": tx.currency,
        "transaction_date": tx.transaction_date.isoformat(),
        "fee": decimal_text(Decimal(tx.fee)),
    }
    return json.dumps(ordered, ensure_ascii=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def transaction_digest(tx: InvestmentTransaction, asset: Asset) -> str:
    return hashlib.sha256(canonical_transaction(tx, asset)).hexdigest()


class BlockchainUnavailable(Exception):
    pass


class BlockchainService:
    def __init__(self) -> None:
        self.w3: Web3 | None = None
        self.contract: Any = None
        self.account: Any = None
        if not CONTRACT_ADDRESS or not CHAIN_PRIVATE_KEY:
            return
        if not CONTRACT_ABI_PATH.is_file():
            return
        try:
            artifact = json.loads(CONTRACT_ABI_PATH.read_text(encoding="utf-8"))
            self.w3 = Web3(Web3.HTTPProvider(CHAIN_RPC_URL, request_kwargs={"timeout": 5}))
            self.account = self.w3.eth.account.from_key(CHAIN_PRIVATE_KEY)
            self.contract = self.w3.eth.contract(
                address=Web3.to_checksum_address(CONTRACT_ADDRESS),
                abi=artifact["abi"],
            )
        except (OSError, ValueError, KeyError) as exc:
            raise RuntimeError("Blockchain configuration or contract artifact is invalid.") from exc

    def configured(self) -> bool:
        return self.w3 is not None and self.contract is not None and self.account is not None

    def status(self) -> dict[str, Any]:
        if not self.configured():
            return {"connected": False, "error": "Blockchain connection is not configured.", "contract_address": CONTRACT_ADDRESS or None}
        try:
            assert self.w3 is not None
            connected = self.w3.is_connected()
            return {
                "connected": connected,
                "chain_id": self.w3.eth.chain_id if connected else None,
                "latest_block": self.w3.eth.block_number if connected else None,
                "contract_address": CONTRACT_ADDRESS,
            }
        except Exception:
            return {"connected": False, "error": "Blockchain connection failed.", "contract_address": CONTRACT_ADDRESS}

    def _require(self) -> tuple[Web3, Any, Any]:
        if not self.configured():
            raise BlockchainUnavailable("Blockchain connection is not configured.")
        assert self.w3 is not None and self.contract is not None and self.account is not None
        try:
            if not self.w3.is_connected():
                raise BlockchainUnavailable("Blockchain connection failed.")
        except BlockchainUnavailable:
            raise
        except Exception as exc:
            raise BlockchainUnavailable("Blockchain connection failed.") from exc
        return self.w3, self.contract, self.account

    def read_record(self, transaction_id: str) -> dict[str, Any] | None:
        w3, contract, _ = self._require()
        identifier = Web3.keccak(text=transaction_id)
        try:
            record = contract.functions.getRecord(identifier).call()
        except Exception as exc:
            raise BlockchainUnavailable("Blockchain record read failed.") from exc
        if not record[5]:
            return None
        return {
            "portfolio_ref": Web3.to_hex(record[0]),
            "data_hash": Web3.to_hex(record[1]),
            "asset_symbol_hash": Web3.to_hex(record[2]),
            "action": int(record[3]),
            "recorded_at": int(record[4]),
            "exists": bool(record[5]),
        }

    def submit_or_recover(self, tx: InvestmentTransaction, asset: Asset) -> dict[str, Any]:
        w3, contract, account = self._require()
        transaction_id = Web3.keccak(text=tx.id)
        portfolio_ref = Web3.keccak(text=tx.portfolio_id)
        data_hash = bytes.fromhex(tx.canonical_hash)
        symbol_hash = Web3.keccak(text=asset.symbol)
        action = 1 if tx.action == "BUY" else 2
        existing = contract.functions.getRecord(transaction_id).call()
        if existing[5]:
            if (
                existing[0] != portfolio_ref
                or existing[1] != data_hash
                or existing[2] != symbol_hash
                or int(existing[3]) != action
            ):
                raise BlockchainUnavailable("Existing on-chain record does not match the pending application transaction.")
            event_logs = contract.events.TransactionRecorded().get_logs(
                from_block=0,
                to_block="latest",
                argument_filters={"transactionId": transaction_id},
            )
            matching_log = next(
                (
                    log for log in event_logs
                    if (
                        log["args"]["portfolioRef"] == portfolio_ref
                        and log["args"]["dataHash"] == data_hash
                        and log["args"]["assetSymbolHash"] == symbol_hash
                        and int(log["args"]["action"]) == action
                    )
                ),
                None,
            )
            if matching_log is None:
                raise BlockchainUnavailable("The existing on-chain record has no matching event for reconciliation.")
            recovered_hash = matching_log["transactionHash"]
            recovered_receipt = w3.eth.get_transaction_receipt(recovered_hash)
            if recovered_receipt["status"] != 1:
                raise BlockchainUnavailable("The recovered blockchain receipt did not succeed.")
            return {
                "tx_hash": Web3.to_hex(recovered_hash),
                "block_number": int(matching_log["blockNumber"]),
                "event_verified": True,
            }

        nonce = w3.eth.get_transaction_count(account.address, "pending")
        built = contract.functions.recordTransaction(
            transaction_id, portfolio_ref, data_hash, symbol_hash, action
        ).build_transaction({
            "from": account.address,
            "nonce": nonce,
            "chainId": w3.eth.chain_id,
            "gas": 250_000,
            "gasPrice": w3.eth.gas_price,
        })
        signed = account.sign_transaction(built)
        raw_tx = getattr(signed, "raw_transaction", None) or signed.rawTransaction
        tx_hash = w3.eth.send_raw_transaction(raw_tx)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
        if receipt["status"] != 1:
            raise BlockchainUnavailable("Blockchain transaction was mined but reverted.")
        logs = contract.events.TransactionRecorded().process_receipt(receipt)
        if len(logs) != 1 or (
            logs[0]["args"]["transactionId"] != transaction_id
            or logs[0]["args"]["portfolioRef"] != portfolio_ref
            or logs[0]["args"]["dataHash"] != data_hash
            or logs[0]["args"]["assetSymbolHash"] != symbol_hash
            or int(logs[0]["args"]["action"]) != action
        ):
            raise BlockchainUnavailable("Transaction receipt did not contain the expected audit event.")
        on_chain = contract.functions.getRecord(transaction_id).call()
        if (
            not on_chain[5]
            or on_chain[0] != portfolio_ref
            or on_chain[1] != data_hash
            or on_chain[2] != symbol_hash
            or int(on_chain[3]) != action
        ):
            raise BlockchainUnavailable("On-chain record verification failed.")
        return {"tx_hash": Web3.to_hex(receipt["transactionHash"]), "block_number": int(receipt["blockNumber"]), "event_verified": True}

    def verify_event(self, tx_hash: str, tx: InvestmentTransaction, asset: Asset) -> bool:
        w3, contract, _ = self._require()
        try:
            receipt = w3.eth.get_transaction_receipt(tx_hash)
        except TransactionNotFound:
            return False
        except Exception as exc:
            raise BlockchainUnavailable("Blockchain receipt read failed.") from exc
        if receipt["status"] != 1:
            return False
        try:
            logs = contract.events.TransactionRecorded().process_receipt(receipt)
        except Exception as exc:
            raise BlockchainUnavailable("Blockchain event decoding failed.") from exc
        expected = (
            Web3.keccak(text=tx.id),
            Web3.keccak(text=tx.portfolio_id),
            bytes.fromhex(tx.canonical_hash),
            Web3.keccak(text=asset.symbol),
            1 if tx.action == "BUY" else 2,
        )
        return any(
            (
                log["args"]["transactionId"],
                log["args"]["portfolioRef"],
                log["args"]["dataHash"],
                log["args"]["assetSymbolHash"],
                int(log["args"]["action"]),
            ) == expected
            for log in logs
        )


blockchain = BlockchainService()


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    require_jwt_secret()
    yield


app = FastAPI(
    title="Portfolio Audit API",
    version="1.0.0",
    description="Academic simulated investment and local-chain audit API.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/auth/register", status_code=201)
def register(body: RegisterBody, db: DB) -> dict[str, Any]:
    email = str(body.email).lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    user = User(email=email, password_hash=password_hash.hash(body.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"id": user.id, "email": user.email, "access_token": create_token(user)}


def create_token(user: User) -> str:
    secret = require_jwt_secret()
    expires = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_MINUTES)
    return jwt.encode({"sub": user.id, "exp": expires}, secret, algorithm=JWT_ALGORITHM)


@app.post("/api/auth/login")
def login(body: LoginBody, db: DB) -> dict[str, Any]:
    user = db.scalar(select(User).where(User.email == str(body.email).lower()))
    if user is None or not password_hash.verify(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    return {"id": user.id, "email": user.email, "access_token": create_token(user)}


@app.get("/api/auth/me")
def me(user: CurrentUser) -> dict[str, Any]:
    return {
        "id": user.id,
        "email": user.email,
        "is_admin": user.is_admin,
        "demo_tampering_enabled": APP_ENV == "development" and DEMO_TAMPERING_ENABLED,
    }


@app.post("/api/portfolios", status_code=201)
def create_portfolio(body: PortfolioBody, user: CurrentUser, db: DB) -> dict[str, Any]:
    existing = db.scalar(select(Portfolio).where(Portfolio.user_id == user.id).limit(1))
    if existing is not None and existing.base_currency != body.base_currency:
        raise HTTPException(
            status_code=422,
            detail="All portfolios in one account must use the same base currency; currency conversion is not implemented.",
        )
    portfolio = Portfolio(user_id=user.id, name=body.name.strip(), base_currency=body.base_currency)
    db.add(portfolio)
    db.commit()
    db.refresh(portfolio)
    return portfolio_out(portfolio)


def portfolio_out(p: Portfolio) -> dict[str, Any]:
    return {"id": p.id, "name": p.name, "base_currency": p.base_currency, "created_at": p.created_at}


@app.get("/api/portfolios")
def list_portfolios(user: CurrentUser, db: DB) -> list[dict[str, Any]]:
    return [portfolio_out(p) for p in db.scalars(select(Portfolio).where(Portfolio.user_id == user.id)).all()]


@app.get("/api/portfolios/{portfolio_id}")
def get_portfolio(portfolio_id: str, user: CurrentUser, db: DB) -> dict[str, Any]:
    return portfolio_out(owned_portfolio(db, user, portfolio_id))


def portfolio_transactions(db: Session, portfolio_id: str) -> list[tuple[InvestmentTransaction, Asset]]:
    rows = db.execute(
        select(InvestmentTransaction, Asset)
        .join(Asset, Asset.id == InvestmentTransaction.asset_id)
        .where(InvestmentTransaction.portfolio_id == portfolio_id)
        .order_by(InvestmentTransaction.transaction_date, InvestmentTransaction.created_at)
    ).all()
    return [(row[0], row[1]) for row in rows]


def calculate_positions(db: Session, portfolio_id: str) -> dict[str, dict[str, Decimal]]:
    positions: dict[str, dict[str, Decimal]] = {}
    for tx, asset in portfolio_transactions(db, portfolio_id):
        if tx.audit_status != "CONFIRMED":
            continue
        qty = Decimal(tx.quantity)
        price = Decimal(tx.unit_price)
        fee = Decimal(tx.fee)
        pos = positions.setdefault(asset.id, {"quantity": Decimal(0), "cost": Decimal(0), "realized": Decimal(0), "fees": Decimal(0)})
        pos["fees"] += fee
        if tx.action == "BUY":
            pos["cost"] += qty * price + fee
            pos["quantity"] += qty
        else:
            if pos["quantity"] == 0:
                continue
            average_cost = pos["cost"] / pos["quantity"]
            pos["realized"] += qty * price - fee - qty * average_cost
            pos["cost"] -= qty * average_cost
            pos["quantity"] -= qty
            if pos["quantity"] == 0:
                pos["cost"] = Decimal(0)
    return positions


def build_holdings(db: Session, portfolio_id: str) -> list[dict[str, Any]]:
    positions = calculate_positions(db, portfolio_id)
    result = []
    for asset_id, pos in positions.items():
        asset = db.get(Asset, asset_id)
        if asset is None or pos["quantity"] == 0:
            continue
        quantity, cost = pos["quantity"], pos["cost"]
        current_value = quantity * Decimal(asset.latest_price)
        avg_cost = cost / quantity if quantity else Decimal(0)
        result.append({
            "asset_id": asset.id, "symbol": asset.symbol, "name": asset.name, "category": asset.category,
            "quantity": decimal_text(quantity), "average_cost": decimal_text(avg_cost),
            "latest_price": decimal_text(Decimal(asset.latest_price)), "invested_value": decimal_text(cost),
            "current_value": decimal_text(current_value), "unrealized_pnl": decimal_text(current_value - cost),
            "realized_pnl": decimal_text(pos["realized"]),
        })
    return result


@app.get("/api/portfolios/{portfolio_id}/holdings")
def holdings(portfolio_id: str, user: CurrentUser, db: DB) -> list[dict[str, Any]]:
    owned_portfolio(db, user, portfolio_id)
    return build_holdings(db, portfolio_id)


@app.get("/api/portfolios/{portfolio_id}/performance")
def performance(portfolio_id: str, user: CurrentUser, db: DB) -> dict[str, Any]:
    owned_portfolio(db, user, portfolio_id)
    rows = portfolio_transactions(db, portfolio_id)
    positions = calculate_positions(db, portfolio_id)
    invested = sum(
        (Decimal(tx.quantity) * Decimal(tx.unit_price) + Decimal(tx.fee)
         for tx, _ in rows if tx.audit_status == "CONFIRMED" and tx.action == "BUY"),
        Decimal(0),
    )
    remaining_cost = sum((p["cost"] for p in positions.values()), Decimal(0))
    value = sum((Decimal(h["current_value"]) for h in build_holdings(db, portfolio_id)), Decimal(0))
    realized = sum((p["realized"] for p in positions.values()), Decimal(0))
    fees = sum((p["fees"] for p in positions.values()), Decimal(0))
    audited = sum(1 for tx, _ in rows if tx.audit_status == "CONFIRMED")
    mismatch = any(
        transaction_digest(tx, asset) != tx.canonical_hash
        for tx, asset in rows if tx.audit_status == "CONFIRMED"
    )
    audit_state = "FAILED" if mismatch else ("VALID" if rows and audited == len(rows) else ("NO_RECORDS" if not rows else "PENDING"))
    return {
        "total_invested": decimal_text(invested), "current_value": decimal_text(value),
        "unrealized_pnl": decimal_text(value - remaining_cost), "realized_pnl": decimal_text(realized),
        "total_fees": decimal_text(fees), "holdings_count": sum(1 for p in positions.values() if p["quantity"] > 0),
        "audited_transactions": audited, "audit_status": audit_state,
        "currency": owned_portfolio(db, user, portfolio_id).base_currency,
    }


def transaction_out(tx: InvestmentTransaction, asset: Asset) -> dict[str, Any]:
    return {
        "id": tx.id, "portfolio_id": tx.portfolio_id, "symbol": asset.symbol, "asset_name": asset.name,
        "category": asset.category, "action": tx.action, "quantity": decimal_text(Decimal(tx.quantity)),
        "unit_price": decimal_text(Decimal(tx.unit_price)), "fee": decimal_text(Decimal(tx.fee)),
        "transaction_date": tx.transaction_date.isoformat(), "currency": tx.currency,
        "canonical_hash": tx.canonical_hash, "hash_schema_version": tx.hash_schema_version,
        "audit_status": tx.audit_status, "blockchain_tx_hash": tx.blockchain_tx_hash,
        "block_number": tx.block_number, "contract_address": tx.contract_address, "created_at": tx.created_at,
    }


@app.post("/api/portfolios/{portfolio_id}/transactions", status_code=201)
def record_transaction(portfolio_id: str, body: TransactionBody, user: CurrentUser, db: DB) -> dict[str, Any]:
    portfolio = owned_portfolio(db, user, portfolio_id)
    if body.currency != portfolio.base_currency:
        raise HTTPException(status_code=422, detail="Transaction currency must match the portfolio base currency.")
    unsettled = db.scalar(
        select(InvestmentTransaction.id).where(
            InvestmentTransaction.portfolio_id == portfolio_id,
            InvestmentTransaction.audit_status.in_(["PENDING", "SUBMITTED", "RECONCILIATION_REQUIRED"]),
        ).limit(1)
    )
    if unsettled:
        raise HTTPException(status_code=409, detail="A transaction is awaiting blockchain reconciliation. Reconcile it before recording another transaction.")
    if body.transaction_date > date.today():
        raise HTTPException(status_code=422, detail="Transaction date cannot be in the future.")
    asset = db.scalar(select(Asset).where(Asset.symbol == body.symbol))
    if asset is None:
        asset = Asset(symbol=body.symbol, name=body.asset_name, category=body.category, latest_price=body.unit_price)
        db.add(asset)
        db.flush()
    elif asset.category != body.category:
        raise HTTPException(status_code=422, detail="Asset category does not match the existing symbol.")
    transaction = InvestmentTransaction(
        portfolio_id=portfolio_id, asset_id=asset.id, action=body.action, quantity=body.quantity,
        unit_price=body.unit_price, fee=body.fee, transaction_date=body.transaction_date, currency=body.currency,
    )
    db.add(transaction)
    db.flush()
    if body.action == "SELL":
        position = calculate_positions(db, portfolio_id).get(asset.id)
        available = position["quantity"] if position else Decimal(0)
        if body.quantity > available:
            db.rollback()
            raise HTTPException(status_code=422, detail="Insufficient confirmed holdings for this sale.")
    transaction.canonical_hash = transaction_digest(transaction, asset)
    transaction.audit_status = "PENDING"
    db.commit()
    db.refresh(transaction)
    try:
        transaction.audit_status = "SUBMITTED"
        db.commit()
        chain_result = blockchain.submit_or_recover(transaction, asset)
        transaction.blockchain_tx_hash = chain_result["tx_hash"]
        transaction.block_number = chain_result["block_number"]
        transaction.contract_address = CONTRACT_ADDRESS
        transaction.audit_status = "CONFIRMED"
        db.commit()
        db.refresh(transaction)
    except BlockchainUnavailable as exc:
        transaction.audit_status = "RECONCILIATION_REQUIRED"
        db.commit()
        raise HTTPException(status_code=503, detail={
            "message": f"Blockchain audit unavailable; transaction was not confirmed. {exc}",
            "transaction_id": transaction.id,
            "audit_status": transaction.audit_status,
        })
    except Exception as exc:
        logger.exception("Blockchain submission outcome is uncertain for transaction %s.", transaction.id)
        transaction.audit_status = "RECONCILIATION_REQUIRED"
        db.commit()
        raise HTTPException(status_code=503, detail={
            "message": "Blockchain submission outcome is uncertain; reconcile before retrying.",
            "transaction_id": transaction.id,
            "audit_status": transaction.audit_status,
        }) from exc
    return transaction_out(transaction, asset)


@app.get("/api/portfolios/{portfolio_id}/transactions")
def list_transactions(
    portfolio_id: str, user: CurrentUser, db: DB,
    limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    owned_portfolio(db, user, portfolio_id)
    rows = db.execute(
        select(InvestmentTransaction, Asset).join(Asset).where(InvestmentTransaction.portfolio_id == portfolio_id)
        .order_by(InvestmentTransaction.created_at.desc()).offset(offset).limit(limit)
    ).all()
    total = db.scalar(select(func.count()).select_from(InvestmentTransaction).where(InvestmentTransaction.portfolio_id == portfolio_id)) or 0
    return {"items": [transaction_out(row[0], row[1]) for row in rows], "limit": limit, "offset": offset, "total": total}


def owned_transaction(db: Session, user: User, transaction_id: str) -> tuple[InvestmentTransaction, Asset]:
    row = db.execute(
        select(InvestmentTransaction, Asset).join(Asset).join(Portfolio)
        .where(InvestmentTransaction.id == transaction_id, Portfolio.user_id == user.id)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Transaction not found.")
    return row[0], row[1]


@app.get("/api/transactions/{transaction_id}")
def get_transaction(transaction_id: str, user: CurrentUser, db: DB) -> dict[str, Any]:
    tx, asset = owned_transaction(db, user, transaction_id)
    return transaction_out(tx, asset)


def audit_result(tx: InvestmentTransaction, asset: Asset) -> dict[str, Any]:
    recalculated = transaction_digest(tx, asset)
    try:
        on_chain = blockchain.read_record(tx.id)
        event_valid = bool(tx.blockchain_tx_hash and blockchain.verify_event(tx.blockchain_tx_hash, tx, asset))
    except BlockchainUnavailable:
        return {
            "status": "UNAVAILABLE", "message": "Audit unavailable — blockchain connection failed.",
            "database_hash": tx.canonical_hash, "recalculated_hash": recalculated,
            "on_chain_hash": None, "on_chain_record_exists": None, "event_verified": None,
        }
    database_matches = recalculated == tx.canonical_hash
    chain_matches = on_chain is not None and (
        on_chain["portfolio_ref"].lower() == Web3.to_hex(Web3.keccak(text=tx.portfolio_id)).lower()
        and on_chain["data_hash"].lower() == f"0x{tx.canonical_hash}".lower()
        and on_chain["asset_symbol_hash"].lower() == Web3.to_hex(Web3.keccak(text=asset.symbol)).lower()
        and on_chain["action"] == (1 if tx.action == "BUY" else 2)
    )
    valid = database_matches and chain_matches and event_valid and tx.audit_status == "CONFIRMED"
    return {
        "status": "VALID" if valid else ("TAMPERING_DETECTED" if not database_matches else "INVALID"),
        "database_hash": tx.canonical_hash, "recalculated_hash": recalculated,
        "database_matches_original": database_matches,
        "on_chain_hash": on_chain["data_hash"] if on_chain else None,
        "on_chain_record_exists": bool(on_chain), "event_verified": event_valid,
        "receipt_status": tx.audit_status, "blockchain_tx_hash": tx.blockchain_tx_hash,
        "block_number": tx.block_number,
    }


@app.get("/api/transactions/{transaction_id}/audit")
def audit_transaction(transaction_id: str, user: CurrentUser, db: DB) -> dict[str, Any]:
    tx, asset = owned_transaction(db, user, transaction_id)
    return audit_result(tx, asset)


@app.get("/api/blockchain/audit/{transaction_id}")
def public_audit(transaction_id: str, db: DB) -> dict[str, Any]:
    tx = db.get(InvestmentTransaction, transaction_id)
    if tx is None:
        raise HTTPException(status_code=404, detail="Audit record not found.")
    asset = db.get(Asset, tx.asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset record not found.")
    return audit_result(tx, asset)


@app.get("/api/assets")
def list_assets(user: CurrentUser, db: DB) -> list[dict[str, Any]]:
    return [{"id": a.id, "symbol": a.symbol, "name": a.name, "category": a.category, "latest_price": decimal_text(Decimal(a.latest_price)), "simulated": True} for a in db.scalars(select(Asset).order_by(Asset.symbol)).all()]


@app.post("/api/assets", status_code=201)
def create_asset(body: AssetBody, user: CurrentUser, db: DB) -> dict[str, Any]:
    if db.scalar(select(Asset).where(Asset.symbol == body.symbol)):
        raise HTTPException(status_code=409, detail="Asset symbol already exists.")
    asset = Asset(**body.model_dump())
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return {"id": asset.id, "symbol": asset.symbol, "name": asset.name, "category": asset.category, "latest_price": decimal_text(Decimal(asset.latest_price)), "simulated": True}


@app.patch("/api/assets/{asset_id}/price")
def update_asset_price(asset_id: str, body: PriceBody, user: CurrentUser, db: DB) -> dict[str, Any]:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Administrator authorization required to update shared simulated valuations.")
    asset = db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found.")
    asset.latest_price = body.latest_price
    asset.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"id": asset.id, "symbol": asset.symbol, "latest_price": decimal_text(Decimal(asset.latest_price)), "simulated": True}


@app.get("/api/blockchain/status")
def chain_status(user: CurrentUser) -> dict[str, Any]:
    return blockchain.status()


@app.get("/api/blockchain/audits")
def recent_audits(
    user: CurrentUser,
    db: DB,
    limit: int = Query(default=20, ge=1, le=100),
) -> list[dict[str, Any]]:
    rows = db.execute(
        select(InvestmentTransaction, Asset)
        .join(Asset)
        .join(Portfolio)
        .where(Portfolio.user_id == user.id)
        .order_by(InvestmentTransaction.created_at.desc())
        .limit(limit)
    ).all()
    return [transaction_out(row[0], row[1]) for row in rows]


@app.get("/api/blockchain/blocks")
def recent_blocks(user: CurrentUser, limit: int = Query(default=10, ge=1, le=50)) -> dict[str, Any]:
    try:
        w3, _, _ = blockchain._require()
        latest = w3.eth.block_number
        blocks = []
        for number in range(max(0, latest - limit + 1), latest + 1):
            block = w3.eth.get_block(number, full_transactions=True)
            blocks.append({
                "number": number, "hash": Web3.to_hex(block["hash"]), "timestamp": int(block["timestamp"]),
                "transaction_count": len(block["transactions"]),
                "transactions": [Web3.to_hex(item["hash"]) for item in block["transactions"]],
            })
        return {"latest_block": latest, "blocks": blocks}
    except BlockchainUnavailable:
        raise HTTPException(status_code=503, detail="Blockchain connection failed.")
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Blockchain block query failed.") from exc


@app.get("/api/blockchain/transactions/{tx_hash}")
def chain_transaction(tx_hash: str, user: CurrentUser) -> dict[str, Any]:
    try:
        w3, _, _ = blockchain._require()
        tx = w3.eth.get_transaction(tx_hash)
        receipt = w3.eth.get_transaction_receipt(tx_hash)
        return {
            "hash": Web3.to_hex(tx["hash"]), "block_number": int(receipt["blockNumber"]),
            "status": int(receipt["status"]), "from": tx["from"], "to": tx["to"],
            "gas_used": int(receipt["gasUsed"]), "contract_address": receipt["contractAddress"],
        }
    except BlockchainUnavailable:
        raise HTTPException(status_code=503, detail="Blockchain connection failed.")
    except (TransactionNotFound, ValueError):
        raise HTTPException(status_code=404, detail="Blockchain transaction not found.")
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Blockchain transaction query failed.") from exc


@app.post("/api/blockchain/reconcile")
def reconcile(user: CurrentUser, db: DB) -> dict[str, Any]:
    rows = db.execute(
        select(InvestmentTransaction, Asset).join(Asset).join(Portfolio)
        .where(Portfolio.user_id == user.id, InvestmentTransaction.audit_status.in_(["PENDING", "SUBMITTED", "RECONCILIATION_REQUIRED"]))
    ).all()
    confirmed = 0
    pending = 0
    errors = 0
    for tx, asset in rows:
        try:
            result = blockchain.submit_or_recover(tx, asset)
            tx.blockchain_tx_hash = result["tx_hash"]
            tx.block_number = result["block_number"]
            tx.contract_address = CONTRACT_ADDRESS
            tx.audit_status = "CONFIRMED"
            confirmed += 1
        except BlockchainUnavailable:
            tx.audit_status = "RECONCILIATION_REQUIRED"
            pending += 1
        except Exception:
            logger.exception("Blockchain reconciliation failed for transaction %s.", tx.id)
            tx.audit_status = "RECONCILIATION_REQUIRED"
            pending += 1
            errors += 1
    db.commit()
    return {
        "confirmed": confirmed,
        "needs_attention": pending,
        "message": "Some blockchain operations failed and remain unconfirmed." if errors else None,
    }


@app.get("/api/dashboard/summary")
def dashboard_summary(user: CurrentUser, db: DB) -> dict[str, Any]:
    portfolios = db.scalars(select(Portfolio).where(Portfolio.user_id == user.id)).all()
    summaries = [performance(p.id, user, db) for p in portfolios]
    fields = ("total_invested", "current_value", "unrealized_pnl", "realized_pnl", "total_fees")
    totals = {key: decimal_text(sum((Decimal(str(item[key])) for item in summaries), Decimal(0))) for key in fields}
    audit_states = [item["audit_status"] for item in summaries]
    audit_status = "FAILED" if "FAILED" in audit_states else (
        "PENDING" if "PENDING" in audit_states else ("VALID" if "VALID" in audit_states else "NO_RECORDS")
    )
    if audit_status == "VALID":
        rows = db.execute(
            select(InvestmentTransaction, Asset)
            .join(Asset)
            .join(Portfolio)
            .where(Portfolio.user_id == user.id, InvestmentTransaction.audit_status == "CONFIRMED")
        ).all()
        for tx, asset in rows:
            verified = audit_result(tx, asset)
            if verified["status"] == "UNAVAILABLE":
                audit_status = "UNAVAILABLE"
                break
            if verified["status"] != "VALID":
                audit_status = "FAILED"
                break
    totals.update({
        "holdings_count": sum(item["holdings_count"] for item in summaries),
        "audited_transactions": sum(item["audited_transactions"] for item in summaries),
        "audit_status": audit_status,
        "currency": summaries[0]["currency"] if summaries else "INR",
    })
    return totals


@app.get("/api/dashboard/allocation")
def dashboard_allocation(user: CurrentUser, db: DB) -> list[dict[str, Any]]:
    allocation: dict[str, Decimal] = {}
    for portfolio in db.scalars(select(Portfolio).where(Portfolio.user_id == user.id)).all():
        for holding in build_holdings(db, portfolio.id):
            category = holding["category"]
            allocation[category] = allocation.get(category, Decimal(0)) + Decimal(holding["current_value"])
    return [{"category": key, "value": decimal_text(value)} for key, value in allocation.items()]


@app.get("/api/dashboard/performance")
def dashboard_performance(user: CurrentUser, db: DB) -> list[dict[str, Any]]:
    result = []
    for portfolio in db.scalars(select(Portfolio).where(Portfolio.user_id == user.id)).all():
        for holding in build_holdings(db, portfolio.id):
            result.append({"symbol": holding["symbol"], "unrealized_pnl": holding["unrealized_pnl"], "current_value": holding["current_value"]})
    return result


@app.post("/api/demo/tamper/{transaction_id}")
def tamper_transaction(transaction_id: str, body: TamperBody, user: CurrentUser, db: DB) -> dict[str, Any]:
    if APP_ENV != "development" or not DEMO_TAMPERING_ENABLED:
        raise HTTPException(status_code=404, detail="Demo tampering is disabled.")
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Administrator authorization required.")
    tx, _ = owned_transaction(db, user, transaction_id)
    tx.unit_price = body.unit_price
    db.commit()
    return {"transaction_id": tx.id, "tampered": True, "audit_status": tx.audit_status}
