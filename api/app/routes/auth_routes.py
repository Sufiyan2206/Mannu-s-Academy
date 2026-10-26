from flask import Blueprint, current_app, g, jsonify, request

from .. import auth, db, zoom
from ..util import HttpError, body, clean, need

bp = Blueprint("auth", __name__, url_prefix="/api")


def public_user(u: dict) -> dict:
    return {k: u[k] for k in ("id", "email", "name", "role", "phone", "student_id")}


@bp.post("/auth/login")
def login():
    b = body()
    email, pw = clean(b.get("email"), 190).lower(), str(b.get("password") or "")
    key = f"{request.remote_addr}|{email}"
    if auth.too_many_attempts(key):
        raise HttpError(429, "Too many attempts. Wait ten minutes and try again.")
    with db.tx() as c:
        u = db.one(c, "SELECT * FROM users WHERE email=:e", e=email)
    if not u or not u["active"] or not auth.check_pw(pw, u["password_hash"]):
        auth.record_failure(key)
        raise HttpError(401, "That email or password is not right.")
    auth.clear_failures(key)
    return jsonify({"token": auth.make_token(u), "user": public_user(u)})


@bp.get("/auth/me")
@auth.login_required
def me():
    return jsonify(public_user(g.user))


@bp.post("/auth/password")
@auth.login_required
def change_password():
    b = body()
    new = str(b.get("new") or "")
    if len(new) < 8:
        raise HttpError(400, "The new password must be at least 8 characters.")
    with db.tx() as c:
        u = db.one(c, "SELECT password_hash FROM users WHERE id=:i", i=g.user["id"])
        if not auth.check_pw(str(b.get("current") or ""), u["password_hash"]):
            raise HttpError(400, "The current password is not right.")
        db.run(c, "UPDATE users SET password_hash=:h WHERE id=:i", h=auth.hash_pw(new), i=g.user["id"])
    return jsonify({"ok": True})


@bp.get("/config")
@auth.login_required
def config():
    cfg = current_app.config
    with db.tx() as c:
        subjects = db.rows(c, "SELECT id, code, name FROM subjects ORDER BY id")
        batches = db.rows(c, "SELECT id, name, active FROM batches WHERE active=1 ORDER BY name")
    return jsonify({"academy": cfg["ACADEMY_NAME"], "tz": cfg["ACADEMY_TZ"], "currency": cfg["DEFAULT_CURRENCY"], "subjects": subjects, "batches": batches,
                    "late_after_min": cfg["LATE_AFTER_MINUTES"], "min_percent": cfg["MIN_ATTENDANCE_PERCENT"], "zoom": zoom.configured()})
