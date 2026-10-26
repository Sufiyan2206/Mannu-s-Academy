'use client';
import { useMemo, useState } from 'react';
import { db } from '@/lib/client';
import { useApp } from '@/state/app';
import { csvOf, fDateISO, fDateY, fDT, num, saveFile, SUBJECTS, subj } from '@/lib/format';
import { CLABEL, RST } from '@/lib/reels';
import { ReelCard, useReels } from '@/components/reels';
import { RecordingsPanel } from '@/components/recordings';
import { Alert, Empty, Field, Form, Options, Seg, useUI } from '@/components/ui';

type Tab = 'recordings' | 'reels' | 'insights' | 'consent' | 'setup';

export default function ReelsPage() {
  const app = useApp(), reels = useReels();
  const [tab, setTab] = useState<Tab>('recordings');
  const items: [Tab, string][] = [['recordings', 'Recordings'], ['reels', 'Reels'], ['insights', 'Insights'], ...(app.isAdmin ? [['consent', 'Consent'], ['setup', 'About']] as [Tab, string][] : [])];
  return (
    <>
      <div className="head"><h1>Instagram Reels</h1><button className="btn primary" onClick={() => reels.form()}>New Reel</button></div>
      <div className="small mute" style={{ margin: '-6px 0 10px' }}>Recorded class → YouTube → short clip → approval → Instagram</div>
      <Seg scroll value={tab} onChange={setTab} items={items} />
      {tab === 'recordings' && <RecordingsPanel />}
      {tab === 'reels' && <ReelList />}
      {tab === 'insights' && <Insights />}
      {tab === 'consent' && app.isAdmin && <Consent />}
      {tab === 'setup' && app.isAdmin && <About />}
    </>
  );
}

