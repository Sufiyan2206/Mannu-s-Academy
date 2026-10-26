// The fees engine. Pure functions over the loaded records, so the screens, the reports and the parent PDF always agree.
import { addDays, } from './tz';
import { daysBetween, skey } from './format';
import type { Batch, FeeCharge, FeeRate, Payment, Student, SubjectId } from './types';

export interface FeeCtx {
  students: Student[]; batches: Batch[]; charges: FeeCharge[]; payments: Payment[]; rates: FeeRate[];
  today: string;             // YYYY-MM-DD in the academy time zone
  defaultCurrency: string;
  subjectName: (id: string | null) => string;
}

export const scur = (s: { currency?: string | null } | undefined | null, d: string) => s?.currency || d;

export interface FeeLine extends FeeCharge { out: number; od: boolean }
export interface FeeStatus { lines: FeeLine[]; charged: number; paid: number; balance: number; overdue: number; upcoming: number; next: string | null; cur: string }

/** Payments are applied to the oldest unpaid charge first. A negative balance is credit. */
export function feeStatus(ctx: FeeCtx, sid: string): FeeStatus {
  const soon = addDays(ctx.today, 7);
  const ch = ctx.charges.filter(c => c.student_id === sid && !c.voided)
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.created_at.localeCompare(b.created_at));
  const pay = ctx.payments.filter(p => p.student_id === sid && !p.voided);
  let pool = pay.reduce((t, p) => t + p.cents, 0);
  const paid = pool;
  let overdue = 0, upcoming = 0, charged = 0, next: string | null = null;
  const lines = ch.map(c => {
    charged += c.cents;
    const ap = Math.min(pool, c.cents); pool -= ap;
    const out = c.cents - ap, od = out > 0 && c.due_date < ctx.today;
    if (out > 0) {
      if (od) overdue += out;
      else { if (c.due_date <= soon) upcoming += out; if (!next) next = c.due_date; }
    }
    return { ...c, out, od };
  });
  return { lines, charged, paid, balance: charged - paid, overdue, upcoming, next, cur: scur(ctx.students.find(x => x.id === sid), ctx.defaultCurrency) };
}

/** The most specific rate wins: student, then batch, then the default for that subject and currency. */
export function rateFor(ctx: FeeCtx, s: Student, subId: SubjectId): FeeRate | undefined {
  const cur = scur(s, ctx.defaultCurrency);
  const weight = (r: FeeRate) => (r.student_id ? 2 : 0) + (r.batch_id ? 1 : 0);
  return ctx.rates
    .filter(r => r.subject_id === subId && r.currency === cur && (!r.student_id || r.student_id === s.id) && (!r.batch_id || r.batch_id === s.batch_id))
    .sort((a, b) => weight(b) - weight(a))[0];
}

export interface PlannedFees { create: Omit<FeeCharge, 'id' | 'created_at' | 'voided'>[]; skipped: number; none: string[] }

/** Works out the monthly charges. Running it again for the same month creates nothing new. */
export function planMonthlyFees(ctx: FeeCtx, period: string, dueDay: number): PlannedFees {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('Choose a month.');
  const day = Math.min(28, Math.max(1, Number(dueDay) || 10)), due = `${period}-${String(day).padStart(2, '0')}`;
  const label = new Date(period + '-01T00:00:00Z').toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const out: PlannedFees = { create: [], skipped: 0, none: [] };
  for (const s of ctx.students.filter(x => x.active)) {
    for (const sid of s.subjects) {
      const r = rateFor(ctx, s, sid);
      if (!r) { out.none.push(`${s.name} (${ctx.subjectName(sid)}, ${scur(s, ctx.defaultCurrency)})`); continue; }
      if (r.cents === 0) continue;
      if (ctx.charges.some(c => c.student_id === s.id && c.subject_id === sid && c.period === period && !c.voided)) { out.skipped++; continue; }
      out.create.push({ student_id: s.id, subject_id: sid, period, description: `${ctx.subjectName(sid)} fee – ${label}`, currency: scur(s, ctx.defaultCurrency), cents: r.cents, due_date: due });
    }
  }
  return out;
}

/** Credited amount (in the student's billing currency) for a payment made in another currency. */
export function creditedCents(amount: number, paidCur: string, billCur: string, rate: number, toMinor: (x: number, c: string) => number, dpOf: (c: string) => number): number {
  return paidCur === billCur ? toMinor(amount, billCur) : Math.round(amount * rate * 10 ** dpOf(billCur));
}

// ---------------------------------------------------------------- outstanding reports
export interface OutFilters { batch?: string; student?: string; currency?: string; subject?: string; period?: string; school?: string }
export interface OutLine { sid: string; student: string; batch_id: string; subject_id: SubjectId | null; subject: string; period: string; due_date: string; cur: string; amount: number; outstanding: number; overdue: boolean; due_soon: boolean; days_overdue: number }
export interface OutStud { s: Student; cur: string; charged: number; paid: number; balance: number; credit: number; outstanding: number; overdue: number; due_soon: number; oldest: string | null }
export interface OutGroup { key: string; name: string; cur: string; outstanding: number; overdue: number; lines: number; ids: Set<string> }

