from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class SyncResult(BaseModel):
    success: bool
    imported: int
    message: str = ""


class IbkrReportOut(BaseModel):
    id: int
    broker_source: str
    symbol: str
    quantity: float
    avg_cost: float
    market_value: float
    unrealized_pnl: float
    currency: str
    report_date: datetime

    model_config = {"from_attributes": True}


class LongbridgePositionOut(BaseModel):
    id: int
    broker_source: str
    symbol: str
    market: str
    quantity: float
    avg_cost: float
    last_price: float
    current_value: float
    cost_value: float
    unrealized_pnl: float
    unrealized_pnl_pct: float
    currency: str
    snapshot_time: datetime

    model_config = {"from_attributes": True}


class BrokerSummaryOut(BaseModel):
    broker_source: str
    total_market_value: float
    total_unrealized_pnl: float


class PortfolioSummaryOut(BaseModel):
    brokers: list[BrokerSummaryOut]
    total_market_value: float
    total_unrealized_pnl: float


class DailySnapshotOut(BaseModel):
    date: str
    total_value_usd: float

    model_config = {"from_attributes": True}

