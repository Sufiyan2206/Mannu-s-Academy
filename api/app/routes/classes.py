"""Classes and attendance (manual entry, Zoom data kept beside it, full audit trail)."""
import json
from datetime import datetime, timedelta

from flask import Blueprint, current_app, g, jsonify, request

from .. import auth, db, zoom
from ..db import iso, now_utc
from ..util import HttpError, body, clean, local_to_utc, minute, need, to_int

bp = Blueprint("classes", __name__, url_prefix="/api")
STAFF = ("admin", "teacher")
STATUSES = ("present", "late", "absent")

CLASS_SQL = """SELECT c.*, b.name AS batch, s.name AS subject, u.name AS teacher_name FROM classes c
  JOIN batches b ON b.id=c.batch_id JOIN subjects s ON s.id=c.subject_id LEFT JOIN users u ON u.id=c.teacher_id"""


def end_of(c: dict) -> datetime:
    return c["start_at"] + timedelta(minutes=c["duration_min"])


def can_edit(user: dict, c: dict) -> bool:
    return user["role"] == "admin" or (user["role"] == "teacher" and c["teacher_id"] == user["id"])


def roster(conn, c: dict) -> list[dict]:
    return db.rows(conn, """SELECT s.id, s.name, s.email FROM students s JOIN student_subjects ss ON ss.student_id=s.id
        WHERE s.batch_id=:b AND ss.subject_id=:x AND s.active=1 ORDER BY s.name""", b=c["batch_id"], x=c["subject_id"])


def shape(conn, c: dict, user: dict) -> dict:
    now = now_utc()
    out = {"id": c["id"], "title": c["title"], "agenda": c["agenda"], "batch_id": c["batch_id"], "batch": c["batch"], "subject_id": c["subject_id"], "subject": c["subject"],
           "teacher_id": c["teacher_id"], "teacher_name": c["teacher_name"], "start_at": iso(c["start_at"]), "end_at": iso(end_of(c)), "duration_min": c["duration_min"],
           "status": c["status"], "cancel_reason": c["cancel_reason"], "join_url": c["join_url"], "link_source": c["link_source"], "started": c["start_at"] <= now,
           "finished": end_of(c) < now, "attendance_taken": c["attendance_taken_at"] is not None, "can_edit": can_edit(user, c)}
    if user["role"] in STAFF:
        r = db.one(conn, "SELECT SUM(status IN ('present','late')) attended, SUM(status='late') late, COUNT(*) recorded FROM attendance WHERE class_id=:i", i=c["id"])
        out.update({"present": int(r["attended"] or 0), "late": int(r["late"] or 0), "recorded": int(r["recorded"] or 0)})
    return out


def snap(a: dict | None) -> dict | None:
    if not a:
        return None
    return {"status": a["status"], "join_time": minute(a["join_time"]), "leave_time": minute(a["leave_time"]), "source": a["source"], "note": a["note"] or ""}


# ------------------------------------------------------------------ list / create / detail
@bp.get("/classes")
@auth.login_required
def list_classes():
    q, w, p = request.args, ["1=1"], {}
    u = g.user
    if u["role"] == "student":
        w.append("""c.batch_id=(SELECT batch_id FROM students WHERE id=:me) AND c.subject_id IN (SELECT subject_id FROM student_subjects WHERE student_id=:me)""")
        p["me"] = u["student_id"]
    for key, col in (("batch", "c.batch_id"), ("subject", "c.subject_id"), ("teacher", "c.teacher_id"), ("status", "c.status")):
        if q.get(key):
            w.append(f"{col}=:{key}"); p[key] = q[key]
    if q.get("from"):
        w.append("c.start_at>=:f"); p["f"] = local_to_utc(q["from"] + "T00:00")
    if q.get("to"):
        w.append("c.start_at<:t"); p["t"] = local_to_utc(q["to"] + "T00:00") + timedelta(days=1)
    order = "DESC" if q.get("order") == "desc" else "ASC"
    with db.tx() as conn:
        rows = db.rows(conn, f"{CLASS_SQL} WHERE {' AND '.join(w)} ORDER BY c.start_at {order} LIMIT 500", **p)
        return jsonify([shape(conn, r, u) for r in rows])


