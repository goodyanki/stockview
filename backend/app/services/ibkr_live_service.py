from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from app.core.config import get_settings


class IbkrLiveService:
    def __init__(self):
        self.settings = get_settings()

    def get_overview(self) -> dict[str, Any]:
        if self.settings.ibkr_live_use_mock:
            return self._mock_overview()

        try:
            from ib_insync import IB
        except ImportError as exc:
            raise HTTPException(status_code=500, detail="ib_insync is not installed") from exc

        ib = IB()
        try:
            ib.connect(
                host=self.settings.ibkr_live_host,
                port=self.settings.ibkr_live_port,
                clientId=self.settings.ibkr_live_client_id,
                timeout=self.settings.ibkr_live_timeout,
                readonly=True,
                account=self.settings.ibkr_live_account or "",
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Failed to connect IB Gateway: {exc}") from exc

        try:
            account_values = ib.accountSummary(account=self.settings.ibkr_live_account or "")
            positions = ib.positions(account=self.settings.ibkr_live_account or "")

            contracts = [p.contract for p in positions]
            tickers = ib.reqTickers(*contracts) if contracts else []
            price_by_conid: dict[int, float] = {}
            for ticker in tickers:
                con_id = getattr(ticker.contract, "conId", 0)
                raw_price = ticker.marketPrice()
                if raw_price is None or (isinstance(raw_price, float) and (math.isnan(raw_price) or raw_price <= 0)):
                    raw_price = ticker.close or ticker.last or ticker.bid or ticker.ask
                price_by_conid[con_id] = self._to_float(raw_price)

            account_no = self.settings.ibkr_live_account or self._guess_account_no(account_values, positions)

            summary_map = self._summary_map(account_values, account_no)
            position_rows: list[dict[str, Any]] = []
            total_market_value = 0.0
            total_cost_value = 0.0

            for pos in positions:
                contract = pos.contract
                qty = self._to_float(pos.position)
                avg_cost = self._to_float(pos.avgCost)
                if qty == 0:
                    continue

                last_price = price_by_conid.get(getattr(contract, "conId", 0), 0.0)
                if not last_price:
                    last_price = avg_cost

                current_value = qty * last_price
                cost_value = qty * avg_cost
                unrealized_pnl = current_value - cost_value
                unrealized_pnl_pct = (unrealized_pnl / cost_value) if cost_value else 0.0

                total_market_value += current_value
                total_cost_value += cost_value

                position_rows.append(
                    {
                        "account_no": getattr(pos, "account", account_no),
                        "symbol": getattr(contract, "localSymbol", "") or getattr(contract, "symbol", ""),
                        "market": getattr(contract, "primaryExchange", "") or getattr(contract, "exchange", ""),
                        "quantity": qty,
                        "avg_cost": avg_cost,
                        "last_price": last_price,
                        "current_value": current_value,
                        "unrealized_pnl": unrealized_pnl,
                        "unrealized_pnl_pct": unrealized_pnl_pct,
                        "currency": getattr(contract, "currency", "USD") or "USD",
                    }
                )

            total_unrealized = total_market_value - total_cost_value

            return {
                "broker_source": "IBKR_GATEWAY",
                "account_no": account_no,
                "generated_at": datetime.now(timezone.utc),
                "account_status": {
                    "net_liquidation": self._summary_number(summary_map, "NetLiquidation"),
                    "total_cash_value": self._summary_number(summary_map, "TotalCashValue"),
                    "buying_power": self._summary_number(summary_map, "BuyingPower"),
                    "available_funds": self._summary_number(summary_map, "AvailableFunds"),
                    "gross_position_value": self._summary_number(summary_map, "GrossPositionValue", total_market_value),
                    "unrealized_pnl": self._summary_number(summary_map, "UnrealizedPnL", total_unrealized),
                    "realized_pnl": self._summary_number(summary_map, "RealizedPnL"),
                    "base_currency": self._summary_currency(summary_map),
                },
                "positions": position_rows,
            }
        finally:
            ib.disconnect()

    @staticmethod
    def _to_float(value: object) -> float:
        if value is None:
            return 0.0
        try:
            return float(str(value).replace(",", ""))
        except (TypeError, ValueError):
            return 0.0

    def _summary_map(self, values: list[Any], account_no: str) -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        for item in values:
            if account_no and getattr(item, "account", "") not in {"", account_no}:
                continue
            tag = getattr(item, "tag", "")
            result[tag] = {
                "value": getattr(item, "value", "0"),
                "currency": getattr(item, "currency", "USD") or "USD",
            }
        return result

    def _summary_number(self, summary_map: dict[str, dict[str, Any]], tag: str, fallback: float = 0.0) -> float:
        item = summary_map.get(tag)
        if not item:
            return fallback
        return self._to_float(item.get("value"))

    @staticmethod
    def _summary_currency(summary_map: dict[str, dict[str, Any]]) -> str:
        for key in ["NetLiquidation", "TotalCashValue", "AvailableFunds"]:
            item = summary_map.get(key)
            if item and item.get("currency"):
                return str(item["currency"])
        return "USD"

    @staticmethod
    def _guess_account_no(account_values: list[Any], positions: list[Any]) -> str:
        for item in account_values:
            account = getattr(item, "account", "")
            if account:
                return account
        for pos in positions:
            account = getattr(pos, "account", "")
            if account:
                return account
        return ""

    @staticmethod
    def _mock_overview() -> dict[str, Any]:
        return {
            "broker_source": "IBKR_GATEWAY",
            "account_no": "U1234567",
            "generated_at": datetime.now(timezone.utc),
            "account_status": {
                "net_liquidation": 125430.0,
                "total_cash_value": 21340.0,
                "buying_power": 87320.0,
                "available_funds": 54120.0,
                "gross_position_value": 104090.0,
                "unrealized_pnl": 4320.0,
                "realized_pnl": 860.0,
                "base_currency": "USD",
            },
            "positions": [
                {
                    "account_no": "U1234567",
                    "symbol": "AAPL",
                    "market": "NASDAQ",
                    "quantity": 30.0,
                    "avg_cost": 181.2,
                    "last_price": 192.3,
                    "current_value": 5769.0,
                    "unrealized_pnl": 333.0,
                    "unrealized_pnl_pct": 0.0612,
                    "currency": "USD",
                },
                {
                    "account_no": "U1234567",
                    "symbol": "MSFT",
                    "market": "NASDAQ",
                    "quantity": 12.0,
                    "avg_cost": 398.0,
                    "last_price": 412.8,
                    "current_value": 4953.6,
                    "unrealized_pnl": 177.6,
                    "unrealized_pnl_pct": 0.0372,
                    "currency": "USD",
                },
            ],
        }
