import { describe, expect, it, beforeAll } from 'vitest';
import { addDays, zonedToUtc } from '../src/lib/tz';
import { dp, money, setFormatConfig, toMinor, parseT, mmss } from '../src/lib/format';
import { feeStatus, outData, planMonthlyFees, rateFor, type FeeCtx } from '../src/lib/fees';
import { mergeRows, parseCsv, parseWhen, parseZoom, zoomToRows } from '../src/lib/attendance';
import { parentData, parentWarnings, type ParentCtx } from '../src/lib/parent';
import { buildCaption, consentIssue, redactT, reelState, ytInfo, ytLink } from '../src/lib/reels';
import { msgText, waNum } from '../src/lib/whatsapp';
import type { AttDoc, AttRow, Batch, ClassRow, FeeCharge, Payment, Reel, ReelDecision, Settings, Student } from '../src/lib/types';

beforeAll(() => setFormatConfig({ tz: 'Asia/Dubai', currency: 'AED' }));

describe('time zones', () => {
  it('converts local academy time to UTC', () => {
    expect(zonedToUtc('2026-03-01T17:00', 'Asia/Dubai')).toBe('2026-03-01T13:00:00.000Z');
    expect(zonedToUtc('2026-03-01T17:00', 'Asia/Colombo')).toBe('2026-03-01T11:30:00.000Z');
    expect(zonedToUtc('nonsense', 'Asia/Dubai')).toBeNull();
  });
  it('handles daylight saving', () => {
    expect(zonedToUtc('2026-07-01T09:00', 'Europe/London')).toBe('2026-07-01T08:00:00.000Z');
    expect(zonedToUtc('2026-01-01T09:00', 'Europe/London')).toBe('2026-01-01T09:00:00.000Z');
  });
  it('adds days across month ends', () => { expect(addDays('2026-02-27', 3)).toBe('2026-03-02'); });
});

describe('money', () => {
  it('uses the currency’s own decimals', () => {
    expect(dp('AED')).toBe(2); expect(dp('KWD')).toBe(3); expect(dp('JPY')).toBe(0);
    expect(toMinor('250', 'AED')).toBe(25000); expect(toMinor('1.5', 'KWD')).toBe(1500);
    expect(money(25000, 'AED')).toBe('AED 250.00');
  });
  it('parses m:ss', () => { expect(parseT('12:30')).toBe(750); expect(parseT('90')).toBe(90); expect(parseT('x')).toBeNaN(); expect(mmss(750)).toBe('12:30'); });
});

// ---------------------------------------------------------------- shared fixtures
const batch: Batch = { id: 'b1', name: 'Grade 11' };
const mk = (id: string, name: string, over: Partial<Student> = {}): Student => ({
  id, name, email: `${id}@x.com`, zoom_email: '', mobile: '+971500000001', guardian_name: 'P', guardian_mobile: '+971500000002', guardian_email: '', school: '',
  batch_id: 'b1', currency: 'AED', subjects: ['chem', 'phys'], active: true, created_at: '2026-01-01T00:00:00Z', ...over,
});
const sam = mk('s1', 'Sam Perera'), ann = mk('s2', 'Ann Silva', { subjects: ['chem'] });
const chg = (id: string, sid: string, sub: 'chem' | 'phys', period: string, cents: number, due: string): FeeCharge => ({
  id, student_id: sid, subject_id: sub, period, description: sub, currency: 'AED', cents, due_date: due, voided: false, created_at: due + 'T00:00:00Z',
});
const pay = (id: string, sid: string, cents: number, over: Partial<Payment> = {}): Payment => ({
  id, receipt_no: 'MTA-2026-0000' + id, student_id: sid, currency: 'AED', cents, paid_currency: 'AED', paid_cents: cents, rate: 1, method: 'cash',
  reference: '', note: '', paid_at: '2026-02-05T08:00:00Z', received_by: 'A', voided: false, void_reason: '', ...over,
});
const feeCtx = (over: Partial<FeeCtx> = {}): FeeCtx => ({
  students: [sam, ann], batches: [batch], charges: [], payments: [], rates: [], today: '2026-03-15', defaultCurrency: 'AED',
  subjectName: id => ({ chem: 'Chemistry', phys: 'Physics', math: 'Mathematics' } as Record<string, string>)[id || ''] || '?', ...over,
});