@bp.post("/classes")
@auth.roles(*STAFF)
def create_class():
    b, u = body(), g.user
    batch_id, subject_id = to_int(b.get("batch_id"), "Choose a batch."), to_int(b.get("subject_id"), "Choose a subject.")
    start = local_to_utc(str(b.get("start_local") or ""))
    if not start:
        raise HttpError(400, "Choose the date and time of the class.")
    dur = to_int(b.get("duration_min", 60), "Enter the length of the class in minutes.")
    if not 15 <= dur <= 300:
        raise HttpError(400, "A class must be between 15 and 300 minutes long.")
    if start < now_utc() - timedelta(minutes=5):
        raise HttpError(400, "The class start time is in the past.")
    link = clean(b.get("manual_join_url"), 500)
    if link and not link.lower().startswith("https://"):
        raise HttpError(400, "The meeting link must start with https://")
    if not link and not zoom.configured():
        raise HttpError(400, "Paste the meeting link (it must start with https://), or connect Zoom so meetings are created for you.")
    teacher = u["id"] if u["role"] == "teacher" else to_int(b.get("teacher_id") or u["id"], "Choose the teacher.")
    with db.tx() as conn:
        bn, sn = db.val(conn, "SELECT name FROM batches WHERE id=:i AND active=1", i=batch_id), db.val(conn, "SELECT name FROM subjects WHERE id=:i", i=subject_id)
        if not bn or not sn:
            raise HttpError(400, "Choose a valid batch and subject.")
        if not db.val(conn, "SELECT 1 FROM users WHERE id=:i AND role IN ('teacher','admin') AND active=1", i=teacher):
            raise HttpError(400, "Choose a valid teacher.")
        z = None if link else zoom.create_meeting(f"{sn} – {bn}", start, dur, clean(b.get("agenda"), 500))      # a Zoom failure stops here, before anything is saved
        cid = db.insert(conn, """INSERT INTO classes(batch_id,subject_id,teacher_id,title,agenda,start_at,duration_min,join_url,start_url,zoom_meeting_id,zoom_uuid,link_source,created_by)
            VALUES (:b,:s,:t,:title,:ag,:st,:d,:l,:su,:zid,:zu,:src,:cb)""", b=batch_id, s=subject_id, t=teacher, title=f"{sn} – {bn}", ag=clean(b.get("agenda"), 500), st=start, d=dur,
                        l=z["join_url"] if z else link, su=z["start_url"] if z else None, zid=z["id"] if z else None, zu=z["uuid"] if z else None, src="zoom" if z else "manual", cb=u["id"])
    return jsonify({"id": cid})


def get_class(conn, cid: int) -> dict:
    c = db.one(conn, f"{CLASS_SQL} WHERE c.id=:i", i=cid)
    if not c:
        raise HttpError(404, "Class not found.")
    return c


@bp.get("/classes/<int:cid>")
@auth.login_required
def class_detail(cid: int):
    u = g.user
    with db.tx() as conn:
        c = get_class(conn, cid)
        ros = roster(conn, c)
        if u["role"] == "student" and u["student_id"] not in {r["id"] for r in ros}:
            raise HttpError(404, "Class not found.")
        out = shape(conn, c, u)
        if u["role"] == "student":
            mine = db.one(conn, "SELECT status, note FROM attendance WHERE class_id=:c AND student_id=:s", c=cid, s=u["student_id"])
            out["my_attendance"] = {"status": mine["status"], "note": mine["note"]} if mine else None
            return jsonify(out)
        out["students"] = ros
        out["late_after_min"] = int(__import__("flask").current_app.config["LATE_AFTER_MINUTES"])
        att = db.rows(conn, """SELECT a.*, s.name AS student_name, cu.name AS created_by_name, uu.name AS updated_by_name FROM attendance a JOIN students s ON s.id=a.student_id
            LEFT JOIN users cu ON cu.id=a.created_by LEFT JOIN users uu ON uu.id=a.updated_by WHERE a.class_id=:c ORDER BY s.name""", c=cid)
        for a in att:
            for k in ("join_time", "leave_time", "created_at", "updated_at"):
                a[k] = iso(a[k])
        out["attendance"] = att
        zr = db.rows(conn, "SELECT * FROM attendance_zoom WHERE class_id=:c", c=cid)
        for z in zr:
            for k in ("join_time", "leave_time", "synced_at"):
                z[k] = iso(z[k])
        out["zoom_attendance"] = zr
        out["unmatched"] = db.rows(conn, "SELECT name, email, duration_sec FROM attendance_unmatched WHERE class_id=:c ORDER BY name", c=cid)
        out["has_zoom"] = bool(c["zoom_meeting_id"])
        if u["role"] == "admin":
            au = db.rows(conn, """SELECT a.*, s.name AS student_name FROM attendance_audit a JOIN students s ON s.id=a.student_id WHERE a.class_id=:c ORDER BY a.id DESC""", c=cid)
            for a in au:
                a["changed_at"] = iso(a["changed_at"])
                for k in ("old_value", "new_value"):
                    a[k] = json.loads(a[k]) if isinstance(a[k], str) else a[k]
            out["audit"] = au
        return jsonify(out)


