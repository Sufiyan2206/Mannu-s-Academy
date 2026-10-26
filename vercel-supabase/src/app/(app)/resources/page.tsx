'use client';
import { useEffect, useMemo, useState } from 'react';
import { db } from '@/lib/client';
import { useApp } from '@/state/app';
import { fDT, REXAMS, RTYPES, SUBJECTS } from '@/lib/format';
import type { ResHistory } from '@/lib/types';
import { ResCard, useResources } from '@/components/resources';
import { Alert, Empty, Options, Seg } from '@/components/ui';

export default function Resources() {
  const app = useApp(), { form, detail } = useResources();
  const [tab, setTab] = useState<'items' | 'log'>('items'), [more, setMore] = useState(false);
  const [f, setF] = useState({ q: '', subject: '', batch: '', type: '', exam: '', topic: '', from: '', to: '', mine: false, removed: false });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(s => ({ ...s, [k]: v }));

  const rows = useMemo(() => {
    const q = f.q.toLowerCase();
    return app.resources.filter(r => (r.status === 'active' || (app.isAdmin && f.removed)) && (!f.subject || r.subject_id === f.subject) && (!f.batch || r.batch_ids.includes(f.batch))
      && (!f.type || r.type === f.type) && (!f.exam || r.exam_type === f.exam) && (!f.topic || r.topic.toLowerCase() === f.topic.toLowerCase())
      && (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to) && (!f.mine || r.by_id === app.me.id)
      && (!q || [r.title, r.description, r.topic, r.tags.join(' ')].some(x => x.toLowerCase().includes(q))))
      .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
  }, [app.resources, app.isAdmin, app.me.id, f]);
  const topics = useMemo(() => [...new Set(rows.map(r => r.topic).filter(Boolean))].sort(), [rows]);

  const [log, setLog] = useState<ResHistory[]>([]);
  useEffect(() => {
    if (tab !== 'log') return;
    db.from('resource_history').select('*').order('at', { ascending: false }).limit(150).then(({ data }) => setLog((data || []) as ResHistory[]));
  }, [tab]);

  return (
    <>
      <div className="head"><h1>Study resources</h1><button className="btn primary" onClick={() => form()}>Add resource</button></div>
      <Alert kind="info">A library of links to notes, worksheets, model papers and videos. Store the files in Google Drive, OneDrive or YouTube and paste the link here. Students get the link on WhatsApp.</Alert>
      {app.isAdmin && <Seg value={tab} onChange={setTab} items={[['items', 'Materials'], ['log', 'Change log']]} />}
      {tab === 'items' ? (
        <div>
          <input type="search" placeholder="Search title, topic, description or tag" aria-label="Search resources" style={{ marginBottom: 8 }} value={f.q} onChange={e => set('q', e.target.value.trim())} />
          <div className="filters">
            <select aria-label="Subject" value={f.subject} onChange={e => set('subject', e.target.value)}><Options items={SUBJECTS} placeholder="All subjects" /></select>
            <select aria-label="Resource type" value={f.type} onChange={e => set('type', e.target.value)}><option value="">All types</option>{Object.entries(RTYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select aria-label="Batch" value={f.batch} onChange={e => set('batch', e.target.value)}><Options items={app.batches} placeholder="All batches" /></select>
            <button className="btn" style={{ minHeight: 44 }} onClick={() => setMore(m => !m)}>More filters</button>
          </div>
          {more && (
            <div className="filters">
              <select aria-label="Exam type" value={f.exam} onChange={e => set('exam', e.target.value)}><option value="">All exam types</option>{Object.entries(REXAMS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <select aria-label="Topic" value={f.topic} onChange={e => set('topic', e.target.value)}><option value="">All topics</option>{topics.map(t => <option key={t} value={t}>{t}</option>)}</select>
              <div><label htmlFor="d1">From date</label><input id="d1" type="date" value={f.from} onChange={e => set('from', e.target.value)} /></div>
              <div><label htmlFor="d2">To date</label><input id="d2" type="date" value={f.to} onChange={e => set('to', e.target.value)} /></div>
              <label className="row wide" style={{ fontWeight: 500 }}><input type="checkbox" checked={f.mine} onChange={e => set('mine', e.target.checked)} /> Only my uploads</label>
              {app.isAdmin && <label className="row wide" style={{ fontWeight: 500 }}><input type="checkbox" checked={f.removed} onChange={e => set('removed', e.target.checked)} /> Include removed</label>}
            </div>
          )}
          {rows.length ? <><div className="mute small" style={{ margin: '4px 0 8px' }}>{rows.length} {rows.length === 1 ? 'resource' : 'resources'}</div>{rows.slice(0, 150).map(r => <ResCard key={r.id} r={r} />)}</>
            : <Empty>{Object.values(f).some(Boolean) ? 'Nothing matches these filters.' : 'No resources yet. Use “Add resource” to share notes, worksheets or model papers.'}</Empty>}
        </div>
      ) : (
        log.length ? (
          <div className="card list small">
            {log.map(a => {
              const r = app.resources.find(x => x.id === a.resource_id);
              return (
                <div key={a.id} className="tap" style={{ alignItems: 'flex-start' }} onClick={() => r && detail(r)}>
                  <div className="grow"><b>{r?.title || 'Deleted resource'}</b> <span className="chip plain">{a.action}</span>
                    {a.note && <div className="mute">{a.note}</div>}
                    {a.changes && <div className="mute">{Object.entries(a.changes).map(([k, [o, n]]) => <div key={k}>{k}: {o || '—'} → {n || '—'}</div>)}</div>}
                  </div>
                  <div className="right mute">{a.by_name}<br />{fDT(a.at)}</div>
                </div>
              );
            })}
          </div>
        ) : <Empty>No changes recorded yet.</Empty>
      )}
    </>
  );
}
