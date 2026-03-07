from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.security import require_authenticated
from app.db.session import get_db
from app.repositories.portfolio_repository import PortfolioRepository
from app.schemas.portfolio import (
    DailySnapshotOut,
    IbkrReportOut,
    LongbridgePositionOut,
    PortfolioSummaryOut,
    SyncResult,
)
from app.services.ibkr_flex_service import IbkrFlexService
from app.services.longbridge_service import LongbridgeService

router = APIRouter(prefix="/api", tags=["portfolio"], dependencies=[Depends(require_authenticated)])


@router.get("/reports/ibkr", response_model=list[IbkrReportOut])
def get_ibkr_reports(
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
) -> list[IbkrReportOut]:
    return PortfolioRepository(db).list_ibkr_reports(limit)


@router.post("/sync/ibkr-flex", response_model=SyncResult)
def sync_ibkr(db: Session = Depends(get_db)) -> SyncResult:
    imported = IbkrFlexService(db).sync()
    return SyncResult(success=True, imported=imported, message="IBKR Flex sync completed")


@router.get("/positions/longbridge", response_model=list[LongbridgePositionOut])
def get_longbridge_positions(
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
) -> list[LongbridgePositionOut]:
    return PortfolioRepository(db).list_longbridge_positions(limit)


@router.post("/sync/longbridge", response_model=SyncResult)
def sync_longbridge(db: Session = Depends(get_db)) -> SyncResult:
    imported = LongbridgeService(db).sync()
    return SyncResult(success=True, imported=imported, message="Longbridge sync completed")


@router.get("/portfolio/summary", response_model=PortfolioSummaryOut)
def get_summary(db: Session = Depends(get_db)) -> PortfolioSummaryOut:
    payload = PortfolioRepository(db).portfolio_summary()
    return PortfolioSummaryOut(
        brokers=payload["brokers"],
        total_market_value=payload["total_market_value"],
        total_unrealized_pnl=payload["total_unrealized_pnl"],
    )


@router.get("/portfolio/snapshots", response_model=list[DailySnapshotOut])
def get_snapshots(db: Session = Depends(get_db)) -> list[DailySnapshotOut]:
    return PortfolioRepository(db).list_daily_snapshots()