@bp.post("/classes/<int:cid>/cancel")
@auth.roles(*STAFF)
def cancel_class(cid: int):
    with db.tx() as conn:
        c = get_class(conn, cid)
        if not can_edit(g.user, c):
            raise HttpError(403, "You can only change your own classes.")
        if c["status"] == "cancelled":
            raise HttpError(400, "This class is already cancelled.")
        db.run(conn, "UPDATE classes SET status='cancelled', cancel_reason=:r WHERE id=:i", r=clean(body().get("reason"), 300), i=cid)
    return jsonify({"ok": True})


@bp.get("/attendance/pending")
@auth.roles(*STAFF)
def pending():
    w, p = ["c.status='scheduled'", "c.attendance_taken_at IS NULL", "DATE_ADD(c.start_at, INTERVAL c.duration_min MINUTE) < :now"], {"now": now_utc()}
    if g.user["role"] == "teacher":
        w.append("c.teacher_id=:t"); p["t"] = g.user["id"]
    with db.tx() as conn:
        rows = db.rows(conn, f"{CLASS_SQL} WHERE {' AND '.join(w)} ORDER BY c.start_at DESC LIMIT 100", **p)
        return jsonify([shape(conn, r, g.user) for r in rows])


# ------------------------------------------------------------------ attendance
def save_attendance(conn, cls: dict, rec: dict, source: str, user: dict | None, reason: str) -> bool:
    old = db.one(conn, "SELECT * FROM attendance WHERE class_id=:c AND student_id=:s FOR UPDATE", c=cls["id"], s=rec["student_id"])
    nxt = {"status": rec["status"], "join_time": rec.get("join_time"), "leave_time": rec.get("leave_time"), "duration_sec": rec.get("duration_sec"), "source": source, "note": rec.get("note", old["note"] if old else "")}
    if old and snap(old) == snap({**nxt, "join_time": nxt["join_time"], "leave_time": nxt["leave_time"]}):
        return False
    t, uid = now_utc(), user["id"] if user else None
    db.run(conn, """INSERT INTO attendance(class_id,student_id,status,join_time,leave_time,duration_sec,source,note,created_by,created_at,updated_by,updated_at)
        VALUES (:c,:s,:st,:j,:l,:d,:src,:n,:u,:t,:u,:t) ON DUPLICATE KEY UPDATE status=VALUES(status), join_time=VALUES(join_time), leave_time=VALUES(leave_time),
        duration_sec=VALUES(duration_sec), source=VALUES(source), note=VALUES(note), updated_by=VALUES(updated_by), updated_at=VALUES(updated_at)""",
           c=cls["id"], s=rec["student_id"], st=nxt["status"], j=nxt["join_time"], l=nxt["leave_time"], d=nxt["duration_sec"], src=source, n=nxt["note"], u=uid, t=t)
    if old or source == "manual":
        new_snap = {"status": nxt["status"], "join_time": minute(nxt["join_time"]), "leave_time": minute(nxt["leave_time"]), "source": source, "note": nxt["note"]}
        db.run(conn, """INSERT INTO attendance_audit(class_id,student_id,changed_by,changed_by_name,changed_at,old_value,new_value,reason) VALUES (:c,:s,:u,:n,:t,:o,:v,:r)""",
               c=cls["id"], s=rec["student_id"], u=uid, n=user["name"] if user else "Zoom sync", t=t, o=json.dumps(snap(old)) if old else None, v=json.dumps(new_snap), r=reason)
    return True


