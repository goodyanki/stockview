from __future__ import annotations

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.services.ibkr_flex_service import IbkrFlexService
from app.services.longbridge_service import LongbridgeService


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


def start_scheduler() -> None:
    settings = get_settings()
    if not settings.enable_scheduler:
        return

    if scheduler.running:
        return

    scheduler.add_job(
        lambda: _run_with_session(_sync_longbridge),
        trigger="interval",
        minutes=settings.longbridge_sync_minutes,
        id="sync_longbridge_positions",
        replace_existing=True,
    )
    scheduler.add_job(
        lambda: _run_with_session(_sync_ibkr),
        trigger="cron",
        hour=settings.ibkr_sync_hour_utc,
        minute=0,
        id="sync_ibkr_flex_daily",
        replace_existing=True,
    )
    scheduler.start()


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)

