from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.init_db import ensure_account
from app.repositories.portfolio_repository import PortfolioRepository

logger = logging.getLogger(__name__)


class LongbridgeService:
    def __init__(self, db: Session):
        self.db = db
        self.settings = get_settings()
        self.repo = PortfolioRepository(db)

    def sync(self) -> int:
        account = ensure_account(
            self.db,
            broker_code="LONGBRIDGE_OPENAPI",
            account_no=self.settings.longbridge_account_no,
            account_name=self.settings.longbridge_account_name,
        )
        positions_payload, quote_payload, rows = self._build_rows()
        self.repo.add_raw_import("LONGBRIDGE_OPENAPI", "POSITION", positions_payload)
        self.repo.add_raw_import("LONGBRIDGE_OPENAPI", "QUOTE", quote_payload)
        return self.repo.replace_longbridge_positions(account_id=account.id, rows=rows)

    def _build_rows(self) -> tuple[str, str, list[dict]]:
        if self.settings.longbridge_use_mock:
            positions = self._mock_positions()
            quotes = self._mock_quotes()
        else:
            positions = self._fetch_positions_sdk()
            symbols = [item["symbol"] for item in positions]
            quotes = self._fetch_quotes_sdk(symbols) if symbols else {}

        rows: list[dict] = []
        snapshot_time = datetime.now(timezone.utc)
        for item in positions:
            symbol = str(item.get("symbol", "")).upper()
            market = str(item.get("market", ""))
            quantity = self._to_float(item.get("quantity"))
            avg_cost = self._to_float(item.get("avg_cost"))
            currency = str(item.get("currency", "USD"))

            quote = quotes.get(symbol, {})
            last_price = self._to_float(quote.get("last_price"))
            current_value = quantity * last_price
            cost_value = quantity * avg_cost
            unrealized_pnl = current_value - cost_value
            unrealized_pnl_pct = ((last_price - avg_cost) / avg_cost) if avg_cost else 0.0

            rows.append(
                {
                    "symbol": symbol,
                    "market": market,
                    "quantity": quantity,
                    "avg_cost": avg_cost,
                    "last_price": last_price,
                    "current_value": current_value,
                    "cost_value": cost_value,
                    "unrealized_pnl": unrealized_pnl,
                    "unrealized_pnl_pct": unrealized_pnl_pct,
                    "currency": currency,
                    "snapshot_time": snapshot_time,
                }
            )

        return (
            json.dumps(positions, ensure_ascii=False, default=str),
            json.dumps(quotes, ensure_ascii=False, default=str),
            rows,
        )

    # ---- Longport SDK methods ----

    def _get_sdk_config(self):
        from longport.openapi import Config

        app_key = self.settings.longport_app_key
        app_secret = self.settings.longport_app_secret
        access_token = self.settings.longbridge_access_token
        if not app_key or not app_secret or not access_token:
            raise HTTPException(
                status_code=500,
                detail="Longport SDK credentials not configured (LONGPORT_APP_KEY, LONGPORT_APP_SECRET, LONGPORT_TOKEN)",
            )
        return Config(app_key=app_key, app_secret=app_secret, access_token=access_token)

    @staticmethod
    def _market_str(market_obj) -> str:
        text = str(market_obj)  # e.g. "Market.US", "Market.HK"
        if "." in text:
            label = text.rsplit(".", 1)[-1]
            return label.upper() if label != "Unknown" else ""
        return text.upper()

    def _fetch_positions_sdk(self) -> list[dict]:
        from longport.openapi import TradeContext

        try:
            config = self._get_sdk_config()
            ctx = TradeContext(config)
            resp = ctx.stock_positions()
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Longport SDK stock_positions failed")
            raise HTTPException(status_code=502, detail=f"Longport SDK error: {exc}") from exc

        positions: list[dict] = []
        for channel in resp.channels:
            for pos in channel.positions:
                positions.append(
                    {
                        "symbol": pos.symbol,
                        "market": self._market_str(pos.market),
                        "quantity": float(pos.quantity) if isinstance(pos.quantity, Decimal) else float(pos.quantity),
                        "avg_cost": float(pos.cost_price) if isinstance(pos.cost_price, Decimal) else float(pos.cost_price),
                        "currency": pos.currency,
                    }
                )
        return positions

    def _fetch_quotes_sdk(self, symbols: list[str]) -> dict[str, dict]:
        from longport.openapi import QuoteContext

        try:
            config = self._get_sdk_config()
            ctx = QuoteContext(config)
            quote_list = ctx.quote(symbols)
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Longport SDK quote failed")
            raise HTTPException(status_code=502, detail=f"Longport SDK quote error: {exc}") from exc

        quote_map: dict[str, dict] = {}
        for q in quote_list:
            symbol = str(q.symbol).upper()
            quote_map[symbol] = {
                "symbol": symbol,
                "last_price": float(q.last_done) if isinstance(q.last_done, Decimal) else float(q.last_done),
                "prev_close": float(q.prev_close) if isinstance(q.prev_close, Decimal) else float(q.prev_close),
                "high": float(q.high) if isinstance(q.high, Decimal) else float(q.high),
                "low": float(q.low) if isinstance(q.low, Decimal) else float(q.low),
                "volume": int(q.volume),
            }
        return quote_map

    # ---- helpers ----

    @staticmethod
    def _to_float(value: object) -> float:
        if value is None:
            return 0.0
        try:
            return float(str(value).replace(",", ""))
        except ValueError:
            return 0.0

    @staticmethod
    def _mock_positions() -> list[dict]:
        return [
            {
                "symbol": "00700.HK",
                "market": "HK",
                "quantity": 100,
                "avg_cost": 301.2,
                "currency": "HKD",
            },
            {
                "symbol": "TSLA.US",
                "market": "US",
                "quantity": 6,
                "avg_cost": 182.5,
                "currency": "USD",
            },
        ]

    @staticmethod
    def _mock_quotes() -> dict[str, dict]:
        return {
            "00700.HK": {"symbol": "00700.HK", "last_price": 328.4},
            "TSLA.US": {"symbol": "TSLA.US", "last_price": 195.2},
        }