@bp.put("/classes/<int:cid>/attendance")
@auth.roles(*STAFF)
def put_attendance(cid: int):
    b = body()
    reason = clean(b.get("reason"), 300)
    recs_in = b.get("records")
    if not isinstance(recs_in, list) or not recs_in:
        raise HttpError(400, "There is no attendance to save.")
    with db.tx() as conn:
        c = db.one(conn, f"{CLASS_SQL} WHERE c.id=:i FOR UPDATE", i=cid)
        if not c:
            raise HttpError(404, "Class not found.")
        if not can_edit(g.user, c):
            raise HttpError(403, "You can only record attendance for your own classes.")
        if c["status"] == "cancelled":
            raise HttpError(400, "This class was cancelled.")
        if c["start_at"] > now_utc():
            raise HttpError(400, "Attendance can be recorded once the class has started.")
        ids = {r["id"] for r in roster(conn, c)}
        seen, recs = set(), []
        for r in recs_in:
            if not isinstance(r, dict):
                raise HttpError(400, "The attendance could not be read.")
            sid = to_int(r.get("student_id"), "A student in the list is not enrolled in this class.")
            if sid not in ids:
                raise HttpError(400, "A student in the list is not enrolled in this class.")
            if sid in seen:
                raise HttpError(400, "A student appears twice in the list.")
            seen.add(sid)
            if r.get("status") not in STATUSES:
                raise HttpError(400, "Choose Present, Late or Absent for every student.")
            j = local_to_utc(r["join_local"]) if r.get("join_local") else None
            l = local_to_utc(r["leave_local"]) if r.get("leave_local") else None
            if (r.get("join_local") and not j) or (r.get("leave_local") and not l):
                raise HttpError(400, "A time could not be read. Check the arrival and leaving times.")
            if j and l and l < j:
                raise HttpError(400, "Leave time must be after the arrival time.")
            recs.append({"student_id": sid, "status": r["status"], "join_time": j, "leave_time": l, "duration_sec": int((l - j).total_seconds()) if j and l else None, "note": clean(r.get("note"), 200)})
        cur = {a["student_id"]: a for a in db.rows(conn, "SELECT * FROM attendance WHERE class_id=:c", c=cid)}
        def same(old, new):
            return bool(old) and old["status"] == new["status"] and minute(old["join_time"]) == minute(new["join_time"]) and minute(old["leave_time"]) == minute(new["leave_time"]) and (old["note"] or "") == new["note"]
        todo = [r for r in recs if not same(cur.get(r["student_id"]), r)]
        if any(r["student_id"] in cur for r in todo) and not reason:
            raise HttpError(400, "Enter a reason for the correction.")
        changed = sum(1 for r in todo if save_attendance(conn, c, r, "manual", g.user, reason or "Manual entry"))
        for sid in ids - set(cur) - {r["student_id"] for r in todo}:   # anyone left out is recorded as absent
            save_attendance(conn, c, {"student_id": sid, "status": "absent", "note": ""}, "manual", g.user, "Manual entry")
        db.run(conn, "UPDATE classes SET attendance_taken_at=COALESCE(attendance_taken_at, :t) WHERE id=:i", t=now_utc(), i=cid)
    return jsonify({"ok": True, "changed": changed})