describe('fees engine', () => {
  it('applies payments to the oldest charge first and flags overdue', () => {
    const ctx = feeCtx({
      charges: [chg('c1', 's1', 'chem', '2026-01', 25000, '2026-01-10'), chg('c2', 's1', 'chem', '2026-02', 25000, '2026-02-10'), chg('c3', 's1', 'chem', '2026-03', 25000, '2026-03-20')],
      payments: [pay('1', 's1', 35000)],
    });
    const f = feeStatus(ctx, 's1');
    expect(f.charged).toBe(75000); expect(f.paid).toBe(35000); expect(f.balance).toBe(40000);
    expect(f.lines.map(l => l.out)).toEqual([0, 15000, 25000]);
    expect(f.overdue).toBe(15000);          // February is past due, March is not
    expect(f.upcoming).toBe(25000);         // March falls due within 7 days of 15 March
    expect(f.next).toBe('2026-03-20');
  });
  it('treats overpayment as credit and ignores voided items', () => {
    const ctx = feeCtx({ charges: [chg('c1', 's1', 'chem', '2026-01', 10000, '2026-01-10')], payments: [pay('1', 's1', 30000), pay('2', 's1', 99999, { voided: true })] });
    expect(feeStatus(ctx, 's1').balance).toBe(-20000);
  });
  it('picks the most specific rate and bills in the student’s own currency', () => {
    const rates = [
      { id: 'r1', subject_id: 'chem' as const, batch_id: null, student_id: null, currency: 'AED', cents: 25000 },
      { id: 'r2', subject_id: 'chem' as const, batch_id: 'b1', student_id: null, currency: 'AED', cents: 20000 },
      { id: 'r3', subject_id: 'chem' as const, batch_id: null, student_id: 's1', currency: 'AED', cents: 15000 },
      { id: 'r4', subject_id: 'chem' as const, batch_id: null, student_id: null, currency: 'USD', cents: 7000 },
    ];
    const ctx = feeCtx({ rates });
    expect(rateFor(ctx, sam, 'chem')?.cents).toBe(15000);
    expect(rateFor(ctx, ann, 'chem')?.cents).toBe(20000);
    expect(rateFor(ctx, mk('s9', 'Usd Kid', { currency: 'USD' }), 'chem')?.cents).toBe(7000);
    expect(rateFor(ctx, ann, 'phys')).toBeUndefined();
  });
  it('generates a month once and never duplicates', () => {
    const rates = [{ id: 'r1', subject_id: 'chem' as const, batch_id: null, student_id: null, currency: 'AED', cents: 25000 }];
    const first = planMonthlyFees(feeCtx({ rates }), '2026-03', 10);
    expect(first.create).toHaveLength(2);           // Sam and Ann in chemistry
    expect(first.none).toEqual(['Sam Perera (Physics, AED)']);   // no physics rate yet
    expect(first.create[0].due_date).toBe('2026-03-10');
    const again = planMonthlyFees(feeCtx({ rates, charges: [chg('c1', 's1', 'chem', '2026-03', 25000, '2026-03-10')] }), '2026-03', 10);
    expect(again.create).toHaveLength(1); expect(again.skipped).toBe(1);
  });
  it('builds the outstanding reports', () => {
    const ctx = feeCtx({ charges: [chg('c1', 's1', 'chem', '2026-01', 25000, '2026-01-10'), chg('c2', 's2', 'chem', '2026-03', 25000, '2026-03-18')], payments: [pay('1', 's2', 30000)] });
    const o = outData(ctx, {});
    expect(o.totals).toHaveLength(1); expect(o.totals[0].outstanding).toBe(25000); expect(o.totals[0].overdue).toBe(25000);
    expect(o.lines[0].days_overdue).toBe(64);
    expect(o.credits[0].credit).toBe(5000);
    expect(o.ageing[0].buckets.find(b => b.key === 'd61_90')?.amount).toBe(25000);
  });
});

