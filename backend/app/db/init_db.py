from sqlalchemy.orm import Session

from app.db.base import Base
from app.db.models import Account, Broker, DailySnapshot
from app.db.session import engine


def create_tables() -> None:
    Base.metadata.create_all(bind=engine)


def ensure_default_brokers(db: Session) -> None:
    defaults = [
        ("IBKR_FLEX", "Interactive Brokers Flex"),
        ("LONGBRIDGE_OPENAPI", "Longbridge OpenAPI"),
    ]
    for code, name in defaults:
        broker = db.query(Broker).filter(Broker.code == code).first()
        if not broker:
            db.add(Broker(code=code, name=name))
    db.commit()


def ensure_account(db: Session, broker_code: str, account_no: str, account_name: str) -> Account:
    broker = db.query(Broker).filter(Broker.code == broker_code).first()
    if not broker:
        broker = Broker(code=broker_code, name=broker_code)
        db.add(broker)
        db.flush()

    account = (
        db.query(Account)
        .filter(Account.broker_id == broker.id, Account.account_no == account_no)
        .first()
    )
    if account:
        return account

    account = Account(
        broker_id=broker.id,
        account_no=account_no,
        account_name=account_name,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


def ensure_initial_snapshot(db: Session) -> None:
    existing = db.query(DailySnapshot).first()
    if not existing:
        db.add(DailySnapshot(date="2026-01-05", total_value_usd=43369.0))
        db.commit()

