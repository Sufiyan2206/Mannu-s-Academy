"""Fee rates, monthly fee generation, manual charges, payments, receipts (admin only; students can read their own statement)."""
from datetime import date, datetime, timedelta
import re

from flask import Blueprint, g, jsonify, request

from .. import auth, db, fees as engine
from ..db import iso, now_utc
from ..money import convert, dp, from_minor, to_minor
from ..util import HttpError, body, clean, local_to_utc, need, to_int, today_local

bp = Blueprint("fees", __name__, url_prefix="/api")
METHODS = ("cash", "bank_transfer", "card", "online", "cheque", "other")


def valid_cur(v: str) -> str:
    v = clean(v, 10).upper()
    if not (len(v) == 3 and v.isalpha()):
        raise HttpError(400, "Choose a valid currency.")
    return v


# ------------------------------------------------------------------ rates
@bp.get("/fees/rates")
@auth.roles("admin")
def list_rates():
    with db.tx() as c:
        rows = db.rows(c, """SELECT r.*, s.name AS subject, b.name AS batch, st.name AS student FROM fee_rates r JOIN subjects s ON s.id=r.subject_id
            LEFT JOIN batches b ON b.id=r.batch_id LEFT JOIN students st ON st.id=r.student_id ORDER BY s.name, r.batch_id, r.student_id""")
    return jsonify([{"id": r["id"], "subject_id": r["subject_id"], "subject": r["subject"], "batch_id": r["batch_id"] or None, "batch": r["batch"], "student_id": r["student_id"] or None,
                     "student": r["student"], "currency": r["currency"], "amount": from_minor(r["amount_minor"], r["currency"])} for r in rows])


@bp.post("/fees/rates")
@auth.roles("admin")
def set_rate():
    b = body()
    cur = valid_cur(b.get("currency") or "AED")
    sub, batch, stu = to_int(b.get("subject_id"), "Choose a subject."), to_int(b.get("batch_id") or 0, "Choose a batch."), to_int(b.get("student_id") or 0, "Choose a student.")
    minor = to_minor(need(b, "amount", "Enter the amount."), cur)
    if batch and stu:
        raise HttpError(400, "A rate is for a whole subject, one batch, or one student, not a batch and a student together.")
    with db.tx() as c:
        if not db.val(c, "SELECT 1 FROM subjects WHERE id=:i", i=sub):
            raise HttpError(400, "Choose a subject.")
        db.run(c, """INSERT INTO fee_rates(subject_id,batch_id,student_id,currency,amount_minor) VALUES (:s,:b,:t,:c,:a) ON DUPLICATE KEY UPDATE amount_minor=VALUES(amount_minor)""", s=sub, b=batch, t=stu, c=cur, a=minor)
    return jsonify({"ok": True})


@bp.delete("/fees/rates/<int:rid>")
@auth.roles("admin")
def delete_rate(rid: int):
    with db.tx() as c:
        db.run(c, "DELETE FROM fee_rates WHERE id=:i", i=rid)
    return jsonify({"ok": True})


def rate_for(c, student: dict, subject_id: int) -> int | None:
    """Most specific rate wins: this student, then this batch, then everyone."""
    r = db.one(c, """SELECT amount_minor FROM fee_rates WHERE subject_id=:s AND currency=:c AND ((student_id=:t) OR (student_id=0 AND batch_id=:b) OR (student_id=0 AND batch_id=0))
        ORDER BY student_id DESC, batch_id DESC LIMIT 1""", s=subject_id, c=student["currency"], t=student["id"], b=student["batch_id"])
    return r["amount_minor"] if r else None


# ------------------------------------------------------------------ charges
@bp.post("/fees/generate")
@auth.roles("admin")
def generate():
    b = body()
    period = clean(b.get("period"), 7)
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", period):
        raise HttpError(400, "Choose the month.")
    due_day = to_int(b.get("due_day") or 10, "Choose the due day.")
    if not 1 <= due_day <= 28:
        raise HttpError(400, "The due day must be between 1 and 28.")
    y, m = map(int, period.split("-"))
    due = date(y, m, due_day)
    created = skipped = no_rate = 0
    with db.tx() as c:
        for st in db.rows(c, "SELECT id, name, currency, batch_id FROM students WHERE active=1"):
            for sub in db.rows(c, "SELECT x.id, x.name FROM subjects x JOIN student_subjects ss ON ss.subject_id=x.id WHERE ss.student_id=:s", s=st["id"]):
                if db.val(c, "SELECT 1 FROM charges WHERE student_id=:s AND subject_id=:x AND period=:p AND voided=0", s=st["id"], x=sub["id"], p=period):
                    skipped += 1; continue
                amt = rate_for(c, st, sub["id"])
                if amt is None:
                    no_rate += 1; continue
                db.run(c, """INSERT INTO charges(student_id,subject_id,period,description,currency,amount_minor,due_date,created_by) VALUES (:s,:x,:p,:d,:c,:a,:due,:u)""",
                       s=st["id"], x=sub["id"], p=period, d=f"{sub['name']} fee – {period}", c=st["currency"], a=amt, due=due, u=g.user["id"])
                created += 1
    return jsonify({"created": created, "skipped": skipped, "no_rate": no_rate})


