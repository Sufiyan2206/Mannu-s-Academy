'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { db } from '@/lib/client';
import { useApp } from '@/state/app';
import { endIso, fDate, fTime, localInput, SUBJECTS, subj, tz } from '@/lib/format';
import { zonedToUtc } from '@/lib/tz';
import type { ClassRow } from '@/lib/types';
import { Field, Form, Options, useUI } from './ui';
import { classItems, NotifyOptions, useClassMessage, useOutbox } from './whatsapp';
import type { To } from '@/lib/whatsapp';

export function ClassCard({ c, showDate }: { c: ClassRow; showDate?: boolean }) {
  const app = useApp(), notify = useClassMessage();
  const st = app.cstate(c), a = app.att(c.id), taken = !!a?.taken_at;
  const present = taken ? Object.values(a!.rows).filter(r => r.status === 'present' || r.status === 'late').length : 0;
  const announced = app.announced(c);
  const chip = st === 'cancelled' ? <span className="chip bad">Cancelled</span>
    : st === 'live' ? <span className="chip ok">In progress</span>
    : st === 'ended' ? (taken ? <span className="chip ok">Attendance {present}/{Object.keys(a!.rows).length}</span> : <span className="chip warn">Attendance needed</span>)
    : announced ? <span className="chip ok">Announced</span> : <span className="chip warn">Not announced</span>;
  return (
    <div className={`cls sub-${subj(c.subject_id)} ${st === 'cancelled' ? 'cancelled' : ''}`}>
      <div className="bar" />
      <div className="time"><b>{fTime(c.start_at)}</b><span>{showDate ? fDate(c.start_at) : 'to ' + fTime(endIso(c))}</span></div>
      <div className="body">
        <div className="row between wrap"><h3>{subj(c.subject_id)}</h3>{chip}</div>
        <div className="meta">{app.bname(c.batch_id)} · {c.teacher_name || 'No teacher'}{showDate ? ' · to ' + fTime(endIso(c)) : ''}</div>
        <div className="acts">
          {(st === 'upcoming' || st === 'live') && <a className="btn sm" href={c.join_url} target="_blank" rel="noopener">Open Zoom link</a>}
          {st === 'upcoming' && !announced && <button className="btn sm" onClick={() => notify(c, 'class_info')}>Send details</button>}
          <Link className="btn sm" href={`/classes/${c.id}`}>{st === 'ended' ? 'Attendance' : 'Manage'}</Link>
        </div>
      </div>
    </div>
  );
}

/** Schedule a new class, or reschedule an existing one. */
export function useSchedule() {
  const app = useApp(), { openModal, toast } = useUI(), router = useRouter(), outbox = useOutbox();
  return useCallback((c?: ClassRow) => {
    if (!app.batches.length) { toast('Add a batch first (Students → Batches)', true); router.push('/students'); return; }
    const known = [...new Map(app.classes.filter(x => x.teacher_name).map(x => [x.teacher_name, x.teacher_phone])).entries()];
    const dflt = c ? localInput(c.start_at) : localInput(new Date(Date.now() + 864e5).toISOString()).slice(0, 11) + '17:00';
    openModal(c ? 'Reschedule class' : 'Schedule class', close => (
      <Form close={close} label={c ? 'Save changes' : 'Schedule class'} onSubmit={async f => {
        const start = zonedToUtc(f.get('start'), tz()), d = Number(f.get('dur'));
        if (!f.get('batch')) throw new Error('Choose a batch.'); if (!f.get('sub')) throw new Error('Choose a subject.');
        if (!start) throw new Error('Choose the class date and time.'); if (!(d >= 15 && d <= 480)) throw new Error('Duration must be between 15 and 480 minutes.');
        if (!/^https:\/\//.test(f.trim('url'))) throw new Error('Paste the Zoom join link (it starts with https://).');
        if (!c && new Date(start).getTime() < Date.now() - 300000) throw new Error('The class start time is in the past.');
        const o = {
          batch_id: f.get('batch'), subject_id: f.get('sub'), start_at: start, duration_min: d, teacher_name: f.trim('tn'), teacher_phone: f.trim('tp'),
          join_url: f.trim('url'), agenda: f.trim('agenda'), title: f.trim('title') || `${subj(f.get('sub'))} – ${app.bname(f.get('batch'))}`,
        };
        const res = c
          ? await db.from('classes').update(o).eq('id', c.id).select('*').single()
          : await db.from('classes').insert({ ...o, created_by: app.by }).select('*').single();
        if (res.error) throw new Error(res.error.message);
        const cls = res.data as ClassRow;
        await app.reload('classes');
        close(); toast(c ? 'Class updated' : 'Class scheduled');
        const to = f.get('notify') as To | 'none';
        if (to !== 'none') outbox(c ? 'Schedule change' : 'Class details', classItems(app, cls, c ? 'class_change' : 'class_info', to));
        router.push(`/classes/${cls.id}`);
      }}>
        <div className="two">
          <Field label="Batch"><select name="batch" defaultValue={c?.batch_id || ''}><Options items={app.batches} placeholder="Choose a batch" /></select></Field>
          <Field label="Subject"><select name="sub" defaultValue={c?.subject_id || ''}><Options items={SUBJECTS} placeholder="Choose a subject" /></select></Field>
        </div>
        <div className="two">
          <Field label={`Date and time (${tz()})`}><input name="start" type="datetime-local" defaultValue={dflt} /></Field>
          <Field label="Duration (minutes)"><input name="dur" type="number" inputMode="numeric" min={15} max={480} step={5} defaultValue={c?.duration_min || 60} /></Field>
        </div>
        <div className="two">
          <Field label="Teacher"><input name="tn" list="tl" defaultValue={c?.teacher_name || ''} autoComplete="off" /><datalist id="tl">{known.map(([n]) => <option key={n} value={n} />)}</datalist></Field>
          <Field label="Teacher phone" hint="(shared with students)"><input name="tp" type="tel" defaultValue={c?.teacher_phone || ''} /></Field>
        </div>
        <Field label="Zoom meeting link"><input name="url" type="url" inputMode="url" placeholder="https://zoom.us/j/…" defaultValue={c?.join_url || ''} /></Field>
        <p className="mute small" style={{ marginTop: -6 }}>Create the meeting in Zoom (turn on “Require authentication” so each student’s email is recorded), then paste its join link here. Classes with a Zoom cloud recording are picked up automatically when the Zoom webhook is set up.</p>
        <Field label="Title" hint="(optional)"><input name="title" defaultValue={c && c.title !== `${subj(c.subject_id)} – ${app.bname(c.batch_id)}` ? c.title : ''} /></Field>
        <Field label="Agenda" hint="(optional)"><textarea name="agenda" defaultValue={c?.agenda || ''} /></Field>
        <NotifyOptions change={!!c} />
      </Form>
    ));
  }, [app, openModal, toast, router, outbox]);
}
