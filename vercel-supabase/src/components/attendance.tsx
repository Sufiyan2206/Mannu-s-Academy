'use client';
import { useState } from 'react';
import { db } from '@/lib/client';
import { useApp } from '@/state/app';
import { ASTAT, dur, endIso, fDateY, fDT, fTime, localInput, subj, tz } from '@/lib/format';
import { zonedToUtc } from '@/lib/tz';
import { mergeRows, parseZoom, toZoomRows, zoomToRows, type BuiltRow } from '@/lib/attendance';
import type { AttDoc, AttRow, AttStatus, ClassRow } from '@/lib/types';
import { Empty, Field, Form, useUI } from './ui';

export const AChip = ({ st }: { st?: AttStatus }) => st ? <span className={`chip ${ASTAT[st][1]}`}>{ASTAT[st][0]}</span> : <span className="chip">Not marked</span>;

async function save(c: ClassRow, rows: AttRow[], audits: unknown[], zoom: unknown[] | null, unmatched: unknown[] | null) {
  const { error } = await db.rpc('apply_attendance', {
    p_class: c.id, p_rows: rows, p_zoom: zoom, p_unmatched: unmatched, p_audits: audits,
  });
  if (error) throw new Error(error.message);
}

export function ImportZoom({ c, close }: { c: ClassRow; close: () => void }) {
  const app = useApp(), { toast } = useUI();
  return (
    <Form close={close} label="Match and save" onSubmit={async f => {
      const file = f.file('file'), text = file ? await file.text() : f.get('txt');
      if (!text.trim()) throw new Error('Choose a CSV file or paste the report.');
      const parts = parseZoom(text, tz()), people = app.enrolled(c);
      const { build, unmatched, matched } = zoomToRows(parts, people, c, { minPct: app.settings.min_pct, lateAfter: app.settings.late_after });
      await app.ensureAtt([c.id]);
      const existing = app.att(c.id)?.rows || {};
      const { rows, audits } = mergeRows(existing, build, 'Zoom import', 'Re-imported from Zoom', new Date().toISOString());
      await save(c, rows, audits, toZoomRows(build), unmatched);
      await app.refreshAtt([c.id]);
      close(); toast(`${matched} matched, ${unmatched.length} not matched`);
    }}>
      <p className="mute small">In Zoom (web portal): Reports → Usage → Meeting, open this meeting, and export the participants report as CSV. Upload it, or paste its contents. Times are read in {tz()}.</p>
      <Field label="CSV file"><input name="file" type="file" accept=".csv,text/csv,text/plain" /></Field>
      <Field label="…or paste the report"><textarea name="txt" placeholder="Name (original name),User Email,Join Time,Leave Time,Duration (Minutes)…" /></Field>
    </Form>
  );
}

