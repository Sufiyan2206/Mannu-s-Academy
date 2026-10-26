'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { addDays } from '@/lib/tz';
import { todayStr } from '@/lib/format';
import { useApp } from '@/state/app';

export const ATT_REPORTS: [string, string, string][] = [
  ['att-student', 'Attendance summary', 'Each student’s Present, Late and Absent counts and attendance % for the dates you choose'],
  ['att-class', 'Attendance by class', 'One row per class: how many were present, late or absent'],
  ['att-register', 'Attendance register', 'Students down the side, class dates across, P / L / A in every cell'],
  ['att-absent', 'Absent students', 'Every absence in the range, and who was absent most'],
  ['att-late', 'Late arrivals', 'Who arrived late, when, and any note'],
  ['att-low', 'Low attendance', 'Students whose attendance is below a percentage you choose'],
  ['att-school', 'Attendance by school', 'Totals grouped by the school entered for each student'],
  ['att-missing', 'Classes with no attendance recorded', 'Finished classes that still need attendance, so they are not missing from reports'],
];
export const OUT_REPORTS: [string, string, string][] = [
  ['out-student', 'Outstanding fees by student', 'Who owes what today, with the amount overdue and the oldest unpaid due date'],
  ['out-overdue', 'Overdue fees', 'Every unpaid fee past its due date, with days overdue'],
  ['out-ageing', 'Overdue ageing', 'Outstanding fees grouped by how long they have been overdue'],
  ['out-batch', 'Outstanding by batch', 'Outstanding and overdue amounts for each batch'],
  ['out-subject', 'Outstanding by subject', 'Outstanding and overdue amounts for each subject'],
  ['out-month', 'Outstanding by month', 'Outstanding and overdue amounts for each billing month'],
  ['out-soon', 'Fees due in the next 7 days', 'Unpaid fees falling due soon'],
  ['out-credit', 'Advance payments (credit balances)', 'Students who have paid more than they have been charged'],
  ['out-payments', 'Payments received', 'Payments in a date range, with totals by method'],
];
export const PARENT_REPORTS: [string, string, string][] = [
  ['parent', 'Monthly attendance report for parents', 'A neat PDF for each student to share with their parent or guardian by WhatsApp or email'],
];
export const reportTitle = (id: string) => [...ATT_REPORTS, ...OUT_REPORTS, ...PARENT_REPORTS].find(r => r[0] === id)?.[1] || '';

export function ReportHead({ id, children }: { id: string; children?: ReactNode }) {
  const app = useApp(), router = useRouter();
  const groups: [string, [string, string, string][]][] = [['Attendance Reports', ATT_REPORTS], ...(app.isAdmin ? [['Outstanding Reports', OUT_REPORTS] as [string, [string, string, string][]], ['Parent Reports', PARENT_REPORTS] as [string, [string, string, string][]]] : [])];
  return (
    <>
      <div className="row between" style={{ marginBottom: 6 }}><Link href="/reports" className="small" style={{ textDecoration: 'none' }}>‹ All reports</Link></div>
      <div className="head"><h1 style={{ fontSize: '1.4rem' }}>{reportTitle(id)}</h1></div>
      <label htmlFor="rv" className="small mute">Switch report</label>
      <select id="rv" aria-label="Switch report" style={{ marginBottom: 12 }} value={id} onChange={e => router.push('/reports/' + e.target.value)}>
        {groups.map(([n, g]) => <optgroup key={n} label={n}>{g.map(r => <option key={r[0]} value={r[0]}>{r[1]}</option>)}</optgroup>)}
      </select>
      {children}
    </>
  );
}

export const PRESETS: Record<string, [string, () => [string, string]]> = {
  today: ['Today', () => [todayStr(), todayStr()]],
  week: ['This week', () => { const t = todayStr(), wd = (new Date(t + 'T12:00:00Z').getUTCDay() + 6) % 7; return [addDays(t, -wd), t]; }],
  d7: ['Last 7 days', () => [addDays(todayStr(), -6), todayStr()]],
  d30: ['Last 30 days', () => [addDays(todayStr(), -29), todayStr()]],
  month: ['This month', () => [todayStr().slice(0, 8) + '01', todayStr()]],
  last: ['Last month', () => { const e = addDays(todayStr().slice(0, 8) + '01', -1); return [e.slice(0, 8) + '01', e]; }],
};

export function PresetBar({ keys, value, onPick }: { keys: string[]; value: string; onPick: (k: string) => void }) {
  return (
    <div className="seg wrapseg" role="group" aria-label="Date range">
      {keys.map(k => <button key={k} type="button" aria-pressed={k === value} onClick={() => onPick(k)}>{PRESETS[k][0]}</button>)}
      <button type="button" aria-pressed={value === 'custom'} onClick={() => onPick('custom')}>Custom</button>
    </div>
  );
}

export const Cell2 = ({ a, b }: { a: ReactNode; b?: ReactNode }) => <td><b>{a}</b>{b ? <div className="mute small">{b}</div> : null}</td>;
export function RTbl({ head, children, cls = '' }: { head: ReactNode[]; children: ReactNode; cls?: string }) {
  return <div className="tbl"><table className={'cmp ' + cls}><thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}
export const PctChip = ({ p }: { p: number | null }) => p == null ? <>—</> : <span className={`chip ${p < 60 ? 'bad' : p < 80 ? 'warn' : 'ok'}`}>{p}%</span>;

/** A date-range check shared by the reports. Returns an error message, or '' when fine. */
export function rangeError(from: string, to: string): string {
  if (!from || !to) return '…';
  if (from > to) return 'The “From” date is after the “To” date.';
  if (Math.round((new Date(to).getTime() - new Date(from).getTime()) / 864e5) > 366) return 'Choose a range of one year or less.';
  return '';
}
