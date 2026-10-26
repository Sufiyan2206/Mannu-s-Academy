'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useApp } from '@/state/app';
import { endIso } from '@/lib/format';
import { ATT_REPORTS, OUT_REPORTS, PARENT_REPORTS } from '@/components/reportKit';
import { useRun } from '@/components/ui';

export default function Reports() {
  const app = useApp(), run = useRun();
  const [ready, setReady] = useState(false);
  const past = app.classes.filter(c => c.status === 'scheduled' && endIso(c) < new Date().toISOString());
  useEffect(() => { run(async () => { await app.ensureAtt(past.map(c => c.id)); setReady(true); }); }, [app.classes.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const pend = ready ? past.filter(c => !app.att(c.id)?.taken_at).length : 0;
  const rows = (list: [string, string, string][]) => list.map(([id, t, d]) => (
    <Link key={id} className="rrow" href={`/reports/${id}`}><span className="grow"><b>{t}</b><span className="mute small">{d}</span></span><span className="chev" aria-hidden="true">›</span></Link>
  ));
  return (
    <>
      <div className="head"><h1>Reports</h1></div>
      <div className="small mute" style={{ margin: '-6px 0 12px' }}>Choose a report. Each one can be filtered and downloaded as a CSV file.</div>
      {pend > 0 && <Link className="alert" href="/reports/att-missing" style={{ textDecoration: 'none' }}><span><b>{pend}</b> finished {pend === 1 ? 'class has' : 'classes have'} no attendance recorded</span><span className="btn sm">Open</span></Link>}
      <section aria-labelledby="h-att"><div className="sec"><h2 id="h-att">Attendance Reports</h2><span className="mute small">{ATT_REPORTS.length} reports</span></div><div className="card rlist">{rows(ATT_REPORTS)}</div></section>
      {app.isAdmin && (
        <>
          <section aria-labelledby="h-out"><div className="sec"><h2 id="h-out">Outstanding Reports</h2><span className="mute small">{OUT_REPORTS.length} reports · fees and payments</span></div><div className="card rlist">{rows(OUT_REPORTS)}</div></section>
          <section aria-labelledby="h-par"><div className="sec"><h2 id="h-par">Parent Reports</h2><span className="mute small">to share with families</span></div><div className="card rlist">{rows(PARENT_REPORTS)}</div></section>
        </>
      )}
    </>
  );
}
