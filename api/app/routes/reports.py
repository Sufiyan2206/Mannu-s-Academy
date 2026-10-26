"""Attendance, outstanding-fee and payment reports. Every figure comes from the same code as the screens, so the reports always agree with them."""
from datetime import date, timedelta

from flask import Blueprint, g, jsonify, request

from .. import auth, db, fees as engine
from ..db import iso, now_utc
from ..money import from_minor
from ..util import HttpError, day_bounds, local_date, school_key, today_local, utc_to_local
from .fees import pay_out

bp = Blueprint("reports", __name__, url_prefix="/api")
STAFF = ("admin", "teacher")


def pct(attended: int, held: int):
    return round(attended * 1000 / held) / 10 if held else None


def check_range(a: str | None, b: str | None) -> None:
    if a and b:
        if a > b:
            raise HttpError(400, "The “From” date is after the “To” date.")
        if (date.fromisoformat(b) - date.fromisoformat(a)).days > 366:
            raise HttpError(400, "Choose a range of one year or less.")


@bp.get("/reports/attendance")
@auth.login_required
def attendance_report():
    q, u = request.args, g.user
    check_range(q.get("from"), q.get("to"))
    sid = int(q["student_id"]) if q.get("student_id") else None
    staff = u["role"] in STAFF
    if not staff:
        sid = u["student_id"]
    w, p = ["c.status='scheduled'"], {}
    if q.get("from"):
        w.append("c.start_at>=:f"); p["f"] = day_bounds(q["from"])[0]
    if q.get("to"):
        w.append("c.start_at<:t"); p["t"] = day_bounds(q["to"])[1]
    for key, col in (("batch", "c.batch_id"), ("subject", "c.subject_id")):
        if q.get(key):
            w.append(f"{col}=:{key}"); p[key] = q[key]
    if sid:
        w.append("a.student_id=:sid"); p["sid"] = sid
    if staff and q.get("school") == "__none":
        w.append("s.school=''")
    with db.tx() as c:
        rows = db.rows(c, f"""SELECT a.class_id, a.student_id, a.status, a.join_time, a.leave_time, a.duration_sec, a.source, a.note, c.start_at, s.name student_name, s.school, b.name batch, sub.name subject
            FROM attendance a JOIN classes c ON c.id=a.class_id JOIN students s ON s.id=a.student_id JOIN batches b ON b.id=c.batch_id JOIN subjects sub ON sub.id=c.subject_id
            WHERE {' AND '.join(w)} ORDER BY c.start_at DESC, s.name""", **p)
        if staff and q.get("school") and q["school"] != "__none":
            key = school_key(q["school"]); rows = [r for r in rows if school_key(r["school"]) == key]
        per: dict[int, dict] = {}
        perc: dict[int, dict] = {}
        for r in rows:
            e = per.setdefault(r["student_id"], {"student_id": r["student_id"], "name": r["student_name"], "school": r["school"] or "", "batch": r["batch"], "held": 0, "present": 0, "late": 0, "absent": 0})
            e["held"] += 1; e[r["status"]] += 1
            k = perc.setdefault(r["class_id"], {"class_id": r["class_id"], "start_at": iso(r["start_at"]), "subject": r["subject"], "batch": r["batch"], "present": 0, "late": 0, "absent": 0})
            k[r["status"]] += 1
        students = sorted(({**e, "percent": pct(e["present"] + e["late"], e["held"])} for e in per.values()), key=lambda x: x["name"])
        by_class = sorted(({**k, "percent": pct(k["present"] + k["late"], k["present"] + k["late"] + k["absent"])} for k in perc.values()), key=lambda x: x["start_at"], reverse=True)
        present = sum(1 for r in rows if r["status"] == "present"); late = sum(1 for r in rows if r["status"] == "late"); attended = present + late
        out = {"summary": {"classes": len({r["class_id"] for r in rows}), "records": len(rows), "present": present, "late": late, "absent": len(rows) - attended, "percent": pct(attended, len(rows))}, "students": students, "by_class": by_class}
        recs = [{"class_id": r["class_id"], "student": r["student_name"], "school": r["school"] or "", "start_at": iso(r["start_at"]), "subject": r["subject"], "batch": r["batch"], "status": r["status"], "join_time": iso(r["join_time"]),
                 "leave_time": iso(r["leave_time"]), "duration_sec": r["duration_sec"], "source": r["source"], "note": r["note"] or ""} for r in rows]
        if sid or not staff or q.get("detail"):
            out["records"] = recs[:5000]
        if staff:
            cols = list(reversed(by_class))[-60:]
            ids = {x["class_id"] for x in cols}
            cell: dict[int, dict] = {}
            for r in rows:
                if r["class_id"] in ids:
                    cell.setdefault(r["student_id"], {})[r["class_id"]] = r["status"]
            out["register"] = {"classes": [{"class_id": x["class_id"], "start_at": x["start_at"], "subject": x["subject"]} for x in cols],
                               "rows": [{"student_id": s["student_id"], "name": s["name"], "percent": s["percent"], "cells": cell.get(s["student_id"], {})} for s in students], "truncated": len(by_class) > 60}
            out["absences"] = [r for r in recs if r["status"] == "absent"]
            mw, mp = ["c.status='scheduled'", "c.attendance_taken_at IS NULL", "DATE_ADD(c.start_at, INTERVAL c.duration_min MINUTE) < :now"], {"now": now_utc()}
            if q.get("from"):
                mw.append("c.start_at>=:f"); mp["f"] = day_bounds(q["from"])[0]
            if q.get("to"):
                mw.append("c.start_at<:t"); mp["t"] = day_bounds(q["to"])[1]
            for key, col in (("batch", "c.batch_id"), ("subject", "c.subject_id")):
                if q.get(key):
                    mw.append(f"{col}=:{key}"); mp[key] = q[key]
            miss = db.rows(c, f"""SELECT c.id class_id, c.start_at, sub.name subject, b.name batch FROM classes c JOIN batches b ON b.id=c.batch_id JOIN subjects sub ON sub.id=c.subject_id
                WHERE {' AND '.join(mw)} ORDER BY c.start_at DESC LIMIT 50""", **mp)
            out["missing"] = [{**m, "start_at": iso(m["start_at"])} for m in miss]
    return jsonify(out)


