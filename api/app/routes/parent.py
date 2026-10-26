"""Parent-friendly monthly report: list, preview, PDF download, and the record of when it was sent."""
import json
from datetime import timedelta

import jwt
from flask import Blueprint, Response, current_app, g, jsonify, request

from .. import auth, db, parentreport as pr
from ..db import iso, now_utc
from ..util import HttpError, body, clean, is_email, to_int, valid_phone

bp = Blueprint("parent", __name__)


def recipients(st: dict) -> dict:
    wa, em = valid_phone(st["guardian_mobile"]), is_email((st["guardian_email"] or "").strip())
    return {"whatsapp": {"to": st["guardian_mobile"], "registered": wa, "ok": False, "note": "No valid guardian mobile number is registered." if not wa else "Automatic sending arrives in stage 3. Send the PDF yourself, then record it."},
            "email": {"to": (st["guardian_email"] or "").strip(), "registered": em, "ok": False, "note": "No guardian email address is registered." if not em else "Automatic sending arrives in stage 3. Send the PDF yourself, then record it."}}


def history(c, sid: int, sub: int, month: str) -> list[dict]:
    rows = db.rows(c, """SELECT p.*, u.name AS sent_by_name FROM parent_report_sends p LEFT JOIN users u ON u.id=p.sent_by WHERE p.student_id=:s AND p.subject_id=:x AND p.month=:m ORDER BY p.id DESC""", s=sid, x=sub, m=month)
    return [{"id": r["id"], "channel": r["channel"], "recipient": r["recipient"], "mode": r["mode"], "status": r["status"], "error": r["error"], "sent_by": r["sent_by_name"], "created_at": iso(r["created_at"]),
             "summary": json.loads(r["summary"]) if isinstance(r["summary"], str) else r["summary"]} for r in rows]


@bp.get("/api/parent-reports")
@auth.roles("admin")
def list_reports():
    month = request.args.get("month", "")
    q, rows = request.args, []
    with db.tx() as c:
        pr.build  # noqa: B018  (keeps the import used)
        try:
            pr.month_label(month)
        except Exception:
            raise HttpError(400, "Choose a month.")
        w, p = ["s.active=1"], {}
        if q.get("batch"): w.append("s.batch_id=:b"); p["b"] = q["batch"]
        if q.get("q"): w.append("s.name LIKE :q"); p["q"] = f"%{q['q']}%"
        for st in db.rows(c, f"SELECT s.* FROM students s WHERE {' AND '.join(w)} ORDER BY s.name", **p):
            for sub in db.rows(c, "SELECT x.id, x.name FROM subjects x JOIN student_subjects ss ON ss.subject_id=x.id WHERE ss.student_id=:s ORDER BY x.name", s=st["id"]):
                if q.get("subject") and str(sub["id"]) != q["subject"]:
                    continue
                d = pr.build(c, st["id"], sub["id"], month)
                if not d["rows"]:
                    continue
                last = (history(c, st["id"], sub["id"], month) or [None])[0]
                r = recipients(st)
                rows.append({"student_id": st["id"], "name": st["name"], "batch": d["student"]["batch"], "subject_id": sub["id"], "subject": sub["name"], "summary": d["summary"], "fee_state": d["fee"]["month"]["state"],
                             "fee_label": d["fee"]["month"]["label"], "owes": d["fee"]["owed"]["total"], "owes_previous": d["fee"]["owed"]["previous"], "currency": d["fee"]["currency"], "warnings": len(pr.warnings(d)),
                             "last_send": {"channel": last["channel"], "status": last["status"], "created_at": last["created_at"], "sent_by": last["sent_by"]} if last else None,
                             "can_whatsapp": r["whatsapp"]["registered"], "can_email": r["email"]["registered"]})
    return jsonify({"month": month, "label": pr.month_label(month), "rows": rows})


@bp.get("/api/parent-reports/preview")
@auth.roles("admin")
def preview():
    a = request.args
    sid, sub, month = to_int(a.get("student_id"), "Choose a student."), to_int(a.get("subject_id"), "Choose a subject."), a.get("month", "")
    with db.tx() as c:
        d = pr.build(c, sid, sub, month)
        st = db.one(c, "SELECT * FROM students WHERE id=:i", i=sid)
        hist = history(c, sid, sub, month)
    tok = jwt.encode({"typ": "preport", "uid": g.user["id"], "sid": sid, "sub": sub, "m": month, "exp": now_utc() + timedelta(minutes=20)}, current_app.config["JWT_SECRET"], algorithm="HS256")
    return jsonify({"data": d, "warnings": pr.warnings(d), "recipients": recipients(st), "pdf_url": f"/files/parent-report/{tok}", "file_name": pr.file_name(d), "history": hist})