# ------------------------------------------------------------------ Zoom attendance sync
def sync_zoom(cid: int, user: dict | None = None) -> dict:
    """Read who joined from Zoom. Zoom's own result is always kept in attendance_zoom; it fills the attendance sheet only where a person has not entered anything by hand."""
    cfg = current_app.config
    with db.tx() as conn:
        c = db.one(conn, f"{CLASS_SQL} WHERE c.id=:i FOR UPDATE", i=cid)
        if not c:
            raise HttpError(404, "Class not found.")
        if c["status"] == "cancelled":
            raise HttpError(400, "This class was cancelled.")
        if not c["zoom_meeting_id"]:
            raise HttpError(400, "This class has no Zoom meeting to read attendance from. Mark attendance by hand.")
        if end_of(c) > now_utc():
            raise HttpError(400, "The class has not ended yet. Zoom's list is ready a few minutes after it ends.")
        people = zoom.participants(c["zoom_meeting_id"])
        ros = roster(conn, c)
        by_email = {}
        for s in ros:
            for e in {s["email"].lower(), (db.val(conn, "SELECT zoom_email FROM students WHERE id=:i", i=s["id"]) or "").lower()} - {""}:
                by_email[e] = s["id"]
        agg: dict[int, dict] = {}
        unmatched: dict[str, dict] = {}
        for p in people:
            j, l = zoom.parse_time(p["join_time"]), zoom.parse_time(p["leave_time"])
            sid = by_email.get((p.get("user_email") or "").lower())
            if sid is None:
                u_ = unmatched.setdefault((p.get("user_email") or p.get("name") or "").lower(), {"name": p.get("name") or "Unknown", "email": p.get("user_email") or "", "duration_sec": 0})
                u_["duration_sec"] += max(0, int((l - j).total_seconds())); continue
            a = agg.setdefault(sid, {"join": j, "leave": l, "secs": 0})
            a["join"], a["leave"] = min(a["join"], j), max(a["leave"], l); a["secs"] += max(0, int((l - j).total_seconds()))
        late_after, min_pct, length = timedelta(minutes=cfg["LATE_AFTER_MINUTES"]), cfg["MIN_ATTENDANCE_PERCENT"], c["duration_min"] * 60
        t = now_utc(); applied = kept = 0
        for s in ros:
            a = agg.get(s["id"])
            if not a or a["secs"] < length * min_pct / 100:
                z = {"status": "absent", "join_time": a["join"] if a else None, "leave_time": a["leave"] if a else None, "duration_sec": a["secs"] if a else None}
            else:
                z = {"status": "late" if a["join"] > c["start_at"] + late_after else "present", "join_time": a["join"], "leave_time": a["leave"], "duration_sec": a["secs"]}
            db.run(conn, """INSERT INTO attendance_zoom(class_id,student_id,status,join_time,leave_time,duration_sec,synced_at) VALUES (:c,:s,:st,:j,:l,:d,:t)
                ON DUPLICATE KEY UPDATE status=VALUES(status), join_time=VALUES(join_time), leave_time=VALUES(leave_time), duration_sec=VALUES(duration_sec), synced_at=VALUES(synced_at)""",
                   c=cid, s=s["id"], st=z["status"], j=z["join_time"], l=z["leave_time"], d=z["duration_sec"], t=t)
            existing = db.one(conn, "SELECT source FROM attendance WHERE class_id=:c AND student_id=:s", c=cid, s=s["id"])
            if existing and existing["source"] == "manual":
                kept += 1; continue                                    # staff entry always wins
            if save_attendance(conn, c, {"student_id": s["id"], **z}, "zoom", None, "Zoom sync"):
                applied += 1
        db.run(conn, "DELETE FROM attendance_unmatched WHERE class_id=:c", c=cid)
        for u_ in unmatched.values():
            db.run(conn, "INSERT INTO attendance_unmatched(class_id,name,email,duration_sec) VALUES (:c,:n,:e,:d)", c=cid, n=u_["name"][:190], e=u_["email"][:190], d=u_["duration_sec"])
        db.run(conn, "UPDATE classes SET zoom_synced_at=:t, attendance_taken_at=COALESCE(attendance_taken_at,:t) WHERE id=:i", t=t, i=cid)
    return {"ok": True, "applied": applied, "kept_manual": kept, "unmatched": len(unmatched)}


@bp.post("/classes/<int:cid>/sync-attendance")
@auth.roles(*STAFF)
def sync_attendance(cid: int):
    with db.tx() as conn:
        c = get_class(conn, cid)
        if not can_edit(g.user, c):
            raise HttpError(403, "You can only sync your own classes.")
    return jsonify(sync_zoom(cid, g.user))