@bp.post("/fees/charges")
@auth.roles("admin")
def add_charge():
    b = body()
    sid = to_int(b.get("student_id"), "Choose a student.")
    desc = clean(need(b, "description", "Describe the charge."), 200)
    try:
        due = date.fromisoformat(str(b.get("due_date")))
    except ValueError:
        raise HttpError(400, "Choose the due date.")
    with db.tx() as c:
        st = db.one(c, "SELECT id, currency FROM students WHERE id=:i", i=sid)
        if not st:
            raise HttpError(404, "Student not found.")
        amt = to_minor(need(b, "amount", "Enter the amount."), st["currency"])
        if amt <= 0:
            raise HttpError(400, "The amount must be more than zero.")
        sub = b.get("subject_id")
        cid = db.insert(c, "INSERT INTO charges(student_id,subject_id,period,description,currency,amount_minor,due_date,created_by) VALUES (:s,:x,:p,:d,:c,:a,:due,:u)",
                        s=sid, x=int(sub) if sub else None, p=clean(b.get("period"), 7) or None, d=desc, c=st["currency"], a=amt, due=due, u=g.user["id"])
    return jsonify({"id": cid})


@bp.post("/fees/charges/<int:cid>/void")
@auth.roles("admin")
def void_charge(cid: int):
    with db.tx() as c:
        if not db.val(c, "SELECT 1 FROM charges WHERE id=:i AND voided=0", i=cid):
            raise HttpError(404, "Charge not found.")
        db.run(c, "UPDATE charges SET voided=1, void_reason=:r WHERE id=:i", r=clean(body().get("reason"), 300), i=cid)
    return jsonify({"ok": True})


# ------------------------------------------------------------------ statements
def statement(c, sid: int) -> dict:
    s = db.one(c, "SELECT s.id, s.name, s.currency, b.name AS batch FROM students s JOIN batches b ON b.id=s.batch_id WHERE s.id=:i", i=sid)
    if not s:
        raise HttpError(404, "Student not found.")
    f = engine.status(c, sid, today_local())
    cur = f["currency"]
    pays = db.rows(c, "SELECT p.*, u.name AS received_by_name FROM payments p LEFT JOIN users u ON u.id=p.received_by WHERE p.student_id=:i ORDER BY p.paid_at DESC, p.id DESC", i=sid)
    return {"student": {"id": s["id"], "name": s["name"], "batch": s["batch"]}, "currency": cur, "charged": from_minor(f["charged"], cur), "paid": from_minor(f["paid"], cur), "balance": from_minor(f["balance"], cur),
            "overdue": from_minor(f["overdue"], cur), "due_soon": from_minor(f["due_soon"], cur), "next_due": f["next_due"].isoformat() if f["next_due"] else None,
            "charges": [engine.money_line(x, cur) for x in f["lines"]], "payments": [pay_out(p) for p in pays], "other_currency_charges": f["other_currency_charges"]}


@bp.get("/fees/summary")
@auth.roles("admin")
def summary():
    out = []
    with db.tx() as c:
        for s in db.rows(c, "SELECT s.id, s.name, s.batch_id, b.name AS batch FROM students s JOIN batches b ON b.id=s.batch_id WHERE s.active=1 ORDER BY s.name"):
            f = engine.status(c, s["id"], today_local()); cur = f["currency"]
            out.append({"id": s["id"], "name": s["name"], "batch": s["batch"], "currency": cur, "charged": from_minor(f["charged"], cur), "paid": from_minor(f["paid"], cur), "balance": from_minor(f["balance"], cur),
                        "overdue": from_minor(f["overdue"], cur), "due_soon": from_minor(f["due_soon"], cur), "next_due": f["next_due"].isoformat() if f["next_due"] else None})
    return jsonify(out)


@bp.get("/fees/student/<int:sid>")
@auth.roles("admin")
def student_fees(sid: int):
    with db.tx() as c:
        return jsonify(statement(c, sid))


@bp.get("/fees/mine")
@auth.roles("student")
def my_fees():
    with db.tx() as c:
        return jsonify(statement(c, g.user["student_id"]))


# ------------------------------------------------------------------ payments & receipts
def pay_out(p: dict) -> dict:
    return {"id": p["id"], "receipt_no": p["receipt_no"], "student_id": p["student_id"], "currency": p["currency"], "amount": from_minor(p["amount_minor"], p["currency"]),
            "paid_currency": p["paid_currency"], "paid_amount": from_minor(p["paid_minor"], p["paid_currency"]), "rate": float(p["rate"]), "method": p["method"], "reference": p["reference"],
            "note": p["note"], "paid_at": iso(p["paid_at"]), "received_by": p.get("received_by_name"), "voided": bool(p["voided"]), "void_reason": p["void_reason"]}


