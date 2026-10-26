// Formatting, constants and small helpers shared by every screen.
import { addDays, dateInTz, zonedToUtc } from './tz';
import type { AttStatus, ExamType, ResType, SubjectId } from './types';

// The academy time zone and main currency, set once settings are loaded.
const C = { tz: 'Asia/Dubai', currency: 'AED' };
export function setFormatConfig(s: { tz: string; currency: string }) { C.tz = s.tz; C.currency = s.currency; }
export const tz = () => C.tz;
export const mainCurrency = () => C.currency;

export const SUBJECTS: { id: SubjectId; name: string }[] = [
  { id: 'chem', name: 'Chemistry' }, { id: 'phys', name: 'Physics' }, { id: 'math', name: 'Mathematics' },
];
export const subj = (id: string | null | undefined) => SUBJECTS.find(s => s.id === id)?.name || '?';

export const CURRENCIES: Record<string, string> = {
  AED: 'UAE Dirham', USD: 'US Dollar', EUR: 'Euro', GBP: 'British Pound', SAR: 'Saudi Riyal', QAR: 'Qatari Riyal', KWD: 'Kuwaiti Dinar',
  OMR: 'Omani Rial', BHD: 'Bahraini Dinar', INR: 'Indian Rupee', PKR: 'Pakistani Rupee', LKR: 'Sri Lankan Rupee', BDT: 'Bangladeshi Taka',
  PHP: 'Philippine Peso', EGP: 'Egyptian Pound', JOD: 'Jordanian Dinar', NPR: 'Nepalese Rupee',
};
export const METHOD: Record<string, string> = { cash: 'Cash', bank_transfer: 'Bank transfer', online: 'Online' };
export const KIND: Record<string, string> = {
  resource_shared: 'Study material', class_info: 'Class details', class_reminder: 'Class reminder', class_change: 'Schedule change',
  class_cancel: 'Cancellation', fee_reminder: 'Fee reminder', announcement: 'Announcement', receipt: 'Receipt',
};
export const RTYPES: Record<ResType, string> = {
  notes: 'Notes', worksheet: 'Worksheet', question_paper: 'Question paper', model_paper: 'Model paper', presentation: 'Presentation',
  image: 'Image', video: 'Video', other: 'Other',
};
export const REXAMS: Record<ExamType, string> = {
  none: 'General', class_test: 'Class test', term_exam: 'Term exam', mock_exam: 'Mock exam', final_exam: 'Final exam', assignment: 'Assignment', revision: 'Revision',
};
export const RICON: Record<ResType, string> = { notes: '📝', worksheet: '📄', question_paper: '❓', model_paper: '🎯', presentation: '📊', image: '🖼️', video: '▶️', other: '📎' };
export const ASTAT: Record<AttStatus, [string, string]> = { present: ['Present', 'ok'], late: ['Late', 'warn'], absent: ['Absent', 'bad'] };

// ---------------------------------------------------------------- dates
export function fmt(iso: string | null | undefined, o: Intl.DateTimeFormatOptions): string {
  return iso ? new Intl.DateTimeFormat('en-GB', { timeZone: C.tz, ...o }).format(new Date(iso)) : '—';
}
export const fDate = (i: string | null | undefined) => fmt(i, { weekday: 'short', day: 'numeric', month: 'short' });
export const fDateY = (i: string | null | undefined) => fmt(i, { day: 'numeric', month: 'short', year: 'numeric' });
export const fTime = (i: string | null | undefined) => fmt(i, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const fDateISO = (i: string | number | Date) => dateInTz(i, C.tz);
export const fDT = (i: string | null | undefined) => (i ? `${fDateY(i)}, ${fTime(i)}` : '—');
/** value for <input type="datetime-local"> in the academy zone */
export const localInput = (iso: string) =>
  new Intl.DateTimeFormat('sv', { timeZone: C.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)).replace(' ', 'T');
export const todayStr = (d = 0) => fDateISO(Date.now() + d * 864e5);
export const dayRange = (d: string): [string, string] => [zonedToUtc(d + 'T00:00', C.tz)!, zonedToUtc(addDays(d, 1) + 'T00:00', C.tz)!];
export const monthOf = (iso: string) => fDateISO(iso).slice(0, 7);
export const monthLabelOf = (m: string) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(m + '-01T12:00:00Z'));
export const lastMonth = () => { const d = new Date(todayStr().slice(0, 8) + '01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
export const shortD = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: C.tz }).format(new Date(iso));
export const dayText = (d: string) => (d ? fDateY(zonedToUtc(d + 'T12:00', C.tz)) : '—');
export const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00Z').getTime() - new Date(a + 'T12:00:00Z').getTime()) / 864e5);
export const endIso = (c: { start_at: string; duration_min: number }) => new Date(new Date(c.start_at).getTime() + c.duration_min * 60000).toISOString();
export const dur = (s: number | null | undefined) => (s == null ? '—' : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : `${Math.round(s / 60)} min`);
export const mmss = (s: number | null | undefined) => { const n = Math.max(0, Math.round(s || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
export const parseT = (v: string): number => { const t = String(v).trim(); if (/^\d+$/.test(t)) return +t; const m = /^(\d+):(\d{1,2})$/.exec(t); return m ? +m[1] * 60 + +m[2] : NaN; };
export const num = (n: number | null | undefined) => (n == null ? '—' : new Intl.NumberFormat('en-US').format(n));

// ---------------------------------------------------------------- money (kept as whole minor units, e.g. fils or cents)
export const validCode = (c: string) => {
  if (!/^[A-Z]{3}$/.test(c)) return false;
  try { const l = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('currency'); return l ? l.includes(c) : true; } catch { return true; }
};
export const dp = (cur: string): number => {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits ?? 2; } catch { return 2; }
};
export function money(minor: number, cur?: string): string {
  const c = cur || C.currency, d = dp(c);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: c, currencyDisplay: 'code', minimumFractionDigits: d, maximumFractionDigits: d })
      .format(minor / 10 ** d).replace(/ /g, ' ');
  } catch { return `${c} ${(minor / 10 ** d).toFixed(d)}`; }
}
export const toMinor = (x: number | string, cur: string) => Math.round(Number(x) * 10 ** dp(cur));
export const fromMinor = (minor: number, cur: string) => Number(minor) / 10 ** dp(cur);
export function sumBy<T extends { cur: string }>(rows: (T & Record<string, number | string>)[], key: string): Record<string, number> {
  return rows.reduce<Record<string, number>>((m, r) => { const v = r[key] as number; if (v > 0) m[r.cur] = (m[r.cur] || 0) + v; return m; }, {});
}
export const totalsText = (o: Record<string, number>) => Object.entries(o).filter(([, v]) => v > 0).map(([c, v]) => money(v, c)).join(' · ') || money(0);

// ---------------------------------------------------------------- misc
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s || '');
/** School name: free text for reference only. Spellings that differ only by capitals or spaces count as one school. */
export const skey = (x: string | null | undefined) => String(x || '').replace(/\s+/g, ' ').trim().toLowerCase();
export const tidySchool = (x: string | null | undefined) => String(x ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
export const csvOf = (rows: (string | number | null | undefined)[][]) => rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
export function downloadBlob(name: string, blob: Blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export const saveFile = (name: string, text: string, mime: string) => downloadBlob(name, new Blob([text], { type: mime }));
