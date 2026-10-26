import subprocess
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app import db as dbm
from tests.conftest import Client
from tests.test_core import DXB, make_class, rec


def pdf_text(pdf: bytes, tmp_path) -> str:
    f = tmp_path / "r.pdf"
    f.write_bytes(pdf)
    return subprocess.run(["pdftotext", "-layout", str(f), "-"], capture_output=True, text=True).stdout


def june_classes(admin, school, subject="chem"):
    """Twelve classes in June 2026 at 18:00 Dubai time; class 7 cancelled. Attendance for Asha: late on the 3rd, absent on the 5th and 10th."""
    ids = []
    for k in range(12):
        cid = make_class(admin, school, subject)
        with dbm.tx() as c:
            c.execute(text("UPDATE classes SET start_at=:s WHERE id=:i"), {"s": datetime(2026, 6, 2 + k * 2, 14, 0), "i": cid})
        ids.append(cid)
    with dbm.tx() as c:
        c.execute(text("UPDATE classes SET status='cancelled', cancel_reason='Teacher unwell' WHERE id=:i"), {"i": ids[6]})
    pat = ["present", "present", "late", "present", "absent", "present", None, "present", "present", "absent", "present", "present"]
    for cid, st in zip(ids, pat):
        if st:
            assert admin.put(f"/api/classes/{cid}/attendance", {"records": [rec(school, "asha", st), rec(school, "ben", "present")], "reason": "x"}).status_code == 200
    return ids


@pytest.fixture()
def june(admin, school):
    s = school["subs"]
    for sub, amt in (("chem", 250), ("phys", 300)):
        admin.post("/api/fees/rates", {"subject_id": s[sub], "currency": "AED", "amount": amt})
    june_classes(admin, school)
    return school


def preview(admin, sid, sub, month="2026-06"):
    r = admin.get(f"/api/parent-reports/preview?student_id={sid}&subject_id={sub}&month={month}")
    assert r.status_code == 200, r.get_json()
    return r.get_json()


def test_report_content_and_summary(admin, june):
    school = june
    d = preview(admin, school["ben"], school["subs"]["chem"])["data"]          # Ben takes only Chemistry: no fee generated yet
    assert d["fee"]["month"]["state"] == "not_billed" and d["fee"]["amount"] == 250 and d["fee"]["month"]["total"] == 250.0
    assert any("No fee has been generated" in w for w in preview(admin, school["ben"], school["subs"]["chem"])["warnings"])
    admin.post("/api/fees/generate", {"period": "2026-06", "due_day": 10})
    pv = preview(admin, school["asha"], school["subs"]["chem"])
    d = pv["data"]
    assert (d["academy"], d["month_label"], d["student"]["name"], d["subject"]["name"], d["student"]["batch"], d["teacher"]) == ("Mannu’s Tuition Academy", "June 2026", "Asha Perera", "Chemistry", "Grade 11", "Teacher t1")
    assert [r["status"] for r in d["rows"]] == ["present", "present", "late", "present", "absent", "present", "cancelled", "present", "present", "absent", "present", "present"]
    assert d["rows"][0]["date"] == "Tue, 2 Jun 2026" and d["rows"][0]["time"] == "6:00 pm" and d["rows"][6]["label"] == "Class cancelled" and d["rows"][2]["label"] == "Present (late)"
    s = d["summary"]
    assert (s["held"], s["attended"], s["missed"], s["late"], s["cancelled"], s["percent"], s["planned"]) == (11, 9, 2, 1, 1, 81.8, 12)
    assert pv["warnings"] == [] and d["note"] == "Please contact us if you have any questions about this report."


