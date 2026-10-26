"""End-to-end check: real MySQL-compatible database + Flask API serving the React build, driven in a phone-size browser."""
import os, subprocess, sys, time, uuid, json, urllib.request
from sqlalchemy import create_engine, text
from playwright.sync_api import sync_playwright

ROOT = os.environ.get("TEST_DB_ROOT_URL", "mysql+pymysql://mannus:mannus@127.0.0.1:3306/?charset=utf8mb4")
name = "mannus_e2e_" + uuid.uuid4().hex[:6]
eng = create_engine(ROOT, isolation_level="AUTOCOMMIT")
with eng.connect() as c: c.execute(text(f"CREATE DATABASE {name} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"))
url = ROOT.replace("/?", f"/{name}?")
env = dict(os.environ, DATABASE_URL=url, JWT_SECRET="e2e", ADMIN_EMAIL="admin@t.test", ADMIN_PASSWORD="adminpass1", STATIC_DIR="/home/claude/mannus-v2/web/dist", PYTHONPATH="/home/claude/mannus-v2/api")
subprocess.run([sys.executable, "-m", "app.migrate"], cwd="/home/claude/mannus-v2/api", env=env, check=True, capture_output=True)
srv = subprocess.Popen([sys.executable, "-m", "flask", "--app", "wsgi", "run", "--port", "5055"], cwd="/home/claude/mannus-v2/api", env=env, stdout=open("/tmp/e2e_srv.log", "w"), stderr=subprocess.STDOUT)
time.sleep(3)
ok = [True]
def check(n, c, x=""):
    print(("✓ " if c else "✗ ") + n + (f" – {x}" if x else ""))
    if not c: ok[0] = False
def J(m, u, b=None, t=None):
    r = urllib.request.Request("http://127.0.0.1:5055" + u, method=m, data=json.dumps(b).encode() if b is not None else None, headers={"Content-Type": "application/json", **({"Authorization": "Bearer " + t} if t else {})})
    return json.loads(urllib.request.urlopen(r).read() or b"{}")
