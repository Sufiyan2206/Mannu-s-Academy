"""Thin helpers over SQLAlchemy Core. SQL is written by hand so it stays plain MySQL."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

from sqlalchemy import Connection, create_engine, text
from sqlalchemy.engine import Engine

engine: Engine | None = None


def init_engine(url: str) -> Engine:
    global engine
    engine = create_engine(url, pool_pre_ping=True, pool_recycle=1800, future=True)
    return engine


@contextmanager
def tx() -> Iterator[Connection]:
    """One transaction: commits on success, rolls back on any error."""
    assert engine is not None, "database not initialised"
    with engine.begin() as c:
        yield c


def rows(c: Connection, sql: str, /, **p: Any) -> list[dict]:
    return [dict(r._mapping) for r in c.execute(text(sql), p)]


def one(c: Connection, sql: str, /, **p: Any) -> dict | None:
    r = c.execute(text(sql), p).first()
    return dict(r._mapping) if r else None


def val(c: Connection, sql: str, /, **p: Any) -> Any:
    r = c.execute(text(sql), p).first()
    return r[0] if r else None


def run(c: Connection, sql: str, /, **p: Any):
    return c.execute(text(sql), p)


def insert(c: Connection, sql: str, /, **p: Any) -> int:
    return int(c.execute(text(sql), p).lastrowid)


def now_utc() -> datetime:
    """Naive UTC datetime, the way MySQL DATETIME columns are stored."""
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=(datetime.now().microsecond // 1000) * 1000)


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
