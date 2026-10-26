from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from flask import current_app


class HttpError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def tz() -> ZoneInfo:
    return ZoneInfo(current_app.config["ACADEMY_TZ"])


def local_to_utc(local: str) -> datetime | None:
    """'2026-10-03T18:00' in the academy time zone -> naive UTC datetime (None if unreadable)."""
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})", (local or "").strip())
    if not m:
        return None
    try:
        d = datetime(*map(int, m.groups()), tzinfo=tz())
    except ValueError:
        return None
    return d.astimezone(timezone.utc).replace(tzinfo=None)


def utc_to_local(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc).astimezone(tz())


def local_date(dt: datetime) -> str:
    return utc_to_local(dt).strftime("%Y-%m-%d")


def month_bounds(month: str) -> tuple[datetime, datetime]:
    y, m = map(int, month.split("-"))
    start = datetime(y, m, 1, tzinfo=tz())
    end = datetime(y + (m == 12), 1 if m == 12 else m + 1, 1, tzinfo=tz())
    return start.astimezone(timezone.utc).replace(tzinfo=None), end.astimezone(timezone.utc).replace(tzinfo=None)


def day_bounds(d: str) -> tuple[datetime, datetime]:
    y, m, dd = map(int, d.split("-"))
    s = datetime(y, m, dd, tzinfo=tz())
    return s.astimezone(timezone.utc).replace(tzinfo=None), (s + timedelta(days=1)).astimezone(timezone.utc).replace(tzinfo=None)


def minute(dt: datetime | None) -> str | None:
    return dt.strftime("%Y-%m-%d %H:%M") if dt else None


EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def is_email(v: str) -> bool:
    return bool(EMAIL.match(v or "")) and len(v) <= 190


def clean(v, n: int = 200) -> str:
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", " ", str(v if v is not None else "")).strip()[:n]


def tidy_school(v) -> str:
    return re.sub(r"\s+", " ", clean(v, 400)).strip()


def school_key(v) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip().casefold()


def valid_phone(v: str) -> bool:
    d = re.sub(r"\D", "", v or "")
    return bool(re.fullmatch(r"\+?[\d\s\-()]{7,25}", (v or "").strip())) and 7 <= len(d) <= 15


def body() -> dict:
    from flask import request
    j = request.get_json(silent=True)
    return j if isinstance(j, dict) else {}


def need(b: dict, key: str, msg: str):
    v = b.get(key)
    if v is None or (isinstance(v, str) and not v.strip()):
        raise HttpError(400, msg)
    return v


def to_int(v, msg: str) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        raise HttpError(400, msg)


def today_local() -> date:
    return utc_to_local(datetime.now(timezone.utc).replace(tzinfo=None)).date()