def test_fee_box_totals_every_subject_and_earlier_months(admin, june):
    school = june
    for per in ("2026-04", "2026-05", "2026-06"):
        admin.post("/api/fees/generate", {"period": per, "due_day": 10})
    admin.post("/api/payments", {"student_id": school["asha"], "amount": 350, "method": "cash"})        # pays April's two fees (250 + 100 of Physics)
    fee = preview(admin, school["asha"], school["subs"]["chem"])["data"]["fee"]
    assert fee["month"] == {"subjects": 2, "enrolled": 2, "billed": 2, "total": 550.0, "paid": 0.0, "outstanding": 550.0, "state": "due", "label": "PAYMENT DUE", "due_date": "2026-06-10"}
    assert [(m["subject"], m["amount"], m["state"]) for m in fee["month_fees"]] == [("Chemistry", 250.0, "due"), ("Physics", 300.0, "due")]
    ow = fee["owed"]
    assert (ow["total"], ow["previous"], ow["this_month"], ow["later"]) == (1300.0, 750.0, 550.0, 0.0)                     # 1650 charged - 350 paid
    assert [(l["period"], l["subject"], l["outstanding"]) for l in ow["lines"]] == [("2026-04", "Physics", 200.0), ("2026-05", "Chemistry", 250.0), ("2026-05", "Physics", 300.0), ("2026-06", "Chemistry", 250.0), ("2026-06", "Physics", 300.0)]
    assert [l["when"] for l in ow["lines"]] == ["previous", "previous", "previous", "this", "this"]
    admin.post("/api/payments", {"student_id": school["asha"], "amount": 200, "method": "cash"})
    part = preview(admin, school["asha"], school["subs"]["chem"])["data"]["fee"]
    assert part["owed"]["previous"] == 550.0                                                                                # the oldest unpaid fee is cleared first
    admin.post("/api/payments", {"student_id": school["asha"], "amount": 1100, "method": "cash"})
    paid = preview(admin, school["asha"], school["subs"]["chem"])["data"]["fee"]
    assert (paid["month"]["state"], paid["owed"]["total"], paid["owed"]["lines"]) == ("paid", 0.0, [])


def test_three_subject_student_sees_850(admin, school):
    """The reported case: Chemistry 300 + Mathematics 250 + Physics 300 = 850 for September."""
    s = school["subs"]
    st = admin.post("/api/students", {"name": "Daniel Perera", "email": "daniel@x.test", "guardian_mobile": "+971505555555", "batch_id": school["batch"], "subjects": [s["chem"], s["math"], s["phys"]]}).get_json()["id"]
    for sub, amt in (("chem", 300), ("math", 250), ("phys", 300)):
        admin.post("/api/fees/rates", {"subject_id": s[sub], "currency": "AED", "amount": amt})
    admin.post("/api/fees/generate", {"period": "2026-09", "due_day": 10})
    fee = preview(admin, st, s["chem"], "2026-09")["data"]["fee"]
    assert (fee["month"]["subjects"], fee["month"]["total"], fee["month"]["outstanding"], fee["month"]["state"]) == (3, 850.0, 850.0, "due")
    admin.post("/api/payments", {"student_id": st, "amount": 200, "method": "cash"})
    fee = preview(admin, st, s["chem"], "2026-09")["data"]["fee"]
    assert (fee["month"]["total"], fee["month"]["paid"], fee["month"]["outstanding"], fee["month"]["state"]) == (850.0, 200.0, 650.0, "part")


def test_pdf_has_everything_a_parent_needs(admin, june, tmp_path):
    school = june
    admin.post("/api/fees/generate", {"period": "2026-06", "due_day": 10})
    admin.post("/api/payments", {"student_id": school["asha"], "amount": 550, "method": "cash"})
    pv = preview(admin, school["asha"], school["subs"]["chem"])
    c = Client(admin.c.application)
    r = c.c.get(pv["pdf_url"])
    assert r.status_code == 200 and r.mimetype == "application/pdf" and r.data[:5] == b"%PDF-" and "Attendance-Report-Asha-Perera-Chemistry-2026-06.pdf" in r.headers["Content-Disposition"]
    assert "attachment" in c.c.get(pv["pdf_url"] + "?download=1").headers["Content-Disposition"]
    open("/tmp/v2_report.pdf", "wb").write(r.data)
    t = pdf_text(r.data, tmp_path)
    for must in ("Mannu’s Tuition Academy", "Monthly Attendance Report", "Asha Perera", "June 2026", "Chemistry", "Grade 11", "Summary", "Classes held", "Attended", "Missed", "81.8%", "FEES FOR JUNE 2026", "AED 550.00",
                 "2 subjects", "12 classes each", "PAID", "Thank you", "No outstanding fees. Thank you.", "All subjects – June 2026", "Class by class", "Tue, 2 Jun 2026", "6:00 pm", "Class cancelled", "Present (late)",
                 "Please contact us if you have any questions about this report."):
        assert must in t, f"missing from the PDF: {must}"
    assert t.count("Absent") == 2 and t.count("Class cancelled") == 1 and "Ben Silva" not in t
    info = subprocess.run(["pdfinfo", str(tmp_path / "r.pdf")], capture_output=True, text=True).stdout
    assert "419.53 x 595.28" in info
    # signed links: junk, expired and non-admin tokens are refused
    assert c.c.get("/files/parent-report/junk").status_code == 401


