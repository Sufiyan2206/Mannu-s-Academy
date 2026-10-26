from datetime import datetime, timedelta, timezone

import pytest

from app import zoom
from tests.conftest import Client
from tests.test_core import local, make_class, rec


class FakeZoom:
    """Stands in for Zoom's web service."""

    def __init__(self):
        self.created, self.people, self.fail = [], [], None

    def __call__(self, method, path, **kw):
        if self.fail:
            from app.util import HttpError
            raise HttpError(*self.fail)
        if method == "POST" and path.endswith("/meetings"):
            self.created.append(kw["json"])
            n = len(self.created)
            return {"id": 8000 + n, "uuid": f"uuid-{n}", "join_url": f"https://zoom.us/j/{8000 + n}", "start_url": f"https://zoom.us/s/{8000 + n}?zak=secret"}
        if method == "GET" and "/participants" in path:
            return {"participants": self.people, "next_page_token": ""}
        raise AssertionError(path)


@pytest.fixture()
def fz(monkeypatch):
    f = FakeZoom()
    for k in ("ZOOM_ACCOUNT_ID", "ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET"):
        monkeypatch.setenv(k, "x")
    monkeypatch.setattr(zoom, "_request", f)
    return f


def iso_utc(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def zoom_class(admin, school, subject="chem", hours=2):
    r = admin.post("/api/classes", {"batch_id": school["batch"], "subject_id": school["subs"][subject], "teacher_id": school["t1"], "start_local": local(datetime.now(timezone.utc) + timedelta(hours=3)), "duration_min": 60})
    assert r.status_code == 200, r.get_json()
    cid = r.get_json()["id"]
    from sqlalchemy import text
    from app import db as dbm
    with dbm.tx() as c:
        c.execute(text("UPDATE classes SET start_at=:s WHERE id=:i"), {"s": datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=hours), "i": cid})
    return cid


def test_meeting_is_created_in_zoom_when_no_link_is_pasted(admin, school, fz):
    cid = zoom_class(admin, school)
    d = admin.get(f"/api/classes/{cid}").get_json()
    assert d["join_url"] == "https://zoom.us/j/8001" and d["link_source"] == "zoom" and d["has_zoom"] and fz.created[0]["duration"] == 60 and fz.created[0]["topic"] == "Chemistry – Grade 11"
    assert "start_url" not in d and "zak" not in str(d)                               # the host's private start link is never sent to the browser
    r = admin.post("/api/classes", {"batch_id": school["batch"], "subject_id": school["subs"]["chem"], "start_local": local(datetime.now(timezone.utc) + timedelta(days=1)), "duration_min": 60, "manual_join_url": "https://meet.example/abc"})
    assert r.status_code == 200 and admin.get(f"/api/classes/{r.get_json()['id']}").get_json()["link_source"] == "manual" and len(fz.created) == 1     # a pasted link wins
    fz.fail = (502, "Zoom said: invalid token")
    r = admin.post("/api/classes", {"batch_id": school["batch"], "subject_id": school["subs"]["chem"], "start_local": local(datetime.now(timezone.utc) + timedelta(days=1)), "duration_min": 60})
    assert r.status_code == 502 and "Zoom said" in r.get_json()["error"]
    assert len([c for c in admin.get("/api/classes").get_json()]) == 2                 # nothing half-saved


def test_without_zoom_a_link_is_required(admin, school, monkeypatch):
    for k in ("ZOOM_ACCOUNT_ID", "ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET"):
        monkeypatch.delenv(k, raising=False)
    r = admin.post("/api/classes", {"batch_id": school["batch"], "subject_id": school["subs"]["chem"], "start_local": local(datetime.now(timezone.utc) + timedelta(days=1)), "duration_min": 60})
    assert r.status_code == 400 and "Paste the meeting link" in r.get_json()["error"]


