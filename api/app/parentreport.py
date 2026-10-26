"""Parent-friendly monthly attendance report: its data (one student, one subject, one month) and the A5 PDF."""
from __future__ import annotations

import hashlib
import io
import json
import os
from datetime import datetime, timedelta, timezone

from flask import current_app
from reportlab.lib.colors import HexColor, white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas

from . import db, fees as engine
from .db import iso, now_utc
from .money import dp, from_minor
from .util import HttpError, local_date, month_bounds, today_local, utc_to_local

ASSETS = os.path.join(os.path.dirname(__file__), "..", "assets")
NOTE = "Please contact us if you have any questions about this report."
STATUS = {"present": "Present", "late": "Present (late)", "absent": "Absent", "cancelled": "Class cancelled", "not_recorded": "Not recorded", "upcoming": "Upcoming"}
COLORS = {"present": "#15803d", "late": "#15803d", "absent": "#b91c1c", "cancelled": "#6b7280", "not_recorded": "#b45309", "upcoming": "#6b7280"}
FEE_LABEL = {"paid": "PAID", "part": "PARTLY PAID", "due": "PAYMENT DUE", "not_billed": "NOT YET RECORDED"}
FEE_COLOR = {"paid": "#15803d", "part": "#b45309", "due": "#b91c1c", "not_billed": "#6b7280"}
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def drawable(ch: str) -> bool:
    c = ord(ch)
    return 0x20 <= c <= 0x24F or 0x300 <= c <= 0x4FF or 0x2000 <= c <= 0x206F or 0x20A0 <= c <= 0x20CF or 0x2100 <= c <= 0x21FF or c == 0xA0


def month_label(m: str) -> str:
    y, mo = m.split("-")
    return f"{FULL[int(mo) - 1]} {y}"


def short_month(m: str) -> str:
    y, mo = m.split("-")
    return f"{MON[int(mo) - 1]} {y}"


def date_label(dt: datetime) -> str:
    d = utc_to_local(dt)
    return f"{WD[d.weekday()]}, {d.day} {MON[d.month - 1]} {d.year}"


def time_label(dt: datetime) -> str:
    d = utc_to_local(dt)
    h = d.hour % 12 or 12
    return f"{h}:{d.minute:02d} {'am' if d.hour < 12 else 'pm'}"


