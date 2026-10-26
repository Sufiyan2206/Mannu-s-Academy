"""Money is handled as integer minor units. Decimals are used only at the edges (input and display)."""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from .util import HttpError

ZERO_DP = {"JPY", "KRW", "VND", "CLP", "ISK", "UGX", "XAF", "XOF", "PYG", "RWF"}
THREE_DP = {"KWD", "BHD", "OMR", "JOD", "TND", "IQD", "LYD"}


def dp(cur: str) -> int:
    return 0 if cur in ZERO_DP else 3 if cur in THREE_DP else 2


def to_minor(v, cur: str, msg: str = "Enter a valid amount.") -> int:
    try:
        d = Decimal(str(v).replace(",", "").strip())
    except (InvalidOperation, AttributeError):
        raise HttpError(400, msg)
    if not d.is_finite() or d < 0:
        raise HttpError(400, msg)
    q = Decimal(1).scaleb(-dp(cur))
    if d != d.quantize(q):
        raise HttpError(400, f"{cur} amounts can have at most {dp(cur)} decimal places.")
    return int((d * (10 ** dp(cur))).to_integral_value(ROUND_HALF_UP))


def from_minor(m: int | None, cur: str) -> float:
    return round((m or 0) / (10 ** dp(cur)), dp(cur))


def convert(paid_minor: int, paid_cur: str, rate, cur: str) -> int:
    """Value of a payment made in another currency: amount x rate (1 unit of paid currency = rate units of the student's currency)."""
    d = Decimal(str(paid_minor)) / (10 ** dp(paid_cur)) * Decimal(str(rate))
    return int((d * (10 ** dp(cur))).to_integral_value(ROUND_HALF_UP))