def test_sync_attendance_rules(app, admin, school, fz):
    cid = zoom_class(admin, school)
    start = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=2)
    P = lambda name, email, join_min, leave_min: {"name": name, "user_email": email, "join_time": iso_utc(start + timedelta(minutes=join_min)), "leave_time": iso_utc(start + timedelta(minutes=leave_min))}
    fz.people = [P("Asha", "ASHA@x.test", 1, 25), P("Asha", "asha@x.test", 30, 58),          # rejoined: times are added up, email case ignored
                 P("Ben", "ben@x.test", 22, 60),                                               # joined 22 minutes after the start: Late
                 P("Mr Guest", "guest@else.test", 0, 60),                                      # not in the class: listed separately, never counted
                 P("Phone user", "", 5, 20)]
    t1 = Client(app).login("t1@t.test", "teachpass1")
    assert Client(app).login("t2@t.test", "teachpass1").post(f"/api/classes/{cid}/sync-attendance").status_code == 403
    r = t1.post(f"/api/classes/{cid}/sync-attendance")
    assert r.status_code == 200 and r.get_json() == {"ok": True, "applied": 2, "kept_manual": 0, "unmatched": 2}
    d = t1.get(f"/api/classes/{cid}").get_json()
    got = {a["student_name"]: (a["status"], a["source"]) for a in d["attendance"]}
    assert got == {"Asha Perera": ("present", "zoom"), "Ben Silva": ("late", "zoom")} and d["attendance_taken"]
    z = {x["student_id"]: x for x in d["zoom_attendance"]}
    assert z[school["asha"]]["duration_sec"] == (24 + 28) * 60 and sorted(u["name"] for u in d["unmatched"]) == ["Mr Guest", "Phone user"]
    assert t1.post(f"/api/classes/{cid}/sync-attendance").get_json()["applied"] == 0       # running it again changes nothing
    # a teacher corrects Ben by hand: later syncs keep the teacher's entry and still record Zoom's own view beside it
    assert t1.put(f"/api/classes/{cid}/attendance", {"records": [rec(school, "asha", "present"), rec(school, "ben", "present")], "reason": "Ben was in the room but joined on a friend's account"}).status_code == 200
    fz.people = [P("Asha", "asha@x.test", 0, 60)]
    r = t1.post(f"/api/classes/{cid}/sync-attendance").get_json()
    assert r["kept_manual"] == 2 and r["applied"] == 0
    d = t1.get(f"/api/classes/{cid}").get_json()
    assert {a["student_name"]: (a["status"], a["source"]) for a in d["attendance"]}["Ben Silva"] == ("present", "manual")
    assert {x["student_id"]: x["status"] for x in d["zoom_attendance"]}[school["ben"]] == "absent"                 # Zoom's own record shows he never joined
    # students who left within the first half are absent
    short = zoom_class(admin, school)
    fz.people = [P("Asha", "asha@x.test", 0, 20), P("Ben", "ben@x.test", 0, 59)]
    admin.post(f"/api/classes/{short}/sync-attendance")
    assert {a["student_name"]: a["status"] for a in admin.get(f"/api/classes/{short}").get_json()["attendance"]} == {"Asha Perera": "absent", "Ben Silva": "present"}


def test_sync_guards(admin, school, fz):
    manual = make_class(admin, school)
    assert admin.post(f"/api/classes/{manual}/sync-attendance").status_code == 400                            # no Zoom meeting for this class
    future = admin.post("/api/classes", {"batch_id": school["batch"], "subject_id": school["subs"]["chem"], "start_local": local(datetime.now(timezone.utc) + timedelta(hours=5)), "duration_min": 60}).get_json()["id"]
    r = admin.post(f"/api/classes/{future}/sync-attendance")
    assert r.status_code == 400 and "not ended" in r.get_json()["error"]
    cid = zoom_class(admin, school)
    fz.fail = (404, "Zoom has no record of this meeting yet.")
    assert admin.post(f"/api/classes/{cid}/sync-attendance").status_code == 404
    fz.fail = (502, "Zoom said: rate limit")
    assert admin.post(f"/api/classes/{cid}/sync-attendance").status_code == 502


def test_automatic_sync_command(app, admin, school, fz):
    done, notyet = zoom_class(admin, school, hours=3), zoom_class(admin, school, hours=0)
    from sqlalchemy import text
    from app import db as dbm
    with dbm.tx() as c:
        c.execute(text("UPDATE classes SET start_at=:s WHERE id=:i"), {"s": datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=30), "i": notyet})    # ended? no: still running
    start = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=3)
    fz.people = [{"name": "Asha", "user_email": "asha@x.test", "join_time": iso_utc(start), "leave_time": iso_utc(start + timedelta(minutes=60))}]
    r = app.test_cli_runner().invoke(args=["sync-zoom"])
    assert r.exit_code == 0 and f"class {done}: 2 applied" in r.output and f"class {notyet}" not in r.output
    assert app.test_cli_runner().invoke(args=["sync-zoom"]).output.strip() == ""                                    # nothing left to do