def test_access_and_recording(app, admin, june):
    school = june
    admin.post("/api/fees/generate", {"period": "2026-06", "due_day": 10})
    t1, st = Client(app).login("t1@t.test", "teachpass1"), Client(app).login("asha@x.test", "studentpw1")
    for who in (t1, st):
        assert who.get("/api/parent-reports?month=2026-06").status_code == 403 and who.get(f"/api/parent-reports/preview?student_id=1&subject_id=1&month=2026-06").status_code == 403
        assert who.post("/api/parent-reports/record", {}).status_code == 403
    lst = admin.get("/api/parent-reports?month=2026-06").get_json()
    row = [r for r in lst["rows"] if r["student_id"] == school["asha"] and r["subject_id"] == school["subs"]["chem"]][0]
    assert (row["summary"]["held"], row["summary"]["attended"], row["fee_state"], row["last_send"], row["owes"]) == (11, 9, "due", None, 550.0)
    assert admin.get("/api/parent-reports?month=bad").status_code == 400 and admin.get("/api/parent-reports?month=2020-01").get_json()["rows"] == []
    assert admin.get(f"/api/parent-reports/preview?student_id={school['ben']}&subject_id={school['subs']['phys']}&month=2026-06").status_code == 400     # not enrolled
    pv = preview(admin, school["asha"], school["subs"]["chem"])
    body = {"student_id": school["asha"], "subject_id": school["subs"]["chem"], "month": "2026-06", "channel": "whatsapp", "hash": pv["data"]["hash"]}
    assert admin.post("/api/parent-reports/record", {**body, "hash": None}).status_code == 400 and admin.post("/api/parent-reports/record", {**body, "hash": "stale"}).status_code == 409
    assert admin.post("/api/parent-reports/record", {**body, "channel": "sms"}).status_code == 400
    assert admin.post("/api/parent-reports/record", {**body, "channel": "email"}).status_code == 400                                  # Asha has no guardian email on file
    ok = admin.post("/api/parent-reports/record", body).get_json()
    assert ok["history"][0]["recipient"] == "+971501111111" and ok["history"][0]["sent_by"] == "Administrator" and ok["history"][0]["mode"] == "manual" and ok["history"][0]["summary"]["attended"] == 9
    assert [r for r in admin.get("/api/parent-reports?month=2026-06").get_json()["rows"] if r["student_id"] == school["asha"]][0]["last_send"]["channel"] == "whatsapp"
    # a change after the preview is caught
    admin.post("/api/payments", {"student_id": school["asha"], "amount": 5, "method": "cash"})
    assert admin.post("/api/parent-reports/record", body).status_code == 409
    # unrecorded classes need an explicit confirmation
    with dbm.tx() as c:
        c.execute(text("UPDATE classes SET attendance_taken_at=NULL WHERE batch_id=:b AND start_at=:s"), {"b": school["batch"], "s": datetime(2026, 6, 24, 14, 0)})
        c.execute(text("DELETE FROM attendance WHERE class_id IN (SELECT id FROM classes WHERE start_at=:s)"), {"s": datetime(2026, 6, 24, 14, 0)})
    pv = preview(admin, school["asha"], school["subs"]["chem"])
    assert pv["data"]["summary"]["not_recorded"] == 1 and any("no attendance recorded" in w for w in pv["warnings"])
    b2 = {**body, "hash": pv["data"]["hash"]}
    assert admin.post("/api/parent-reports/record", b2).status_code == 400 and admin.post("/api/parent-reports/record", {**b2, "confirm_incomplete": True}).status_code == 200
    assert len(admin.get("/api/parent-reports/history?month=2026-06").get_json()) == 2
