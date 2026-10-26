from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app import db as dbm
from tests.conftest import Client
from tests.test_core import DXB, local, make_class, rec
from tests.test_core import make_class, rec


def today_dxb():
    return datetime.now(DXB).date()


def money_close(a, b):
    return abs(a - b) < 0.0005


@pytest.fixture()
def priced(admin, school):
    s = school["subs"]
    admin.post("/api/fees/rates", {"subject_id": s["chem"], "currency": "AED", "amount": 250})
    admin.post("/api/fees/rates", {"subject_id": s["phys"], "currency": "AED", "amount": 300})
    return school


def stmt(admin, sid):
    return admin.get(f"/api/fees/student/{sid}").get_json()


# ------------------------------------------------------------------ rates and generation
def test_rate_precedence_and_generation(admin, school, priced):
    s = school["subs"]
    admin.post("/api/fees/rates", {"subject_id": s["chem"], "batch_id": school["batch"], "currency": "AED", "amount": 275})       # batch rate beats the general one
    admin.post("/api/fees/rates", {"subject_id": s["chem"], "student_id": school["asha"], "currency": "AED", "amount": 200})       # student rate beats both
    assert admin.post("/api/fees/rates", {"subject_id": s["chem"], "batch_id": 1, "student_id": 1, "currency": "AED", "amount": 1}).status_code == 400
    assert admin.post("/api/fees/rates", {"subject_id": s["chem"], "currency": "AED", "amount": "abc"}).status_code == 400
    assert admin.post("/api/fees/rates", {"subject_id": s["chem"], "currency": "AED", "amount": "10.555"}).status_code == 400    # AED has two decimals
    assert admin.post("/api/fees/generate", {"period": "2026", "due_day": 10}).status_code == 400 and admin.post("/api/fees/generate", {"period": "2026-06", "due_day": 31}).status_code == 400
    r = admin.post("/api/fees/generate", {"period": "2026-06", "due_day": 10}).get_json()
    assert r == {"created": 4, "skipped": 0, "no_rate": 0}                                                                       # Asha chem+phys, Ben chem, Dev phys
    assert admin.post("/api/fees/generate", {"period": "2026-06", "due_day": 10}).get_json() == {"created": 0, "skipped": 4, "no_rate": 0}   # safe to run twice
    amounts = {sid: {l["description"].split(" fee")[0]: l["amount"] for l in stmt(admin, sid)["charges"]} for sid in (school["asha"], school["ben"], school["dev"])}
    assert amounts == {school["asha"]: {"Chemistry": 200.0, "Physics": 300.0}, school["ben"]: {"Chemistry": 275.0}, school["dev"]: {"Physics": 300.0}}
    assert admin.post("/api/fees/generate", {"period": "2026-07", "due_day": 10}).get_json()["created"] == 4
    admin.delete(f"/api/fees/rates/{[x for x in admin.get('/api/fees/rates').get_json() if x['student_id'] == school['asha']][0]['id']}")
    assert admin.post("/api/fees/generate", {"period": "2026-08", "due_day": 10}).get_json()["created"] == 4
    assert [l["amount"] for l in stmt(admin, school["asha"])["charges"] if l["period"] == "2026-08"] == [275.0, 300.0]   # back to the batch rate
    # a subject with no rate is reported, not guessed
    admin.post("/api/students", {"name": "Zed M", "email": "zed@x.test", "guardian_mobile": "+971504444444", "batch_id": school["batch"], "subjects": [s["math"]]})
    assert admin.post("/api/fees/generate", {"period": "2026-09", "due_day": 10}).get_json()["no_rate"] == 1


