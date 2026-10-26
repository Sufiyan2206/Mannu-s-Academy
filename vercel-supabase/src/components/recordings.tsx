'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, db } from '@/lib/client';
import { useApp } from '@/state/app';
import { fDate, fDT, fTime, mmss, parseT, SUBJECTS, subj } from '@/lib/format';
import { CLABEL } from '@/lib/reels';
import { startCapture, uploadRecording, type Capture, type CaptureMode } from '@/lib/upload';
import type { RecStage, Recording } from '@/lib/types';
import { Alert, Chip, Empty, Field, Form, Options, useRun, useUI } from './ui';

const STEPS: [string, string][] = [['upload', 'Upload'], ['youtube', 'YouTube'], ['clip', '60-second clip'], ['instagram', 'Instagram']];
const STAGE_LABEL: Record<RecStage, [string, string]> = {
  uploading: ['Uploading', 'warn'], queued: ['Waiting to start', 'warn'], youtube: ['Saving to YouTube', 'sched'], trim: ['Cutting the clip', 'sched'], instagram: ['Publishing on Instagram', 'sched'],
  completed: ['Done', 'ok'], held: ['Waiting for you', 'warn'], failed: ['Needs attention', 'bad'], cancelled: ['Cancelled', 'bad'],
};
/** how many of the four steps are finished, and which one is under way */
function progress(r: Recording): { done: number; current: number | null } {
  const flags = [r.stage !== 'uploading', !!r.yt_video_id, !!r.clip_path, r.stage === 'completed' && r.publish_mode !== 'off'];
  let done = 0;
  while (done < 4 && flags[done]) done++;
  return { done, current: done < 4 && !['failed', 'cancelled', 'held', 'completed'].includes(r.stage) ? done : null };
}

export function RecordingsPanel() {
  const app = useApp(), { openModal } = useUI();
  const [status, setStatus] = useState<{ youtube: { connected: boolean; configured: boolean; channel: string }; instagram: { connected: boolean; username: string } } | null>(null);
  useEffect(() => { if (app.isAdmin) api<typeof status>('/api/integrations/status').then(setStatus).catch(() => {}); }, [app.isAdmin]);
  const s = app.settings;
  const rows = app.recordings;
  const modeText = s.publish_mode === 'auto' ? 'published on Instagram automatically' : s.publish_mode === 'approval' ? 'sent to Reels for an admin to approve before publishing' : 'saved as a draft Reel (publishing is off)';
  return (
    <>
      <div className="alert info" style={{ display: 'block' }}>
        <b>One recording → YouTube → {s.reel_len_sec}-second Reel → Instagram.</b> Add a class recording (record it here or upload the file). The full class is saved to YouTube ({s.yt_privacy}), a vertical {s.reel_len_sec}-second clip is cut starting at {mmss(s.reel_start_sec)}, and the Reel is {modeText}.
      </div>
      {status && (!status.youtube.connected || !status.instagram.connected) && (
        <div className="alert"><span>{!status.youtube.connected && 'YouTube is not connected. '}{!status.instagram.connected && 'Instagram is not connected. '}Recordings will stop until an admin connects them.</span><Link href="/settings">Open Setup</Link></div>
      )}
      <div className="row" style={{ margin: '10px 0' }}><button className="btn primary" onClick={() => openModal('New recording', close => <NewRecording close={close} />)}>New recording</button></div>
      {rows.length ? rows.map(r => <RecCard key={r.id} r={r} />) : <Empty>No recordings yet. Use “New recording” after your next class.</Empty>}
    </>
  );
}