export const schoolOk = (students: Student[], school: string | undefined, sid: string) => {
  if (!school) return true;
  const sk = skey(students.find(x => x.id === sid)?.school);
  return school === '__none' ? !sk : sk === skey(school);
};

export function outData(ctx: FeeCtx, st: OutFilters) {
  const today = ctx.today, soon = addDays(today, 7), lines: OutLine[] = [], studs: OutStud[] = [];
  const bname = (id: string) => ctx.batches.find(b => b.id === id)?.name || '—';
  for (const s of ctx.students) {
    if (!s.active || (st.batch && s.batch_id !== st.batch) || (st.student && s.id !== st.student) || !schoolOk(ctx.students, st.school, s.id)) continue;
    const f = feeStatus(ctx, s.id), cur = f.cur;
    if (st.currency && cur !== st.currency) continue;
    const mine = f.lines.filter(l => l.out > 0 && (!st.subject || l.subject_id === st.subject) && (!st.period || l.period === st.period));
    for (const l of mine) {
      lines.push({
        sid: s.id, student: s.name, batch_id: s.batch_id, subject_id: l.subject_id, subject: l.subject_id ? ctx.subjectName(l.subject_id) : 'Other',
        period: l.period || '', due_date: l.due_date, cur, amount: l.cents, outstanding: l.out, overdue: l.due_date < today,
        due_soon: l.due_date >= today && l.due_date <= soon, days_overdue: Math.max(0, daysBetween(l.due_date, today)),
      });
    }
    const sum = (fn: (l: FeeLine) => boolean) => mine.filter(fn).reduce((t, l) => t + l.out, 0);
    studs.push({
      s, cur, charged: f.charged, paid: f.paid, balance: f.balance, credit: f.balance < 0 ? -f.balance : 0, outstanding: sum(() => true),
      overdue: sum(l => l.due_date < today), due_soon: sum(l => l.due_date >= today && l.due_date <= soon), oldest: mine[0]?.due_date || null,
    });
  }
  const tot: Record<string, { cur: string; outstanding: number; overdue: number; due_soon: number; ids: Set<string> }> = {};
  for (const l of lines) {
    const t = tot[l.cur] ||= { cur: l.cur, outstanding: 0, overdue: 0, due_soon: 0, ids: new Set() };
    t.outstanding += l.outstanding; if (l.overdue) t.overdue += l.outstanding; if (l.due_soon) t.due_soon += l.outstanding; t.ids.add(l.sid);
  }
  const group = (kf: (l: OutLine) => string, nf: (l: OutLine) => string): OutGroup[] => {
    const m: Record<string, OutGroup> = {};
    for (const l of lines) {
      const k = kf(l) + '|' + l.cur, g = m[k] ||= { key: kf(l), name: nf(l), cur: l.cur, outstanding: 0, overdue: 0, lines: 0, ids: new Set() };
      g.outstanding += l.outstanding; if (l.overdue) g.overdue += l.outstanding; g.lines++; g.ids.add(l.sid);
    }
    return Object.values(m).sort((a, b) => String(a.key).localeCompare(String(b.key)) || a.cur.localeCompare(b.cur));
  };
  const BUCKETS: [string, string, (l: OutLine) => boolean][] = [
    ['not_due', 'Not yet due', l => !l.overdue],
    ['d1_30', '1–30 days overdue', l => l.overdue && l.days_overdue <= 30],
    ['d31_60', '31–60 days overdue', l => l.overdue && l.days_overdue > 30 && l.days_overdue <= 60],
    ['d61_90', '61–90 days overdue', l => l.overdue && l.days_overdue > 60 && l.days_overdue <= 90],
    ['d90', 'Over 90 days overdue', l => l.overdue && l.days_overdue > 90],
  ];
  const ageing = Object.keys(tot).map(cur => ({
    cur,
    buckets: BUCKETS.map(([key, label, fn]) => {
      const ls = lines.filter(l => l.cur === cur && fn(l));
      return { key, label, amount: ls.reduce((t, l) => t + l.outstanding, 0), lines: ls.length, students: new Set(ls.map(l => l.sid)).size };
    }),
  }));
  const credits: Record<string, { cur: string; credit: number; students: number }> = {};
  for (const x of studs) if (x.credit > 0) { const c = credits[x.cur] ||= { cur: x.cur, credit: 0, students: 0 }; c.credit += x.credit; c.students++; }
  return {
    today, lines, studs, ageing,
    totals: Object.values(tot).map(t => ({ ...t, students: t.ids.size })),
    credits: Object.values(credits),
    byBatch: group(l => l.batch_id, l => bname(l.batch_id)),
    bySubject: group(l => l.subject_id ?? 'other', l => l.subject),
    byMonth: group(l => l.period || 'none', l => l.period || 'No period'),
    periods: [...new Set(ctx.charges.filter(c => !c.voided && c.period).map(c => c.period as string))].sort().reverse(),
  };
}