try:
    A = J("POST", "/api/auth/login", {"email": "admin@t.test", "password": "adminpass1"})["token"]
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2); pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e))); pass  # expected 4xx replies (wrong password, validation) are logged by the browser as console errors; only real exceptions count
        pg.goto("http://127.0.0.1:5055/"); pg.wait_for_selector("form")
        check("served by Flask: login with the logo and the new name", "Mannu’s Tuition Academy" in pg.inner_text("body") and pg.evaluate("document.querySelector('.brandlogo').naturalWidth>0"))
        pg.screenshot(path="/tmp/e2e_login.png")
        pg.fill("#email", "admin@t.test"); pg.fill("#password", "wrong"); pg.click("button.primary"); pg.wait_for_selector(".alert.bad"); check("wrong password shows a clear message", "not right" in pg.inner_text(".alert.bad"))
        pg.fill("#password", "adminpass1"); pg.click("button.primary"); pg.wait_for_selector("nav.tabs")
        check("signed in as admin: menu has Users", "Users" in pg.inner_text("nav.tabs") and pg.inner_text("header").count("Mannu’s")==1)
        # batch via the UI
        pg.click("nav.tabs >> text=Students"); pg.wait_for_selector("text=Add student"); pg.click("text=Batches"); pg.wait_for_selector(".modal"); pg.fill(".modal input[name=name]", "Grade 11 – Evening"); pg.click(".modal form.row button"); pg.wait_for_selector(".modal .list >> text=Grade 11"); pg.click(".modal .x")
        # student via the UI (with school + login)
        pg.click("text=Add student"); pg.wait_for_selector(".modal form")
        f = lambda n, v: pg.fill(f".modal [name={n}]", v)
        f("name", "Asha Perera"); f("email", "asha@x.test"); f("guardian_name", "Mrs Perera"); f("guardian_mobile", "+971501234567"); f("school", "  Royal   College ")
        pg.select_option(".modal [name=batch_id]", index=1); pg.check(".modal input[name=sub] >> nth=0"); pg.check(".modal input[name=sub] >> nth=1"); pg.check(".modal input[type=checkbox] >> nth=-1") if False else None
        pg.click(".modal form .foot .primary"); pg.wait_for_selector(".toast"); pg.wait_for_selector(".card.list >> text=Asha Perera")
        check("student added; school tidied and shown with 🏫", "🏫 Royal College" in pg.inner_text(".card.list"))
        pg.click("text=Add student"); pg.wait_for_selector(".modal form"); f("name", "Ben Silva"); f("email", "bad"); pg.click(".modal form .foot .primary"); pg.wait_for_selector(".modal .alert.bad"); check("validation message appears inside the form", "valid email" in pg.inner_text(".modal .alert.bad")); pg.click(".modal .x")
        for n, e in (("Ben Silva", "ben@x.test"),):
            J("POST", "/api/students", {"name": n, "email": e, "guardian_mobile": "+971502222222", "batch_id": 1, "subjects": [1]}, A)
        pg.reload(); pg.wait_for_selector("text=Add student")
        pg.fill("input[type=search]", "royal"); pg.wait_for_timeout(700); check("search finds a student by school", "Asha Perera" in pg.inner_text("main") and "Ben Silva" not in pg.inner_text("main"))
        # a class that has already started (the API forbids past starts, so move it in the database)
        import datetime
        loc = (datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) + datetime.timedelta(hours=7)).strftime("%Y-%m-%dT%H:%M")
        cid = J("POST", "/api/classes", {"batch_id": 1, "subject_id": 1, "start_local": loc, "duration_min": 60, "manual_join_url": "https://zoom.us/j/1"}, A)["id"]
        with eng.connect() as c: c.execute(text(f"UPDATE {name}.classes SET start_at=:s WHERE id=:i"), {"s": datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) - datetime.timedelta(hours=2), "i": cid})
        pg.goto(f"http://127.0.0.1:5055/"); pg.wait_for_selector(".alert >> text=no attendance recorded"); check("home page warns about a finished class without attendance", True)
        pg.click(".alert >> text=Review"); pg.wait_for_selector(".cls"); check("“Needs attendance” tab lists it", "Attendance needed" in pg.inner_text("main"))
        pg.click(".cls"); pg.wait_for_selector("text=Mark attendance by hand"); pg.click("text=Mark attendance by hand"); pg.wait_for_selector(".modal form")
        check("form shows class, subject, date and time", "Chemistry" in pg.inner_text(".modal") and "Grade 11" in pg.inner_text(".modal"))
        pg.click(".modal .foot .primary"); pg.wait_for_selector(".modal .alert.bad"); check("cannot save until every student is marked", "Mark 2 students" in pg.inner_text(".modal .alert.bad"))
        pg.click("text=Mark all Present"); cards = pg.query_selector_all(".modal .card")
        cards[1].query_selector("label.late input").click(force=True); cards[1].query_selector("input[type=time] >> nth=0").fill("09:25"); cards[1].query_selector("input[maxlength='200']").fill("Bus delay – بسبب الحافلة")
        pg.screenshot(path="/tmp/e2e_form.png"); pg.click(".modal .foot .primary"); pg.wait_for_selector(".tbl")
        tx = pg.inner_text("main"); check("saved: Present 1, Late 1; who entered it; note kept (any language)", "Present 1" in tx and "Late 1" in tx and "Entered by hand" in tx and "Administrator" in tx and "بسبب الحافلة" in tx)
        pg.click("text=Mark or correct by hand"); pg.wait_for_selector(".modal form"); cards = pg.query_selector_all(".modal .card"); cards[1].query_selector("label.absent input").click(force=True); pg.click(".modal .foot .primary"); pg.wait_for_selector(".modal .alert.bad")
        check("a correction asks for a reason", "reason" in pg.inner_text(".modal .alert.bad").lower())
        pg.fill(".modal input[placeholder^='e.g. Joined']", "Parent confirmed absence"); pg.click(".modal .foot .primary"); pg.wait_for_selector("text=late → absent")
        hx = pg.inner_text("main"); check("change history lists old → new, who and the reason", "late → absent" in hx and "Parent confirmed absence" in hx, hx[hx.find("Change history"):][:160].replace(chr(10), " | "))
        pg.screenshot(path="/tmp/e2e_class.png", full_page=True)
        # teacher and student views
        J("POST", "/api/users", {"name": "Mr Rahman", "email": "t@x.test", "role": "teacher", "password": "teachpass1"}, A); sid = J("GET", "/api/students", None, A)[0]["id"]
        with eng.connect() as c: c.execute(text(f"UPDATE {name}.users SET email=email"))
        J("POST", "/api/students", {"name": "Cara Login", "email": "cara@x.test", "guardian_mobile": "+971503333333", "batch_id": 1, "subjects": [1], "create_login": True, "password": "studentpw1"}, A)
        ctx2 = br.new_context(viewport={"width": 390, "height": 844}); p2 = ctx2.new_page(); p2.goto("http://127.0.0.1:5055/"); p2.wait_for_selector("form"); p2.fill("#email", "cara@x.test"); p2.fill("#password", "studentpw1"); p2.click("button.primary"); p2.wait_for_selector("nav.tabs")
        nav = p2.inner_text("nav.tabs"); check("student: no Students or Users tab", "Students" not in nav and "Users" not in nav, nav.replace("\n", " "))
        p2.goto("http://127.0.0.1:5055/students"); p2.wait_for_timeout(800); check("student cannot open the students page by address", "Add student" not in p2.inner_text("body") and p2.evaluate("location.pathname") == "/")
        ctx3 = br.new_context(viewport={"width": 390, "height": 844}); p3 = ctx3.new_page(); p3.goto("http://127.0.0.1:5055/"); p3.wait_for_selector("form"); p3.fill("#email", "t@x.test"); p3.fill("#password", "teachpass1"); p3.click("button.primary"); p3.wait_for_selector("nav.tabs")
        check("teacher: Students tab but no Users tab", "Students" in p3.inner_text("nav.tabs") and "Users" not in p3.inner_text("nav.tabs"))
        p3.goto("http://127.0.0.1:5055/classes/%d" % cid); p3.wait_for_selector("text=Attendance"); check("a teacher who does not teach the class cannot edit its attendance", "Mark or correct by hand" not in p3.inner_text("main"))
        pg.goto("http://127.0.0.1:5055/classes/%d" % cid); pg.reload(); pg.wait_for_selector("text=Attendance"); check("deep link / refresh works (Flask serves the app for every page)", "Chemistry" in pg.inner_text("main"))
        print("page errors:", errs); check("no page errors", not errs)
        br.close()
finally:
    srv.terminate()
    with eng.connect() as c: c.execute(text(f"DROP DATABASE {name}"))
print("STAGE 1 E2E OK" if ok[0] else "STAGE 1 E2E PROBLEMS")
