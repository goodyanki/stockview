from __future__ import annotations

import json
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from urllib.parse import urlencode

import requests
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.init_db import ensure_account
from app.repositories.portfolio_repository import PortfolioRepository


class IbkrFlexService:
    def __init__(self, db: Session):
        self.db = db
        self.settings = get_settings()
        self.repo = PortfolioRepository(db)

    def sync(self) -> int:
        account = ensure_account(
            self.db,
            broker_code="IBKR_FLEX",
            account_no=self.settings.ibkr_account_no,
            account_name=self.settings.ibkr_account_name,
        )
        xml_payload = self._fetch_statement()
        self.repo.add_raw_import("IBKR_FLEX", "FLEX_REPORT", xml_payload)
        rows = self._parse_statement(xml_payload)
        return self.repo.replace_ibkr_reports(account_id=account.id, rows=rows)

    def _fetch_statement(self) -> str:
        if self.settings.ibkr_use_mock or not self.settings.ibkr_flex_token or not self.settings.ibkr_flex_query_id:
            return self._mock_xml()

        send_query = urlencode(
            {
                "t": self.settings.ibkr_flex_token,
                "q": self.settings.ibkr_flex_query_id,
                "v": "3",
            }
        )
        send_resp = requests.get(
            f"{self.settings.ibkr_flex_send_url}?{send_query}",
            headers={"Cache-Control": "no-cache", "Pragma": "no-cache"},
            timeout=20,
        )
        if send_resp.status_code == 304:
            raise HTTPException(status_code=502, detail="IBKR send request returned 304 (no data)")
        send_resp.raise_for_status()
        reference_code = self._extract_reference_code(send_resp.text)
        if not reference_code:
            raise HTTPException(status_code=502, detail="IBKR send request failed: missing reference code")

        for _ in range(5):
            get_query = urlencode({"t": self.settings.ibkr_flex_token, "q": reference_code, "v": "3"})
            result = requests.get(
                f"{self.settings.ibkr_flex_get_url}?{get_query}",
                headers={"Cache-Control": "no-cache", "Pragma": "no-cache"},
                timeout=20,
            )
            if result.status_code == 304:
                raise HTTPException(status_code=502, detail="IBKR get statement returned 304 (no data)")
            result.raise_for_status()
            text = result.text
            if "Statement generation in progress" in text:
                time.sleep(2)
                continue
            return text

        raise HTTPException(status_code=504, detail="IBKR statement still in progress")

    @staticmethod
    def _extract_reference_code(text: str) -> str:
        patterns = [
            r"<ReferenceCode>(\d+)</ReferenceCode>",
            r'referenceCode="(\d+)"',
        ]
        for pattern in patterns:
            match = re.search(pattern, text)
            if match:
                return match.group(1)
        return ""

    def _parse_statement(self, xml_payload: str) -> list[dict]:
        try:
            root = ET.fromstring(xml_payload)
        except ET.ParseError:
            return self._mock_rows()

        report_date = datetime.now(timezone.utc)
        date_node = root.find(".//FlexStatement")
        if date_node is not None and "toDate" in date_node.attrib:
            try:
                report_date = datetime.fromisoformat(date_node.attrib["toDate"]).replace(tzinfo=timezone.utc)
            except ValueError:
                pass

        parsed_rows: list[dict] = []
        for node in root.iter():
            attrs = {k.lower(): v for k, v in node.attrib.items()}
            if not attrs:
                continue
            symbol = attrs.get("symbol") or attrs.get("underlyingsymbol")
            quantity_raw = attrs.get("position") or attrs.get("quantity") or attrs.get("qty")
            if not symbol or quantity_raw is None:
                continue

            quantity = self._to_float(quantity_raw)
            cost_basis_price = self._to_float(
                attrs.get("costbasisprice") or attrs.get("avgcost") or attrs.get("avg_price")
            )
            if cost_basis_price:
                avg_cost = cost_basis_price
            else:
                total_cost = self._to_float(attrs.get("costbasismoney") or attrs.get("costbasis"))
                avg_cost = (total_cost / quantity) if quantity else 0.0
            market_value = self._to_float(
                attrs.get("positionvalue")
                or attrs.get("marketvalue")
                or attrs.get("currentvalue")
            )
            unrealized_pnl = self._to_float(
                attrs.get("fifopnlunrealized") or attrs.get("unrealizedpl") or attrs.get("unrealized_pnl")
            )
            currency = attrs.get("currency", "USD")

            parsed_rows.append(
                {
                    "report_date": report_date,
                    "symbol": symbol,
                    "quantity": quantity,
                    "avg_cost": avg_cost,
                    "market_value": market_value,
                    "unrealized_pnl": unrealized_pnl,
                    "currency": currency,
                    "parsed_payload": json.dumps(node.attrib, ensure_ascii=False),
                }
            )

        return parsed_rows or self._mock_rows()

    @staticmethod
    def _to_float(value: str | None) -> float:
        if value is None:
            return 0.0
        try:
            return float(str(value).replace(",", ""))
        except ValueError:
            return 0.0

    @staticmethod
    def _mock_xml() -> str:
        return """<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse>
  <FlexStatements>
    <FlexStatement toDate="2026-03-07">
      <OpenPosition symbol="AAPL" position="20" costBasisPrice="170.5" marketValue="3640" fifoPnlUnrealized="230" currency="USD"/>
      <OpenPosition symbol="MSFT" position="8" costBasisPrice="390.3" marketValue="3240" fifoPnlUnrealized="118" currency="USD"/>
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>
"""

    @staticmethod
    def _mock_rows() -> list[dict]:
        now = datetime.now(timezone.utc)
        return [
            {
                "report_date": now,
                "symbol": "AAPL",
                "quantity": 20,
                "avg_cost": 170.5,
                "market_value": 3640,
                "unrealized_pnl": 230,
                "currency": "USD",
                "parsed_payload": '{"source":"mock"}',
            },
            {
                "report_date": now,
                "symbol": "MSFT",
                "quantity": 8,
                "avg_cost": 390.3,
                "market_value": 3240,
                "unrealized_pnl": 118,
                "currency": "USD",
                "parsed_payload": '{"source":"mock"}',
            },
        ]

