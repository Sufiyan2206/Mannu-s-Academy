"""Users (teachers), batches and students."""
from flask import Blueprint, g, jsonify, request
from sqlalchemy.exc import IntegrityError

from .. import auth, db
from ..util import HttpError, body, clean, is_email, need, school_key, tidy_school, to_int, valid_phone

bp = Blueprint("people", __name__, url_prefix="/api")
STAFF = ("admin", "teacher")


# ------------------------------------------------------------------ users
@bp.get("/teachers")
@auth.roles(*STAFF)
def teachers():
    with db.tx() as c:
        return jsonify(db.rows(c, "SELECT id, name, phone FROM users WHERE role IN ('teacher','admin') AND active=1 ORDER BY name"))


@bp.get("/users")
@auth.roles("admin")
def list_users():
    with db.tx() as c:
        return jsonify(db.rows(c, "SELECT id,email,name,role,phone,active,student_id FROM users ORDER BY role, name"))


@bp.post("/users")
@auth.roles("admin")
def create_user():
    b = body()
    name, email, role = clean(need(b, "name", "Enter the name."), 120), clean(need(b, "email", "Enter the email address."), 190).lower(), b.get("role")
    if role not in ("admin", "teacher"):
        raise HttpError(400, "Choose Teacher or Admin.")
    if not is_email(email):
        raise HttpError(400, "Enter a valid email address.")
    pw = str(b.get("password") or "")
    if len(pw) < 8:
        raise HttpError(400, "The password must be at least 8 characters.")
    try:
        with db.tx() as c:
            uid = db.insert(c, "INSERT INTO users(email,name,role,password_hash,phone) VALUES (:e,:n,:r,:h,:p)", e=email, n=name, r=role, h=auth.hash_pw(pw), p=clean(b.get("phone"), 40))
    except IntegrityError:
        raise HttpError(400, "That email address is already used.")
    return jsonify({"id": uid})


@bp.put("/users/<int:uid>")
@auth.roles("admin")
def update_user(uid: int):
    b = body()
    sets, p = [], {"i": uid}
    if "name" in b:
        sets.append("name=:n"); p["n"] = clean(need(b, "name", "Enter the name."), 120)
    if "phone" in b:
        sets.append("phone=:ph"); p["ph"] = clean(b["phone"], 40)
    if "active" in b:
        if uid == g.user["id"] and not b["active"]:
            raise HttpError(400, "You cannot deactivate your own account.")
        sets.append("active=:a"); p["a"] = 1 if b["active"] else 0
    if b.get("password"):
        if len(str(b["password"])) < 8:
            raise HttpError(400, "The password must be at least 8 characters.")
        sets.append("password_hash=:h"); p["h"] = auth.hash_pw(str(b["password"]))
    if not sets:
        return jsonify({"ok": True})
    with db.tx() as c:
        if not db.val(c, "SELECT 1 FROM users WHERE id=:i", i=uid):
            raise HttpError(404, "User not found.")
        db.run(c, f"UPDATE users SET {', '.join(sets)} WHERE id=:i", **p)
    return jsonify({"ok": True})


# ------------------------------------------------------------------ batches
@bp.get("/batches")
@auth.roles(*STAFF)
def list_batches():
    with db.tx() as c:
        return jsonify(db.rows(c, """SELECT b.id, b.name, b.active, (SELECT COUNT(*) FROM students s WHERE s.batch_id=b.id AND s.active=1) students FROM batches b ORDER BY b.name"""))


@bp.post("/batches")
@auth.roles("admin")
def create_batch():
    name = clean(need(body(), "name", "Enter the batch name."), 120)
    try:
        with db.tx() as c:
            bid = db.insert(c, "INSERT INTO batches(name) VALUES (:n)", n=name)
    except IntegrityError:
        raise HttpError(400, "A batch with that name already exists.")
    return jsonify({"id": bid})