function ReelList() {
  const app = useApp(), { stateOf } = useReels();
  const [f, setF] = useState({ q: '', status: '', subject: '', batch: '', teacher: '', topic: '', from: '', to: '', deleted: false }), [more, setMore] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(s => ({ ...s, [k]: v }));
  const all = app.reels.map(r => ({ r, st: stateOf(r) }));
  const rows = useMemo(() => {
    const q = f.q.toLowerCase(), day = (x: { r: { created_at: string } }) => (x.r.created_at || '').slice(0, 10);
    return all.filter(x => (x.st.s !== 'deleted' || (app.isAdmin && f.deleted)) && (!f.status || x.st.s === f.status) && (!f.subject || x.r.subject_id === f.subject) && (!f.batch || x.r.batch_id === f.batch)
      && (!f.teacher || x.r.teacher_name === f.teacher) && (!f.topic || x.r.topic.toLowerCase().includes(f.topic.toLowerCase())) && (!q || (x.r.title + ' ' + x.r.topic).toLowerCase().includes(q)) && (!f.from || day(x) >= f.from) && (!f.to || day(x) <= f.to))
      .sort((a, b) => b.r.created_at.localeCompare(a.r.created_at));
  }, [all, f, app.isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps
  const need = rows.filter(x => x.st.s === 'awaiting_approval').length, due = rows.filter(x => x.st.s === 'scheduled' && x.st.at && new Date(x.st.at) < new Date() && !x.r.recording_id).length;
  return (
    <>
      <input type="search" placeholder="Search title or topic" aria-label="Search Reels" style={{ marginBottom: 8 }} value={f.q} onChange={e => set('q', e.target.value.trim())} />
      <div className="filters">
        <select aria-label="Subject" value={f.subject} onChange={e => set('subject', e.target.value)}><Options items={SUBJECTS} placeholder="All subjects" /></select>
        <select aria-label="Batch" value={f.batch} onChange={e => set('batch', e.target.value)}><Options items={app.batches} placeholder="All batches" /></select>
        <select aria-label="Status" value={f.status} onChange={e => set('status', e.target.value)}><option value="">All statuses</option>{Object.entries(RST).filter(([k]) => k !== 'deleted').map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select>
        <button className="btn" type="button" onClick={() => setMore(m => !m)}>More filters</button>
      </div>
      {more && (
        <div className="filters">
          <select aria-label="Teacher" value={f.teacher} onChange={e => set('teacher', e.target.value)}><option value="">All teachers</option>{[...new Set(app.reels.map(r => r.teacher_name).filter(Boolean))].sort().map(t => <option key={t}>{t}</option>)}</select>
          <input placeholder="Topic" aria-label="Topic" value={f.topic} onChange={e => set('topic', e.target.value.trim())} />
          <div><label htmlFor="d1">From date</label><input id="d1" type="date" value={f.from} onChange={e => set('from', e.target.value)} /></div>
          <div><label htmlFor="d2">To date</label><input id="d2" type="date" value={f.to} onChange={e => set('to', e.target.value)} /></div>
          {app.isAdmin && <label className="row wide" style={{ fontWeight: 500 }}><input type="checkbox" checked={f.deleted} onChange={e => set('deleted', e.target.checked)} /> Show deleted Reels</label>}
        </div>
      )}
      {rows.length ? (
        <>
          {app.isAdmin && need > 0 && <Alert kind="info"><b>{need}</b> {need === 1 ? 'Reel is' : 'Reels are'} waiting for your approval.</Alert>}
          {app.isAdmin && due > 0 && <div className="alert" style={{ display: 'block' }}><b>{due}</b> approved {due === 1 ? 'Reel is' : 'Reels are'} past the planned time. Post {due === 1 ? 'it' : 'them'}, then use “Mark as published”.</div>}
          <div className="mute small" style={{ margin: '4px 0 8px' }}>{rows.length} {rows.length === 1 ? 'Reel' : 'Reels'}</div>
          {rows.slice(0, 150).map(x => <ReelCard key={x.r.id} r={x.r} />)}
        </>
      ) : <Empty>{Object.values(f).some(Boolean) ? 'Nothing matches these filters.' : 'No Reels yet. Add a recording, or tap “New Reel” to plan one by hand.'}</Empty>}
    </>
  );
}

function Insights() {
  const app = useApp(), { stateOf } = useReels();
  const [from, setFrom] = useState(''), [to, setTo] = useState('');
  const rows = app.reels.map(r => ({ r, st: stateOf(r) })).filter(x => {
    const d = app.decisions[x.r.id];
    return (x.st.s === 'published' || (x.st.s === 'deleted' && d?.published_at)) && (!from || fDateISO(d.published_at as string) >= from) && (!to || fDateISO(d.published_at as string) <= to);
  }).sort((a, b) => (app.decisions[b.r.id].published_at as string).localeCompare(app.decisions[a.r.id].published_at as string));
  const t = { reels: rows.length, views: 0, likes: 0, comments: 0, shares: 0, reach: 0 }, by: Record<string, { reels: number; views: number; likes: number }> = {};
  for (const { r } of rows) {
    const m = app.decisions[r.id].metrics || ({} as Record<string, number | null>);
    for (const k of ['views', 'likes', 'comments', 'shares', 'reach'] as const) t[k] += (m[k] as number) || 0;
    const s = (by[subj(r.subject_id)] ||= { reels: 0, views: 0, likes: 0 }); s.reels++; s.views += (m.views as number) || 0; s.likes += (m.likes as number) || 0;
  }
  return (
    <>
      <div className="two"><div><label htmlFor="i1">Published from</label><input id="i1" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div><div><label htmlFor="i2">To</label><input id="i2" type="date" value={to} onChange={e => setTo(e.target.value)} /></div></div>
      <div style={{ marginTop: 10 }}>
        <div className="row between small mute"><span>Numbers are read from Instagram automatically for Reels the app published.</span>
          {rows.length > 0 && <button className="btn sm" onClick={() => saveFile('reels.csv', csvOf([['Published', 'Title', 'Subject', 'Batch', 'Topic', 'Teacher', 'Instagram link', 'Views', 'Reach', 'Likes', 'Comments', 'Shares', 'Saves'],
            ...rows.map(({ r }) => { const d = app.decisions[r.id], m = d.metrics; return [fDateISO(d.published_at as string), r.title, subj(r.subject_id), app.bname(r.batch_id), r.topic, r.teacher_name, d.ig_url, m?.views ?? '', m?.reach ?? '', m?.likes ?? '', m?.comments ?? '', m?.shares ?? '', m?.saved ?? '']; })]), 'text/csv')}>Download CSV</button>}</div>
        <div className="two" style={{ margin: '8px 0' }}>
          <div className="card"><div className="mute small">Published Reels</div><b style={{ fontSize: '1.4rem' }}>{t.reels}</b></div>
          <div className="card"><div className="mute small">Views</div><b style={{ fontSize: '1.4rem' }}>{num(t.views)}</b></div>
          <div className="card"><div className="mute small">Reach</div><b style={{ fontSize: '1.4rem' }}>{num(t.reach)}</b></div>
          <div className="card"><div className="mute small">Likes · comments · shares</div><b>{num(t.likes)} · {num(t.comments)} · {num(t.shares)}</b></div>
        </div>
        {Object.keys(by).length > 0 && <div className="tbl"><table><thead><tr><th>Subject</th><th>Reels</th><th>Views</th><th>Likes</th></tr></thead><tbody>{Object.entries(by).map(([k, s]) => <tr key={k}><td>{k}</td><td>{s.reels}</td><td>{num(s.views)}</td><td>{num(s.likes)}</td></tr>)}</tbody></table></div>}
        {rows.length ? <><div className="sec"><h2>By Reel</h2></div>{rows.map(({ r }) => <ReelCard key={r.id} r={r} />)}</> : <Empty>No published Reels in this period.</Empty>}
      </div>
    </>
  );
}

function Consent() {
  const app = useApp(), { openModal, toast } = useUI(), { stateOf } = useReels();
  const [q, setQ] = useState('');
  const list = app.students.filter(s => s.active && (!q || s.name.toLowerCase().includes(q)));
  const change = (s: (typeof app.students)[number]) => {
    const c = app.consent[s.id], cur = c?.status || 'unknown';
    openModal('Consent: ' + s.name, close => (
      <Form close={close} label="Save" onSubmit={async f => {
        const st = f.get('st'), note = f.trim('nt');
        if (st === 'granted' && !note) throw new Error('Note how consent was given (for example “written consent from parent, 3 Oct”).');
        const now = new Date().toISOString();
        const a = await db.from('consent').upsert({ student_id: s.id, status: st, note, by_name: app.by, at: now });
        if (a.error) throw new Error(a.error.message);
        await db.from('consent_log').insert({ student_id: s.id, name: s.name, status: st, note, by_name: app.by, at: now });
        await app.reload('consent', 'consentLog');
        const aff = st !== 'granted' ? app.reels.filter(r => r.appears === 'students' && r.appearing.includes(s.id) && ['scheduled', 'awaiting_approval', 'published'].includes(stateOf(r).s)).length : 0;
        close(); toast(aff ? `Saved. ${aff} Reel(s) with ${s.name} are now paused or flagged.` : 'Saved');
      }}>
        <Field label="Status"><select name="st" defaultValue={cur}><option value="granted">Consent given</option><option value="denied">Refused / withdrawn</option><option value="unknown">Not recorded</option></select></Field>
        <Field label="How was it given?" hint="(required when giving consent)"><input name="nt" maxLength={300} defaultValue={c?.note || ''} placeholder="e.g. Written consent from parent, 3 Oct" /></Field>
      </Form>
    ));
  };
  return (
    <>
      <Alert kind="info">A student’s face, voice or name can only be used in a Reel when consent is recorded here (for a child, from the parent or guardian). Withdrawing consent pauses approved Reels and flags published ones automatically.</Alert>
      <input type="search" placeholder="Search students" aria-label="Search students" style={{ margin: '10px 0' }} value={q} onChange={e => setQ(e.target.value.trim().toLowerCase())} />
      {list.length ? (
        <div className="card list">{list.map(s => {
          const c = app.consent[s.id], k = c?.status || 'unknown';
          return (
            <div key={s.id} style={{ alignItems: 'flex-start' }}>
              <div className="grow"><b>{s.name}</b> <span className="mute small">{app.bname(s.batch_id)}</span><div className="small mute">{c?.note ? c.note + ' · ' : ''}{c?.at ? fDateY(c.at) : ''}</div></div>
              <span className={'chip ' + CLABEL[k][1]}>{CLABEL[k][0]}</span><button className="btn sm" onClick={() => change(s)}>Change</button>
            </div>
          );
        })}</div>
      ) : <Empty>No students.</Empty>}
      <details className="mt"><summary><b>Record of consent changes</b></summary>
        <div className="list small" style={{ marginTop: 6 }}>{app.consentLog.slice(0, 100).map(l => (
          <div key={l.id} style={{ alignItems: 'flex-start' }}><div className="grow"><b>{l.name}</b> · {CLABEL[l.status]?.[0] || l.status}{l.note ? ' · ' + l.note : ''}<div className="mute">{l.by_name} · {fDT(l.at)}</div></div></div>
        ))}{!app.consentLog.length && <div className="mute">Nothing yet.</div>}</div>
      </details>
    </>
  );
}

function About() {
  const app = useApp(), { toast } = useUI();
  return (
    <>
      <div className="card stack"><h3>Instagram account</h3>
        <form noValidate onSubmit={async e => {
          e.preventDefault();
          const h = String(new FormData(e.currentTarget).get('h') || '').trim().replace(/^@/, '');
          if (h && !/^[\w.]{1,30}$/.test(h)) return toast('Use only letters, numbers, dots and underscores.', true);
          const { error } = await db.from('settings').update({ ig_handle: h }).eq('id', 1);
          if (error) return toast(error.message, true);
          await app.reload('settings'); toast('Saved');
        }}>
          <Field label="Academy Instagram username" hint="(used in captions)"><input name="h" maxLength={40} defaultValue={app.settings.ig_handle} placeholder="e.g. mannus_academy" /></Field>
          <button className="btn primary">Save</button>
        </form>
      </div>
      <div className="card stack mt"><h3>How this works</h3>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li><b>Recordings</b>: add the class recording (or let Zoom send it). The app saves the full class to YouTube, cuts a vertical clip, and posts it as a Reel. Connect YouTube and Instagram in Setup.</li>
          <li><b>Teachers</b> can also add a Reel by hand: the link to a finished clip, the subject, batch, topic, a caption and who appears. They submit it for approval.</li>
          <li><b>Admins</b> approve or reject, and delete. Only admins can approve, publish, mark failed or delete. These records are stored where teachers cannot change them.</li>
          <li>Any edit after submission sends a Reel back to Draft for approval again.</li>
          <li>A student can only be in a Reel when consent is recorded in the Consent tab. Student names and contact details are hidden when you copy a caption.</li>
          <li>The publishing mode (automatic, needs approval, or off) is set in Setup → Video pipeline.</li>
        </ul>
      </div>
    </>
  );
}
