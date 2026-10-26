# Mannu’s Tuition Academy — Next.js + PostgreSQL

The same app as `Mannu’s Tuition Academy.html`, rebuilt as a normal web app on **your own PostgreSQL** — local on your PC now, on an **Oracle Cloud (OCI)** server later. No Supabase, no Vercel: one Node app, one Postgres database, one folder of files.

It also adds the automatic video flow:

> **record a class → saved to YouTube → 60-second vertical clip → published on Instagram**

## What is in it

| Area | Features |
|---|---|
| **Home** | today’s classes, attendance today, outstanding fees, classes with no attendance, upcoming notifications |
| **Students** | search / filter by batch, subject, school · add / edit · batches · students-by-school report (CSV) · fee currency · Zoom login email |
| **Classes** | schedule / reschedule / cancel · Zoom link · attendance by hand (Present / Late / Absent, times, notes, correction reason) · **Zoom participants CSV import** with matching and “compare with Zoom” · change history · study materials per class |
| **Reports** | 8 attendance + 9 fee/payment reports (filters, CSV) · **parent monthly report** (preview, A5 PDF, WhatsApp / email, “sent” record) |
| **Fees** | rates per subject / batch / currency · generate monthly fees (never duplicates) · numbered receipts `MTA-YEAR-00001`, other-currency payments, void with reason · balances, overdue, credit · reminders |
| **Resources** | library of links with filters, tags, history, remove / restore, WhatsApp sharing |
| **WhatsApp** | click-to-chat outbox for class details, reminders, changes, cancellations, fee reminders, receipts, announcements · message log |
| **Reels** | drafts → approval → Instagram · consent register · captions · names/numbers hidden when copying · insights and CSV |
| **Setup** | academy settings, currencies, time zone · teachers/admins · video pipeline · backup (JSON) |
| **Roles** | **Admin**: everything. **Teacher**: classes, attendance, WhatsApp, resources, Reel drafts — never fees, payments, approvals or consent (enforced inside the database) |

Not carried over: the “find key moments from a transcript” button (it used Claude inside the old page and needs an API key).

## How it is built

```
 browser ──► Next.js server (Node) ──► PostgreSQL        (all records, accounts, row level security)
                    │
                    ├──► disk folder STORAGE_DIR          (class recordings, cut clips)
                    ├──► ffmpeg                           (cuts the clip)
                    └──► YouTube API · Instagram API      (publishing)
       background worker inside the same server: checks for video work every minute
```

* **Security lives in Postgres.** The browser never sends SQL; it sends a small query description. The server checks the table and column names against the real database, runs the query as the signed-in person inside a transaction (`SET LOCAL ROLE authenticated`) and the **row level security** policies in `db/migrations/0002_…sql` decide what is allowed.
* **Accounts** are rows in `auth.users` (bcrypt hashes) with signed 7-day tokens. There is no public sign-up; admins create accounts in Setup.
* **Money is whole minor units**, receipts are numbered inside the database, attendance and payments are saved by SQL functions so nothing is half-written.
* **The video pipeline survives restarts.** It is a state machine over the `recordings` table: the YouTube upload goes in 8 MB pieces and resumes at the same byte; Instagram processing is polled; a crash can never publish twice.

## Run it on your PC (about 10 minutes)

You need Node 20+, PostgreSQL (you have it) and, for the video clip, nothing else (ffmpeg comes with the app).

1. **Create the database** in pgAdmin: Databases → Create → Database → `mannu_academy`.
2. **Configure**: `.env.local` is already created for you with a random `JWT_SECRET`. Put your Postgres password in `DATABASE_URL`:
   `DATABASE_URL=postgres://postgres:YOURPASSWORD@127.0.0.1:5432/mannu_academy`
3. **Install and create the tables**
   ```bash
   npm install
   npm run migrate
   ```
4. **Create the first admin**
   ```bash
   npm run create-admin -- you@example.com "A strong password" "Your Name"
   ```
5. **Start**
   ```bash
   npm run dev          # http://localhost:3000
   ```
   Sign in, open **Setup**, and fill in the academy settings.