# ------------------------------------------------------------------ payments: oldest charge first
def test_payments_fifo_receipts_and_void(app, admin, school, priced):
    for per in ("2026-04", "2026-05", "2026-06"):
        admin.post("/api/fees/generate", {"period": per, "due_day": 10})
    a = school["asha"]
    s0 = stmt(admin, a)
    assert (s0["charged"], s0["paid"], s0["balance"], s0["currency"]) == (1650.0, 0.0, 1650.0, "AED")
    assert admin.post("/api/payments", {"student_id": a, "amount": 200, "method": "cash"}).status_code == 200
    s1 = stmt(admin, a)
    ls = {(l["period"], l["description"].split(" fee")[0]): l for l in s1["charges"]}
    assert ls[("2026-04", "Chemistry")]["outstanding"] == 50.0 and ls[("2026-04", "Chemistry")]["paid"] == 200.0 and ls[("2026-04", "Physics")]["outstanding"] == 300.0     # April is paid first
    assert (s1["paid"], s1["balance"]) == (200.0, 1450.0)
    p2 = admin.post("/api/payments", {"student_id": a, "amount": 1500, "method": "bank_transfer", "reference": "TT-77"}).get_json()["id"]
    s2 = stmt(admin, a)
    assert s2["balance"] == -50.0 and all(l["outstanding"] == 0 for l in s2["charges"])                                            # overpaid = credit
    rc = admin.get(f"/api/payments/{p2}").get_json()
    assert rc["receipt_no"].endswith("-00002") and rc["receipt_no"].startswith("MTA-") and rc["student"] == "Asha Perera" and rc["balance_after"] == -50.0 and rc["academy"] == "Mannu’s Tuition Academy"
    # cancelling a payment needs a reason and puts the money back
    assert admin.post(f"/api/payments/{p2}/void", {}).status_code == 400
    assert admin.post(f"/api/payments/{p2}/void", {"reason": "Cheque bounced"}).status_code == 200 and admin.post(f"/api/payments/{p2}/void", {"reason": "x"}).status_code == 404
    assert stmt(admin, a)["balance"] == 1450.0
    pays = stmt(admin, a)["payments"]
    assert [p["voided"] for p in pays] == [True, False]
    # validation
    for bad in ({"amount": 0}, {"amount": -5}, {"amount": "x"}, {"amount": 10, "method": "gold"}, {"amount": 10, "student_id": 9999}):
        assert admin.post("/api/payments", {"student_id": a, "method": "cash", **bad}).status_code in (400, 404), bad
    # receipt numbers are unique and in order
    nums = [admin.get(f"/api/payments/{admin.post('/api/payments', {'student_id': a, 'amount': 1, 'method': 'cash'}).get_json()['id']}").get_json()["receipt_no"] for _ in range(3)]
    assert nums == sorted(set(nums)) and nums[0].endswith("-00003")


def test_other_currency_payment(admin, school, priced):
    a = admin.put(f"/api/students/{school['ben']}", {"name": "Ben Silva", "email": "ben@x.test", "guardian_mobile": "+971502222222", "batch_id": school["batch"], "subjects": [school["subs"]["chem"]], "currency": "KWD"})
    assert a.status_code == 200
    admin.post("/api/fees/rates", {"subject_id": school["subs"]["chem"], "currency": "KWD", "amount": "25.500"})
    admin.post("/api/fees/generate", {"period": "2026-06", "due_day": 10})
    s = stmt(admin, school["ben"])
    assert s["currency"] == "KWD" and s["charges"][0]["amount"] == 25.5
    assert admin.post("/api/payments", {"student_id": school["ben"], "amount": 100, "paid_currency": "AED", "method": "cash"}).status_code == 400          # needs a rate
    assert admin.post("/api/payments", {"student_id": school["ben"], "amount": 100, "paid_currency": "AED", "rate": 0, "method": "cash"}).status_code == 400
    pid = admin.post("/api/payments", {"student_id": school["ben"], "amount": 102, "paid_currency": "AED", "rate": "0.0833", "method": "cash"}).get_json()["id"]   # 102 AED x 0.0833 = 8.4966 KWD
    r = admin.get(f"/api/payments/{pid}").get_json()
    assert (r["paid_currency"], r["paid_amount"], r["currency"], r["amount"]) == ("AED", 102.0, "KWD", 8.497)
    assert money_close(stmt(admin, school["ben"])["balance"], 25.5 - 8.497)