# ------------------------------------------------------------------ outstanding fees
BUCKETS = [("not_due", "Not yet due"), ("d1_30", "1–30 days overdue"), ("d31_60", "31–60 days overdue"), ("d61_90", "61–90 days overdue"), ("d90", "Over 90 days overdue")]


def bucket(l: dict) -> str:
    if not l["overdue"]:
        return "not_due"
    d = l["days_overdue"]
    return "d1_30" if d <= 30 else "d31_60" if d <= 60 else "d61_90" if d <= 90 else "d90"


@bp.get("/reports/outstanding")
@auth.roles("admin")
def outstanding():
    q, today = request.args, today_local()
    if q.get("due_from") and q.get("due_to") and q["due_from"] > q["due_to"]:
        raise HttpError(400, "The “Due from” date is after the “Due to” date.")
    soon = today + timedelta(days=7)
    w, p = ["1=1" if q.get("inactive") else "s.active=1"], {}
    for key, col in (("batch", "s.batch_id"), ("student_id", "s.id")):
        if q.get(key):
            w.append(f"{col}=:{key}"); p[key] = q[key]
    lines, studs = [], []
    with db.tx() as c:
        subjects = {r["id"]: r["name"] for r in db.rows(c, "SELECT id, name FROM subjects")}
        for s in db.rows(c, f"SELECT s.*, b.name AS batch FROM students s JOIN batches b ON b.id=s.batch_id WHERE {' AND '.join(w)} ORDER BY s.name", **p):
            if q.get("school") == "__none" and s["school"]:
                continue
            if q.get("school") and q["school"] != "__none" and school_key(s["school"]) != school_key(q["school"]):
                continue
            f = engine.status(c, s["id"], today); cur = f["currency"]
            if q.get("currency") and cur != q["currency"]:
                continue
            mine = [x for x in f["lines"] if x["outstanding_minor"] > 0 and (not q.get("subject") or str(x["subject_id"]) == q["subject"]) and (not q.get("period") or x["period"] == q["period"])
                    and (not q.get("due_from") or x["due_date"].isoformat() >= q["due_from"]) and (not q.get("due_to") or x["due_date"].isoformat() <= q["due_to"])]
            for x in mine:
                lines.append({"charge_id": x["id"], "student_id": s["id"], "student": s["name"], "batch_id": s["batch_id"], "batch": s["batch"], "school": s["school"], "guardian_name": s["guardian_name"], "guardian_mobile": s["guardian_mobile"],
                              "subject_id": x["subject_id"], "subject": subjects.get(x["subject_id"], "Other"), "period": x["period"] or "", "description": x["description"], "due_date": x["due_date"].isoformat(), "currency": cur,
                              "amount": from_minor(x["amount_minor"], cur), "paid": from_minor(x["paid_minor"], cur), "outstanding": from_minor(x["outstanding_minor"], cur), "days_overdue": max(0, (today - x["due_date"]).days),
                              "overdue": x["due_date"] < today, "due_soon": today <= x["due_date"] <= soon})
            tot = lambda fn: sum(x["outstanding_minor"] for x in mine if fn(x))
            studs.append({"id": s["id"], "name": s["name"], "batch_id": s["batch_id"], "batch": s["batch"], "school": s["school"], "active": bool(s["active"]), "guardian_name": s["guardian_name"], "guardian_mobile": s["guardian_mobile"], "currency": cur,
                          "charged": from_minor(f["charged"], cur), "paid": from_minor(f["paid"], cur), "balance": from_minor(f["balance"], cur), "credit": from_minor(-f["balance"], cur) if f["balance"] < 0 else 0,
                          "outstanding": from_minor(tot(lambda x: True), cur), "overdue": from_minor(tot(lambda x: x["due_date"] < today), cur), "due_soon": from_minor(tot(lambda x: today <= x["due_date"] <= soon), cur),
                          "oldest_due": mine[0]["due_date"].isoformat() if mine else None, "days_overdue": max(0, (today - mine[0]["due_date"]).days) if mine else 0, "lines": len(mine)})
        periods = [r["period"] for r in db.rows(c, "SELECT DISTINCT period FROM charges WHERE voided=0 AND period IS NOT NULL ORDER BY period DESC")]
    r2 = lambda x: round(x, 2)

    def group(kf, nf):
        m: dict = {}
        for l in lines:
            k = (kf(l), l["currency"]); e = m.setdefault(k, {"key": kf(l), "name": nf(l), "currency": l["currency"], "outstanding": 0.0, "overdue": 0.0, "lines": 0, "_s": set()})
            e["outstanding"] += l["outstanding"]; e["overdue"] += l["outstanding"] if l["overdue"] else 0; e["lines"] += 1; e["_s"].add(l["student_id"])
        return sorted(({**{k: v for k, v in e.items() if k != "_s"}, "outstanding": r2(e["outstanding"]), "overdue": r2(e["overdue"]), "students": len(e["_s"])} for e in m.values()), key=lambda e: (str(e["name"]), e["currency"]))
    ageing: dict = {}
    for l in lines:
        a = ageing.setdefault(l["currency"], {k: {"amount": 0.0, "lines": 0, "_s": set()} for k, _ in BUCKETS}); b = a[bucket(l)]
        b["amount"] += l["outstanding"]; b["lines"] += 1; b["_s"].add(l["student_id"])
    totals: dict = {}
    for l in lines:
        t = totals.setdefault(l["currency"], {"currency": l["currency"], "outstanding": 0.0, "overdue": 0.0, "due_soon": 0.0, "_s": set()})
        t["outstanding"] += l["outstanding"]; t["overdue"] += l["outstanding"] if l["overdue"] else 0; t["due_soon"] += l["outstanding"] if l["due_soon"] else 0; t["_s"].add(l["student_id"])
    credits: dict = {}
    for s in studs:
        if s["credit"] > 0:
            e = credits.setdefault(s["currency"], {"currency": s["currency"], "credit": 0.0, "students": 0}); e["credit"] += s["credit"]; e["students"] += 1
    return jsonify({"today": today.isoformat(), "students": studs, "lines": lines, "periods": periods,
                    "ageing": [{"currency": cur, "buckets": [{"key": k, "label": lab, "amount": r2(a[k]["amount"]), "lines": a[k]["lines"], "students": len(a[k]["_s"])} for k, lab in BUCKETS]} for cur, a in ageing.items()],
                    "by_batch": group(lambda l: l["batch_id"], lambda l: l["batch"]), "by_subject": group(lambda l: l["subject_id"] or 0, lambda l: l["subject"]), "by_period": sorted(group(lambda l: l["period"] or "none", lambda l: l["period"] or "No period"), key=lambda e: str(e["key"])),
                    "totals": [{"currency": t["currency"], "outstanding": r2(t["outstanding"]), "overdue": r2(t["overdue"]), "due_soon": r2(t["due_soon"]), "students_owing": len(t["_s"])} for t in totals.values()],
                    "credits": [{**e, "credit": r2(e["credit"])} for e in credits.values()]})