def next_receipt(c) -> str:
    year = today_local().year
    db.run(c, "INSERT INTO receipt_counters(year, n) VALUES (:y, 0) ON DUPLICATE KEY UPDATE n=n", y=year)
    n = int(db.val(c, "SELECT n FROM receipt_counters WHERE year=:y FOR UPDATE", y=year)) + 1
    db.run(c, "UPDATE receipt_counters SET n=:n WHERE year=:y", n=n, y=year)
    return f"MTA-{year}-{n:05d}"


@bp.post("/payments")
@auth.roles("admin")
def record_payment():
    b = body()
    sid = to_int(b.get("student_id"), "Choose a student.")
    method = b.get("method")
    if method not in METHODS:
        raise HttpError(400, "Choose how the payment was made.")
    with db.tx() as c:
        st = db.one(c, "SELECT id, currency FROM students WHERE id=:i", i=sid)
        if not st:
            raise HttpError(404, "Student not found.")
        cur = st["currency"]
        paid_cur = valid_cur(b.get("paid_currency") or cur)
        paid_minor = to_minor(need(b, "amount", "Enter the amount."), paid_cur)
        if paid_minor <= 0:
            raise HttpError(400, "The amount must be more than zero.")
        if paid_cur == cur:
            rate, credit = 1, paid_minor
        else:
            try:
                rate = float(b.get("rate"))
            except (TypeError, ValueError):
                raise HttpError(400, f"Enter the exchange rate (1 {paid_cur} = ? {cur}).")
            if not rate > 0:
                raise HttpError(400, f"Enter the exchange rate (1 {paid_cur} = ? {cur}).")
            credit = convert(paid_minor, paid_cur, rate, cur)
        when = now_utc()
        if b.get("paid_date"):
            when = local_to_utc(str(b["paid_date"]) + "T12:00")
            if not when:
                raise HttpError(400, "Choose a valid payment date.")
        pid = db.insert(c, """INSERT INTO payments(receipt_no,student_id,currency,amount_minor,paid_currency,paid_minor,rate,method,reference,note,paid_at,received_by)
            VALUES (:r,:s,:c,:a,:pc,:pm,:rate,:m,:ref,:n,:t,:u)""", r=next_receipt(c), s=sid, c=cur, a=credit, pc=paid_cur, pm=paid_minor, rate=rate, m=method, ref=clean(b.get("reference"), 120), n=clean(b.get("note"), 300), t=when, u=g.user["id"])
    return jsonify({"id": pid})


@bp.get("/payments")
@auth.roles("admin")
def list_payments():
    w, p = ["1=1"], {}
    if request.args.get("student_id"):
        w.append("p.student_id=:s"); p["s"] = request.args["student_id"]
    with db.tx() as c:
        rows = db.rows(c, f"""SELECT p.*, u.name AS received_by_name, s.name AS student FROM payments p JOIN students s ON s.id=p.student_id LEFT JOIN users u ON u.id=p.received_by
            WHERE {' AND '.join(w)} ORDER BY p.paid_at DESC, p.id DESC LIMIT 200""", **p)
    return jsonify([{**pay_out(r), "student": r["student"]} for r in rows])


@bp.get("/payments/<int:pid>")
@auth.login_required
def receipt(pid: int):
    with db.tx() as c:
        p = db.one(c, """SELECT p.*, u.name AS received_by_name, s.name AS student, b.name AS batch FROM payments p JOIN students s ON s.id=p.student_id JOIN batches b ON b.id=s.batch_id
            LEFT JOIN users u ON u.id=p.received_by WHERE p.id=:i""", i=pid)
        if not p or (g.user["role"] == "student" and p["student_id"] != g.user["student_id"]) or g.user["role"] == "teacher":
            raise HttpError(404, "Receipt not found.")
        bal = engine.status(c, p["student_id"], today_local())
    from flask import current_app
    return jsonify({**pay_out(p), "student": p["student"], "batch": p["batch"], "academy": current_app.config["ACADEMY_NAME"], "balance_after": from_minor(bal["balance"], bal["currency"])})


@bp.post("/payments/<int:pid>/void")
@auth.roles("admin")
def void_payment(pid: int):
    reason = clean(body().get("reason"), 300)
    if not reason:
        raise HttpError(400, "Say why the payment is being cancelled.")
    with db.tx() as c:
        if not db.val(c, "SELECT 1 FROM payments WHERE id=:i AND voided=0", i=pid):
            raise HttpError(404, "Payment not found, or already cancelled.")
        db.run(c, "UPDATE payments SET voided=1, void_reason=:r, voided_by=:u, voided_at=:t WHERE id=:i", r=reason, u=g.user["id"], t=now_utc(), i=pid)
    return jsonify({"ok": True})