def build(c, student_id: int, subject_id: int, month: str) -> dict:
    cfg = current_app.config
    st = db.one(c, "SELECT s.*, b.name AS batch FROM students s JOIN batches b ON b.id=s.batch_id WHERE s.id=:i", i=student_id)
    if not st:
        raise HttpError(404, "Student not found.")
    sub = db.one(c, "SELECT x.id, x.name FROM subjects x JOIN student_subjects ss ON ss.subject_id=x.id WHERE ss.student_id=:s AND x.id=:x", s=student_id, x=subject_id)
    if not sub:
        raise HttpError(400, "That student is not enrolled in that subject.")
    try:
        start, end = month_bounds(month)
    except Exception:
        raise HttpError(400, "Choose a month.")
    now = now_utc()
    classes = db.rows(c, """SELECT c.*, u.name AS teacher_name FROM classes c LEFT JOIN users u ON u.id=c.teacher_id WHERE c.batch_id=:b AND c.subject_id=:x AND c.status IN ('scheduled','cancelled')
        AND c.start_at>=:s AND c.start_at<:e ORDER BY c.start_at""", b=st["batch_id"], x=sub["id"], s=start, e=end)
    att = {a["class_id"]: a for a in db.rows(c, "SELECT * FROM attendance WHERE student_id=:s", s=student_id)}
    rows = []
    for cl in classes:
        a = att.get(cl["id"])
        if cl["status"] == "cancelled":
            status = "cancelled"
        elif a:
            status = a["status"]
        elif cl["attendance_taken_at"]:
            continue                                            # attendance was taken but this student was not on the list (joined the batch later)
        else:
            status = "not_recorded" if cl["start_at"] + timedelta(minutes=cl["duration_min"]) < now else "upcoming"
        rows.append({"class_id": cl["id"], "date": date_label(cl["start_at"]), "day": local_date(cl["start_at"]), "time": time_label(cl["start_at"]), "status": status, "label": STATUS[status],
                     "note": cl["cancel_reason"] if status == "cancelled" else ((a or {}).get("note") or "" if status == "late" else "")})
    cnt = lambda k: sum(1 for r in rows if r["status"] == k)
    held, attended = cnt("present") + cnt("late") + cnt("absent"), cnt("present") + cnt("late")
    summary = {"planned": 12, "scheduled": len(rows), "held": held, "attended": attended, "missed": cnt("absent"), "late": cnt("late"), "cancelled": cnt("cancelled"), "pending": cnt("not_recorded") + cnt("upcoming"),
               "not_recorded": cnt("not_recorded"), "upcoming": cnt("upcoming"), "percent": round(attended * 1000 / held) / 10 if held else None}
    # ----- fees: this month across every subject, plus everything still unpaid -----
    f = engine.status(c, student_id, today_local())
    cur = f["currency"]
    std = float(os.environ.get("REPORT_MONTHLY_FEE", 250))
    classes_per_month = int(os.environ.get("REPORT_CLASSES_PER_MONTH", 12))
    summary["planned"] = classes_per_month
    subs_all = db.rows(c, "SELECT x.id, x.name FROM subjects x JOIN student_subjects ss ON ss.subject_id=x.id WHERE ss.student_id=:s ORDER BY x.name", s=student_id)
    names = {r["id"]: r["name"] for r in db.rows(c, "SELECT id, name FROM subjects")}
    month_fees = []
    for es in subs_all:
        ln = next((x for x in f["lines"] if x["period"] == month and x["subject_id"] == es["id"]), None)
        stt = "not_billed" if not ln else "paid" if ln["outstanding_minor"] <= 0 else "part" if ln["paid_minor"] > 0 else "due"
        month_fees.append({"subject_id": es["id"], "subject": es["name"], "current": es["id"] == sub["id"], "billed": bool(ln),
                           "amount": from_minor(ln["amount_minor"], cur) if ln else (std if es["id"] == sub["id"] and cur == cfg["DEFAULT_CURRENCY"] else None),
                           "outstanding": from_minor(ln["outstanding_minor"], cur) if ln else None, "due_date": ln["due_date"].isoformat() if ln and ln["outstanding_minor"] > 0 else None, "state": stt, "label": FEE_LABEL[stt]})
    cur_line = next((m for m in month_fees if m["current"]), None)
    r2 = lambda x: round(x, 2)
    withamt, billed = [m for m in month_fees if m["amount"] is not None], [m for m in month_fees if m["billed"]]
    owed_m, paid_m = r2(sum(m["outstanding"] for m in billed)), r2(sum(m["amount"] - m["outstanding"] for m in billed))
    st_m = "not_billed" if not billed else "paid" if owed_m <= 0 else "part" if paid_m > 0 else "due"
    dues = sorted(m["due_date"] for m in billed if m["due_date"])
    today = today_local()
    olines = sorted(({"period": (x["period"] or x["due_date"].isoformat()[:7]), "subject": names.get(x["subject_id"], "Other"), "outstanding": from_minor(x["outstanding_minor"], cur), "due_date": x["due_date"].isoformat(), "overdue": x["due_date"] < today}
                     for x in f["lines"] if x["outstanding_minor"] > 0), key=lambda x: (x["period"], x["subject"]))
    for x in olines:
        x["period_label"] = short_month(x["period"]); x["when"] = "previous" if x["period"] < month else "this" if x["period"] == month else "later"
    ssum = lambda w: r2(sum(x["outstanding"] for x in olines if not w or x["when"] == w))
    fee = {"currency": cur, "classes": classes_per_month, "billed": bool(cur_line and cur_line["billed"]), "amount": cur_line["amount"] if cur_line else None, "state": cur_line["state"] if cur_line else "not_billed",
           "label": cur_line["label"] if cur_line else FEE_LABEL["not_billed"], "month_fees": month_fees,
           "month": {"subjects": len(withamt), "enrolled": len(month_fees), "billed": len(billed), "total": r2(sum(m["amount"] for m in withamt)), "paid": paid_m, "outstanding": owed_m, "state": st_m, "label": FEE_LABEL[st_m], "due_date": dues[0] if dues else None},
           "owed": {"currency": cur, "total": ssum(None), "previous": ssum("previous"), "this_month": ssum("this"), "later": ssum("later"), "lines": olines, "as_of": today.isoformat()}}
    data = {"academy": cfg["ACADEMY_NAME"], "contact": os.environ.get("ACADEMY_CONTACT", ""), "month": month, "month_label": month_label(month), "student": {"id": st["id"], "name": st["name"], "batch": st["batch"]},
            "subject": {"id": sub["id"], "name": sub["name"]}, "teacher": next((x["teacher_name"] for x in classes if x["teacher_name"]), ""), "rows": rows, "summary": summary, "fee": fee, "note": NOTE}
    data["hash"] = hashlib.sha256(json.dumps(data, sort_keys=True, default=str).encode()).hexdigest()[:20]
    data["generated_at"] = iso(now)
    data["generated_label"] = date_label(now)
    return data


