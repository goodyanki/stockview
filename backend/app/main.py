from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.api.routes import router as api_router
from app.core.config import get_settings
from app.db.init_db import create_tables, ensure_default_brokers, ensure_initial_snapshot
from app.db.session import SessionLocal
from app.jobs.scheduler import start_scheduler, stop_scheduler

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_tables()
    db: Session = SessionLocal()
    try:
        ensure_default_brokers(db)
        ensure_initial_snapshot(db)
    finally:
        db.close()
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title=settings.app_name, debug=settings.debug, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}

