'use client';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/state/app';
import { SUBJECTS } from '@/lib/format';
import { ClassCard, useSchedule } from '@/components/classes';
import { Empty, Options, Seg, useRun } from '@/components/ui';

export default function Classes() {
  const app = useApp(), schedule = useSchedule(), run = useRun();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming'), [batch, setBatch] = useState(''), [sub, setSub] = useState('');
  const [, force] = useState(0);

  const filtered = useMemo(() => app.classes.filter(c => (!batch || c.batch_id === batch) && (!sub || c.subject_id === sub)), [app.classes, batch, sub]);
  const rows = useMemo(() => {
    const r = filtered.filter(c => { const s = app.cstate(c); return tab === 'upcoming' ? s === 'upcoming' || s === 'live' : s === 'ended' || c.status === 'cancelled'; });
    r.sort((a, b) => tab === 'upcoming' ? a.start_at.localeCompare(b.start_at) : b.start_at.localeCompare(a.start_at));
    return r.slice(0, 100);
  }, [filtered, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { run(async () => { await app.ensureAtt(rows.map(c => c.id)); force(n => n + 1); }); }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="head"><h1>Classes</h1><button className="btn primary" onClick={() => schedule()}>Schedule class</button></div>
      <Seg value={tab} onChange={setTab} items={[['upcoming', 'Upcoming'], ['past', 'Past']]} />
      <div className="filters">
        <select aria-label="Batch" value={batch} onChange={e => setBatch(e.target.value)}><Options items={app.batches} placeholder="All batches" /></select>
        <select aria-label="Subject" value={sub} onChange={e => setSub(e.target.value)}><Options items={SUBJECTS} placeholder="All subjects" /></select>
      </div>
      {rows.length ? rows.map(c => <ClassCard key={c.id} c={c} showDate />) : <Empty>{tab === 'upcoming' ? 'No upcoming classes. Use “Schedule class” to add one.' : 'No past classes yet.'}</Empty>}
    </>
  );
}
