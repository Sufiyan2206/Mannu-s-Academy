import os
import uuid

import pytest
from sqlalchemy import create_engine, text

ROOT = os.environ.get("TEST_DB_ROOT_URL", "mysql+pymysql://mannus:mannus@127.0.0.1:3306/?charset=utf8mb4")


@pytest.fixture(scope="session")
def dburl():
    name = "mannus_t_" + uuid.uuid4().hex[:8]
    root = create_engine(ROOT, future=True, isolation_level="AUTOCOMMIT")
    with root.connect() as c:
        c.execute(text(f"CREATE DATABASE {name} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"))
    url = ROOT.replace("/?", f"/{name}?")
    from app.migrate import migrate
    migrate(url)
    yield url
    with root.connect() as c:
        c.execute(text(f"DROP DATABASE {name}"))


@pytest.fixture()
def app(dburl):
    from app import create_app
    from app import db as dbm
    from app import auth as authm
    authm._fails.clear()   # login lock-outs from one test must not leak into the next
    a = create_app({"DATABASE_URL": dburl, "JWT_SECRET": "test-secret", "ADMIN_EMAIL": "admin@t.test", "ADMIN_PASSWORD": "adminpass1", "TESTING": True})
    with dbm.tx() as c:   # every test starts from an empty school (the seeded subjects stay)
        c.execute(text("SET FOREIGN_KEY_CHECKS=0"))
        for t in ("parent_report_sends", "attendance_unmatched", "attendance_audit", "attendance_zoom", "attendance", "payments", "charges", "fee_rates", "receipt_counters", "classes", "student_subjects", "students", "batches", "kv"):
            c.execute(text(f"DELETE FROM {t}"))
        c.execute(text("DELETE FROM users WHERE email<>'admin@t.test'"))
        c.execute(text("SET FOREIGN_KEY_CHECKS=1"))
    return a


class Client:
    def __init__(self, app):
        self.c = app.test_client()
        self.tok = None

    def login(self, email, pw):
        r = self.c.post("/api/auth/login", json={"email": email, "password": pw})
        assert r.status_code == 200, r.get_json()
        self.tok = r.get_json()["token"]
        return self

    def _h(self):
        return {"Authorization": f"Bearer {self.tok}"} if self.tok else {}

    def get(self, u, **k):
        return self.c.get(u, headers=self._h(), **k)

    def post(self, u, j=None):
        return self.c.post(u, json=j or {}, headers=self._h())

    def put(self, u, j=None):
        return self.c.put(u, json=j or {}, headers=self._h())

    def delete(self, u):
        return self.c.delete(u, headers=self._h())


@pytest.fixture()
def admin(app):
    return Client(app).login("admin@t.test", "adminpass1")


@pytest.fixture()
def school(app, admin):
    """A small school: batch, two teachers, a student with a login, two other students."""
    ids = {}
    ids["batch"] = admin.post("/api/batches", {"name": "Grade 11"}).get_json()["id"]
    subs = {s["code"]: s["id"] for s in admin.get("/api/config").get_json()["subjects"]}
    ids["subs"] = subs
    for key, email in (("t1", "t1@t.test"), ("t2", "t2@t.test")):
        ids[key] = admin.post("/api/users", {"name": f"Teacher {key}", "email": email, "role": "teacher", "password": "teachpass1"}).get_json()["id"]
    def stu(name, subjects, **extra):
        r = admin.post("/api/students", {"name": name, "email": f"{name.split()[0].lower()}@x.test", "mobile": "0501234567", "guardian_name": "Parent", "guardian_mobile": "+971501111111",
                                          "batch_id": ids["batch"], "subjects": subjects, **extra})
        assert r.status_code == 200, r.get_json()
        return r.get_json()["id"]
    ids["asha"] = stu("Asha Perera", [subs["chem"], subs["phys"]], create_login=True, password="studentpw1")
    ids["ben"] = stu("Ben Silva", [subs["chem"]])
    ids["dev"] = stu("Dev Kumar", [subs["phys"]])
    return ids
