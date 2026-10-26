from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import text

from app import db as dbm
from tests.conftest import Client

DXB = ZoneInfo("Asia/Dubai")


def local(dt_utc: datetime) -> str:
    return dt_utc.replace(tzinfo=timezone.utc).astimezone(DXB).strftime("%Y-%m-%dT%H:%M")


def make_class(admin, school, subject="chem", teacher="t1", hours=2, started=True):
    """A class that began `hours` ago (or starts in `hours`); the API forbids past starts, so the start is moved in the database."""
    r = admin.post("/api/classes", {"batch_id": school["batch"], "subject_id": school["subs"][subject], "teacher_id": school[teacher],
                                    "start_local": local(datetime.now(timezone.utc) + timedelta(hours=3)), "duration_min": 60, "manual_join_url": "https://zoom.us/j/1"})
    assert r.status_code == 200, r.get_json()
    cid = r.get_json()["id"]
    when = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=-hours if started else hours)
    with dbm.tx() as c:
        c.execute(text("UPDATE classes SET start_at=:s WHERE id=:i"), {"s": when, "i": cid})
    return cid


# ------------------------------------------------------------------ authentication
def test_health_and_mysql(app):
    r = app.test_client().get("/api/health")
    assert r.status_code == 200 and r.get_json() == {"ok": True}


def test_login_rules(app, admin, school):
    c = app.test_client()
    assert c.post("/api/auth/login", json={"email": "admin@t.test", "password": "wrong"}).status_code == 401
    assert c.get("/api/auth/me").status_code == 401
    assert c.get("/api/students", headers={"Authorization": "Bearer junk"}).status_code == 401
    me = admin.get("/api/auth/me").get_json()
    assert me["role"] == "admin" and "password_hash" not in me
    assert Client(app).login("ASHA@x.test", "studentpw1").get("/api/auth/me").get_json()["role"] == "student"   # email is case-insensitive
    # lock-out after repeated failures
    for _ in range(8):
        c.post("/api/auth/login", json={"email": "t1@t.test", "password": "nope"})
    assert c.post("/api/auth/login", json={"email": "t1@t.test", "password": "teachpass1"}).status_code == 429


def test_change_password(app, admin):
    assert admin.post("/api/auth/password", {"current": "bad", "new": "newpassword1"}).status_code == 400
    assert admin.post("/api/auth/password", {"current": "adminpass1", "new": "short"}).status_code == 400
    assert admin.post("/api/auth/password", {"current": "adminpass1", "new": "newpassword1"}).status_code == 200
    assert app.test_client().post("/api/auth/login", json={"email": "admin@t.test", "password": "newpassword1"}).status_code == 200
    admin.post("/api/auth/password", {"current": "newpassword1", "new": "adminpass1"})


# ------------------------------------------------------------------ people
def test_roles_and_permissions(app, admin, school):
    t1, st = Client(app).login("t1@t.test", "teachpass1"), Client(app).login("asha@x.test", "studentpw1")
    assert t1.get("/api/students").status_code == 200 and st.get("/api/students").status_code == 403
    assert t1.post("/api/students", {}).status_code == 403 and t1.post("/api/batches", {"name": "x"}).status_code == 403 and t1.get("/api/users").status_code == 403
    assert st.get("/api/batches").status_code == 403 and st.get("/api/classes").status_code == 200
    assert admin.post("/api/users", {"name": "X", "email": "t1@t.test", "role": "teacher", "password": "teachpass1"}).status_code == 400   # duplicate email
    assert admin.put(f"/api/users/{school['t2']}", {"active": False}).status_code == 200
    assert app.test_client().post("/api/auth/login", json={"email": "t2@t.test", "password": "teachpass1"}).status_code == 401
    assert admin.put("/api/users/1", {"active": False}).status_code == 400   # cannot lock yourself out


