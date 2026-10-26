// Data for the parent monthly report (attendance + fees for one student and subject).
import { dp, endIso, monthLabelOf, monthOf, subj, tz } from './format';
import { feeStatus, scur, type FeeCtx } from './fees';
import type { AttDoc, Batch, ClassRow, Settings, Student, SubjectId } from './types';

export type RowStatus = 'present' | 'late' | 'absent' | 'cancelled' | 'not_recorded' | 'upcoming';
export const PST: Record<RowStatus, string> = { present: 'Present', late: 'Present (late)', absent: 'Absent', cancelled: 'Class cancelled', not_recorded: 'Not recorded', upcoming: 'Upcoming' };
export type FeeState = 'paid' | 'part' | 'due' | 'not_billed';
export const FEE_LABEL: Record<FeeState, string> = { paid: 'PAID', part: 'PARTLY PAID', due: 'PAYMENT DUE', not_billed: 'NOT YET RECORDED' };
export const FEE_CHIP: Record<FeeState, string> = { paid: 'ok', part: 'warn', due: 'bad', not_billed: '' };
export const NOTE_TXT = 'Please contact us if you have any questions about this report.';

export function hash53(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
export const drawable = (ch: string) => {
  const c = ch.codePointAt(0)!;
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || [0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026].includes(c);
};
/** The PDF font (Helvetica / Windows-1252) can draw Latin letters and curly quotes; anything else becomes "?". */
export const pdfText = (s: unknown) =>
  String(s ?? '').replace(/ /g, ' ').replace(/[‐‑‒―]/g, '-').replace(/…/g, '...')
    .replace(/[^\x20-\x7e\xa1-\xff–—‘’“”•]/gu, '?');

export interface ParentCtx {
  students: Student[]; batches: Batch[]; classes: ClassRow[]; att: Record<string, AttDoc | undefined>; fees: FeeCtx; settings: Settings; nowIso: string; today: string;
}
export interface ParentRow { class_id: string; date: string; time: string; status: RowStatus; label: string; note: string }
export interface MonthFee { subject_id: string; subject: string; current: boolean; billed: boolean; amount: number | null; outstanding: number | null; due_date: string | null; state: FeeState; label: string }
export interface OwedLine { period: string; period_label: string; subject: string; amount: number; paid: number; outstanding: number; due_date: string; overdue: boolean; when: 'previous' | 'this' | 'later' }
export interface ParentData {
  academy: string; contact: string; month: string; month_label: string;
  student: { id: string; name: string; batch: string }; subject: { id: SubjectId; name: string }; teacher: string; rows: ParentRow[];
  summary: { planned: number; scheduled: number; held: number; attended: number; missed: number; late: number; cancelled: number; pending: number; not_recorded: number; upcoming: number; percent: number | null };
  fee: {
    billed: boolean; currency: string; amount: number | null; paid: number; outstanding: number | null; due_date: string | null; state: FeeState; label: string; classes: number;
    month_fees: MonthFee[];
    month: { subjects: number; enrolled: number; billed: number; total: number; paid: number; outstanding: number; state: FeeState; label: string; due_date: string | null };
    owed: { currency: string; total: number; previous: number; this_month: number; later: number; lines: OwedLine[]; as_of: string };
  };
  note: string; hash: string; generated_label: string;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function parentData(ctx: ParentCtx, sid: string, subId: SubjectId, month: string): ParentData {
  const st = ctx.students.find(s => s.id === sid);
  if (!st || !st.subjects.includes(subId)) throw new Error('That student is not enrolled in that subject.');
  const cfg = ctx.settings, defCur = cfg.currency, cur = scur(st, defCur), now = ctx.nowIso;
  const cls = ctx.classes.filter(c => c.batch_id === st.batch_id && c.subject_id === subId && monthOf(c.start_at) === month).sort((a, b) => a.start_at.localeCompare(b.start_at));
  const fmtD = new Intl.DateTimeFormat('en-GB', { timeZone: tz(), weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const fmtT = new Intl.DateTimeFormat('en-US', { timeZone: tz(), hour: 'numeric', minute: '2-digit', hour12: true });
  const bname = (id: string) => ctx.batches.find(b => b.id === id)?.name || '—';

  const rows: ParentRow[] = [];
  for (const c of cls) {
    const rec = ctx.att[c.id], a = rec?.rows[sid];
    let status: RowStatus;
    if (c.status === 'cancelled') status = 'cancelled';
    else if (a) status = a.status;
    else if (rec?.taken_at) continue;          // attendance was taken and this student was not part of it
    else status = endIso(c) < now ? 'not_recorded' : 'upcoming';
    rows.push({ class_id: c.id, date: fmtD.format(new Date(c.start_at)), time: fmtT.format(new Date(c.start_at)).toLowerCase(), status, label: PST[status], note: status === 'cancelled' ? c.cancel_reason || '' : '' });
  }
  const cnt = (k: RowStatus) => rows.filter(r => r.status === k).length;
  const held = cnt('present') + cnt('late') + cnt('absent'), attended = cnt('present') + cnt('late');
  const summary = {
    planned: cfg.classes_per_month || 12, scheduled: rows.length, held, attended, missed: cnt('absent'), late: cnt('late'), cancelled: cnt('cancelled'),
    pending: cnt('not_recorded') + cnt('upcoming'), not_recorded: cnt('not_recorded'), upcoming: cnt('upcoming'), percent: held ? Math.round(attended * 1000 / held) / 10 : null,
  };

  const f = feeStatus(ctx.fees, sid), D = 10 ** dp(cur), today = ctx.today;
  const ln = f.lines.find(l => l.period === month && l.subject_id === subId);
  let fee: ParentData['fee'];
  const base = { currency: cur, classes: cfg.classes_per_month || 12 };
  if (ln) {
    const paid = ln.cents - ln.out;
    const state: FeeState = ln.out <= 0 ? 'paid' : paid > 0 ? 'part' : 'due';
    fee = { ...base, billed: true, amount: ln.cents / D, paid: paid / D, outstanding: ln.out / D, due_date: ln.due_date, state, label: FEE_LABEL[state] } as ParentData['fee'];
  } else {
    fee = { ...base, billed: false, amount: cur === defCur ? Number(cfg.monthly_fee ?? 250) : null, paid: 0, outstanding: null, due_date: null, state: 'not_billed', label: FEE_LABEL.not_billed } as ParentData['fee'];
  }
  const shortM = (pm: string) => new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(pm + '-01T12:00:00Z'));
  fee.month_fees = [...st.subjects].map(id => ({ id, name: subj(id) })).sort((a, b) => a.name.localeCompare(b.name)).map(es => {
    const l = f.lines.find(x => x.period === month && x.subject_id === es.id);
    const stt: FeeState = !l ? 'not_billed' : l.out <= 0 ? 'paid' : l.cents - l.out > 0 ? 'part' : 'due';
    return {
      subject_id: es.id, subject: es.name, current: es.id === subId, billed: !!l, amount: l ? l.cents / D : (es.id === subId ? fee.amount : null),
      outstanding: l ? l.out / D : null, due_date: l && l.out > 0 ? l.due_date : null, state: stt, label: FEE_LABEL[stt],
    };
  });
  {
    const withAmt = fee.month_fees.filter(m => m.amount != null), billedM = fee.month_fees.filter(m => m.billed);
    const total = r2(withAmt.reduce((t, m) => t + (m.amount as number), 0)), owedM = r2(billedM.reduce((t, m) => t + (m.outstanding as number), 0));
    const paidM = r2(billedM.reduce((t, m) => t + ((m.amount as number) - (m.outstanding as number)), 0));
    const stM: FeeState = !billedM.length ? 'not_billed' : owedM <= 0 ? 'paid' : paidM > 0 ? 'part' : 'due';
    const dues = billedM.map(m => m.due_date).filter(Boolean).sort() as string[];
    fee.month = { subjects: withAmt.length, enrolled: fee.month_fees.length, billed: billedM.length, total, paid: paidM, outstanding: owedM, state: stM, label: FEE_LABEL[stM], due_date: dues[0] || null };
  }
  const oLines: OwedLine[] = f.lines.filter(l => l.out > 0).map(l => {
    const per = l.period || l.due_date.slice(0, 7);
    return {
      period: per, period_label: shortM(per), subject: l.subject_id ? subj(l.subject_id) : 'Other', amount: l.cents / D, paid: (l.cents - l.out) / D,
      outstanding: l.out / D, due_date: l.due_date, overdue: l.due_date < today, when: (per < month ? 'previous' : per === month ? 'this' : 'later') as OwedLine['when'],
    };
  }).sort((a, b) => a.period.localeCompare(b.period) || a.subject.localeCompare(b.subject));
  const sumW = (w?: OwedLine['when']) => r2(oLines.filter(l => !w || l.when === w).reduce((t, l) => t + l.outstanding, 0));
  fee.owed = { currency: cur, total: sumW(), previous: sumW('previous'), this_month: sumW('this'), later: sumW('later'), lines: oLines, as_of: today };

  const d: ParentData = {
    academy: cfg.academy, contact: cfg.contact || '', month, month_label: monthLabelOf(month),
    student: { id: st.id, name: st.name, batch: bname(st.batch_id) }, subject: { id: subId, name: subj(subId) },
    teacher: cls.find(c => c.teacher_name)?.teacher_name || '', rows, summary, fee, note: NOTE_TXT, hash: '', generated_label: '',
  };
  d.hash = hash53(JSON.stringify(d));
  d.generated_label = new Intl.DateTimeFormat('en-GB', { timeZone: tz(), weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
  return d;
}

export function parentWarnings(d: ParentData): string[] {
  const w: string[] = [], s = d.summary;
  if (!d.rows.length) w.push('No classes were found for this student and subject in this month.');
  if (s.not_recorded) w.push(`${s.not_recorded} ${s.not_recorded === 1 ? 'class has' : 'classes have'} no attendance recorded yet. It will show as “Not recorded” in the report.`);
  if (s.upcoming) w.push(`${s.upcoming} ${s.upcoming === 1 ? 'class has' : 'classes have'} not taken place yet. It will show as “Upcoming”.`);
  if (!d.fee.billed) w.push('No fee has been generated for this month, so the payment status shows “Not yet recorded”. Generate the month’s fees in Fees first if you want it to show.');
  if (d.fee.amount == null) w.push('The student is billed in a different currency, so the fee amount cannot be shown until a fee is generated.');
  const bad = [...new Set([...(d.student.name + d.subject.name + d.student.batch + d.academy)].filter(ch => !drawable(ch)))];
  if (bad.length) w.push(`The PDF can only draw Latin letters. These characters will show as “?”: ${bad.slice(0, 5).join(' ')}`);
  return w;
}

export const parentFile = (d: ParentData) =>
  `Attendance-Report-${d.student.name.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'Student'}-${d.subject.name.replace(/[^A-Za-z0-9]+/g, '-')}-${d.month}.pdf`;