@bp.put("/batches/<int:bid>")
@auth.roles("admin")
def update_batch(bid: int):
    b = body()
    name = clean(need(b, "name", "Enter the batch name."), 120)
    try:
        with db.tx() as c:
            if not db.val(c, "SELECT 1 FROM batches WHERE id=:i", i=bid):
                raise HttpError(404, "Batch not found.")
            db.run(c, "UPDATE batches SET name=:n, active=:a WHERE id=:i", n=name, a=0 if b.get("active") is False else 1, i=bid)
    except IntegrityError:
        raise HttpError(400, "A batch with that name already exists.")
    return jsonify({"ok": True})


# ------------------------------------------------------------------ students
STUDENT_SQL = """SELECT s.*, b.name AS batch FROM students s JOIN batches b ON b.id=s.batch_id"""


def shape_student(c, s: dict) -> dict:
    subs = db.rows(c, "SELECT x.id, x.name FROM subjects x JOIN student_subjects ss ON ss.subject_id=x.id WHERE ss.student_id=:i ORDER BY x.name", i=s["id"])
    u = db.one(c, "SELECT id, email FROM users WHERE student_id=:i", i=s["id"])
    out = {k: s[k] for k in ("id", "name", "email", "zoom_email", "mobile", "guardian_name", "guardian_mobile", "guardian_email", "school", "batch_id", "batch", "currency", "reel_consent")}
    out.update({"active": bool(s["active"]), "subjects": subs, "has_login": bool(u)})
    return out


@bp.get("/students")
@auth.roles(*STAFF)
def list_students():
    q, w, p = request.args, ["1=1"], {}
    if q.get("active") != "all":
        w.append("s.active=1")
    if q.get("batch"):
        w.append("s.batch_id=:b"); p["b"] = q["batch"]
    if q.get("subject"):
        w.append("EXISTS (SELECT 1 FROM student_subjects ss WHERE ss.student_id=s.id AND ss.subject_id=:sub)"); p["sub"] = q["subject"]
    if q.get("q"):
        w.append("(s.name LIKE :q OR s.email LIKE :q OR s.mobile LIKE :q OR s.school LIKE :q)"); p["q"] = f"%{q['q']}%"
    if q.get("school") == "__none":
        w.append("s.school=''")
    with db.tx() as c:
        rows = db.rows(c, f"{STUDENT_SQL} WHERE {' AND '.join(w)} ORDER BY s.name", **p)
        out = [shape_student(c, r) for r in rows]
    if q.get("school") and q["school"] != "__none":
        key = school_key(q["school"])
        out = [s for s in out if school_key(s["school"]) == key]  # compared in Python so capitals in any language are ignored
    return jsonify(out)


@bp.get("/students/schools")
@auth.roles(*STAFF)
def schools():
    with db.tx() as c:
        names = [r["school"] for r in db.rows(c, f"SELECT school FROM students WHERE school<>'' {'' if request.args.get('active') == 'all' else 'AND active=1'}")]
    groups: dict[str, dict] = {}
    for n in names:
        g_ = groups.setdefault(school_key(n), {"names": {}, "n": 0})
        g_["names"][n] = g_["names"].get(n, 0) + 1
        g_["n"] += 1
    def best(names_: dict) -> str:  # most common spelling, then the one with more capitals
        return sorted(names_.items(), key=lambda kv: (-kv[1], -sum(ch.isupper() for ch in kv[0]), kv[0]))[0][0]
    return jsonify(sorted(({"name": best(g_["names"]), "students": g_["n"]} for g_ in groups.values()), key=lambda x: x["name"].casefold()))