interface Card { status: AttStatus | ''; j: string; l: string; n: string }
export function AttendanceEditor({ c, close }: { c: ClassRow; close: () => void }) {
  const app = useApp(), { toast } = useUI();
  const a0 = app.att(c.id), zr = a0?.zoom || {}, by = a0?.rows || {}, people = app.enrolled(c), has = Object.keys(by).length > 0;
  const startDay = localInput(c.start_at).slice(0, 10), startTod = localInput(c.start_at).slice(11, 16), endI = endIso(c), crosses = localInput(endI).slice(0, 10) !== startDay;
  const toLocal = (t: string) => !t ? '' : ((t < startTod && crosses ? localInput(endI).slice(0, 10) : startDay) + 'T' + t);
  const tod = (iso: string | null | undefined) => iso ? localInput(iso).slice(11, 16) : '';
  const minuteOf = (t: string | null) => t ? new Date(t).toISOString().slice(0, 16) : null;

  const [cards, setCards] = useState<Record<string, Card>>(() => Object.fromEntries(people.map(s => {
    const a = by[s.id];
    return [s.id, { status: (a?.status || '') as Card['status'], j: tod(a?.join_time), l: tod(a?.leave_time), n: a?.note || '' }];
  })));
  const upd = (id: string, p: Partial<Card>) => setCards(m => ({ ...m, [id]: { ...m[id], ...p } }));
  const unmarked = people.filter(s => !cards[s.id].status).length;

  return (
    <Form close={close} label={has ? 'Save changes' : 'Save attendance'} onSubmit={async f => {
      const missing = people.filter(s => !cards[s.id].status);
      if (missing.length) throw new Error(`Mark ${missing.length === 1 ? 'this student' : missing.length + ' students'} as Present, Late or Absent.`);
      const build: Record<string, BuiltRow> = {}; let touched = false;
      for (const s of people) {
        const k = cards[s.id], j = zonedToUtc(toLocal(k.j), tz()), l = zonedToUtc(toLocal(k.l), tz()), note = k.n.replace(/\s+/g, ' ').trim().slice(0, 200);
        if (j && l && l < j) throw new Error('Leave time must be after the arrival time.');
        const ex: AttRow | undefined = by[s.id];
        if (ex && ex.status === k.status && minuteOf(ex.join_time) === minuteOf(j) && minuteOf(ex.leave_time) === minuteOf(l) && (ex.note || '') === note) continue;
        build[s.id] = { status: k.status as AttStatus, join_time: j, leave_time: l, duration_sec: j && l ? Math.round((new Date(l).getTime() - new Date(j).getTime()) / 1000) : null, source: 'manual', note };
        if (ex) touched = true;
      }
      const reason = f.trim('reason');
      if (touched && !reason) throw new Error('Enter a reason for the correction.');
      if (!Object.keys(build).length) { close(); toast('No changes'); return; }
      const { rows, audits } = mergeRows(by, build, app.by, reason || 'Manual entry', new Date().toISOString());
      await save(c, rows, audits, null, null);
      await app.refreshAtt([c.id]);
      close(); toast('Attendance saved');
    }}>
      <div className="alert info" style={{ display: 'block' }}>
        <b>{subj(c.subject_id)}</b> · {app.bname(c.batch_id)}<br />{fDateY(c.start_at)} · {fTime(c.start_at)} – {fTime(endI)} · {c.teacher_name}
        <div className="small" style={{ marginTop: 4 }}>Mark every student. “Arrived at” is the time the student joined; it is optional, but useful for Late.{Object.keys(zr).length ? ' Zoom’s record is shown under each name so you can compare.' : ''}</div>
      </div>
      <div className="row between mt">
        <span className="mute small">{unmarked ? `${unmarked} not marked yet` : 'All students marked'}</span>
        <button type="button" className="btn sm" onClick={() => setCards(m => Object.fromEntries(Object.entries(m).map(([id, k]) => [id, k.status ? k : { ...k, status: 'present' as const }])))}>Mark all Present</button>
      </div>
      <div className="stack mt">
        {people.map(s => {
          const k = cards[s.id], z = zr[s.id];
          return (
            <div className="card" key={s.id}>
              <b>{s.name}</b>
              <div className="seg att" role="radiogroup" aria-label={`Status for ${s.name}`} style={{ margin: '8px 0' }}>
                {(['present', 'late', 'absent'] as const).map(st => (
                  <label key={st} className={st}><input type="radio" name={`st${s.id}`} value={st} checked={k.status === st} onChange={() => upd(s.id, { status: st })} /><span>{ASTAT[st][0]}</span></label>
                ))}
              </div>
              <div className="two">
                <div><label>Arrived at <span className="mute">(optional)</span></label><input type="time" value={k.j} onChange={e => upd(s.id, { j: e.target.value })} /></div>
                <div><label>Left at <span className="mute">(optional)</span></label><input type="time" value={k.l} onChange={e => upd(s.id, { l: e.target.value })} /></div>
              </div>
              <input maxLength={200} placeholder="Note (optional), e.g. joined by phone" value={k.n} onChange={e => upd(s.id, { n: e.target.value })} style={{ marginTop: 8 }} aria-label={`Note for ${s.name}`} />
              {z ? (
                <div className="small mute" style={{ marginTop: 6 }}>
                  Zoom: <AChip st={z.status} /> {z.join_time ? 'joined ' + fTime(z.join_time) + ' · ' : ''}{dur(z.duration_sec)}{' '}
                  <button type="button" className="btn sm" onClick={() => upd(s.id, { status: z.status, j: tod(z.join_time), l: tod(z.leave_time) })}>Use Zoom’s</button>
                </div>
              ) : Object.keys(zr).length ? <div className="small mute" style={{ marginTop: 6 }}>Zoom: no record for this student</div> : null}
            </div>
          );
        })}
        {!people.length && <Empty>No students are enrolled in this batch and subject.</Empty>}
      </div>
      <Field className="mt" label={has ? 'Reason for correction' : 'Note for the record'} hint={has ? '(saved in the change history)' : '(optional)'}><input name="reason" placeholder="e.g. Joined by phone without logging in" /></Field>
    </Form>
  );
}

