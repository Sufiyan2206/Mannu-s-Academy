from __future__ import annotations

import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from functools import wraps

import bcrypt
import jwt
from flask import current_app, g, request

from . import db
from .util import HttpError


def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(rounds=10)).decode()


def check_pw(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except ValueError:
        return False


def make_token(u: dict) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=current_app.config["JWT_HOURS"])
    return jwt.encode({"sub": str(u["id"]), "role": u["role"], "exp": exp}, current_app.config["JWT_SECRET"], algorithm="HS256")


def load_user() -> dict:
    h = request.headers.get("Authorization", "")
    tok = h[7:] if h.startswith("Bearer ") else request.args.get("token", "")
    if not tok:
        raise HttpError(401, "Please sign in.")
    try:
        p = jwt.decode(tok, current_app.config["JWT_SECRET"], algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HttpError(401, "Your session has expired. Please sign in again.")
    with db.tx() as c:
        u = db.one(c, "SELECT id,email,name,role,phone,student_id,active FROM users WHERE id=:i", i=int(p["sub"]))
    if not u or not u["active"]:
        raise HttpError(401, "This account is not active.")
    return u


def login_required(fn):
    @wraps(fn)
    def w(*a, **k):
        g.user = load_user()
        return fn(*a, **k)
    return w


def roles(*allowed: str):
    def deco(fn):
        @wraps(fn)
        def w(*a, **k):
            g.user = load_user()
            if g.user["role"] not in allowed:
                raise HttpError(403, "You do not have permission to do that.")
            return fn(*a, **k)
        return w
    return deco


# ---- gentle protection against password guessing (per process; put a proxy limit in front for more) ----
_fails: dict[str, list[float]] = defaultdict(list)


def too_many_attempts(key: str) -> bool:
    now = time.time()
    _fails[key] = [t for t in _fails[key] if now - t < 600]
    return len(_fails[key]) >= 8


def record_failure(key: str) -> None:
    _fails[key].append(time.time())


def clear_failures(key: str) -> None:
    _fails.pop(key, None)