def warnings(d: dict) -> list[str]:
    w, s = [], d["summary"]
    if not d["rows"]:
        w.append("No classes were found for this student and subject in this month.")
    if s["not_recorded"]:
        w.append(f"{s['not_recorded']} {'class has' if s['not_recorded'] == 1 else 'classes have'} no attendance recorded yet. It will show as “Not recorded” in the report.")
    if s["upcoming"]:
        w.append(f"{s['upcoming']} {'class has' if s['upcoming'] == 1 else 'classes have'} not taken place yet. It will show as “Upcoming”.")
    if not d["fee"]["billed"]:
        w.append("No fee has been generated for this month, so the payment status shows “Not yet recorded”. Generate the month’s fees in Fees first if you want it to show.")
    if d["fee"]["amount"] is None:
        w.append("The student is billed in a different currency, so the fee amount cannot be shown until a fee is generated.")
    bad = sorted({ch for ch in d["student"]["name"] + d["subject"]["name"] + d["student"]["batch"] if not drawable(ch)})
    if bad:
        w.append(f"Some characters in the name ({' '.join(bad[:5])}) cannot be drawn in the PDF and may appear as empty boxes.")
    return w


# ------------------------------------------------------------------ PDF (A5 portrait, large type, one clear column)
_fonts = False


def _register():
    global _fonts
    if not _fonts:
        pdfmetrics.registerFont(TTFont("R", os.path.join(ASSETS, "DejaVuSans.ttf")))
        pdfmetrics.registerFont(TTFont("B", os.path.join(ASSETS, "DejaVuSans-Bold.ttf")))
        _fonts = True


W, H, M = 419.53, 595.28, 26.0
CW = W - 2 * M
NAVY, GOLD, INK, GREY, LINE = "#1c2b45", "#c8921b", "#1a2233", "#5b6577", "#d8dee9"


class Numbered(rl_canvas.Canvas):
    """Draws 'Page x of y' once the page count is known."""

    def __init__(self, *a, prepared="", **k):
        super().__init__(*a, **k)
        self._states, self._prepared = [], prepared

    def showPage(self):
        self._states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        n = len(self._states)
        for st in self._states:
            self.__dict__.update(st)
            self.setStrokeColor(HexColor(LINE)); self.setLineWidth(0.5); self.line(M, 32, W - M, 32)
            self.setFillColor(HexColor("#8b95a7")); self.setFont("R", 7.5)
            self.drawString(M, 21, f"Prepared on {self._prepared}"); self.drawRightString(W - M, 21, f"Page {self._pageNumber} of {n}")
            super().showPage()
        super().save()


def money_txt(v: float, cur: str) -> str:
    return f"{cur} {v:,.{dp(cur)}f}"