def test_fee_permissions(app, admin, school, priced):
    admin.post("/api/fees/generate", {"period": "2026-06", "due_day": 10})
    t1, st = Client(app).login("t1@t.test", "teachpass1"), Client(app).login("asha@x.test", "studentpw1")
    for path in ("/api/fees/summary", "/api/fees/rates", "/api/payments", "/api/reports/outstanding", "/api/reports/payments"):
        assert t1.get(path).status_code == 403 and st.get(path).status_code == 403, path
    assert t1.post("/api/payments", {}).status_code == 403 and st.get("/api/fees/mine").status_code == 200 and t1.get("/api/fees/mine").status_code == 403
    mine = st.get("/api/fees/mine").get_json()
    assert mine["student"]["name"] == "Asha Perera" and mine["charged"] == 550.0
    pid = admin.post("/api/payments", {"student_id": school["asha"], "amount": 10, "method": "cash"}).get_json()["id"]
    other = admin.post("/api/payments", {"student_id": school["ben"], "amount": 10, "method": "cash"}).get_json()["id"]
    assert st.get(f"/api/payments/{pid}").status_code == 200 and st.get(f"/api/payments/{other}").status_code == 404 and t1.get(f"/api/payments/{pid}").status_code == 404


# ------------------------------------------------------------------ outstanding report
def test_outstanding_ageing_and_filters(admin, school, priced):
    today = today_dxb()
    add = lambda sid, sub, days, amount, period=None: admin.post("/api/fees/charges", {"student_id": sid, "subject_id": school["subs"][sub], "description": f"{sub} test", "amount": amount, "due_date": (today + timedelta(days=days)).isoformat(), "period": period})
    for sid, sub, days, amt in [(school["asha"], "chem", -20, 100), (school["asha"], "phys", -45, 200), (school["ben"], "chem", -75, 300), (school["dev"], "phys", -120, 400), (school["dev"], "phys", 3, 50), (school["ben"], "chem", 30, 25)]:
        assert add(sid, sub, days, amt, "2026-05").status_code == 200
    o = admin.get("/api/reports/outstanding").get_json()
    ag = {b["key"]: (b["amount"], b["students"]) for b in o["ageing"][0]["buckets"]}
    assert ag == {"not_due": (75.0, 2), "d1_30": (100.0, 1), "d31_60": (200.0, 1), "d61_90": (300.0, 1), "d90": (400.0, 1)}
    t = o["totals"][0]
    assert (t["outstanding"], t["overdue"], t["due_soon"], t["students_owing"]) == (1075.0, 1000.0, 50.0, 3)
    for grp in ("by_batch", "by_subject", "by_period"):
        assert round(sum(x["outstanding"] for x in o[grp]), 2) == 1075.0
    # agrees with the fee summary (the Fees screen)
    summ = {x["id"]: x for x in admin.get("/api/fees/summary").get_json()}
    for s in o["students"]:
        assert s["balance"] == summ[s["id"]]["balance"] and s["overdue"] == summ[s["id"]]["overdue"]
    q = lambda s: admin.get("/api/reports/outstanding" + s).get_json()
    assert {l["student"] for l in q(f"?student_id={school['ben']}")["lines"]} == {"Ben Silva"} and q("?currency=KWD")["lines"] == [] and all(l["subject"] == "Physics" for l in q(f"?subject={school['subs']['phys']}")["lines"])
    assert len(q(f"?due_from={(today - timedelta(days=100)).isoformat()}&due_to={(today - timedelta(days=10)).isoformat()}")["lines"]) == 3
    assert admin.get("/api/reports/outstanding?due_from=2026-09-01&due_to=2026-08-01").status_code == 400
    # overpay Dev: shows as credit, not as outstanding
    admin.post("/api/payments", {"student_id": school["dev"], "amount": 1000, "method": "cash"})
    d = [s for s in q("")["students"] if s["id"] == school["dev"]][0]
    assert d["credit"] == 550.0 and d["outstanding"] == 0 and q("")["credits"] == [{"currency": "AED", "credit": 550.0, "students": 1}]


