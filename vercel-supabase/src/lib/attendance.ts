// Attendance: Zoom CSV import, merging with what staff entered, and the data behind the attendance reports.
import { zonedToUtc } from './tz';
import { endIso, monthOf, skey } from './format';
import type { AttAudit, AttDoc, AttRow, AttStatus, ClassRow, Student, Unmatched, ZoomRow } from './types';

// ---------------------------------------------------------------- CSV / Zoom report
export function parseCsv(input: string): string[][] {
  const rows: string[][] = []; let r: string[] = [], v = '', q = false;
  const t = input.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { v += '"'; i++; } else q = false; } else v += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { r.push(v); v = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; r.push(v); v = ''; rows.push(r); r = []; }
    else v += ch;
  }
  if (v || r.length) { r.push(v); rows.push(r); }
  return rows;
}

export function parseWhen(s: string | undefined, tz: string): string | null {
  s = String(s || '').trim(); if (!s) return null;
  let m: RegExpExecArray | null;
  if (/Z$|[+-]\d\d:?\d\d$/.test(s) && !isNaN(Date.parse(s))) return new Date(s).toISOString();
  let y: string, mo: string, d: string, h: string | number, mi: string, ap: string | undefined;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i.exec(s))) [, y, mo, d, h, mi, ap] = m;
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i.exec(s))) {
    [, mo, d, y, h, mi, ap] = m;
    if (+mo > 12) [mo, d] = [d, mo];     // day/month/year
  } else return null;
  let hh = +h;
  if (ap) { const a = ap.toUpperCase(); if (a === 'PM' && hh < 12) hh += 12; if (a === 'AM' && hh === 12) hh = 0; }
  return zonedToUtc(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${mi}`, tz);
}

export interface ZoomPerson { name: string; email: string; join: string | null; leave: string | null; dur: number | null }
export function parseZoom(text: string, tz: string): ZoomPerson[] {
  const rows = parseCsv(text).filter(r => r.some(x => x.trim()));
  const hi = rows.findIndex(r => r.some(x => /e-?mail/i.test(x)) && r.some(x => /join/i.test(x)));
  if (hi < 0) throw new Error('This does not look like a Zoom participants report. It needs columns for email, join time and leave time.');
  const h = rows[hi].map(x => x.trim()), col = (re: RegExp) => h.findIndex(x => re.test(x));
  const ci = { name: col(/name/i), email: col(/e-?mail/i), join: col(/join/i), leave: col(/leave/i), dur: col(/duration/i) };
  return rows.slice(hi + 1).map(r => ({
    name: (r[ci.name] || '').trim(),
    email: (r[ci.email] || '').trim().toLowerCase(),
    join: parseWhen(r[ci.join], tz),
    leave: parseWhen(r[ci.leave], tz),
    dur: ci.dur >= 0 && r[ci.dur] !== undefined && r[ci.dur] !== '' ? Math.round(parseFloat(r[ci.dur]) * 60) : null,
  })).filter(p => p.name || p.email);
}

export interface BuiltRow { status: AttStatus; join_time: string | null; leave_time: string | null; duration_sec: number | null; source: 'manual' | 'zoom'; note?: string }

/** Match the Zoom report to the enrolled students: present / late / absent from time spent and arrival. */
export function zoomToRows(
  parts: ZoomPerson[], people: Student[], cls: ClassRow, opts: { minPct: number; lateAfter: number },
): { build: Record<string, BuiltRow>; unmatched: Unmatched[]; matched: number } {
  const by: Record<string, Student> = {};
  people.forEach(s => { by[s.email.toLowerCase()] = s; if (s.zoom_email) by[s.zoom_email.toLowerCase()] = s; });
  const agg = new Map<string, { join: string | null; leave: string | null; dur: number }>(), unmatched: Unmatched[] = [];
  for (const p of parts) {
    const s = p.email ? by[p.email] : undefined;
    const secs = p.dur ?? (p.join && p.leave ? Math.round((new Date(p.leave).getTime() - new Date(p.join).getTime()) / 1000) : 0);
    if (!s) { unmatched.push({ name: p.name, email: p.email, duration_sec: secs, reason: p.email ? 'Email does not match an enrolled student' : 'No Zoom login email' }); continue; }
    const g = agg.get(s.id) || { join: p.join, leave: p.leave, dur: 0 };
    if (p.join && (!g.join || p.join < g.join)) g.join = p.join;
    if (p.leave && (!g.leave || p.leave > g.leave)) g.leave = p.leave;
    g.dur += secs; agg.set(s.id, g);
  }
  const need = cls.duration_min * 60 * opts.minPct / 100;
  const lateAt = opts.lateAfter > 0 ? new Date(new Date(cls.start_at).getTime() + opts.lateAfter * 60000).toISOString() : null;
  const build: Record<string, BuiltRow> = {};
  for (const s of people) {
    const g = agg.get(s.id);
    build[s.id] = g
      ? { status: g.dur < need ? 'absent' : lateAt && g.join && g.join > lateAt ? 'late' : 'present', join_time: g.join, leave_time: g.leave, duration_sec: g.dur, source: 'zoom' }
      : { status: 'absent', join_time: null, leave_time: null, duration_sec: 0, source: 'zoom' };
  }
  return { build, unmatched: unmatched.slice(0, 60), matched: agg.size };
}

/**
 * Merge new rows into what is stored. What staff entered by hand is never overwritten by Zoom,
 * unchanged rows are skipped, and every real change leaves an audit entry (who, when, old and new value, reason).
 */
export function mergeRows(existing: Record<string, AttRow>, build: Record<string, BuiltRow>, by: string, reason: string, now: string): { rows: AttRow[]; audits: Omit<AttAudit, 'at'>[] } {
  const rows: AttRow[] = [], audits: Omit<AttAudit, 'at'>[] = [];
  for (const [sid, nw] of Object.entries(build)) {
    const old = existing[sid];
    if (old && old.source === 'manual' && nw.source === 'zoom') continue;
    if (old && (['status', 'join_time', 'leave_time', 'duration_sec', 'source'] as const).every(k => (old[k] ?? null) === (nw[k] ?? null)) && (old.note || '') === (nw.note || '')) continue;
    if (old || nw.source === 'manual') {
      audits.push({
        student_id: sid, by_name: by, reason,
        old_value: old ? { status: old.status, source: old.source, note: old.note || '' } : null,
        new_value: { status: nw.status, source: nw.source, note: nw.note || '' },
      });
    }
    rows.push({
      student_id: sid, status: nw.status, join_time: nw.join_time, leave_time: nw.leave_time, duration_sec: nw.duration_sec, source: nw.source,
      note: nw.note ?? old?.note ?? '', created_by: old?.created_by ?? by, created_at: old?.created_at ?? now, updated_by: by, updated_at: now,
    });
  }
  return { rows, audits };
}

export const toZoomRows = (build: Record<string, BuiltRow>): ZoomRow[] =>
  Object.entries(build).map(([student_id, b]) => ({ student_id, status: b.status, join_time: b.join_time, leave_time: b.leave_time, duration_sec: b.duration_sec }));

// ---------------------------------------------------------------- report data
export interface AttFilters { from: string; to: string; batch?: string; subject?: string; student?: string; school?: string }
export interface AttRec extends AttRow { c: ClassRow; sid: string }

export function attData(
  classes: ClassRow[], students: Student[], docs: Record<string, AttDoc | undefined>, st: AttFilters,
  h: { fromUtc: string; toUtc: string; nowIso: string; batchName: (id: string) => string; studentName: (id: string) => string },
) {
  const cl = classes.filter(c => c.status === 'scheduled' && c.start_at >= h.fromUtc && c.start_at < h.toUtc && (!st.batch || c.batch_id === st.batch) && (!st.subject || c.subject_id === st.subject));
  const recs: AttRec[] = [], missing: ClassRow[] = [];
  const schoolOk = (sid: string) => !st.school || (st.school === '__none' ? !skey(students.find(x => x.id === sid)?.school) : skey(students.find(x => x.id === sid)?.school) === skey(st.school));
  for (const c of cl) {
    const a = docs[c.id];
    if (!a?.taken_at) { if (endIso(c) < h.nowIso) missing.push(c); continue; }
    for (const [sid, r] of Object.entries(a.rows)) if ((!st.student || sid === st.student) && schoolOk(sid)) recs.push({ ...r, c, sid });
  }
  recs.sort((a, b) => b.c.start_at.localeCompare(a.c.start_at));
  type Per = { sid: string; name: string; school: string; batch: string; held: number; present: number; late: number; absent: number };
  const per: Record<string, Per> = {}, perC: Record<string, { c: ClassRow; present: number; late: number; absent: number }> = {};
  for (const r of recs) {
    const sd = students.find(s => s.id === r.sid);
    const p = per[r.sid] ||= { sid: r.sid, name: h.studentName(r.sid), school: sd?.school || '', batch: h.batchName(sd?.batch_id || ''), held: 0, present: 0, late: 0, absent: 0 };
    p.held++; p[r.status]++;
    const q = perC[r.c.id] ||= { c: r.c, present: 0, late: 0, absent: 0 };
    q[r.status]++;
  }
  const pc = (x: { held: number; present: number; late: number }) => (x.held ? Math.round((x.present + x.late) * 1000 / x.held) / 10 : null);
  const studentsOut = Object.values(per).map(p => ({ ...p, percent: pc(p) })).sort((a, b) => a.name.localeCompare(b.name));
  const byClass = Object.values(perC).map(q => {
    const held = q.present + q.late + q.absent;
    return { ...q, held, percent: pc({ held, present: q.present, late: q.late }) };
  }).sort((a, b) => b.c.start_at.localeCompare(a.c.start_at));
  const pp = recs.filter(r => r.status === 'present').length, pl = recs.filter(r => r.status === 'late').length, pr = pp + pl;
  const cols = byClass.map(b => b.c).sort((a, b) => a.start_at.localeCompare(b.start_at)).slice(-60);
  return {
    recs, students: studentsOut, byClass, missing, cols, absences: recs.filter(r => r.status === 'absent'),
    sum: { classes: byClass.length, present: pp, late: pl, absent: recs.length - pr, percent: recs.length ? Math.round(pr * 1000 / recs.length) / 10 : null },
  };
}

export const monthsOfClasses = (list: { start_at: string }[]) => [...new Set(list.map(c => monthOf(c.start_at)))];
