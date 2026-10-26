// WhatsApp click-to-chat messages. Staff tap "Send"; WhatsApp opens with the text filled in and the tap is logged.
import { endIso, fDate, fTime, subj } from './format';
import type { ClassRow, Student } from './types';

/** Digits only, with country code, 8-15 digits; numbers starting with 0 use the default country code from Setup. */
export function waNum(raw: string | null | undefined, cc: string): string | null {
  const s = String(raw || '').trim();
  let d = s.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  else if (!s.startsWith('+') && d.startsWith('0')) { if (!cc) return null; d = cc.replace(/\D/g, '') + d.slice(1); }
  return d.length >= 8 && d.length <= 15 ? d : null;
}

export type MsgKind = 'resource_shared' | 'class_info' | 'class_reminder' | 'class_change' | 'class_cancel' | 'fee_reminder' | 'announcement' | 'receipt';
type V = Record<string, string | undefined>;

export function msgText(academy: string, kind: MsgKind, v: V): string {
  const A = academy;
  const map: Record<MsgKind, string> = {
    resource_shared: `*${A}*\nNew ${v.subject} study material for ${v.student}\nTitle: ${v.title}\nType: ${v.kind}${v.topic ? '\nTopic: ' + v.topic : ''}${v.instructions ? '\nInstructions: ' + v.instructions : ''}\nOpen: ${v.link}`,
    class_info: `*${A}*\nClass details for ${v.student}\nSubject: ${v.subject}\nDate: ${v.date}\nTime: ${v.time}\nTeacher: ${v.teacher}\nZoom link: ${v.link}`,
    class_reminder: `*${A}* reminder\n${v.student}'s ${v.subject} class starts ${v.date} at ${v.time}.\nTeacher: ${v.teacher}\nZoom link: ${v.link}`,
    class_change: `*${A}*\nSchedule change for ${v.student}'s ${v.subject} class.\nNew date: ${v.date}\nNew time: ${v.time}\nTeacher: ${v.teacher}\nZoom link: ${v.link}`,
    class_cancel: `*${A}*\n${v.student}'s ${v.subject} class on ${v.date} at ${v.time} is cancelled.${v.reason ? '\nReason: ' + v.reason : ''}`,
    fee_reminder: `*${A}*\nFee reminder for ${v.student}.\n${v.note}\nAmount outstanding: ${v.amount}${v.contact ? '\nContact: ' + v.contact : ''}`,
    announcement: `*${A}*\nMessage regarding ${v.student}:\n${v.text}`,
    receipt: `*${A}*\n${v.text}`,
  };
  return map[kind];
}

export type To = 'both' | 'students' | 'parents';
export interface Recipient { role: 'student' | 'guardian'; name: string; number: string }
export function recipients(s: Student, to: To): Recipient[] {
  const r: Recipient[] = [];
  if (to !== 'parents') r.push({ role: 'student', name: s.name, number: s.mobile });
  if (to !== 'students') r.push({ role: 'guardian', name: s.guardian_name, number: s.guardian_mobile });
  return r;
}

export function classVars(c: ClassRow, s: Student): V {
  return {
    student: s.name, subject: subj(c.subject_id), date: fDate(c.start_at), time: `${fTime(c.start_at)} – ${fTime(endIso(c))}`,
    teacher: c.teacher_name ? c.teacher_name + (c.teacher_phone ? ` (${c.teacher_phone})` : '') : 'To be announced',
    link: c.join_url, reason: c.cancel_reason,
  };
}

export interface OutItem { kind: MsgKind; student_id: string; class_id: string | null; role: 'student' | 'guardian'; name: string; number: string; text: string }
