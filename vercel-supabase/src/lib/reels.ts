// Reel rules shared by the app and the publishing pipeline: consent, status, YouTube links, captions, name hiding.
import type { Reel, ReelDecision, Student, SubjectId } from './types';

export const RST: Record<string, [string, string]> = {
  draft: ['Draft', ''], awaiting_approval: ['Awaiting approval', 'warn'], scheduled: ['Scheduled', 'sched'], published: ['Published', 'ok'],
  failed: ['Failed', 'bad'], deleted: ['Deleted', 'bad'],
};
export const CLABEL: Record<string, [string, string]> = { granted: ['Consent given', 'ok'], denied: ['Refused / withdrawn', 'bad'], unknown: ['Not recorded', ''] };
export const RTYPE: Record<string, string> = { explanation: 'Explanation', formula: 'Formula', tip: 'Exam tip', problem_solving: 'Problem solving' };

// ---------------------------------------------------------------- consent
export interface Appearance { appears: 'none' | 'students' | null; appearing: string[] }

/** A student may only appear in a Reel when consent is on record. Returns the problem, or '' when all is well. */
export function consentIssue(r: Appearance, consentOf: (studentId: string) => string, nameOf: (studentId: string) => string): string {
  if (!r.appears) return 'Say whether any student appears or is heard in this clip.';
  if (r.appears === 'none') return '';
  if (!r.appearing.length) return 'Choose which students appear in this clip.';
  const bad = r.appearing.filter(id => consentOf(id) !== 'granted');
  return bad.length ? `Consent has not been recorded for: ${bad.map(nameOf).join(', ')}.` : '';
}

export type ReelStateName = 'draft' | 'awaiting_approval' | 'scheduled' | 'published' | 'failed' | 'deleted';
export interface ReelState { s: ReelStateName; note?: string; alert?: string; at?: string | null }

/** The visible status is worked out from the teacher’s draft plus the admin’s decision. */
export function reelState(r: Reel, d: ReelDecision | undefined, issue: string): ReelState {
  if (d?.state === 'deleted' || r.discarded) return { s: 'deleted' };
  if (d?.state === 'published') return { s: 'published', alert: r.appears === 'students' && issue ? 'A student in this Reel no longer has consent on record. Delete it on Instagram as well.' : '' };
  if (d?.state === 'failed' && d.rev === r.rev) return { s: 'failed', note: d.error };
  if (d?.state === 'approved' && d.rev === r.rev) return issue ? { s: 'draft', note: 'Approval paused: ' + issue } : { s: 'scheduled', at: d.scheduled_at };
  if (r.submitted) {
    if (d?.state === 'rejected' && r.submitted_at && d.at >= r.submitted_at) return { s: 'draft', note: d.note || 'Changes requested.' };
    return issue ? { s: 'draft', note: 'Waiting: ' + issue } : { s: 'awaiting_approval' };
  }
  return { s: 'draft' };
}

// ---------------------------------------------------------------- YouTube + captions
export function ytInfo(u: string): string | null {
  try {
    const x = new URL(u);
    if (x.protocol !== 'https:') return null;
    const h = x.hostname.replace(/^www\.|^m\./, '');
    const id = h === 'youtu.be' ? x.pathname.slice(1) : h === 'youtube.com' ? (x.searchParams.get('v') || (/^\/(live|embed)\/([\w-]{6,})/.exec(x.pathname) || [])[2]) : null;
    return id && /^[\w-]{6,20}$/.test(id) ? id : null;
  } catch { return null; }
}
export const ytLink = (u: string, t: number) => { const id = ytInfo(u); return id ? `https://youtu.be/${id}${t > 0 ? '?t=' + Math.round(t) : ''}` : ''; };

const camel = (s: string) => String(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join('');
export function hashtagsFor(sid: string, topic: string, academy: string): string[] {
  const base = ({ chem: ['Chemistry', 'ChemistryTips', 'ChemistryStudents'], phys: ['Physics', 'PhysicsTips', 'PhysicsStudents'], math: ['Maths', 'MathsTips', 'Mathematics'] } as Record<string, string[]>)[sid] || [];
  const t = String(topic || '').split(/[–—\-:,&]/).map(x => camel(x.trim())).filter(x => x.length >= 4 && x.length <= 30).slice(0, 3);
  return [...new Set([...base, ...t, 'StudyTips', 'ExamPreparation', 'LearnOnInstagram', camel(String(academy).replace(/[’']/g, '')).slice(0, 30)])]
    .filter(Boolean).slice(0, 12).map(x => '#' + x);
}

export function buildCaption(d: { title: string; topic: string; subject_id: SubjectId | string; yt_url: string; yt_start: number }, o: { handle: string; academy: string; subjectName: string }): string {
  const link = ytLink(d.yt_url, d.yt_start);
  return [
    `📘 ${o.subjectName} in under a minute: ${d.topic || d.title}`, '',
    d.title && d.title !== d.topic ? `✅ ${d.title}` : null, d.title && d.title !== d.topic ? '' : null,
    `👉 Follow ${o.handle ? '@' + o.handle : 'us'} for daily Chemistry, Physics and Maths lessons.`,
    link ? `📺 Watch the full class on YouTube: ${link}` : null,
    '💬 Save this for revision and share it with a friend!', '',
    hashtagsFor(d.subject_id, d.topic, o.academy).join(' '),
  ].filter(x => x !== null).join('\n').replace(/\n{3,}/g, '\n\n').slice(0, 2200);
}

// ---------------------------------------------------------------- privacy: hide student names, phone numbers and emails
export function nameTokens(students: Pick<Student, 'name' | 'active'>[]): [string, string][] {
  const m = new Map<string, string>();
  for (const s of students.filter(x => x.active)) {
    const full = s.name.trim().replace(/\s+/g, ' ');
    if (full.length >= 3) m.set(full.toLowerCase(), full);
    for (const p of full.split(' ')) if (p.length >= 3 && !/^(bin|van|von|the|and|del|mr|mrs|ms|miss)$/i.test(p)) m.set(p.toLowerCase(), p);
  }
  return [...m.entries()].sort((a, b) => b[0].length - a[0].length);
}
export function redactT(text: string, students: Pick<Student, 'name' | 'active'>[]): { text: string; masked: Record<string, number>; pii: number } {
  let t = String(text ?? ''), pii = 0;
  const masked: Record<string, number> = {};
  t = t.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, () => { pii++; return '[email removed]'; })
    .replace(/(?<!\w)\+?\d[\d\s().-]{6,}\d(?!\w)/g, m => (m.replace(/\D/g, '').length < 7 ? m : (pii++, '[number removed]')));
  for (const [low, shown] of nameTokens(students)) {
    t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}])${low.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu'), () => { masked[shown] = (masked[shown] || 0) + 1; return 'a student'; });
  }
  return { text: t.replace(/(a student)(\s+a student)+/gi, 'a student'), masked, pii };
}