@bp.get("/files/parent-report/<token>")
def pdf_file(token: str):
    try:
        p = jwt.decode(token, current_app.config["JWT_SECRET"], algorithms=["HS256"])
        if p.get("typ") != "preport":
            raise ValueError
    except Exception:
        return Response(status=401)
    with db.tx() as c:
        if not db.val(c, "SELECT 1 FROM users WHERE id=:i AND role='admin' AND active=1", i=p["uid"]):
            return Response(status=403)
        d = pr.build(c, p["sid"], p["sub"], p["m"])
    pdf = pr.build_pdf(d)
    disp = "attachment" if request.args.get("download") else "inline"
    return Response(pdf, mimetype="application/pdf", headers={"Content-Disposition": f'{disp}; filename="{pr.file_name(d)}"', "Cache-Control": "private, no-store"})


@bp.post("/api/parent-reports/record")
@auth.roles("admin")
def record_sent():
    """Staff sent the PDF themselves (WhatsApp / email app) and record it here. Stage 3 adds automatic sending."""
    b = body()
    sid, sub, month, ch = to_int(b.get("student_id"), "Choose a student."), to_int(b.get("subject_id"), "Choose a subject."), str(b.get("month") or ""), b.get("channel")
    if ch not in ("whatsapp", "email"):
        raise HttpError(400, "Choose WhatsApp or email.")
    if not b.get("hash"):
        raise HttpError(400, "Preview the report before recording it.")
    with db.tx() as c:
        d = pr.build(c, sid, sub, month)
        st = db.one(c, "SELECT * FROM students WHERE id=:i", i=sid)
        if b["hash"] != d["hash"]:
            raise HttpError(409, "The report has changed since you previewed it (attendance or fees were updated). Please preview it again.")
        incomplete = d["summary"]["not_recorded"] + d["summary"]["upcoming"]
        if incomplete and b.get("confirm_incomplete") is not True:
            raise HttpError(400, f"{incomplete} {'class is' if incomplete == 1 else 'classes are'} not recorded or still to come. Confirm that you want to record the report as sent as it is.")
        rc = recipients(st)[ch]
        if not rc["registered"]:
            raise HttpError(400, rc["note"].split(" Automatic")[0])
        summ = {"held": d["summary"]["held"], "attended": d["summary"]["attended"], "missed": d["summary"]["missed"], "cancelled": d["summary"]["cancelled"], "percent": d["summary"]["percent"], "fee_state": d["fee"]["month"]["state"]}
        rid = db.insert(c, """INSERT INTO parent_report_sends(student_id,subject_id,month,channel,recipient,mode,status,report_hash,summary,sent_by) VALUES (:s,:x,:m,:ch,:r,'manual','recorded',:h,:j,:u)""",
                        s=sid, x=sub, m=month, ch=ch, r=rc["to"], h=d["hash"], j=json.dumps(summ), u=g.user["id"])
        hist = history(c, sid, sub, month)
    return jsonify({"ok": True, "id": rid, "history": hist})


@bp.get("/api/parent-reports/history")
@auth.roles("admin")
def history_all():
    w, p = ["1=1"], {}
    if request.args.get("month"): w.append("p.month=:m"); p["m"] = request.args["month"]
    with db.tx() as c:
        rows = db.rows(c, f"""SELECT p.*, u.name AS sent_by_name, s.name AS student, x.name AS subject FROM parent_report_sends p JOIN students s ON s.id=p.student_id JOIN subjects x ON x.id=p.subject_id
            LEFT JOIN users u ON u.id=p.sent_by WHERE {' AND '.join(w)} ORDER BY p.id DESC LIMIT 300""", **p)
    return jsonify([{"id": r["id"], "student": r["student"], "subject": r["subject"], "month": r["month"], "channel": r["channel"], "recipient": r["recipient"], "mode": r["mode"], "status": r["status"],
                     "sent_by": r["sent_by_name"], "created_at": iso(r["created_at"])} for r in rows])
