from datetime import timedelta

from flask import Blueprint, g, jsonify

from .. import auth, db
from ..db import now_utc
from ..util import day_bounds, today_local
from .classes import CLASS_SQL, shape

bp = Blueprint("dashboard", __name__, url_prefix="/api")


@bp.get("/dashboard")
@auth.login_required
def dashboard():
    u = g.user
    start, end = day_bounds(today_local().isoformat())
    with db.tx() as c:
        if u["role"] == "student":
            rows = db.rows(c, f"""{CLASS_SQL} WHERE c.status='scheduled' AND c.start_at>=:s AND c.start_at<:e AND c.batch_id=(SELECT batch_id FROM students WHERE id=:me)
                AND c.subject_id IN (SELECT subject_id FROM student_subjects WHERE student_id=:me) ORDER BY c.start_at""", s=start, e=end + timedelta(days=7), me=u["student_id"])
            r = db.one(c, "SELECT COUNT(*) held, SUM(status IN ('present','late')) attended FROM attendance WHERE student_id=:me", me=u["student_id"])
            held = int(r["held"] or 0)
            return jsonify({"role": "student", "upcoming": [shape(c, x, u) for x in rows], "attendance": {"held": held, "attended": int(r["attended"] or 0), "percent": round(int(r["attended"] or 0) * 1000 / held) / 10 if held else None}})
        today = db.rows(c, f"{CLASS_SQL} WHERE c.start_at>=:s AND c.start_at<:e AND c.status='scheduled' ORDER BY c.start_at", s=start, e=end)
        pend = db.val(c, "SELECT COUNT(*) FROM classes c WHERE c.status='scheduled' AND c.attendance_taken_at IS NULL AND DATE_ADD(c.start_at, INTERVAL c.duration_min MINUTE)<:n" + (" AND c.teacher_id=:t" if u["role"] == "teacher" else ""), n=now_utc(), t=u["id"])
        return jsonify({"role": u["role"], "today": [shape(c, x, u) for x in today], "pending_attendance": int(pend or 0), "students": int(db.val(c, "SELECT COUNT(*) FROM students WHERE active=1")),
                        "week_classes": int(db.val(c, "SELECT COUNT(*) FROM classes WHERE status='scheduled' AND start_at>=:s AND start_at<:e", s=start, e=end + timedelta(days=6)))})
