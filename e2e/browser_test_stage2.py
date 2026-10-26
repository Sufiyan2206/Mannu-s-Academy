"""Stage 2 end-to-end: fees, payments, receipts, all 18 reports, parent report preview/PDF/record. Real MySQL-protocol DB + Flask + React build, phone-size browser."""
import os, subprocess, sys, time, uuid, json, urllib.request, datetime
from sqlalchemy import create_engine, text
from playwright.sync_api import sync_playwright

ROOT = os.environ.get("TEST_DB_ROOT_URL", "mysql+pymysql://mannus:mannus@127.0.0.1:3306/?charset=utf8mb4")
name = "mannus_e2e2_" + uuid.uuid4().hex[:6]
eng = create_engine(ROOT, isolation_level="AUTOCOMMIT")
with eng.connect() as c: c.execute(text(f"CREATE DATABASE {name} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"))
url = ROOT.replace("/?", f"/{name}?")
env = dict(os.environ, DATABASE_URL=url, JWT_SECRET="e2e", ADMIN_EMAIL="admin@t.test", ADMIN_PASSWORD="adminpass1", STATIC_DIR="/home/claude/mannus-v2/web/dist", PYTHONPATH="/home/claude/mannus-v2/api", ACADEMY_CONTACT="Tel: +971 50 000 0000")
subprocess.run([sys.executable, "-m", "app.migrate"], cwd="/home/claude/mannus-v2/api", env=env, check=True, capture_output=True)
srv = subprocess.Popen([sys.executable, "-m", "flask", "--app", "wsgi", "run", "--port", "5056"], cwd="/home/claude/mannus-v2/api", env=env, stdout=open("/tmp/e2e2_srv.log", "w"), stderr=subprocess.STDOUT)
time.sleep(3)
ok = [True]
def check(n, c, x=""):
    print(("✓ " if c else "✗ ") + n + (f" – {x}" if x else ""))
    if not c: ok[0] = False
def J(m, u, b=None, t=None):
    r = urllib.request.Request("http://127.0.0.1:5056" + u, method=m, data=json.dumps(b).encode() if b is not None else None, headers={"Content-Type": "application/json", **({"Authorization": "Bearer " + t} if t else {})})
    return json.loads(urllib.request.urlopen(r).read() or b"{}")
