import secrets

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from app.core.config import get_settings

basic_security = HTTPBasic(auto_error=False)


def _verify_basic(credentials: HTTPBasicCredentials, username: str, password: str) -> bool:
    return secrets.compare_digest(credentials.username, username) and secrets.compare_digest(
        credentials.password, password
    )


def require_authenticated(
    credentials: HTTPBasicCredentials | None = Depends(basic_security),
    x_api_key: str | None = Header(default=None),
) -> None:
    settings = get_settings()
    basic_enabled = bool(settings.view_username) and bool(settings.view_password)
    api_key_enabled = bool(settings.backend_api_key)

    if not basic_enabled and not api_key_enabled:
        return

    if api_key_enabled and x_api_key and secrets.compare_digest(x_api_key, settings.backend_api_key):
        return

    if basic_enabled and credentials and _verify_basic(
        credentials, settings.view_username, settings.view_password
    ):
        return

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required",
        headers={"WWW-Authenticate": "Basic"},
    )


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    # Backward compatible helper for endpoints that want API-key-only protection.
    settings = get_settings()
    if not settings.backend_api_key:
        return
    if not x_api_key or not secrets.compare_digest(x_api_key, settings.backend_api_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