def test_student_validation_and_school(app, admin, school):
    base = {"name": "Mia Chen", "email": "mia@x.test", "guardian_mobile": "+971502222222", "batch_id": school["batch"], "subjects": [school["subs"]["math"]]}
    bad = [({"name": ""}, "name"), ({"email": "nope"}, "valid email"), ({"guardian_mobile": "12"}, "guardian mobile"), ({"batch_id": 9999}, "batch"), ({"subjects": []}, "subject"), ({"email": "asha@x.test"}, "already exists"),
           ({"school": "x" * 121}, "120"), ({"currency": "DIRHAM"}, "currency"), ({"zoom_email": "bad"}, "Zoom")]
    for patch, word in bad:
        r = admin.post("/api/students", {**base, **patch})
        assert r.status_code == 400 and word.lower() in r.get_json()["error"].lower(), (patch, r.get_json())
    mia = admin.post("/api/students", {**base, "school": "  Royal \t College "}).get_json()["id"]
    got = [s for s in admin.get("/api/students").get_json() if s["id"] == mia][0]
    assert got["school"] == "Royal College" and [s["name"] for s in got["subjects"]] == ["Mathematics"] and got["batch"] == "Grade 11"
    admin.put(f"/api/students/{school['ben']}", {**base, "name": "Ben Silva", "email": "ben@x.test", "school": "royal college", "subjects": [school["subs"]["chem"]]})
    q = lambda s: [x["name"] for x in admin.get("/api/students" + s).get_json()]
    assert q("?school=ROYAL%20%20COLLEGE") == ["Ben Silva", "Mia Chen"] and q("?q=royal") == ["Ben Silva", "Mia Chen"] and "Mia Chen" not in q("?school=__none")
    assert admin.get("/api/students/schools").get_json() == [{"name": "Royal College", "students": 2}]
    assert q(f"?subject={school['subs']['math']}") == ["Mia Chen"] and q(f"?batch={school['batch']}&subject={school['subs']['phys']}") == ["Asha Perera", "Dev Kumar"]
    admin.put(f"/api/students/{mia}", {**base, "active": False})
    assert "Mia Chen" not in q("") and "Mia Chen" in q("?active=all")


def test_batches(app, admin):
    assert admin.post("/api/batches", {"name": ""}).status_code == 400
    b = admin.post("/api/batches", {"name": "Grade 10"}).get_json()["id"]
    assert admin.post("/api/batches", {"name": "Grade 10"}).status_code == 400
    assert admin.put(f"/api/batches/{b}", {"name": "Grade 10 – Morning"}).status_code == 200
    assert [x["name"] for x in admin.get("/api/batches").get_json()] == ["Grade 10 – Morning"]


# ------------------------------------------------------------------ classes
def test_schedule_validation_and_visibility(app, admin, school):
    t1, st, dev = Client(app).login("t1@t.test", "teachpass1"), Client(app).login("asha@x.test", "studentpw1"), None
    ok = {"batch_id": school["batch"], "subject_id": school["subs"]["phys"], "start_local": local(datetime.now(timezone.utc) + timedelta(days=1)), "duration_min": 60, "manual_join_url": "https://zoom.us/j/9"}
    for patch, word in [({"start_local": ""}, "date"), ({"start_local": "2020-01-01T10:00"}, "past"), ({"duration_min": 5}, "between"), ({"manual_join_url": "http://x"}, "https"), ({"batch_id": 999}, "valid"), ({"teacher_id": 99999}, "teacher")]:
        r = admin.post("/api/classes", {**ok, **patch})
        assert r.status_code == 400 and word in r.get_json()["error"].lower(), (patch, r.get_json())
    cid = t1.post("/api/classes", ok).get_json()["id"]   # a teacher always schedules as themselves
    d = admin.get(f"/api/classes/{cid}").get_json()
    assert d["teacher_name"] == "Teacher t1" and d["title"] == "Physics – Grade 11" and [s["name"] for s in d["students"]] == ["Asha Perera", "Dev Kumar"]
    assert any(c["id"] == cid for c in st.get("/api/classes").get_json())                     # Asha takes Physics
    chem = make_class(admin, school, "math" if False else "chem")
    sd = st.get(f"/api/classes/{chem}")                                                       # and Chemistry
    assert sd.status_code == 200 and "students" not in sd.get_json() and sd.get_json()["my_attendance"] is None
    other = Client(app).login("t2@t.test", "teachpass1")
    assert other.post(f"/api/classes/{cid}/cancel", {}).status_code == 403
    assert t1.post(f"/api/classes/{cid}/cancel", {"reason": "Teacher unwell"}).status_code == 200 and t1.post(f"/api/classes/{cid}/cancel", {}).status_code == 400
    assert admin.get(f"/api/classes/{cid}").get_json()["status"] == "cancelled"


# ------------------------------------------------------------------ attendance
def rec(school, name, status, **extra):
    return {"student_id": school[name], "status": status, **extra}


