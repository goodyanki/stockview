from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
ROOT_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Load root .dev.vars first, then allow backend/.env to override when needed.
        env_file=(ROOT_DIR / ".dev.vars", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "portfolio-backend"
    app_env: str = "dev"
    debug: bool = Field(default=True)

    database_url: str = f"sqlite:///{ROOT_DIR / 'portfolio.db'}"
    cors_origins: List[str] = ["http://localhost:8788", "http://localhost:3000"]
    backend_api_key: str = ""

    ibkr_flex_token: str = ""
    ibkr_flex_query_id: str = ""
    ibkr_account_no: str = "U1234567"
    ibkr_account_name: str = "IBKR Main"
    ibkr_flex_send_url: str = (
        "https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.SendRequest"
    )
    ibkr_flex_get_url: str = (
        "https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement"
    )
    ibkr_use_mock: bool = True

    longbridge_account_no: str = "LONG-001"
    longbridge_account_name: str = "Longbridge Main"
    longbridge_use_mock: bool = True
    longbridge_access_token: str = Field(
        default="",
        validation_alias=AliasChoices("LONGBRIDGE_ACCESS_TOKEN", "LONGPORT_TOKEN"),
    )
    longport_app_key: str = Field(default="", validation_alias=AliasChoices("LONGPORT_APP_KEY"))
    longport_app_secret: str = Field(default="", validation_alias=AliasChoices("LONGPORT_APP_SECRET"))

    view_username: str = Field(default="", validation_alias=AliasChoices("VIEW_USERNAME"))
    view_password: str = Field(default="", validation_alias=AliasChoices("VIEW_PASSWORD"))

    enable_scheduler: bool = False
    longbridge_sync_minutes: int = 5
    ibkr_sync_hour_utc: int = 22

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_origins(cls, value: str | List[str]) -> List[str]:
        if isinstance(value, list):
            return value
        if not value:
            return []
        return [item.strip() for item in value.split(",") if item.strip()]

    @field_validator("debug", mode="before")
    @classmethod
    def parse_debug(cls, value: object) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"1", "true", "yes", "on", "debug", "dev"}:
                return True
            if normalized in {"0", "false", "no", "off", "release", "prod", "production"}:
                return False
        return bool(value)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