B = "http://127.0.0.1:5056"
try:
    A = J("POST", "/api/auth/login", {"email": "admin@t.test", "password": "adminpass1"})["token"]
    b1 = J("POST", "/api/batches", {"name": "Grade 11 – Evening"}, A)["id"]; subs = {s["code"]: s["id"] for s in J("GET", "/api/config", None, A)["subjects"]}
    J("POST", "/api/users", {"name": "Mr Rahman", "email": "t@x.test", "role": "teacher", "password": "teachpass1"}, A); tid = [t for t in J("GET", "/api/teachers", None, A) if t["name"] == "Mr Rahman"][0]["id"]
    dan = J("POST", "/api/students", {"name": "Daniel Perera", "email": "daniel@x.test", "guardian_name": "Mr Perera", "guardian_mobile": "+971505555555", "guardian_email": "dp@example.com", "batch_id": b1, "subjects": [subs["chem"], subs["math"], subs["phys"]], "school": "Royal College", "create_login": True, "password": "studentpw1"}, A)["id"]
    ben = J("POST", "/api/students", {"name": "Ben Silva", "email": "ben@x.test", "guardian_mobile": "+971502222222", "batch_id": b1, "subjects": [subs["chem"]]}, A)["id"]
    for sub, amt in (("chem", 300), ("math", 250), ("phys", 300)): J("POST", "/api/fees/rates", {"subject_id": subs[sub], "currency": "AED", "amount": amt}, A)
    last = (datetime.date.today().replace(day=1) - datetime.timedelta(days=1)).strftime("%Y-%m")
    for per in ((datetime.date.today().replace(day=1) - datetime.timedelta(days=62)).strftime("%Y-%m"), (datetime.date.today().replace(day=1) - datetime.timedelta(days=31)).strftime("%Y-%m"), last): J("POST", "/api/fees/generate", {"period": per, "due_day": 10}, A)
    # six classes last month for Chemistry, a few finished classes this week
    for k in range(6):
        loc = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=7)).strftime("%Y-%m-%dT%H:%M")
        cid = J("POST", "/api/classes", {"batch_id": b1, "subject_id": subs["chem"], "teacher_id": tid, "start_local": loc, "duration_min": 60, "manual_join_url": "https://zoom.us/j/1"}, A)["id"]
        when = datetime.datetime.strptime(last + f"-{3 + k * 4:02d} 14:00", "%Y-%m-%d %H:%M") if k < 5 else datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) - datetime.timedelta(hours=2)
        with eng.connect() as c: c.execute(text(f"UPDATE {name}.classes SET start_at=:s WHERE id=:i"), {"s": when, "i": cid})
        if k < 5:
            J("PUT", f"/api/classes/{cid}/attendance", {"records": [{"student_id": dan, "status": ["present", "present", "late", "absent", "present"][k]}, {"student_id": ben, "status": "present"}]}, A)
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, accept_downloads=True); pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(B + "/"); pg.wait_for_selector("form"); pg.fill("#email", "admin@t.test"); pg.fill("#password", "adminpass1"); pg.click("button.primary"); pg.wait_for_selector("nav.tabs")
        check("admin menu now has Reports and Fees", "Reports" in pg.inner_text("nav.tabs") and "Fees" in pg.inner_text("nav.tabs"))
        # ---- Fees
        pg.goto(B + "/fees"); pg.wait_for_selector(".card.list"); tx = pg.inner_text("main")
        check("Fees lists students with what they owe and overdue", "Daniel Perera" in tx and "overdue" in tx and "AED" in tx)
        pg.click("text=Daniel Perera"); pg.wait_for_selector(".modal"); check("student fee statement shows 3 subjects × 3 months", pg.inner_text(".modal").count("fee –") == 9 and "AED 2,550.00" in pg.inner_text(".modal"), pg.inner_text(".modal")[:80].replace("\n", " "))
        pg.click(".modal >> text=Record payment"); pg.wait_for_selector(".modal-root >> nth=-1 >> form"); pg.fill(".modal-root >> nth=-1 >> [name=amount]", "850"); pg.select_option(".modal-root >> nth=-1 >> [name=method]", "bank_transfer"); pg.fill(".modal-root >> nth=-1 >> [name=reference]", "TT-1001")
        pg.click(".modal-root >> nth=-1 >> .foot .primary"); pg.wait_for_selector("text=Payment recorded"); pg.wait_for_timeout(600)
        mt = pg.inner_text(".modal-root >> nth=0"); check("payment recorded: paid AED 850, receipt number MTA-…-00001, balance reduced", "MTA-" in mt and "-00001" in mt and "AED 850.00" in mt and "AED 1,700.00" in mt, mt[:120].replace("\n", " "))
        pg.click(".modal-root >> nth=0 >> a:has-text('MTA-')"); pg.wait_for_selector("text=Receipt TTT") if False else pg.wait_for_selector(".modal-root >> nth=-1 >> text=Received"); rc = pg.inner_text(".modal-root >> nth=-1"); check("receipt shows academy, student, method, reference, balance", "Mannu’s Tuition Academy" in rc and "Daniel Perera" in rc and "Bank transfer · TT-1001" in rc and "AED 1,700.00 due" in rc)
        pg.screenshot(path="/tmp/s2_receipt.png"); pg.click(".modal-root >> nth=-1 >> .x"); pg.click(".modal-root >> nth=0 >> .x")
        # ---- Reports hub & every report opens
        pg.goto(B + "/reports"); pg.wait_for_selector(".rlist"); check("hub has 3 sections: Attendance (8), Outstanding (9), Parent (1)", pg.eval_on_selector_all("section h2", "e=>e.map(x=>x.textContent)") == ["Attendance Reports", "Outstanding Reports", "Parent Reports"] and len(pg.query_selector_all(".rrow")) == 18)
        ids = pg.eval_on_selector_all(".rrow", "e=>e.map(x=>x.getAttribute('href'))"); opened = []
        for href in ids:
            pg.goto(B + href); pg.wait_for_selector("#rv"); pg.wait_for_selector(".card, .alert.bad, .empty", timeout=8000); pg.wait_for_timeout(250)
            if not pg.query_selector(".alert.bad") and len(pg.inner_text("main")) > 80: opened.append(href)
            else: print("   problem:", href, pg.inner_text("main")[:100].replace("\n", " "))
        check("every one of the 18 reports opens without errors", len(opened) == 18, len(opened))
        # outstanding total agrees with the Fees screen
        pg.goto(B + "/reports/out-student"); pg.wait_for_selector(".stats"); check("outstanding by student shows the AED 1,700.00 still owed", "AED 1,700.00" in pg.inner_text("main"))
        pg.goto(B + "/reports/out-payments"); pg.wait_for_selector(".stat"); pg.click("button:has-text('Today')"); pg.wait_for_timeout(600); check("payments received today: 1 payment, AED 850.00, Bank transfer", "1 payment received" in pg.inner_text("main") and "AED 850.00" in pg.inner_text("main") and "Bank transfer" in pg.inner_text("main"))
        with pg.expect_download() as dl: pg.click("text=Download this report")
        d = dl.value; txt = open(d.path(), encoding="utf-8-sig").read(); check("CSV download is named by report and range and has the data", d.suggested_filename.startswith("payments-received-") and "Daniel Perera" in txt and "TT-1001" in txt, d.suggested_filename)
        pg.goto(B + "/reports/att-register"); pg.wait_for_selector("table.reg"); check("attendance register shows P / L / A cells", pg.query_selector_all("td.rg.present") and pg.query_selector_all("td.rg.late") and pg.query_selector_all("td.rg.absent"))
        pg.goto(B + "/reports/att-missing"); pg.wait_for_selector(".card, .empty"); check("classes without attendance lists the finished class", "Chemistry" in pg.inner_text("main") and "Tap a class" in pg.inner_text("main"))
        # ---- Parent report
        pg.goto(B + "/reports/parent"); pg.wait_for_selector(".pr-row"); card = pg.inner_text(".pr-row:has-text('Daniel')")
        check("list card: Daniel, outstanding, attendance", "Daniel Perera" in card and "Outstanding: AED" in card and "of 5" in card.replace("\n", " ") or "classes attended" in card, card.replace("\n", " ")[:160])
        pg.click(".pr-row:has-text('Daniel') >> text=Preview and send"); pg.wait_for_selector(".prv"); box = pg.inner_text(".prv-fee").replace("\n", " ")
        check("fee box = whole month across all 3 subjects: AED 850.00, 3 subjects, status", "AED 850.00" in box and "3 subjects" in box and ("PAID" in box or "PAYMENT DUE" in box or "PARTLY" in box), box)
        pv = pg.inner_text(".prv"); check("preview shows academy, student, summary, outstanding incl. earlier months, all subjects, class table, note", all(x in pv for x in ["Mannu’s Tuition Academy", "Daniel Perera", "Classes held", "Outstanding fees", "All subjects", "Class by class", "Please contact us if you have any questions about this report."]) and pg.query_selector("img").get_attribute("src").startswith("/brand"))
        href = pg.get_attribute("a:has-text('Open PDF')", "href"); data = urllib.request.urlopen(B + href).read(); check("Open PDF serves a real A5 PDF", data[:5] == b"%PDF-" and len(data) > 4000, len(data))
        with pg.expect_download() as dl2: pg.click("a:has-text('Download PDF')")
        check("Download PDF has a clear file name", dl2.value.suggested_filename.startswith("Attendance-Report-Daniel-Perera-Chemistry-"), dl2.value.suggested_filename)
        pg.screenshot(path="/tmp/s2_preview.png")
        pg.click("button:has-text('Record: sent by WhatsApp')"); pg.wait_for_selector("text=Only record this after"); pg.click(".modal-root >> nth=-1 >> .foot .primary"); pg.wait_for_selector(".toast"); pg.wait_for_timeout(700)
        st = pg.inner_text(".modal-root >> nth=0"); check("sent record lists WhatsApp, the number, who and when", "WhatsApp to +971505555555" in st and "Administrator" in st and "Recorded" in st)
        pg.click(".modal-root >> nth=0 >> .x"); pg.wait_for_timeout(500); check("list card now shows ✓ WhatsApp · date · Administrator", "✓ WhatsApp" in pg.inner_text(".pr-row:has-text('Daniel')"))
        # ---- teacher and student
        ctx2 = br.new_context(viewport={"width": 390, "height": 844}); p2 = ctx2.new_page(); p2.goto(B + "/"); p2.wait_for_selector("form"); p2.fill("#email", "t@x.test"); p2.fill("#password", "teachpass1"); p2.click("button.primary"); p2.wait_for_selector("nav.tabs")
        check("teacher: Reports yes, Fees no", "Reports" in p2.inner_text("nav.tabs") and "Fees" not in p2.inner_text("nav.tabs"))
        p2.goto(B + "/reports"); p2.wait_for_selector(".rlist"); check("teacher sees only Attendance Reports", p2.eval_on_selector_all("section h2", "e=>e.map(x=>x.textContent)") == ["Attendance Reports"])
        p2.goto(B + "/reports/out-student"); p2.wait_for_timeout(800); check("teacher cannot open an outstanding report by address", p2.evaluate("location.pathname") == "/reports")
        p2.goto(B + "/reports/parent"); p2.wait_for_timeout(800); check("teacher cannot open parent reports", p2.evaluate("location.pathname") == "/reports")
        ctx3 = br.new_context(viewport={"width": 390, "height": 844}); p3 = ctx3.new_page(); p3.goto(B + "/"); p3.wait_for_selector("form"); p3.fill("#email", "daniel@x.test"); p3.fill("#password", "studentpw1"); p3.click("button.primary"); p3.wait_for_selector("nav.tabs")
        nav = p3.inner_text("nav.tabs"); check("student: Attendance and Fees, no Reports", "Attendance" in nav and "Fees" in nav and "Reports" not in nav, nav.replace("\n", " "))
        p3.goto(B + "/fees"); p3.wait_for_selector("text=My fees"); check("student sees own fees: charged, paid, due", "AED 2,550.00" in p3.inner_text("main") and "AED 850.00" in p3.inner_text("main"))
        p3.goto(B + "/attendance"); p3.wait_for_selector("text=My attendance"); p3.wait_for_timeout(600); check("student sees own attendance", "My attendance" in p3.inner_text("main") and "Classes" in p3.inner_text("main"))
        p3.goto(B + "/reports"); p3.wait_for_timeout(700); check("student cannot open Reports", p3.evaluate("location.pathname") == "/")
        print("page errors:", errs); check("no page errors", not errs)
        br.close()
finally:
    srv.terminate()
    with eng.connect() as c: c.execute(text(f"DROP DATABASE {name}"))
print("STAGE 2 E2E OK" if ok[0] else "STAGE 2 E2E PROBLEMS")