def test_payments_report(admin, school, priced):
    admin.post("/api/payments", {"student_id": school["asha"], "amount": 100, "method": "cash"})
    admin.post("/api/payments", {"student_id": school["asha"], "amount": 300, "method": "bank_transfer"})
    v = admin.post("/api/payments", {"student_id": school["ben"], "amount": 77, "method": "cash"}).get_json()["id"]
    admin.post(f"/api/payments/{v}/void", {"reason": "mistake"})
    today = today_dxb().isoformat()
    r = admin.get(f"/api/reports/payments?from={today}&to={today}").get_json()
    assert len(r["payments"]) == 2 and r["totals"] == [{"currency": "AED", "amount": 400.0, "count": 2}]                         # voided payments are left out
    assert [(m["method"], m["amount"]) for m in r["by_method"]] == [("bank_transfer", 300.0), ("cash", 100.0)]
    assert len(admin.get("/api/reports/payments?method=cash").get_json()["payments"]) == 1 and admin.get("/api/reports/payments?from=2026-02-01&to=2026-01-01").status_code == 400
    assert admin.get("/api/reports/payments?from=2019-01-01&to=2019-01-31").get_json()["payments"] == []


# ------------------------------------------------------------------ attendance report
def test_attendance_report(app, admin, school):
    t1 = Client(app).login("t1@t.test", "teachpass1")
    started = datetime.now(timezone.utc) - timedelta(hours=4)
    c1, c2, c3 = make_class(admin, school, "chem", hours=6), make_class(admin, school, "chem", hours=5), make_class(admin, school, "chem", hours=4)
    for cid, asha, ben in ((c1, "present", "present"), (c2, "late", "absent"), (c3, "absent", "present")):
        assert t1.put(f"/api/classes/{cid}/attendance", {"records": [rec(school, "asha", asha), rec(school, "ben", ben)]}).status_code == 200
    missing = make_class(admin, school, "chem", hours=3)
    today, yesterday = today_dxb().isoformat(), (today_dxb() - timedelta(days=1)).isoformat()   # the classes began a few hours ago: possibly yesterday in Dubai
    r = admin.get(f"/api/reports/attendance?from={yesterday}&to={today}&detail=1").get_json()
    assert r["summary"] == {"classes": 3, "records": 6, "present": 3, "late": 1, "absent": 2, "percent": 66.7}
    st = {s["name"]: s for s in r["students"]}
    assert (st["Asha Perera"]["present"], st["Asha Perera"]["late"], st["Asha Perera"]["absent"], st["Asha Perera"]["percent"]) == (1, 1, 1, 66.7)
    assert len(r["by_class"]) == 3 and r["by_class"][0]["start_at"] > r["by_class"][-1]["start_at"] and sum(x["present"] + x["late"] + x["absent"] for x in r["by_class"]) == 6
    reg = r["register"]; assert [x["start_at"] for x in reg["classes"]] == sorted(x["start_at"] for x in reg["classes"]) and len(reg["rows"]) == 2
    assert sum(len(x["cells"]) for x in reg["rows"]) == 6 and len(r["absences"]) == 2 and len(r["records"]) == 6
    assert [m["class_id"] for m in r["missing"]] == [missing]                                                                    # finished, but nobody recorded attendance
    assert admin.get("/api/reports/attendance?from=2030-01-01&to=2020-01-01").status_code == 400 and admin.get("/api/reports/attendance?from=2020-01-01&to=2026-01-01").status_code == 400
    assert admin.get("/api/reports/attendance?from=2019-01-01&to=2019-01-05").get_json()["summary"]["records"] == 0
    admin.put(f"/api/students/{school['ben']}", {"name": "Ben Silva", "email": "ben@x.test", "guardian_mobile": "+971502222222", "batch_id": school["batch"], "subjects": [school["subs"]["chem"]], "school": "Royal College"})
    assert [s["name"] for s in admin.get("/api/reports/attendance?school=royal%20%20college").get_json()["students"]] == ["Ben Silva"]
    assert [s["name"] for s in admin.get("/api/reports/attendance?school=__none").get_json()["students"]] == ["Asha Perera"]
    # a student sees only their own numbers and none of the class-wide parts
    mine = Client(app).login("asha@x.test", "studentpw1").get("/api/reports/attendance").get_json()
    assert mine["summary"]["records"] == 3 and "register" not in mine and "missing" not in mine and all(x["student"] == "Asha Perera" for x in mine["records"])