function RecCard({ r }: { r: Recording }) {
  const app = useApp(), run = useRun(), { toast, openModal } = useUI();
  const [lab, kind] = STAGE_LABEL[r.stage], p = progress(r);
  const mine = r.by_id === app.me.id, canAct = app.isAdmin || mine;
  const act = (action: string, extra: object = {}) => run(async () => { await api('/api/pipeline/action', { id: r.id, action, ...extra }); await app.reload('recordings'); toast(action === 'cancel' ? 'Cancelled' : 'Done'); });
  const reel = r.reel_id ? app.reels.find(x => x.id === r.reel_id) : undefined;
  const decl = () => openModal('Which students appear?', close => <Declare r={r} close={close} />);
  return (
    <div className={`cls sub-${subj(r.subject_id)} ${r.stage === 'cancelled' ? 'cancelled' : ''}`}>
      <div className="bar" />
      <div className="body" style={{ paddingLeft: 12 }}>
        <div className="row between wrap"><h3>🎥 {r.title}</h3><Chip kind={kind}>{lab}</Chip></div>
        <div className="meta">{subj(r.subject_id)} · {app.bname(r.batch_id)} · {r.teacher_name || '—'} · {fDT(r.created_at)}{r.source_size ? ` · ${(r.source_size / 1048576).toFixed(0)} MB` : ''}{r.source_kind === 'zoom' ? ' · from Zoom' : ''}</div>
        <ol className="rec-steps" style={{ display: 'flex', gap: 6, listStyle: 'none', padding: 0, margin: '10px 0', flexWrap: 'wrap' }}>
          {STEPS.map(([k, l], i) => {
            const done = i < p.done, cur = p.current === i;
            return <li key={k} className={'chip ' + (done ? 'ok' : cur ? 'sched' : 'plain')}>{done ? '✓ ' : cur ? '… ' : ''}{l}</li>;
          })}
        </ol>
        {r.stage === 'youtube' && r.source_size ? <div className="small mute">YouTube upload: {Math.min(100, Math.round(r.yt_offset * 100 / r.source_size))}%</div> : null}
        {r.last_error && <div className={'small'} style={{ color: r.stage === 'failed' ? 'var(--bad)' : 'var(--warn)', marginTop: 4 }}>{r.last_error}{r.stage === 'queued' || r.stage === 'youtube' || r.stage === 'trim' || r.stage === 'instagram' ? ' (will retry)' : ''}</div>}
        {r.appears === null && !r.last_error && <div className="small" style={{ color: 'var(--warn)', marginTop: 4 }}>Say whether students appear in the clip. Until then it is not posted to Instagram.</div>}
        <div className="acts">
          {r.yt_url && <a className="btn sm" href={r.yt_url} target="_blank" rel="noopener">Watch on YouTube</a>}
          {r.ig_url && <a className="btn sm" href={r.ig_url} target="_blank" rel="noopener">View on Instagram</a>}
          {reel && <Link className="btn sm" href="/reels">Open the Reel</Link>}
          {canAct && r.appears === null && <button className="btn sm primary" onClick={decl}>Which students appear?</button>}
          {canAct && ['failed', 'held'].includes(r.stage) && r.appears !== null && <button className="btn sm" onClick={() => act('retry')}>Try again</button>}
          {app.isAdmin && r.stage === 'held' && !r.last_error.startsWith('Consent') && r.appears !== null && <button className="btn sm primary" onClick={() => act('publish_now')}>Publish now</button>}
          {canAct && !['completed', 'cancelled'].includes(r.stage) && <button className="btn sm danger" onClick={() => act('cancel')}>Cancel</button>}
          <button className="btn sm" onClick={() => openModal('Progress', () => <Log r={r} />)}>Log</button>
        </div>
      </div>
    </div>
  );
}

const Log = ({ r }: { r: Recording }) => (
  <div className="list small">{[...r.steps].reverse().map((s, i) => <div key={i} style={{ alignItems: 'flex-start' }}><div className="grow"><b>{s.step}</b>{s.note ? ' · ' + s.note : ''}</div><div className="mute">{fDT(s.at)}</div></div>)}{!r.steps.length && <div className="mute">Nothing yet.</div>}</div>
);

function Declare({ r, close }: { r: Recording; close: () => void }) {
  const app = useApp(), run = useRun();
  const [ap, setAp] = useState<string>(r.appears || ''), [pick, setPick] = useState<Set<string>>(new Set(r.appearing));
  const list = app.students.filter(s => s.active && s.batch_id === r.batch_id && s.subjects.includes(r.subject_id));
  return (
    <Form close={close} label="Save" onSubmit={async () => {
      if (!ap) throw new Error('Choose one of the two options.');
      await api('/api/pipeline/action', { id: r.id, action: 'declare', appears: ap, appearing: [...pick] });
      await run(async () => { await app.reload('recordings', 'reels'); }); close();
    }}>
      <StudentsAppear ap={ap} setAp={setAp} list={list} pick={pick} setPick={setPick} />
    </Form>
  );
}