export function AttTable({ c, a, rows }: { c: ClassRow; a: AttDoc | undefined; rows: (AttRow & { sid: string })[] }) {
  const app = useApp();
  if (!rows.length) return <Empty>No attendance recorded yet. Use “Mark attendance by hand”, or import the Zoom participants report.</Empty>;
  const zr = a?.zoom || {}, n = (k: AttStatus) => rows.filter(r => r.status === k).length;
  const differs = (r: AttRow & { sid: string }) => zr[r.sid] && zr[r.sid].status !== r.status;
  const cfg = app.settings;
  return (
    <>
      <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
        <span className="chip ok">Present {n('present')}</span><span className="chip warn">Late {n('late')}</span><span className="chip bad">Absent {n('absent')}</span>
      </div>
      <div className="tbl"><table>
        <thead><tr><th>Student</th><th>Status</th><th>Arrived</th><th>Left</th><th>Time in class</th><th>Recorded by</th><th>Note</th></tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.sid}>
            <td>{app.sname(r.sid)}</td>
            <td><AChip st={r.status} />{differs(r) && <> <span className="chip plain">≠ Zoom</span></>}</td>
            <td>{r.join_time ? fTime(r.join_time) : '—'}</td><td>{r.leave_time ? fTime(r.leave_time) : '—'}</td><td>{dur(r.duration_sec)}</td>
            <td className="small">{r.source === 'zoom'
              ? <>Zoom report<div className="mute">{fDT(r.updated_at)}</div></>
              : <>Entered by hand<div className="mute">{r.created_by || '—'} · {fDT(r.created_at || r.updated_at)}{r.updated_at !== (r.created_at || r.updated_at) && <><br />Changed by {r.updated_by || '—'} · {fDT(r.updated_at)}</>}</div></>}</td>
            <td className="small">{r.note}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <p className="mute small">Present or Late both count as attended. Zoom marks Present when someone stayed at least {cfg.min_pct}% of the class time.</p>
      {Object.keys(zr).length > 0 && (
        <details className="mt"><summary><b>Compare with Zoom</b> <span className="mute small">({rows.filter(differs).length} differ)</span></summary>
          <div className="tbl" style={{ marginTop: 8 }}><table>
            <thead><tr><th>Student</th><th>Recorded</th><th>Zoom says</th><th>Zoom joined</th><th>Zoom time</th></tr></thead>
            <tbody>{rows.map(r => { const z = zr[r.sid]; return (
              <tr key={r.sid}><td>{app.sname(r.sid)}</td><td><AChip st={r.status} /></td>
                <td>{z ? <><AChip st={z.status} />{differs(r) && <> <span className="chip plain">differs</span></>}</> : <span className="mute">no Zoom record</span>}</td>
                <td>{z?.join_time ? fTime(z.join_time) : '—'}</td><td>{z ? dur(z.duration_sec) : '—'}</td></tr>
            ); })}</tbody>
          </table></div>
          <p className="mute small">Zoom data from the last import. It is only for comparison: what staff entered by hand is what counts. Zoom marks Late when someone joins more than {cfg.late_after} minutes after the start.</p>
        </details>
      )}
    </>
  );
}