describe('Zoom attendance', () => {
  const cls: ClassRow = { id: 'k1', batch_id: 'b1', subject_id: 'chem', title: 'Chem', start_at: '2026-03-01T13:00:00.000Z', duration_min: 60, teacher_name: 'T', teacher_phone: '', join_url: 'https://zoom.us/j/1', agenda: '', status: 'scheduled', cancel_reason: '', created_by: '', created_at: '' };
  const csvFor = (annMinutes: number) => [
    'Topic,ID,Host,Duration',
    'Chem,123,Teacher,60',
    '',
    'Name (original name),User Email,Join Time,Leave Time,Duration (Minutes)',
    'Sam P,sam@x.com,2026-03-01 17:02:00,2026-03-01 18:00:00,58',
    `Ann,ann@other.com,2026-03-01 17:25:00,2026-03-01 18:00:00,${annMinutes}`,
    '"Guest, The",,2026-03-01 17:00:00,2026-03-01 17:10:00,10',
  ].join('\n');
  const csv = csvFor(20);
  const samZ = mk('s1', 'Sam Perera', { email: 'sam@x.com' });
  it('reads the participants block', () => {
    const p = parseZoom(csv, 'Asia/Dubai');
    expect(p).toHaveLength(3); expect(p[0].email).toBe('sam@x.com'); expect(p[0].join).toBe('2026-03-01T13:02:00.000Z'); expect(p[2].name).toBe('Guest, The');
    expect(() => parseZoom('a,b\n1,2', 'Asia/Dubai')).toThrow(/participants report/);
  });
  it('marks present / late / absent and lists the people it could not match', () => {
    const annZ = mk('s2', 'Ann Silva', { subjects: ['chem'], zoom_email: 'ann@other.com' });
    const r = zoomToRows(parseZoom(csv, 'Asia/Dubai'), [samZ, annZ], cls, { minPct: 50, lateAfter: 10 });
    expect(r.build.s1.status).toBe('present');         // 2 minutes after the start is within the grace period
    expect(r.build.s2.status).toBe('absent');          // 20 of 60 minutes is below the 50 % needed
    expect(r.unmatched).toHaveLength(1); expect(r.unmatched[0].reason).toBe('No Zoom login email');
  });
  it('marks late arrivals who stayed long enough', () => {
    const p = parseZoom(csvFor(35), 'Asia/Dubai');
    const annZ = mk('s2', 'Ann Silva', { zoom_email: 'ann@other.com' });
    expect(zoomToRows(p, [samZ, annZ], cls, { minPct: 50, lateAfter: 10 }).build.s2.status).toBe('late');
    expect(zoomToRows(p, [samZ, annZ], cls, { minPct: 50, lateAfter: 0 }).build.s2.status).toBe('present');
  });
  it('parses CSV quotes and dates', () => {
    expect(parseCsv('a,"b,c",d\n"x""y",2')).toEqual([['a', 'b,c', 'd'], ['x"y', '2']]);
    expect(parseWhen('03/01/2026 05:02 PM', 'Asia/Dubai')).toBe('2026-03-01T13:02:00.000Z');
    expect(parseWhen('13/01/2026 05:02 PM', 'Asia/Dubai')).toBe('2026-01-13T13:02:00.000Z');
  });
  it('never overwrites what staff typed with Zoom, and audits real changes only', () => {
    const manual: AttRow = { student_id: 's1', status: 'present', join_time: null, leave_time: null, duration_sec: null, source: 'manual', note: 'phone', created_by: 'Tess', created_at: 'a', updated_by: 'Tess', updated_at: 'a' };
    const z = { s1: { status: 'absent' as const, join_time: null, leave_time: null, duration_sec: 0, source: 'zoom' as const } };
    expect(mergeRows({ s1: manual }, z, 'Zoom import', 'x', 'now').rows).toHaveLength(0);
    const same = { s1: { status: 'present' as const, join_time: null, leave_time: null, duration_sec: null, source: 'manual' as const, note: 'phone' } };
    expect(mergeRows({ s1: manual }, same, 'Tess', 'x', 'now').rows).toHaveLength(0);
    const changed = mergeRows({ s1: manual }, { s1: { ...same.s1, status: 'late' } }, 'Ada', 'arrived late', 'now');
    expect(changed.rows[0].status).toBe('late'); expect(changed.rows[0].created_by).toBe('Tess'); expect(changed.rows[0].updated_by).toBe('Ada');
    expect(changed.audits[0].old_value?.status).toBe('present'); expect(changed.audits[0].new_value.status).toBe('late');
    expect(mergeRows({}, same, 'Tess', 'Manual entry', 'now').audits).toHaveLength(1);   // first manual entry is recorded
    expect(mergeRows({}, z, 'Zoom import', 'x', 'now').audits).toHaveLength(0);           // first Zoom import is not
  });
});