export function StudentsAppear({ ap, setAp, list, pick, setPick }: { ap: string; setAp: (v: string) => void; list: { id: string; name: string }[]; pick: Set<string>; setPick: (s: Set<string>) => void }) {
  const app = useApp();
  return (
    <div className="field">
      <label>Students in this clip <span className="chip warn">Required</span></label>
      <label className="row" style={{ fontWeight: 500 }}><input type="radio" name="ap" checked={ap === 'none'} onChange={() => setAp('none')} /> No student is visible, audible or named. Only the teacher and the lesson.</label>
      <label className="row" style={{ fontWeight: 500 }}><input type="radio" name="ap" checked={ap === 'students'} onChange={() => setAp('students')} /> A student appears (face, voice or name)</label>
      {ap === 'students' && (
        <div className="checks">{list.map(s => {
          const c = app.consent[s.id]?.status || 'unknown';
          return <label key={s.id}><input type="checkbox" checked={pick.has(s.id)} onChange={e => { const n = new Set(pick); if (e.target.checked) n.add(s.id); else n.delete(s.id); setPick(n); }} />{s.name} <span className={'chip ' + CLABEL[c][1]}>{c === 'granted' ? 'Consent given' : 'No consent on record'}</span></label>;
        })}{!list.length && <span className="mute small">No students in this batch for this subject.</span>}</div>
      )}
      {ap === 'students' && <p className="mute small">A student can only appear in a public Reel when consent is on record (Reels → Consent). Without it, the clip stays on YouTube and waits.</p>}
    </div>
  );
}