Want a look around with fake data and no database? `npm run dev:mock` (http://localhost:3100).

## Put it on Oracle Cloud (OCI) later

The app is a normal Node server, so anything that runs Node works. A good fit is an **OCI Compute VM** (the Always Free ARM “Ampere A1” shape is enough; Ubuntu 22.04/24.04):

1. **Postgres** — either install it on the VM (`sudo apt install postgresql`) or use OCI’s managed *Database with PostgreSQL*. Create the database, then move your data if you want it: `pg_dump mannu_academy > academy.sql` on the PC and `psql … < academy.sql` on the server (or just start fresh with `npm run migrate`).
2. **Node + the app**
   ```bash
   sudo apt install -y nodejs npm ffmpeg git nginx     # Node 20+ (use nodesource if apt is older)
   git clone <your repo> && cd Academy/vercel-supabase
   cp .env.example .env.local        # fill in DATABASE_URL, JWT_SECRET (new random), NEXT_PUBLIC_SITE_URL=https://your-domain …
   npm ci && npm run migrate && npm run build
   npm run create-admin -- you@example.com "password" "Name"
   ```
   On ARM, point the app at the system ffmpeg: add `FFMPEG_PATH=/usr/bin/ffmpeg` to `.env.local`.
3. **Keep it running** with systemd (`/etc/systemd/system/academy.service`):
   ```ini
   [Unit]
   Description=Mannu's Academy
   After=network.target postgresql.service
   [Service]
   WorkingDirectory=/home/ubuntu/Academy/vercel-supabase
   ExecStart=/usr/bin/npm start
   Restart=always
   User=ubuntu
   Environment=NODE_ENV=production
   [Install]
   WantedBy=multi-user.target
   ```
   `sudo systemctl enable --now academy`
4. **HTTPS with nginx** (needed for Instagram, Google sign-in and camera/screen recording). Point your domain at the VM’s public IP, then:
   ```nginx
   server {
     server_name academy.example.com;
     client_max_body_size 16m;            # the app uploads recordings in 8 MB pieces
     location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $remote_addr; proxy_read_timeout 600s; }
   }
   ```
   `sudo certbot --nginx -d academy.example.com`
5. **OCI network**: open ports 80 and 443 in the VCN security list **and** in the VM firewall (`sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT`, or `ufw`). Keep Postgres closed to the internet.
6. **Disk**: recordings are big. Put `STORAGE_DIR` on a block volume with room (the app deletes each original a few days after publishing — Setup → Video pipeline). Back up the database (`pg_dump`) and, if you want to keep them, the clips.

## Connect YouTube and Instagram

### YouTube
1. Google Cloud → new project → enable **YouTube Data API v3**.
2. OAuth consent screen → External → scopes `youtube.upload` and `youtube.readonly`. **Publish the app (“In production”)** — in “Testing” Google expires the connection every 7 days.
3. Credentials → OAuth client ID → *Web application* → redirect URI `<NEXT_PUBLIC_SITE_URL>/api/integrations/youtube/callback` (also shown in Setup). Put the id and secret in `.env.local`, restart.
4. Setup → Video pipeline → **Connect YouTube**.

New API projects can upload only as *private* until Google audits them (free form: “YouTube API Services – Audit and Quota Extension”). Each upload costs 1,600 of 10,000 daily quota units.

### Instagram
1. The account must be **Professional** (Business/Creator) and linked to a **Facebook Page**.
2. developers.facebook.com → create an app → add *Instagram* (API with Facebook Login). Add yourself as admin/tester — a development-mode app can publish to accounts you manage.
3. Graph API Explorer: grant `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, make a **long-lived** user token, then read the **Page access token** (`GET /me/accounts`; it does not expire). Get the Instagram account id with `GET /{page-id}?fields=instagram_business_account`.
4. Setup → Video pipeline → paste the **account id** and **Page access token**.

Instagram fetches the clip from `NEXT_PUBLIC_SITE_URL`, so on your PC it only works through a public address (use OCI, or a tunnel while testing).

### Zoom (optional, makes it fully automatic)
Zoom Marketplace → *Server-to-Server OAuth* app, scope `cloud_recording:read:admin`, event `recording.completed` → `<site>/api/webhooks/zoom`. Set the four `ZOOM_*` values. (Not tested against live Zoom.)

## Using the video flow

**Reels → Recordings → New recording**: pick the class, record in the browser (camera or screen) or upload a file, say whether any student appears, save. The file uploads to the server in resumable pieces, then the app shows *Upload → YouTube → 60-second clip → Instagram*. Settings in **Setup → Video pipeline**: publishing mode (*Automatic*, *Needs approval*, *Off*), YouTube visibility, clip length and start, how long to keep the original.

**Students and consent.** A clip with a student in it is **never posted to Instagram until consent is recorded** for every student who appears (Reels → Consent), even in automatic mode. It waits, shows why, and goes out by itself once consent is saved.

**If something fails** the card shows why and retries with growing delays, then asks for attention with a *Try again* button. Problems that cannot fix themselves (not connected, token expired) stop at once and say what to do. Instagram numbers refresh automatically every six hours.

## Tests

```bash
npm test             # 60 tests: fees, Zoom import, parent report, reels rules, the pipeline (with fakes), real ffmpeg cut, files on disk,
                     # and — when a Postgres is reachable — the real server code, accounts and row level security
npm run test:db      # applies the migrations to a throw-away database and checks the security rules, receipts, attendance, pipeline lease
npx tsc --noEmit     # type check
```
The database tests need a server where you can create databases: `TEST_DATABASE_URL=postgres://postgres:PASSWORD@127.0.0.1:5432/postgres npm test`.

## Limits worth knowing

* YouTube, Instagram and Zoom could not be tried against the live services; the logic is covered with fakes. Expect small account-setup fixes the first time (permissions, quota, audit).
* The app must run as a **long-lived Node server** (`npm start`, systemd, pm2) because the video worker lives inside it. It will not work on serverless hosting.
* Browser recording keeps the video in the open tab until you save — for a full-length class record in Zoom (cloud) or your usual recorder and upload the file.
* WhatsApp messages open in WhatsApp for staff to send (no WhatsApp Business API), exactly like the original page.
* There is no “forgot password” e-mail; an admin sets a new password in Setup (people can change their own with the **Password** button).
* The older Flask/MySQL version in `../` is untouched.