describe('parent report', () => {
  const settings = { academy: 'Mannu’s Tuition Academy', tz: 'Asia/Dubai', currency: 'AED', currencies: ['AED'], min_pct: 50, late_after: 10, classes_per_month: 12, monthly_fee: 250, due_day: 10, cc: '', contact: '', ig_handle: '', publish_mode: 'auto', yt_privacy: 'unlisted', reel_len_sec: 60, reel_start_sec: 0, keep_original_days: 7 } as Settings;
  const klass = (id: string, start: string, over: Partial<ClassRow> = {}): ClassRow => ({ id, batch_id: 'b1', subject_id: 'chem', title: 'Chem', start_at: start, duration_min: 60, teacher_name: 'Mr T', teacher_phone: '', join_url: 'https://zoom.us/j/1', agenda: '', status: 'scheduled', cancel_reason: '', created_by: '', created_at: '', ...over });
  const att = (status: AttRow['status']): AttDoc => ({ taken_at: 'x', unmatched: [], zoom: {}, audit: [], rows: { s1: { student_id: 's1', status, join_time: null, leave_time: null, duration_sec: null, source: 'manual', note: '', created_by: '', created_at: '', updated_by: '', updated_at: '' } } });
  const classes = [klass('k1', '2026-02-03T13:00:00Z'), klass('k2', '2026-02-10T13:00:00Z'), klass('k3', '2026-02-17T13:00:00Z'), klass('k4', '2026-02-24T13:00:00Z', { status: 'cancelled', cancel_reason: 'Teacher unwell' }), klass('k5', '2026-02-26T13:00:00Z')];
  const docs: Record<string, AttDoc> = { k1: att('present'), k2: att('late'), k3: att('absent') };
  const ctx = (): ParentCtx => ({
    students: [sam], batches: [batch], classes, att: docs, settings, nowIso: '2026-03-15T08:00:00Z', today: '2026-03-15',
    fees: feeCtx({ students: [sam], charges: [chg('c1', 's1', 'chem', '2026-02', 25000, '2026-02-10'), chg('c0', 's1', 'phys', '2026-01', 20000, '2026-01-10')], payments: [pay('1', 's1', 30000)] }),
  });
  it('summarises the month and the fees', () => {
    const d = parentData(ctx(), 's1', 'chem', '2026-02');
    expect(d.summary).toMatchObject({ held: 3, attended: 2, missed: 1, late: 1, cancelled: 1, not_recorded: 1, percent: 66.7 });
    expect(d.rows.map(r => r.label)).toEqual(['Present', 'Present (late)', 'Absent', 'Class cancelled', 'Not recorded']);
    expect(d.rows[3].note).toBe('Teacher unwell');
    expect(d.fee.owed.total).toBe(150);              // 450 charged, 300 paid -> oldest (Jan physics 200) paid first, then Feb chem has 50 left... see below
  });
  it('lists every unpaid fee including earlier months', () => {
    const d = parentData(ctx(), 's1', 'chem', '2026-02');
    // 300 paid: January physics (200) is cleared, February chemistry has 150 left
    expect(d.fee.owed.lines).toHaveLength(1);
    expect(d.fee.owed.lines[0]).toMatchObject({ subject: 'Chemistry', outstanding: 150, when: 'this' });
    expect(d.fee.month.state).toBe('part'); expect(d.fee.month.paid).toBe(100);
  });
  it('warns when something is missing', () => {
    const w = parentWarnings(parentData(ctx(), 's1', 'chem', '2026-02'));
    expect(w.some(x => x.includes('no attendance recorded'))).toBe(true);
    const w2 = parentWarnings(parentData(ctx(), 's1', 'chem', '2026-04'));
    expect(w2.some(x => x.includes('No classes were found'))).toBe(true); expect(w2.some(x => x.includes('No fee has been generated'))).toBe(true);
    expect(() => parentData(ctx(), 's1', 'math', '2026-02')).toThrow(/not enrolled/);
  });
});