function NewRecording({ close }: { close: () => void }) {
  const app = useApp(), { toast } = useUI(), run = useRun();
  const s = app.settings;
  const [classId, setClassId] = useState(''), [sub, setSub] = useState<string>(''), [batch, setBatch] = useState('');
  const [source, setSource] = useState<'file' | 'camera' | 'screen'>('file'), [file, setFile] = useState<File | null>(null);
  const [ap, setAp] = useState(''), [pick, setPick] = useState<Set<string>>(new Set());
  const [pct, setPct] = useState<number | null>(null);
  const cap = useRef<Capture | null>(null);
  const [recording, setRecording] = useState(false), [secs, setSecs] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelled = useRef({ cancelled: false });

  const recent = app.classes.filter(c => c.status === 'scheduled' && new Date(c.start_at).getTime() < Date.now() + 3600e3).sort((a, b) => b.start_at.localeCompare(a.start_at)).slice(0, 30);
  const list = app.students.filter(x => x.active && x.batch_id === batch && (!sub || x.subjects.includes(sub as 'chem')));
  useEffect(() => () => { cap.current?.cleanup(); if (timer.current) clearInterval(timer.current); cancelled.current.cancelled = true; }, []);

  const pickClass = (id: string) => { setClassId(id); const c = app.classes.find(x => x.id === id); if (c) { setSub(c.subject_id); setBatch(c.batch_id); } };
  const begin = async () => {
    try {
      const c = await startCapture(source as CaptureMode, () => { void finishCapture(); });
      cap.current = c; setRecording(true); setSecs(0);
      timer.current = setInterval(() => setSecs(n => n + 1), 1000);
    } catch (e) { toast((e as Error).message, true); }
  };
  const finishCapture = async () => {
    if (!cap.current) return;
    if (timer.current) clearInterval(timer.current);
    const f = await cap.current.stop(); cap.current = null; setRecording(false); setFile(f);
  };

  return (
    <Form close={close} label={pct == null ? 'Save and start' : 'Uploading…'} onSubmit={async f => {
      if (recording) throw new Error('Stop the recording first.');
      if (!sub) throw new Error('Choose a subject.'); if (!batch) throw new Error('Choose a batch.');
      if (!file) throw new Error(source === 'file' ? 'Choose the recording file.' : 'Record the class first, then save.');
      if (!ap) throw new Error('Say whether any student appears in the recording.');
      if (ap === 'students' && !pick.size) throw new Error('Choose which students appear.');
      const start = f.trim('start') ? parseT(f.trim('start')) : 0, len = Number(f.get('len') || s.reel_len_sec);
      if (isNaN(start) || start < 0) throw new Error('Enter the clip start like 12:30.');
      if (!(len >= 5 && len <= 90)) throw new Error('A Reel is 5–90 seconds long.');
      const title = f.trim('title') || `${subj(sub)} – ${app.bname(batch)}`;
      const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'mp4';
      const path = `${app.me.id}/${crypto.randomUUID()}.${ext}`;
      const ins = await db.from('recordings').insert({
        class_id: classId || null, title, subject_id: sub, batch_id: batch, topic: f.trim('topic'), teacher_name: f.trim('teacher') || app.by,
        source_path: path, source_kind: 'upload', source_mime: file.type || 'video/mp4', source_size: file.size, appears: ap, appearing: ap === 'students' ? [...pick] : [],
        trim_start_sec: start, trim_len_sec: len, publish_mode: s.publish_mode, yt_privacy: s.yt_privacy, stage: 'uploading', by_id: app.me.id, by_name: app.by,
      }).select('*').single();
      if (ins.error) throw new Error(ins.error.message);
      const id = (ins.data as Recording).id;
      try {
        setPct(0);
        await uploadRecording(file, id, (d, t) => setPct(Math.round(d * 100 / t)), cancelled.current);
        await api('/api/pipeline/start', { id });
      } catch (e) {
        await api('/api/pipeline/action', { id, action: 'cancel' }).catch(() => {});      // do not leave a half-finished entry behind
        await run(async () => { await app.reload('recordings'); });
        setPct(null); throw e;
      }
      await app.reload('recordings'); close(); toast('Saved. The app is working on it.');
    }}>
      <Field label="Which class is this?" hint="(optional – fills in the details)">
        <select value={classId} onChange={e => pickClass(e.target.value)}><option value="">Not linked to a class</option>{recent.map(c => <option key={c.id} value={c.id}>{fDate(c.start_at)}, {fTime(c.start_at)} · {subj(c.subject_id)} · {app.bname(c.batch_id)}</option>)}</select>
      </Field>
      <div className="two">
        <Field label="Subject"><select value={sub} onChange={e => setSub(e.target.value)}><Options items={SUBJECTS} placeholder="Choose" /></select></Field>
        <Field label="Batch"><select value={batch} onChange={e => setBatch(e.target.value)}><Options items={app.batches} placeholder="Choose" /></select></Field>
      </div>
      <Field label="Title" hint="(used on YouTube and for the Reel)"><input name="title" maxLength={100} placeholder="e.g. Chemistry – Alkenes, Grade 11" defaultValue={classId ? app.classes.find(c => c.id === classId)?.title : ''} key={classId} /></Field>
      <div className="two">
        <Field label="Topic"><input name="topic" maxLength={100} placeholder="e.g. Alkenes" /></Field>
        <Field label="Teacher"><input name="teacher" maxLength={80} defaultValue={classId ? app.classes.find(c => c.id === classId)?.teacher_name : app.by} key={'t' + classId} /></Field>
      </div>

      <div className="field">
        <label>The recording</label>
        <div className="seg" role="group">
          {([['file', 'Upload a file'], ['camera', 'Record: camera'], ['screen', 'Record: screen']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={source === k} disabled={recording || pct != null} onClick={() => { setSource(k); setFile(null); }}>{l}</button>)}
        </div>
        {source === 'file' ? (
          <input type="file" accept="video/*" onChange={e => setFile(e.target.files?.[0] || null)} disabled={pct != null} />
        ) : recording ? (
          <div className="row"><span className="chip bad">● Recording {mmss(secs)}</span><button type="button" className="btn" onClick={() => run(finishCapture)}>Stop</button></div>
        ) : file ? (
          <div className="row"><span className="chip ok">Recorded {(file.size / 1048576).toFixed(0)} MB</span><button type="button" className="btn sm" onClick={() => { setFile(null); }}>Record again</button></div>
        ) : (
          <button type="button" className="btn" onClick={begin}>Start recording</button>
        )}
        {source !== 'file' && <p className="mute small">The recording is kept in this browser tab until you save, so keep the tab open. For a long class, record it in Zoom (cloud recording) or with your usual recorder and upload the file instead.</p>}
        {file && source === 'file' && <p className="mute small">{file.name} · {(file.size / 1048576).toFixed(0)} MB</p>}
      </div>

      <div className="two">
        <Field label="Clip starts at (m:ss)" hint={`(default ${mmss(s.reel_start_sec)})`}><input name="start" placeholder={mmss(s.reel_start_sec)} defaultValue={s.reel_start_sec ? mmss(s.reel_start_sec) : ''} /></Field>
        <Field label="Clip length (seconds)"><input name="len" inputMode="numeric" defaultValue={s.reel_len_sec} /></Field>
      </div>
      <StudentsAppear ap={ap} setAp={setAp} list={list} pick={pick} setPick={setPick} />
      {pct != null && <div><div className="mute small">Uploading the recording… {pct}%</div><div style={{ height: 8, borderRadius: 4, background: 'var(--line)', overflow: 'hidden' }}><div style={{ width: pct + '%', height: '100%', background: 'var(--brand)' }} /></div><p className="mute small">Keep this window open until it finishes. If the connection drops it continues from where it stopped.</p></div>}
      {s.publish_mode === 'off' && <Alert kind="info">Publishing is switched off in Setup, so the clip will be saved as a draft Reel.</Alert>}
    </Form>
  );
}