def build_pdf(d: dict) -> bytes:
    _register()
    buf = io.BytesIO()
    cv = Numbered(buf, pagesize=(W, H), prepared=d["generated_label"])
    cv.setTitle(f"Monthly Attendance Report – {d['student']['name']} – {d['month_label']}"); cv.setAuthor(d["academy"]); cv.setSubject(f"{d['subject']['name']}, {d['month_label']}")
    LIMIT = H - 44
    y = [0.0]

    def T(txt, x, top, size=10, bold=False, color=INK, align="l", width=None):
        txt = str(txt)
        cv.setFont("B" if bold else "R", size); cv.setFillColor(HexColor(color))
        if width:
            while len(txt) > 1 and pdfmetrics.stringWidth(txt, "B" if bold else "R", size) > width:
                txt = txt[:-2] + "…"
        yy = H - top - size * 0.8
        {"l": cv.drawString, "r": cv.drawRightString, "c": cv.drawCentredString}[align](x, yy, txt)

    def rect(x, top, w, h, fill=None, stroke=None, r=0):
        if fill: cv.setFillColor(HexColor(fill))
        if stroke: cv.setStrokeColor(HexColor(stroke)); cv.setLineWidth(1)
        (cv.roundRect if r else cv.rect)(*( (x, H - top - h, w, h, r) if r else (x, H - top - h, w, h) ), fill=1 if fill else 0, stroke=1 if stroke else 0)

    def hline(top, color="#e3e8f0"):
        cv.setStrokeColor(HexColor(color)); cv.setLineWidth(0.5); cv.line(M, H - top, M + CW, H - top)

    def para(txt, x, top, size, color, width, lh):
        words, line, n = txt.split(), "", 0
        for w_ in words:
            t = (line + " " + w_).strip()
            if pdfmetrics.stringWidth(t, "R", size) > width and line:
                T(line, x, top + n * lh, size, False, color); n += 1; line = w_
            else:
                line = t
        if line:
            T(line, x, top + n * lh, size, False, color); n += 1
        return top + n * lh

    def header(small=False):
        hh = 38 if small else 66
        rect(0, 0, W, hh, NAVY); rect(0, hh, W, 3, GOLD)
        logo = os.path.join(ASSETS, "logo-emblem-pdf.png")
        if os.path.exists(logo):
            lh = hh - (10 if small else 18)
            cv.drawImage(logo, 16, H - (5 if small else 9) - lh, width=lh * 240 / 218, height=lh, mask="auto")
        lx = 52 if small else 78
        T(d["academy"], lx, 13 if small else 15, 11 if small else 14, True, "#ffffff", width=W - lx - 16)
        if small: T(f"{d['student']['name']} · {d['month_label']}", lx, 26, 8, False, "#f1c15a", width=W - lx - 16)
        else: T("Monthly Attendance Report", lx, 36, 10.5, False, "#f1c15a")
        y[0] = hh + 18

    def ensure(h):
        if y[0] + h > LIMIT:
            cv.showPage(); header(True)

    cur = d["fee"]["currency"]
    money = lambda v: money_txt(v, cur)
    header()
    T("STUDENT", M, y[0], 8, False, GREY); y[0] += 12
    T(d["student"]["name"], M, y[0], 19, True, INK, width=CW); y[0] += 27
    for k, v in [("Month", d["month_label"]), ("Subject", d["subject"]["name"]), ("Class", d["student"]["batch"])] + ([("Teacher", d["teacher"])] if d["teacher"] else []):
        T(k, M, y[0], 10.5, False, GREY); T(v, M + 62, y[0], 10.5, True, INK, width=CW - 62); y[0] += 17
    y[0] += 4
    # ---- summary
    s = d["summary"]; ensure(120)
    T("Summary", M, y[0], 13, True); y[0] += 21
    tiles = [("Classes held", str(s["held"]), NAVY), ("Attended", str(s["attended"]), "#15803d"), ("Missed", str(s["missed"]), "#b91c1c" if s["missed"] else INK), ("Attendance", "—" if s["percent"] is None else f"{s['percent']}%", NAVY)]
    tw = (CW - 21) / 4
    for i, (k, v, col) in enumerate(tiles):
        x = M + i * (tw + 7)
        rect(x, y[0], tw, 56, "#fbfcfe", LINE, 8); T(v, x + tw / 2, y[0] + 10, 16 if len(v) > 4 else 21, True, col, "c"); T(k, x + tw / 2, y[0] + 38, 8.5, False, GREY, "c")
    y[0] += 66
    extra = []
    if s["cancelled"]: extra.append(f"{s['cancelled']} {'class was' if s['cancelled'] == 1 else 'classes were'} cancelled and {'is' if s['cancelled'] == 1 else 'are'} not counted.")
    if s["late"]: extra.append(f"{s['late']} of the attended classes {'was' if s['late'] == 1 else 'were'} joined late.")
    if s["pending"]: extra.append(f"{s['pending']} {'class is' if s['pending'] == 1 else 'classes are'} not yet recorded or still to come.")
    if extra: y[0] = para(" ".join(extra), M, y[0], 9.5, GREY, CW, 12) + 6
    y[0] += 8
    # ---- fee box: the whole month across every subject
    ensure(100)
    fm_, multi = d["fee"]["month"], d["fee"]["month"]["subjects"] > 1
    rect(M, y[0], CW, 82, "#fbfcfe", LINE, 9); fx = M + 14
    T(f"{'FEES' if multi else 'FEE'} FOR {d['month_label'].upper()}", fx, y[0] + 11, 8, False, GREY)
    T("—" if not fm_["billed"] and not fm_["total"] else money(fm_["total"]), fx, y[0] + 24, 22, True)
    T(f"{fm_['subjects']} subjects · {d['fee']['classes']} classes each · paid in advance" if multi else f"for {d['fee']['classes']} classes · collected in advance", fx, y[0] + 54, 9, False, GREY, width=CW - 28 - 126)
    pw = 118; px = M + CW - pw - 14
    T("PAYMENT STATUS", px + pw / 2, y[0] + 11, 8, False, GREY, "c"); rect(px, y[0] + 26, pw, 26, FEE_COLOR[fm_["state"]], None, 13); T(fm_["label"], px + pw / 2, y[0] + 34, 8.5 if len(fm_["label"]) > 12 else 10, True, "#ffffff", "c")
    note = (f"{money(fm_['paid'])} received · {money(fm_['outstanding'])} due" if fm_["state"] == "part" else
            f"{money(fm_['outstanding'])} due" + (f" · {datetime.fromisoformat(fm_['due_date']).day} {MON[datetime.fromisoformat(fm_['due_date']).month - 1]}" if fm_["due_date"] else "") if fm_["state"] == "due" else "Thank you" if fm_["state"] == "paid" else "")
    if note: T(note, px + pw / 2, y[0] + 58, 8.5, False, GREY, "c", width=pw + 20)
    y[0] += 98
    # ---- outstanding fees (all subjects, earlier months included)
    ol = d["fee"]["owed"]; RH = 21
    ensure(66 + RH * min(len(ol["lines"]), 2) if ol["lines"] else 50)
    T("Outstanding fees", M, y[0], 13, True); T(f"as of {d['generated_label']}", W - M, y[0] + 4, 8.5, False, GREY, "r"); y[0] += 21
    if not ol["lines"]:
        rect(M, y[0], CW, 34, "#ecf8f0", None, 8); T("No outstanding fees. Thank you.", M + CW / 2, y[0] + 11, 11, True, "#15803d", "c"); y[0] += 50
    else:
        def ohead():
            rect(M, y[0], CW, 22, NAVY); T("Fee", M + 10, y[0] + 6.5, 9.5, True, "#ffffff"); T("Due", M + 190, y[0] + 6.5, 9.5, True, "#ffffff"); T("Amount", W - M - 10, y[0] + 6.5, 9.5, True, "#ffffff", "r"); y[0] += 22
        ohead()
        for i, l in enumerate(ol["lines"]):
            if y[0] + RH > LIMIT - 30:
                cv.showPage(); header(True); ohead()
            if i % 2: rect(M, y[0], CW, RH, "#f5f7fb")
            hline(y[0] + RH)
            dd = datetime.fromisoformat(l["due_date"])
            T(f"{l['period_label']} · {l['subject']}", M + 10, y[0] + 5.5, 10.5, False, INK, width=175); T(f"{dd.day} {MON[dd.month - 1]}", M + 190, y[0] + 6, 9.5, l["overdue"], "#b91c1c" if l["overdue"] else GREY); T(money(l["outstanding"]), W - M - 10, y[0] + 5.5, 10.5, True, INK, "r"); y[0] += RH
        if y[0] + 40 > LIMIT: cv.showPage(); header(True)
        rect(M, y[0], CW, 30, "#fdf2f2"); T("Total outstanding", M + 10, y[0] + 9, 11.5, True, "#b91c1c"); T(money(ol["total"]), W - M - 10, y[0] + 9, 11.5, True, "#b91c1c", "r"); y[0] += 36
        bits = ([f"{money(ol['previous'])} is from earlier months"] if ol["previous"] > 0 else []) + ([f"{money(ol['later'])} is for later months"] if ol["later"] > 0 else [])
        if bits: y[0] = para(" · ".join(bits) + ".", M, y[0], 9.5, GREY, CW, 12) + 4
        y[0] += 10
    # ---- every subject this month
    if len(d["fee"]["month_fees"]) > 1:
        ensure(44 + RH * len(d["fee"]["month_fees"]))
        T(f"All subjects – {d['month_label']}", M, y[0], 13, True); y[0] += 21
        rect(M, y[0], CW, 22, NAVY); T("Subject", M + 10, y[0] + 6.5, 9.5, True, "#ffffff"); T("Fee", M + 140, y[0] + 6.5, 9.5, True, "#ffffff"); T("Payment", M + 238, y[0] + 6.5, 9.5, True, "#ffffff"); y[0] += 22
        for i, mf in enumerate(d["fee"]["month_fees"]):
            if i % 2: rect(M, y[0], CW, RH, "#f5f7fb")
            hline(y[0] + RH)
            T(mf["subject"], M + 10, y[0] + 5.5, 10.5, mf["current"], INK, width=125); T("—" if mf["amount"] is None else money(mf["amount"]), M + 140, y[0] + 5.5, 10.5)
            cv.setFillColor(HexColor(FEE_COLOR[mf["state"]])); cv.circle(M + 242, H - (y[0] + 10.5), 3.4, stroke=0, fill=1)
            T("Not yet recorded" if mf["state"] == "not_billed" else mf["label"].capitalize(), M + 252, y[0] + 6.2, 9, True, FEE_COLOR[mf["state"]], width=CW - 262); y[0] += RH
        y[0] += 14
    # ---- class by class
    cDate, cTime, cStat = M + 10, M + 168, M + 238

    def thead():
        rect(M, y[0], CW, 22, NAVY)
        for x, t in ((cDate, "Date"), (cTime, "Time"), (cStat, "Status")): T(t, x, y[0] + 6.5, 9.5, True, "#ffffff")
        y[0] += 22
    ensure(22 + 21 + 24 * min(max(len(d["rows"]), 1), 7))
    T("Class by class", M, y[0], 13, True); y[0] += 21; thead()
    if not d["rows"]:
        T("No classes were scheduled this month.", cDate, y[0] + 8, 10.5, False, GREY); y[0] += 30
    for i, r in enumerate(d["rows"]):
        if y[0] + 24 > LIMIT:
            cv.showPage(); header(True); thead()
        if i % 2: rect(M, y[0], CW, 24, "#f5f7fb")
        hline(y[0] + 24)
        T(r["date"], cDate, y[0] + 6.5, 10.5, False, INK, width=150); T(r["time"], cTime, y[0] + 6.5, 10.5, False, GREY, width=66)
        cv.setFillColor(HexColor(COLORS[r["status"]])); cv.circle(cStat + 4, H - (y[0] + 12), 3.4, stroke=0, fill=1); T(r["label"], cStat + 13, y[0] + 6.8, 10, True, COLORS[r["status"]], width=CW - 254); y[0] += 24
    y[0] += 18
    # ---- note
    ensure(70)
    rect(M, y[0], CW, 3, GOLD, None, 1.5); y[0] += 12
    y[0] = para(d["note"], M, y[0], 11, INK, CW, 14) + 6
    if d["contact"]: y[0] = para(d["contact"], M, y[0], 9.5, GREY, CW, 12) + 4
    T(d["academy"], M, y[0] + 4, 10, True, INK, width=CW)
    cv.showPage(); cv.save()
    return buf.getvalue()


def file_name(d: dict) -> str:
    import re, unicodedata
    safe = lambda s: re.sub(r"^-+|-+$", "", re.sub(r"[^A-Za-z0-9]+", "-", unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode())) or "Student"
    return f"Attendance-Report-{safe(d['student']['name'])}-{safe(d['subject']['name'])}-{d['month']}.pdf"