describe('reels', () => {
  const reel = (over: Partial<Reel> = {}): Reel => ({ id: 'r1', title: 'T', subject_id: 'chem', batch_id: 'b1', topic: 'Alkenes', teacher_name: 'T', clip_url: 'https://x.com/c.mp4', clip_path: null, clip_len: 60, yt_url: '', yt_start: 0, caption: '', appears: 'none', appearing: [], rev: 1, submitted: false, submitted_at: null, discarded: false, recording_id: null, by_id: null, by_name: '', created_at: '', updated_at: '', ...over });
  const dec = (over: Partial<ReelDecision> = {}): ReelDecision => ({ reel_id: 'r1', state: 'approved', rev: 1, scheduled_at: '2026-03-01T00:00:00Z', note: '', error: '', prev: '', ig_url: '', ig_media_id: null, published_at: null, appears: null, metrics: null, by_name: '', at: '2026-03-01T00:00:00Z', ...over });
  const consent = (m: Record<string, string>) => (id: string) => m[id] || 'unknown';
  const nm = (id: string) => ({ s1: 'Sam', s2: 'Ann' } as Record<string, string>)[id];
  it('needs consent before a student may appear', () => {
    expect(consentIssue(reel({ appears: null }), consent({}), nm)).toMatch(/Say whether/);
    expect(consentIssue(reel({ appears: 'none' }), consent({}), nm)).toBe('');
    expect(consentIssue(reel({ appears: 'students', appearing: [] }), consent({}), nm)).toMatch(/Choose which/);
    expect(consentIssue(reel({ appears: 'students', appearing: ['s1', 's2'] }), consent({ s1: 'granted' }), nm)).toBe('Consent has not been recorded for: Ann.');
    expect(consentIssue(reel({ appears: 'students', appearing: ['s1'] }), consent({ s1: 'granted' }), nm)).toBe('');
  });
  it('works out the visible status', () => {
    expect(reelState(reel(), undefined, '').s).toBe('draft');
    expect(reelState(reel({ submitted: true, submitted_at: '2026-02-01T00:00:00Z' }), undefined, '').s).toBe('awaiting_approval');
    expect(reelState(reel({ submitted: true, submitted_at: '2026-02-01T00:00:00Z' }), dec(), '').s).toBe('scheduled');
    expect(reelState(reel({ rev: 2 }), dec(), '').s).toBe('draft');     // edited after approval => needs approval again
    expect(reelState(reel(), dec(), 'Consent withdrawn').s).toBe('draft');
    expect(reelState(reel(), dec({ state: 'published' }), '').s).toBe('published');
    expect(reelState(reel({ appears: 'students' }), dec({ state: 'published' }), 'x').alert).toMatch(/no longer has consent/);
    expect(reelState(reel({ submitted: true, submitted_at: '2026-02-01T00:00:00Z' }), dec({ state: 'rejected', rev: null, note: 'Fix audio', at: '2026-02-02T00:00:00Z' }), '')).toMatchObject({ s: 'draft', note: 'Fix audio' });
    expect(reelState(reel({ discarded: true }), undefined, '').s).toBe('deleted');
  });
  it('understands YouTube links and builds captions', () => {
    expect(ytInfo('https://youtu.be/abcdefghijk')).toBe('abcdefghijk');
    expect(ytInfo('https://www.youtube.com/watch?v=abcdefghijk&t=3')).toBe('abcdefghijk');
    expect(ytInfo('http://youtu.be/abcdefghijk')).toBeNull(); expect(ytInfo('https://evil.com/watch?v=abcdefghijk')).toBeNull();
    expect(ytLink('https://youtu.be/abcdefghijk', 90)).toBe('https://youtu.be/abcdefghijk?t=90');
    const cap = buildCaption({ title: 'The alkene formula', topic: 'Alkenes', subject_id: 'chem', yt_url: 'https://youtu.be/abcdefghijk', yt_start: 0 }, { handle: 'mannus', academy: 'Mannu’s Tuition Academy', subjectName: 'Chemistry' });
    expect(cap).toContain('@mannus'); expect(cap).toContain('https://youtu.be/abcdefghijk'); expect(cap).toContain('#Chemistry'); expect(cap).toContain('#Alkenes');
    expect((cap.match(/#\w+/g) || []).length).toBeLessThanOrEqual(30);
  });
  it('hides student names, numbers and emails', () => {
    const r = redactT('Well done Sam Perera! Call +971 50 123 4567 or sam@x.com. Samantha is fine.', [sam, ann]);
    expect(r.text).toBe('Well done a student! Call [number removed] or [email removed]. Samantha is fine.');
    expect(r.pii).toBe(2); expect(r.masked['Sam Perera']).toBe(1);
  });
});

describe('WhatsApp', () => {
  it('normalises numbers', () => {
    expect(waNum('+94 77 123 4567', '')).toBe('94771234567');
    expect(waNum('0771234567', '94')).toBe('94771234567');
    expect(waNum('0771234567', '')).toBeNull();
    expect(waNum('0094771234567', '')).toBe('94771234567');
    expect(waNum('123', '')).toBeNull();
  });
  it('fills the templates', () => {
    expect(msgText('Academy', 'class_cancel', { student: 'Sam', subject: 'Chemistry', date: 'Mon', time: '5pm', reason: 'Unwell' })).toContain('Reason: Unwell');
  });
});
