from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.models import Position, RawImport, Report


class PortfolioRepository:
    def __init__(self, db: Session):
        self.db = db

    def add_raw_import(self, broker_source: str, import_type: str, raw_payload: str) -> None:
        self.db.add(
            RawImport(
                broker_source=broker_source,
                import_type=import_type,
                raw_payload=raw_payload,
            )
        )
        self.db.commit()

    def replace_ibkr_reports(self, account_id: int, rows: list[dict]) -> int:
        self.db.query(Report).filter(Report.account_id == account_id, Report.broker_source == "IBKR_FLEX").delete()
        for row in rows:
            self.db.add(
                Report(
                    account_id=account_id,
                    broker_source="IBKR_FLEX",
                    report_type="FLEX_REPORT",
                    report_date=row["report_date"],
                    symbol=row["symbol"],
                    quantity=row["quantity"],
                    avg_cost=row["avg_cost"],
                    market_value=row["market_value"],
                    unrealized_pnl=row["unrealized_pnl"],
                    currency=row["currency"],
                    parsed_payload=row["parsed_payload"],
                )
            )
        self.db.commit()
        return len(rows)

    def replace_longbridge_positions(self, account_id: int, rows: list[dict]) -> int:
        self.db.query(Position).filter(
            Position.account_id == account_id,
            Position.broker_source == "LONGBRIDGE_OPENAPI",
        ).delete()
        for row in rows:
            self.db.add(
                Position(
                    account_id=account_id,
                    broker_source="LONGBRIDGE_OPENAPI",
                    symbol=row["symbol"],
                    market=row["market"],
                    quantity=row["quantity"],
                    avg_cost=row["avg_cost"],
                    last_price=row["last_price"],
                    current_value=row["current_value"],
                    cost_value=row["cost_value"],
                    unrealized_pnl=row["unrealized_pnl"],
                    unrealized_pnl_pct=row["unrealized_pnl_pct"],
                    currency=row["currency"],
                    snapshot_time=row["snapshot_time"],
                )
            )
        self.db.commit()
        return len(rows)

    def list_ibkr_reports(self, limit: int = 200) -> list[Report]:
        return (
            self.db.query(Report)
            .filter(Report.broker_source == "IBKR_FLEX")
            .order_by(Report.report_date.desc(), Report.id.desc())
            .limit(limit)
            .all()
        )

    def list_longbridge_positions(self, limit: int = 200) -> list[Position]:
        return (
            self.db.query(Position)
            .filter(Position.broker_source == "LONGBRIDGE_OPENAPI")
            .order_by(Position.snapshot_time.desc(), Position.id.desc())
            .limit(limit)
            .all()
        )

    def portfolio_summary(self) -> dict:
        # Longbridge positions
        position_rows = (
            self.db.query(
                Position.broker_source,
                func.coalesce(func.sum(Position.current_value), 0.0),
                func.coalesce(func.sum(Position.unrealized_pnl), 0.0),
            )
            .group_by(Position.broker_source)
            .all()
        )
        # IBKR reports
        report_rows = (
            self.db.query(
                Report.broker_source,
                func.coalesce(func.sum(Report.market_value), 0.0),
                func.coalesce(func.sum(Report.unrealized_pnl), 0.0),
            )
            .group_by(Report.broker_source)
            .all()
        )
        broker_summaries = [
            {
                "broker_source": broker_source,
                "total_market_value": float(total_market_value),
                "total_unrealized_pnl": float(total_unrealized_pnl),
            }
            for broker_source, total_market_value, total_unrealized_pnl in (*position_rows, *report_rows)
        ]
        total_market_value = sum(item["total_market_value"] for item in broker_summaries)
        total_unrealized_pnl = sum(item["total_unrealized_pnl"] for item in broker_summaries)
        return {
            "brokers": broker_summaries,
            "total_market_value": total_market_value,
            "total_unrealized_pnl": total_unrealized_pnl,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

