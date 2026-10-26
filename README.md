# Mannu’s Tuition Academy – version 2 (Flask + React + Node.js + MySQL)

This is the new platform, built in stages. The earlier single-server version (Node.js + SQLite) keeps working until each part has been moved across.

| Part | Technology | Job |
|---|---|---|
| **Database** | **MySQL 8** (utf8mb4; MariaDB 10.5+ also works) | one source of truth for both services |
| **`api/`** | **Python, Flask**, SQLAlchemy + PyMySQL | the core: sign-in, students, batches, classes, attendance (stage 2: fees, Zoom, all reports, the parent PDF) |
| **`web/`** | **React + TypeScript** (Vite) | the mobile-first app; in production Flask serves the built files |
| **`integrations/`** | **Node.js + TypeScript** | WhatsApp, YouTube recordings, Instagram Reels and video processing (stages 3–4) |

## How the pieces fit
```
 phone / browser ──► Flask API (Python) ──► MySQL ◄── Node.js integrations
        ▲                    │                              │  WhatsApp · YouTube · Instagram · ffmpeg
        └── React app ◄──────┘  serves the built app        └─ workers read "outbox" rows and send them
```
* **One sign-in.** Flask issues the token; the Node service accepts the same token (same `JWT_SECRET`) and re-checks the account in MySQL on each request.
* **Flask never calls WhatsApp, Instagram or YouTube.** It writes a row (for example a message to send); a Node worker picks it up, sends it and records the result. If an outside service is down, nothing is lost and the Flask API stays fast.
* **Times are stored in UTC** and shown in the academy time zone (`ACADEMY_TZ`). Notes and names are stored as utf8mb4, so every language works.

## Stages
1. **Stage 1 – done:** MySQL schema and migrations · Flask API: sign-in, roles, teachers, batches, students (school name, search, filters), classes, **manual attendance (Present / Late / Absent) with notes, who-entered/changed audit and Zoom data beside it**, pending attendance, dashboard · React + TypeScript app for all of that · Node.js service skeleton with shared sign-in · Docker · tests.
2. **Stage 2 – done (this package):** fees (rates per subject / batch / student, monthly generation, manual charges), payments and numbered receipts, other-currency payments with an exchange rate, cancel-with-reason · **Zoom** (creates the meeting, reads who joined, never overwrites what staff entered) · the **Reports tab** (8 attendance reports, 9 outstanding / payment reports, CSV for each) · the **parent monthly PDF** (preview, download, sent record) · student pages for their own attendance and fees.
3. **Stage 3:** Node: WhatsApp (queue, templates, delivery status, sending the parent report), learning resources, YouTube recordings.
4. **Stage 4:** Node: Instagram Reels (clips, subtitles, approvals, publishing, numbers) and the consent register.
5. **Stage 5:** move your existing data from the old SQLite database into MySQL, switch over, retire the old server.

## Run it
### With Docker (simplest)
```
cp .env.example .env     # fill in JWT_SECRET, MYSQL_PASSWORD, MYSQL_ROOT_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD, and the two DATABASE_URL lines
docker compose up --build
```
Open http://localhost:8080 and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Use an https reverse proxy (Caddy, nginx) for a real server.

### For development
```
# 1. MySQL (any 8.x) with an empty database and user, then:
cd api && python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
export DATABASE_URL='mysql+pymysql://USER:PASS@127.0.0.1:3306/mannus?charset=utf8mb4' JWT_SECRET=dev ADMIN_PASSWORD=adminpass1
python -m app.migrate                       # creates / updates the tables
flask --app wsgi run --port 5000            # the API
# 2. the app
cd ../web && npm install && npm run dev     # http://localhost:5173 (forwards /api to :5000)
# 3. the Node service (optional until stage 3)
cd ../integrations && npm install && DATABASE_URL_NODE='mysql://USER:PASS@127.0.0.1:3306/mannus' JWT_SECRET=dev npm run dev
```

## Tests
```
cd api && python -m pytest -q                   # 27 API tests against a real MySQL-protocol server (needs a user that can create databases; `pdftotext` is used to read the PDFs)
cd web && npm run build                         # type-checks (TypeScript strict) and builds
cd integrations && npm test                     # 4 tests, shared sign-in and database
cd e2e && python browser_test.py                # stage 1 flows in a real phone-size browser: Flask + MySQL + React
cd e2e && python browser_test_stage2.py         # stage 2 flows: fees, receipts, all 18 reports, the parent report, role limits
```
Set `TEST_DB_ROOT_URL` (for example `mysql+pymysql://USER:PASS@127.0.0.1:3306/?charset=utf8mb4`) if your test database is not the default.

## Database changes
SQL files in `db/migrations/` are applied in order by `python -m app.migrate` (the Docker image runs it on every start) and recorded in `schema_migrations`. To change the database, add a new numbered file; never edit one that has been applied.

## Fees, payments and reports (stage 2)
* **Rates:** set a monthly fee per subject; override for one batch or one student (most specific wins). **Generate fees** creates one fee per active student and subject for a month and never duplicates.
* **Payments** are applied to the oldest unpaid fee first. Overpaying shows as credit. A payment made in another currency is credited at the exchange rate you enter. Cancelling a payment needs a reason and is kept on record. Receipts are numbered `MTA-YEAR-00001`.
* **Reports** (admins see all; teachers only the attendance ones): the attendance, outstanding-fee and payment reports read the same data as the screens, so the numbers always agree.
* **Parent monthly report:** a two-to-three page A5 PDF with the academy name and logo, the student, subject and month, the class-by-class table (Present / Absent / Class cancelled; late shows as “Present (late)”), the summary, the **month’s fee across every subject** with its payment status, and **every unpaid fee including earlier months** with a total. You preview it, download it, send it yourself by WhatsApp or email (the message is prepared), and record that it was sent. Automatic sending comes in stage 3.
* **Zoom:** with the three `ZOOM_*` settings, scheduling a class creates the Zoom meeting. After the class, **Read attendance from Zoom** (or run `flask --app wsgi sync-zoom` every few minutes from cron) fills the sheet. People who joined with an unknown email are listed, not counted. Anything staff entered by hand is never changed; Zoom’s own record stays beside it for comparison.

## What attendance does (stage 1)
* Staff (admins, and the teacher of that class) mark every student **Present, Late or Absent**, with optional arrival and leaving times and a note, once the class has started.
* Every first entry and every correction is stored with who, when, old and new value and the reason (a reason is required only when something really changes). Saving an untouched form changes nothing.
* Zoom’s own record is kept in its own table (`attendance_zoom`) so it can be compared with what staff entered. It is filled in stage 2.
* Present and Late both count as attended.
* Students see only their own result.

## Security notes
* Passwords are stored as bcrypt hashes. Sign-in is rate-limited per address and email (set a limit at your proxy too).
* Every API route checks the role on the server; the React app only hides what a person may not use.
* Keep `.env` private. Never commit it.
