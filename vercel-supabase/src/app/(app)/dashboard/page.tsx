'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/state/app';
import { addDays } from '@/lib/tz';
import { dayRange, endIso, fDate, fTime, sumBy, subj, todayStr, totalsText, tz } from '@/lib/format';
import { feeStatus } from '@/lib/fees';
import { ClassCard, useSchedule } from '@/components/classes';
import { useClassMessage } from '@/components/whatsapp';
import { Empty, Spin, useRun } from '@/components/ui';

export default function Dashboard() {
  const app = useApp(), schedule = useSchedule(), notify = useClassMessage(), run = useRun();
  const [ready, setReady] = useState(false);

  const lists = useMemo(() => {
    const t = todayStr(), [from, to] = dayRange(t), week = dayRange(addDays(t, 7))[0], nowIso = new Date().toISOString();
    const today = app.classes.filter(c => c.start_at >= from && c.start_at < to);
    const up = app.classes.filter(c => c.status === 'scheduled' && c.start_at >= nowIso && c.start_at < week);
    const prev = app.classes.filter(c => c.status === 'scheduled' && endIso(c) < nowIso && endIso(c) > new Date(Date.now() - 30 * 864e5).toISOString());
    return { today, up, prev };
  }, [app.classes]);

  useEffect(() => {
    let live = true;
    run(async () => { await app.ensureAtt([...lists.today, ...lists.prev].map(c => c.id)); if (live) setReady(true); });
    return () => { live = false; };
  }, [lists, run]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return <Spin />;
  const { today, up, prev } = lists;
  const pending = prev.filter(c => !app.att(c.id)?.taken_at).length;
  let p = 0, n = 0;
  today.filter(c => c.status === 'scheduled').forEach(c => {
    const a = app.att(c.id);
    if (a?.taken_at) { const r = Object.values(a.rows); n += r.length; p += r.filter(x => x.status === 'present' || x.status === 'late').length; }
  });
  let fees: { bal: Record<string, number>; od: Record<string, number>; owing: number } | null = null;
  if (app.isAdmin) {
    const ctx = app.feeCtx();
    const rows = app.students.filter(s => s.active).map(s => { const f = feeStatus(ctx, s.id); return { cur: f.cur, bal: f.balance, od: f.overdue }; });
    fees = { bal: sumBy(rows, 'bal'), od: sumBy(rows, 'od'), owing: rows.filter(r => r.bal > 0).length };
  }
  const heading = new Intl.DateTimeFormat('en-GB', { timeZone: tz(), weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  return (
    <>
      <div className="head">
        <div><h1>{heading}</h1><div className="mute">{app.isAdmin ? 'Academy overview' : 'Teacher view'}</div></div>
        <button className="btn primary" onClick={() => schedule()}>Schedule class</button>
      </div>
      {!app.batches.length && <div className="alert info"><span><b>Start here:</b> add a batch and your students.</span><Link href="/students">Open Students</Link></div>}
      {pending > 0 && <Link className="alert" href="/reports/att-missing" style={{ textDecoration: 'none' }}><span><b>{pending}</b> finished {pending === 1 ? 'class has' : 'classes have'} no attendance recorded</span><span>Review</span></Link>}
      <div className="stats">
        <Link className="stat" href="/students"><b>{app.students.filter(s => s.active).length}</b><span>Students</span></Link>
        <Link className="stat" href="/classes"><b>{today.filter(c => c.status === 'scheduled').length}</b><span>Zoom classes today</span><small>{today.filter(c => app.cstate(c) === 'upcoming').length} still to come</small></Link>
        <Link className="stat" href="/reports/att-student"><b>{n ? Math.round(p * 1000 / n) / 10 + '%' : '—'}</b><span>Attendance today</span><small>{n ? `${p} of ${n} present` : 'None recorded yet'}</small></Link>
        {fees
          ? <Link className="stat" href="/fees"><b style={Object.keys(fees.bal).length > 1 ? { fontSize: '1.1rem' } : undefined}>{totalsText(fees.bal)}</b><span>Outstanding fees</span><small>{fees.owing} students · {totalsText(fees.od)} overdue</small></Link>
          : <Link className="stat" href="/classes"><b>{up.length}</b><span>Classes this week</span></Link>}
      </div>
      <div className="sec"><h2>Today’s classes</h2><Link className="small" href="/classes">All classes</Link></div>
      {today.length ? today.map(c => <ClassCard key={c.id} c={c} />) : <Empty>No classes scheduled for today.</Empty>}
      <div className="sec"><h2>Upcoming class notifications</h2><span className="mute small">Next 7 days</span></div>
      {up.length ? (
        <div className="card list">
          {up.map(c => (
            <div key={c.id} className={`sub-${subj(c.subject_id)}`}>
              <span className="dot" />
              <div className="grow"><b>{subj(c.subject_id)}</b> · {app.bname(c.batch_id)}<div className="mute small">{fDate(c.start_at)}, {fTime(c.start_at)}</div></div>
              {app.announced(c) ? <span className="chip ok">Details sent</span> : <><span className="chip warn">Not sent</span><button className="btn sm" onClick={() => notify(c, 'class_info')}>Send</button></>}
            </div>
          ))}
        </div>
      ) : <Empty>Nothing scheduled in the next 7 days.</Empty>}
    </>
  );
}