def student_input(b: dict, c, current_id: int | None = None) -> dict:
    name = clean(need(b, "name", "Enter the student’s name."), 120)
    email = clean(need(b, "email", "Enter the student’s email address."), 190).lower()
    if not is_email(email):
        raise HttpError(400, "Enter a valid email address.")
    gm = clean(b.get("guardian_mobile"), 40)
    if not valid_phone(gm):
        raise HttpError(400, "Enter a valid parent or guardian mobile number.")
    mobile = clean(b.get("mobile"), 40)
    if mobile and not valid_phone(mobile):
        raise HttpError(400, "Enter a valid mobile number or leave it empty.")
    gem = clean(b.get("guardian_email"), 190).lower()
    if gem and not is_email(gem):
        raise HttpError(400, "Enter a valid guardian email address or leave it empty.")
    zem = clean(b.get("zoom_email"), 190).lower()
    if zem and not is_email(zem):
        raise HttpError(400, "Enter a valid Zoom email address or leave it empty.")
    batch_id = to_int(b.get("batch_id"), "Choose a batch.")
    if not db.val(c, "SELECT 1 FROM batches WHERE id=:i", i=batch_id):
        raise HttpError(400, "Choose a batch.")
    subs = sorted({to_int(x, "Choose the subjects.") for x in (b.get("subjects") or [])})
    if not subs:
        raise HttpError(400, "Choose at least one subject.")
    if len(subs) != db.val(c, "SELECT COUNT(*) FROM subjects WHERE id IN :ids", ids=tuple(subs)):
        raise HttpError(400, "Choose valid subjects.")
    cur = clean(b.get("currency") or "AED", 20).upper()
    if not (len(cur) == 3 and cur.isalpha()):
        raise HttpError(400, "Choose a valid currency.")
    school = tidy_school(b.get("school"))
    if len(school) > 120:
        raise HttpError(400, "The school name can be at most 120 characters.")
    clash = db.val(c, "SELECT id FROM students WHERE email=:e AND id<>:i", e=email, i=current_id or 0)
    if clash:
        raise HttpError(400, "A student with that email address already exists.")
    return dict(name=name, email=email, zoom_email=zem, mobile=mobile, guardian_name=clean(b.get("guardian_name"), 120), guardian_mobile=gm, guardian_email=gem, school=school, batch_id=batch_id, currency=cur, subs=subs)


@bp.post("/students")
@auth.roles("admin")
def create_student():
    b = body()
    try:
        with db.tx() as c:
            s = student_input(b, c)
            sid = db.insert(c, """INSERT INTO students(name,email,zoom_email,mobile,guardian_name,guardian_mobile,guardian_email,school,batch_id,currency)
                VALUES (:name,:email,:zoom_email,:mobile,:guardian_name,:guardian_mobile,:guardian_email,:school,:batch_id,:currency)""", **{k: v for k, v in s.items() if k != "subs"})
            for sub in s["subs"]:
                db.run(c, "INSERT INTO student_subjects(student_id, subject_id) VALUES (:s,:x)", s=sid, x=sub)
            if b.get("create_login"):
                pw = str(b.get("password") or "")
                if len(pw) < 8:
                    raise HttpError(400, "The student’s password must be at least 8 characters.")
                db.run(c, "INSERT INTO users(email,name,role,password_hash,student_id) VALUES (:e,:n,'student',:h,:s)", e=s["email"], n=s["name"], h=auth.hash_pw(pw), s=sid)
    except IntegrityError:
        raise HttpError(400, "That email address is already used.")
    return jsonify({"id": sid})


@bp.put("/students/<int:sid>")
@auth.roles("admin")
def update_student(sid: int):
    b = body()
    try:
        with db.tx() as c:
            if not db.val(c, "SELECT 1 FROM students WHERE id=:i", i=sid):
                raise HttpError(404, "Student not found.")
            s = student_input(b, c, sid)
            db.run(c, """UPDATE students SET name=:name,email=:email,zoom_email=:zoom_email,mobile=:mobile,guardian_name=:guardian_name,guardian_mobile=:guardian_mobile,
                guardian_email=:guardian_email,school=:school,batch_id=:batch_id,currency=:currency,active=:active WHERE id=:i""", i=sid, active=0 if b.get("active") is False else 1,
                   **{k: v for k, v in s.items() if k != "subs"})
            db.run(c, "DELETE FROM student_subjects WHERE student_id=:s", s=sid)
            for sub in s["subs"]:
                db.run(c, "INSERT INTO student_subjects(student_id, subject_id) VALUES (:s,:x)", s=sid, x=sub)
            db.run(c, "UPDATE users SET name=:n, email=:e, active=:a WHERE student_id=:s", n=s["name"], e=s["email"], a=0 if b.get("active") is False else 1, s=sid)
    except IntegrityError:
        raise HttpError(400, "That email address is already used.")
    return jsonify({"ok": True})
