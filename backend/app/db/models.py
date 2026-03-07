from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Broker(Base):
    __tablename__ = "brokers"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128))

    accounts: Mapped[list["Account"]] = relationship(back_populates="broker")


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (UniqueConstraint("broker_id", "account_no", name="uq_broker_account"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    broker_id: Mapped[int] = mapped_column(ForeignKey("brokers.id"), index=True)
    account_no: Mapped[str] = mapped_column(String(64))
    account_name: Mapped[str] = mapped_column(String(128))

    broker: Mapped["Broker"] = relationship(back_populates="accounts")
    positions: Mapped[list["Position"]] = relationship(back_populates="account")
    reports: Mapped[list["Report"]] = relationship(back_populates="account")


class RawImport(Base):
    __tablename__ = "raw_imports"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    broker_source: Mapped[str] = mapped_column(String(64), index=True)
    import_type: Mapped[str] = mapped_column(String(64), index=True)
    raw_payload: Mapped[str] = mapped_column(Text())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class Position(Base):
    __tablename__ = "positions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    broker_source: Mapped[str] = mapped_column(String(64), index=True)
    symbol: Mapped[str] = mapped_column(String(64), index=True)
    market: Mapped[str] = mapped_column(String(32), default="")
    quantity: Mapped[float] = mapped_column(Float())
    avg_cost: Mapped[float] = mapped_column(Float())
    last_price: Mapped[float] = mapped_column(Float())
    current_value: Mapped[float] = mapped_column(Float())
    cost_value: Mapped[float] = mapped_column(Float())
    unrealized_pnl: Mapped[float] = mapped_column(Float())
    unrealized_pnl_pct: Mapped[float] = mapped_column(Float())
    currency: Mapped[str] = mapped_column(String(16), default="USD")
    snapshot_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

    account: Mapped["Account"] = relationship(back_populates="positions")


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    broker_source: Mapped[str] = mapped_column(String(64), index=True)
    report_type: Mapped[str] = mapped_column(String(64), default="FLEX_REPORT")
    report_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    symbol: Mapped[str] = mapped_column(String(64), index=True)
    quantity: Mapped[float] = mapped_column(Float())
    avg_cost: Mapped[float] = mapped_column(Float())
    market_value: Mapped[float] = mapped_column(Float())
    unrealized_pnl: Mapped[float] = mapped_column(Float())
    currency: Mapped[str] = mapped_column(String(16), default="USD")
    parsed_payload: Mapped[str] = mapped_column(Text())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    account: Mapped["Account"] = relationship(back_populates="reports")


class DailySnapshot(Base):
    __tablename__ = "daily_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    date: Mapped[str] = mapped_column(String(10), unique=True, index=True)  # YYYY-MM-DD
    total_value_usd: Mapped[float] = mapped_column(Float())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

