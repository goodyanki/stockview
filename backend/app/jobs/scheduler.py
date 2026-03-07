from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.repositories.portfolio_repository import PortfolioRepository
from app.services.ibkr_flex_service import IbkrFlexService
from app.services.longbridge_service import LongbridgeService

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler(timezone="UTC")


def _run_with_session(job_fn) -> None:
    db: Session = SessionLocal()
    try:
        job_fn(db)
    finally:
        db.close()


def _sync_longbridge(db: Session) -> None:
    LongbridgeService(db).sync()


def _sync_ibkr(db: Session) -> None:
    IbkrFlexService(db).sync()


def _daily_snapshot(db: Session) -> None:
    try:
        IbkrFlexService(db).sync()
    except Exception:
        logger.exception("Daily snapshot: IBKR sync failed")
    try:
        LongbridgeService(db).sync()
    except Exception:
        logger.exception("Daily snapshot: Longbridge sync failed")
    repo = PortfolioRepository(db)
    summary = repo.portfolio_summary()
    repo.save_daily_snapshot(summary["total_market_value"])
    logger.info("Daily snapshot saved: %.2f USD", summary["total_market_value"])


def start_scheduler() -> None:
    settings = get_settings()
    if not settings.enable_scheduler:
        return

    if scheduler.running:
        return

    scheduler.add_job(
        lambda: _run_with_session(_daily_snapshot),
        trigger="cron",
        hour=settings.ibkr_sync_hour_utc,
        minute=0,
        id="daily_portfolio_snapshot",
        replace_existing=True,
    )
    scheduler.start()


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)