@bp.get("/reports/payments")
@auth.roles("admin")
def payments_report():
    q = request.args
    check_range(q.get("from"), q.get("to"))
    w, p = ["p.voided=0"], {}
    if q.get("from"):
        w.append("p.paid_at>=:f"); p["f"] = day_bounds(q["from"])[0]
    if q.get("to"):
        w.append("p.paid_at<:t"); p["t"] = day_bounds(q["to"])[1]
    for key, col in (("method", "p.method"), ("batch", "s.batch_id"), ("student_id", "p.student_id")):
        if q.get(key):
            w.append(f"{col}=:{key}"); p[key] = q[key]
    if q.get("currency"):
        w.append("p.paid_currency=:cur"); p["cur"] = q["currency"]
    with db.tx() as c:
        rows = db.rows(c, f"""SELECT p.*, s.name student_name, b.name batch, u.name received_by_name FROM payments p JOIN students s ON s.id=p.student_id JOIN batches b ON b.id=s.batch_id
            LEFT JOIN users u ON u.id=p.received_by WHERE {' AND '.join(w)} ORDER BY p.paid_at DESC, p.id DESC LIMIT 2000""", **p)
    pays = [{**pay_out(r), "student": r["student_name"], "batch": r["batch"], "received_by": r["received_by_name"] or ""} for r in rows]
    totals, by_method = {}, {}
    for r in pays:
        t = totals.setdefault(r["paid_currency"], {"currency": r["paid_currency"], "amount": 0.0, "count": 0}); t["amount"] += r["paid_amount"]; t["count"] += 1
        m = by_method.setdefault((r["paid_currency"], r["method"]), {"currency": r["paid_currency"], "method": r["method"], "amount": 0.0, "count": 0}); m["amount"] += r["paid_amount"]; m["count"] += 1
    return jsonify({"payments": pays, "totals": [{**t, "amount": round(t["amount"], 2)} for t in totals.values()], "by_method": sorted(({**m, "amount": round(m["amount"], 2)} for m in by_method.values()), key=lambda m: m["method"])})
