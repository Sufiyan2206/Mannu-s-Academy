'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { db } from '@/lib/client';
import { useApp } from '@/state/app';
import { dur, endIso, fDate, fDT, fTime, subj } from '@/lib/format';
import type { AttAudit, AttRow } from '@/lib/types';
import type { To } from '@/lib/whatsapp';
import { AttendanceEditor, AttTable, ImportZoom } from '@/components/attendance';
import { useSchedule } from '@/components/classes';
import { ResCard, useResources } from '@/components/resources';
import { classItems, useClassMessage, useOutbox } from '@/components/whatsapp';
import { Empty, Field, Form, Spin, useRun, useUI } from '@/components/ui';

export default function ClassPage() {
  const { id } = useParams<{ id: string }>();
  const app = useApp(), { openModal, toast } = useUI(), run = useRun();
  const schedule = useSchedule(), message = useClassMessage(), outbox = useOutbox(), res = useResources();
  const c = app.classes.find(x => x.id === id);
  const [ready, setReady] = useState(false);
  const [audit, setAudit] = useState<AttAudit[]>([]);

  const a = c ? app.att(c.id) : undefined;
  useEffect(() => {
    if (!c) return;
    run(async () => { await app.ensureAtt([c.id]); setAudit(await app.loadAudit(c.id)); setReady(true); });
  }, [c?.id, a?.taken_at, a && Object.keys(a.rows).length]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => a ? Object.entries(a.rows).map(([sid, r]) => ({ sid, ...r } as AttRow & { sid: string })).sort((x, y) => app.sname(x.sid).localeCompare(app.sname(y.sid))) : [], [a, app.students]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!c) return <Empty>Class not found.</Empty>;
  if (!ready) return <Spin />;
  const st = app.cstate(c), started = Date.now() >= new Date(c.start_at).getTime(), people = app.enrolled(c);
  const materials = app.resources.filter(r => r.class_id === c.id && r.status === 'active');

  const cancel = () => openModal('Cancel class', close => (
    <Form close={close} danger label="Cancel class" onSubmit={async f => {
      const { error } = await db.from('classes').update({ status: 'cancelled', cancel_reason: f.trim('r') }).eq('id', c.id);
      if (error) throw new Error(error.message);
      await app.reload('classes');
      close(); toast('Class cancelled');
      const to = f.get('n') as To | 'none';
      if (to !== 'none') outbox('Cancellation', classItems(app, { ...c, status: 'cancelled', cancel_reason: f.trim('r') }, 'class_cancel', to));
    }}>
      <Field label="Reason (shared with students)"><input name="r" placeholder="e.g. Teacher unwell" /></Field>
      <Field label="Prepare WhatsApp cancellation?"><select name="n"><option value="both">Yes – students and parents</option><option value="students">Yes – students only</option><option value="parents">Yes – parents only</option><option value="none">No</option></select></Field>
      <p className="mute small">Also cancel the meeting in Zoom.</p>
    </Form>
  ));

  return (
    <>
      <Link href="/classes">← Classes</Link>
      <div className={`head mt sub-${subj(c.subject_id)}`}>
        <div><h1><span className="dot" />{c.title}</h1><div className="mute">{fDate(c.start_at)}, {fTime(c.start_at)} – {fTime(endIso(c))} · {app.bname(c.batch_id)}</div></div>
        {st === 'cancelled' ? <span className="chip bad">Cancelled</span> : st === 'live' ? <span className="chip ok">In progress</span> : null}
      </div>
      <div className="card stack">
        <dl className="kv">
          <dt>Teacher</dt><dd>{c.teacher_name || '—'}{c.teacher_phone ? ' · ' + c.teacher_phone : ''}</dd>
          <dt>Students</dt><dd>{people.length} enrolled</dd>
          {c.agenda && <><dt>Agenda</dt><dd>{c.agenda}</dd></>}
          {c.cancel_reason && <><dt>Cancelled</dt><dd>{c.cancel_reason}</dd></>}
        </dl>
        <div className="copy">{c.join_url}</div>
        <div className="row wrap">
          <a className="btn primary" href={c.join_url} target="_blank" rel="noopener">Open Zoom link</a>
          <button className="btn" onClick={() => navigator.clipboard?.writeText(c.join_url).then(() => toast('Copied'), () => toast('Copy failed – select the text and copy it by hand', true))}>Copy link</button>
          {st !== 'cancelled' && <button className="btn" onClick={() => message(c, st === 'ended' ? 'class_info' : 'class_reminder')}>Send WhatsApp</button>}
          {st === 'upcoming' && <button className="btn" onClick={() => schedule(c)}>Reschedule</button>}
          {st !== 'cancelled' && st !== 'ended' && <button className="btn danger" onClick={cancel}>Cancel class</button>}
        </div>
      </div>

      <div className="sec"><h2>Study materials</h2>{c.status !== 'cancelled' && <button className="btn sm" onClick={() => res.form(undefined, { subject_id: c.subject_id, batch_id: c.batch_id, class_id: c.id })}>Share material</button>}</div>
      {materials.length ? materials.map(r => <ResCard key={r.id} r={r} />) : <Empty>No materials linked to this class yet.</Empty>}

      {st !== 'cancelled' && (
        <>
          <div className="sec"><h2>Attendance</h2>
            <div className="row">
              {started && <button className="btn sm" onClick={() => openModal('Import Zoom attendance', close => <ImportZoom c={c} close={close} />)}>Import Zoom report</button>}
              {started && <button className={`btn sm ${rows.length ? '' : 'primary'}`} onClick={() => openModal(rows.length ? 'Correct attendance' : 'Mark attendance by hand', close => <AttendanceEditor c={c} close={close} />)}>{rows.length ? 'Mark or correct by hand' : 'Mark attendance by hand'}</button>}
            </div>
          </div>
          {!started ? <Empty>Attendance opens when the class starts.</Empty> : <AttTable c={c} a={a} rows={rows} />}
          {a && a.unmatched.length > 0 && (
            <>
              <div className="sec"><h3>Zoom participants not matched</h3></div>
              <div className="card list small">{a.unmatched.map((u, i) => (
                <div key={i}><div className="grow">{u.name || 'Unknown'}<div className="mute">{u.email || 'no email'} · {dur(u.duration_sec)}</div></div><span className="mute">{u.reason}</span></div>
              ))}</div>
              <p className="mute small">If a student joined with a different email, add it as their Zoom login email, or correct attendance by hand.</p>
            </>
          )}
          {audit.length > 0 && (
            <>
              <div className="sec"><h3>Change history</h3></div>
              <div className="card list small">{[...audit].reverse().map((x, i) => (
                <div key={i}>
                  <div className="grow"><b>{app.sname(x.student_id)}</b>: {x.old_value?.status || '—'} → {x.new_value.status}<div className="mute">{x.reason}</div></div>
                  <div className="right mute">{x.by_name}<br />{fDT(x.at)}</div>
                </div>
              ))}</div>
            </>
          )}
        </>
      )}
    </>
  );
}