def test_manual_attendance_flow(app, admin, school):
    t1, t2 = Client(app).login("t1@t.test", "teachpass1"), Client(app).login("t2@t.test", "teachpass1")
    cid = make_class(admin, school)
    url = f"/api/classes/{cid}/attendance"
    started = datetime.now(timezone.utc) - timedelta(hours=2)
    # who may record, and what is rejected
    assert t2.put(url, {"records": [rec(school, "asha", "present")]}).status_code == 403
    assert Client(app).login("asha@x.test", "studentpw1").put(url, {"records": [rec(school, "asha", "present")]}).status_code == 403
    for bad in ([], [rec(school, "asha", "excused")], [rec(school, "dev", "present")], [rec(school, "asha", "present"), rec(school, "asha", "absent")], [rec(school, "asha", "late", join_local="banana")],
                [rec(school, "asha", "late", join_local=local(started + timedelta(minutes=20)), leave_local=local(started + timedelta(minutes=5)))]):
        assert t1.put(url, {"records": bad}).status_code == 400, bad
    # Present / Late with arrival time and note / Absent
    r = t1.put(url, {"records": [rec(school, "asha", "present", join_local=local(started)), rec(school, "ben", "late", join_local=local(started + timedelta(minutes=22)), leave_local=local(started + timedelta(minutes=60)), note="Bus delay")]})
    assert r.status_code == 200 and r.get_json()["changed"] == 2
    d = t1.get(f"/api/classes/{cid}").get_json()
    by = {a["student_name"]: a for a in d["attendance"]}
    assert (by["Asha Perera"]["status"], by["Ben Silva"]["status"]) == ("present", "late") and by["Ben Silva"]["note"] == "Bus delay" and by["Ben Silva"]["duration_sec"] == 38 * 60
    assert by["Ben Silva"]["created_by_name"] == "Teacher t1" and by["Ben Silva"]["source"] == "manual" and d["attendance_taken"] and d["present"] == 2 and d["late"] == 1
    assert "audit" not in d and len(admin.get(f"/api/classes/{cid}").get_json()["audit"]) == 2                 # first entries are recorded; only admins see the history
    # saving the form untouched changes nothing and needs no reason
    again = [rec(school, "asha", "present", join_local=local(started)), rec(school, "ben", "late", join_local=local(started + timedelta(minutes=22)), leave_local=local(started + timedelta(minutes=60)), note="Bus delay")]
    assert t1.put(url, {"records": again}).get_json()["changed"] == 0
    # a correction needs a reason and is logged with old and new
    fix = [rec(school, "asha", "present", join_local=local(started)), rec(school, "ben", "absent")]
    assert t1.put(url, {"records": fix}).status_code == 400
    assert admin.put(url, {"records": fix, "reason": "Parent confirmed absence"}).status_code == 200
    au = admin.get(f"/api/classes/{cid}").get_json()["audit"]
    change = [a for a in au if a["old_value"]][0]
    assert (change["old_value"]["status"], change["new_value"]["status"], change["changed_by_name"], change["reason"]) == ("late", "absent", "Administrator", "Parent confirmed absence")
    # the student sees only their own result; classes not yet started cannot be marked
    st = Client(app).login("asha@x.test", "studentpw1")
    assert st.get(f"/api/classes/{cid}").get_json()["my_attendance"]["status"] == "present"
    future = make_class(admin, school, started=False)
    assert t1.put(f"/api/classes/{future}/attendance", {"records": [rec(school, "asha", "present")]}).status_code == 400


def test_left_out_students_are_absent_and_pending_list(app, admin, school):
    t1 = Client(app).login("t1@t.test", "teachpass1")
    cid = make_class(admin, school, "chem", "t1")
    pend = t1.get("/api/attendance/pending").get_json()
    assert [c["id"] for c in pend] == [cid] and Client(app).login("t2@t.test", "teachpass1").get("/api/attendance/pending").get_json() == []
    assert t1.put(f"/api/classes/{cid}/attendance", {"records": [rec(school, "asha", "present")]}).status_code == 200
    d = t1.get(f"/api/classes/{cid}").get_json()
    assert {a["student_name"]: a["status"] for a in d["attendance"]} == {"Asha Perera": "present", "Ben Silva": "absent"}
    assert t1.get("/api/attendance/pending").get_json() == []
    dash = admin.get("/api/dashboard").get_json()
    assert dash["students"] == 3 and dash["pending_attendance"] == 0
    sd = Client(app).login("asha@x.test", "studentpw1").get("/api/dashboard").get_json()
    assert sd["role"] == "student" and sd["attendance"] == {"held": 1, "attended": 1, "percent": 100.0}


def test_unicode_and_json_audit_roundtrip(app, admin, school):
    cid = make_class(admin, school)
    r = admin.put(f"/api/classes/{cid}/attendance", {"records": [rec(school, "asha", "late", note="Joined late – بسبب الحافلة / சிங்களம்")]})
    assert r.status_code == 200
    a = [x for x in admin.get(f"/api/classes/{cid}").get_json()["attendance"] if x["student_name"] == "Asha Perera"][0]
    assert a["note"] == "Joined late – بسبب الحافلة / சிங்களம்"    # utf8mb4 keeps every language intact
