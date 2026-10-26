"""The fee engine: what a student has been charged, paid and still owes. Payments are applied to the oldest charge first."""
from __future__ import annotations

from datetime import date, timedelta

from . import db
from .money import from_minor


def status(c, student_id: int, today: date) -> dict:
    s = db.one(c, "SELECT id, currency FROM students WHERE id=:i", i=student_id)
    cur = s["currency"]
    charges = db.rows(c, "SELECT * FROM charges WHERE student_id=:s AND voided=0 AND currency=:c ORDER BY due_date, id", s=student_id, c=cur)
    paid_total = int(db.val(c, "SELECT COALESCE(SUM(amount_minor),0) FROM payments WHERE student_id=:s AND voided=0 AND currency=:c", s=student_id, c=cur))
    left, soon = paid_total, today + timedelta(days=7)
    lines = []
    for ch in charges:
        paid = min(left, ch["amount_minor"]); left -= paid
        lines.append({**ch, "paid_minor": paid, "outstanding_minor": ch["amount_minor"] - paid})
    charged = sum(x["amount_minor"] for x in lines)
    open_ = [x for x in lines if x["outstanding_minor"] > 0]
    other = int(db.val(c, "SELECT COUNT(*) FROM charges WHERE student_id=:s AND voided=0 AND currency<>:c", s=student_id, c=cur))
    return {"currency": cur, "charged": charged, "paid": paid_total, "balance": charged - paid_total, "lines": lines,
            "overdue": sum(x["outstanding_minor"] for x in open_ if x["due_date"] < today),
            "due_soon": sum(x["outstanding_minor"] for x in open_ if today <= x["due_date"] <= soon),
            "next_due": min((x["due_date"] for x in open_), default=None), "other_currency_charges": other}


def money_line(x: dict, cur: str) -> dict:
    return {"id": x["id"], "subject_id": x["subject_id"], "period": x["period"], "description": x["description"], "due_date": x["due_date"].isoformat(),
            "amount": from_minor(x["amount_minor"], cur), "paid": from_minor(x["paid_minor"], cur), "outstanding": from_minor(x["outstanding_minor"], cur)}
