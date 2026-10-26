'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/state/app';
import { ASTAT, csvOf, dayRange, dayText, endIso, fDateY, fTime, saveFile, shortD, SUBJECTS, skey, subj, todayStr, tz } from '@/lib/format';
import { zonedToUtc } from '@/lib/tz';
import { attData } from '@/lib/attendance';
import { Cell2, PctChip, PRESETS, PresetBar, ReportHead, RTbl, rangeError, reportTitle } from '../reportKit';
import { AChip } from '../attendance';
import { Empty, Options, useRun } from '../ui';

const L = { present: 'P', late: 'L', absent: 'A' } as const;
const LEG = <p className="mute small" style={{ margin: '6px 0 0' }}>P = Present · L = Late · A = Absent</p>;

export function AttReport({ view }: { view: string }) {
  const app = useApp(), router = useRouter(), run = useRun();
  const needsRange = view !== 'att-missing';
  const [st, setSt] = useState({ from: todayStr(-29), to: todayStr(), batch: '', subject: '', student: '', school: '', preset: 'd30', low: 75 });
  const set = (p: Partial<typeof st>) => setSt(s => ({ ...s, ...p }));
  const [ver, force] = useState(0);
  const err = needsRange ? rangeError(st.from, st.to) : '';

  // the classes this report covers, and making sure their attendance is loaded
  const nowIso = new Date().toISOString();
  const scope = useMemo(() => {
    if (err) return [];
    if (!needsRange) return app.classes.filter(c => c.status === 'scheduled' && endIso(c) < nowIso && (!st.batch || c.batch_id === st.batch) && (!st.subject || c.subject_id === st.subject));
    const from = zonedToUtc(st.from + 'T00:00', tz())!, to = dayRange(st.to)[1];
    return app.classes.filter(c => c.status === 'scheduled' && c.start_at >= from && c.start_at < to && (!st.batch || c.batch_id === st.batch) && (!st.subject || c.subject_id === st.subject));
  }, [app.classes, st.from, st.to, st.batch, st.subject, err, needsRange]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { run(async () => { await app.ensureAtt(scope.map(c => c.id)); force(n => n + 1); }); }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const filterText = [st.batch && app.bname(st.batch), st.subject && subj(st.subject), st.school && (st.school === '__none' ? 'no school entered' : st.school), st.student && app.sname(st.student)].filter(Boolean).join(' · ') || 'All batches, subjects and students';
  const rangeText = !needsRange ? 'Up to today' : st.from === st.to ? dayText(st.from) : `${dayText(st.from)} – ${dayText(st.to)}`;

  const out = useMemo<{ body: ReactNode; csv: (string | number | null)[][] | null; name: string; missing?: React.ReactNode; d?: ReturnType<typeof attData> } | null>(() => {
    if (err) return null;
    const head: (string | number | null)[][] = [['Report', reportTitle(view)], ['Range', needsRange ? st.from + ' to ' + st.to : 'Up to today'], ['Filters', filterText], []];
    const docs = Object.fromEntries(scope.map(c => [c.id, app.att(c.id)]));
    if (view === 'att-missing') {
      const miss = scope.filter(c => !docs[c.id]?.taken_at).sort((a, b) => b.start_at.localeCompare(a.start_at));
      return {
        csv: [...head, ['Subject', 'Batch', 'Teacher', 'Date', 'Time'], ...miss.map(c => [subj(c.subject_id), app.bname(c.batch_id), c.teacher_name || '', fDateY(c.start_at), fTime(c.start_at)])], name: 'classes-without-attendance.csv',
        body: (
          <>
            <div className="card" style={{ marginBottom: 10 }}><b>{miss.length} {miss.length === 1 ? 'class' : 'classes'} without attendance</b><div className="mute small">{filterText}</div></div>
            {miss.length ? <>
              <RTbl head={['Class', 'Date']}>{miss.map(c => (
                <tr key={c.id} className="tap" onClick={() => router.push('/classes/' + c.id)}>
                  <Cell2 a={subj(c.subject_id)} b={app.bname(c.batch_id) + (c.teacher_name ? ' · ' + c.teacher_name : '')} /><td>{shortD(c.start_at)}<div className="mute small">{fTime(c.start_at)}</div></td>
                </tr>))}</RTbl>
              <p className="mute small">Tap a class to record its attendance.</p>
            </> : <Empty>Every finished class has attendance recorded. 🎉</Empty>}
          </>
        ),
      };
    }
    const d = attData(app.classes, app.students, docs, st, {
      fromUtc: zonedToUtc(st.from + 'T00:00', tz())!, toUtc: dayRange(st.to)[1], nowIso, batchName: app.bname, studentName: app.sname,
    });
    let body: ReactNode = null, csv: (string | number | null)[][] = [], name = 'report.csv';
    const sName = app.sname;
    if (!d.recs.length) body = <Empty>No attendance recorded in this date range for these filters.</Empty>;
    else if (view === 'att-student') {
      if (st.student) {
        body = <>
          <RTbl head={['Date', 'Subject', 'Status', 'Arrived']}>{d.recs.map((r, i) => (
            <tr key={i}><td>{shortD(r.c.start_at)}</td><td>{subj(r.c.subject_id)}</td><td><AChip st={r.status} />{r.note && <div className="mute small">{r.note}</div>}</td><td>{r.join_time ? fTime(r.join_time) : '—'}</td></tr>
          ))}</RTbl>{LEG}</>;
        csv = [...head, ['Date', 'Subject', 'Batch', 'Status', 'Arrived', 'Left', 'Minutes', 'Note', 'Recorded by'],
          ...d.recs.map(r => [fDateY(r.c.start_at), subj(r.c.subject_id), app.bname(r.c.batch_id), ASTAT[r.status][0], r.join_time ? fTime(r.join_time) : '', r.leave_time ? fTime(r.leave_time) : '', r.duration_sec == null ? '' : Math.round(r.duration_sec / 60), r.note || '', r.source === 'zoom' ? 'Zoom report' : (r.created_by || '')])];
      } else {
        body = <>
          <RTbl head={['Student', 'P', 'L', 'A', '%']}>{d.students.map(s => (
            <tr key={s.sid}><Cell2 a={s.name} b={`${s.batch}${s.school ? ' · ' + s.school : ''} · ${s.held} ${s.held === 1 ? 'class' : 'classes'}`} /><td>{s.present}</td><td>{s.late}</td><td>{s.absent}</td><td><PctChip p={s.percent} /></td></tr>
          ))}</RTbl>{LEG}</>;
        csv = [...head, ['Student', 'School', 'Batch', 'Classes', 'Present', 'Late', 'Absent', 'Percent attended'], ...d.students.map(s => [s.name, s.school, s.batch, s.held, s.present, s.late, s.absent, s.percent])];
      }
      name = 'attendance-summary.csv';
    } else if (view === 'att-class') {
      body = <>
        <RTbl head={['Class', 'P', 'L', 'A', '%']}>{d.byClass.map(b => (
          <tr key={b.c.id} className="tap" onClick={() => router.push('/classes/' + b.c.id)}>
            <td><b>{shortD(b.c.start_at)}</b> · {fTime(b.c.start_at)}<div className="mute small">{subj(b.c.subject_id)} · {app.bname(b.c.batch_id)}{b.c.teacher_name ? ' · ' + b.c.teacher_name : ''}</div></td>
            <td>{b.present}</td><td>{b.late}</td><td>{b.absent}</td><td><PctChip p={b.percent} /></td>
          </tr>))}</RTbl>{LEG}</>;
      csv = [...head, ['Date', 'Time', 'Subject', 'Batch', 'Teacher', 'Present', 'Late', 'Absent', 'Percent attended'], ...d.byClass.map(b => [fDateY(b.c.start_at), fTime(b.c.start_at), subj(b.c.subject_id), app.bname(b.c.batch_id), b.c.teacher_name || '', b.present, b.late, b.absent, b.percent])];
      name = 'attendance-by-class.csv';
    } else if (view === 'att-register') {
      body = <>
        <div className="tbl"><table className="reg"><thead><tr><th>Student</th>{d.cols.map(c => <th key={c.id} title={subj(c.subject_id)}>{shortD(c.start_at)}<div className="mute small">{subj(c.subject_id).slice(0, 4)}</div></th>)}<th>%</th></tr></thead>
          <tbody>{d.students.map(s => (
            <tr key={s.sid}><td>{s.name}</td>
              {d.cols.map(c => { const r = docs[c.id]?.rows[s.sid]; return r ? <td key={c.id} className={`rg ${r.status}`} title={ASTAT[r.status][0]}>{L[r.status]}</td> : <td key={c.id} className="rg none">·</td>; })}
              <td>{s.percent}%</td></tr>
          ))}</tbody></table></div>
        <p className="mute small">P = Present, L = Late, A = Absent, · = not in that class. Swipe sideways for more dates.{d.byClass.length > 60 ? ' Showing the latest 60 classes.' : ''}</p></>;
      csv = [...head, ['Student', ...d.cols.map(c => fDateY(c.start_at) + ' ' + subj(c.subject_id)), 'Percent attended'],
        ...d.students.map(s => [s.name, ...d.cols.map(c => { const r = docs[c.id]?.rows[s.sid]; return r ? ASTAT[r.status][0] : ''; }), s.percent])];
      name = 'attendance-register.csv';
    } else if (view === 'att-absent') {
      const by: Record<string, number> = {};
      for (const a of d.absences) by[sName(a.sid)] = (by[sName(a.sid)] || 0) + 1;
      const top = Object.entries(by).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      body = d.absences.length ? <>
        <div className="sec"><h2>Most absences</h2></div>
        <RTbl head={['Student', 'Absences']}>{top.slice(0, 10).map(([n, c]) => <tr key={n}><td><b>{n}</b></td><td>{c}</td></tr>)}</RTbl>
        <div className="sec"><h2>All absences</h2><span className="mute small">{d.absences.length}</span></div>
        <RTbl head={['Student', 'Date']}>{d.absences.map((a, i) => (
          <tr key={i}><Cell2 a={sName(a.sid)} b={`${subj(a.c.subject_id)} · ${app.bname(a.c.batch_id)}${a.note ? ' · ' + a.note : ''}`} /><td>{shortD(a.c.start_at)}<div className="mute small">{fTime(a.c.start_at)}</div></td></tr>
        ))}</RTbl></> : <Empty>No absences in this range. 🎉</Empty>;
      csv = [...head, ['Student', 'Batch', 'Subject', 'Date', 'Time', 'Note'], ...d.absences.map(a => [sName(a.sid), app.bname(a.c.batch_id), subj(a.c.subject_id), fDateY(a.c.start_at), fTime(a.c.start_at), a.note || ''])];
      name = 'absent-students.csv';
    } else if (view === 'att-late') {
      const late = d.recs.filter(r => r.status === 'late');
      body = late.length ? <RTbl head={['Student', 'Date', 'Arrived']}>{late.map((r, i) => (
        <tr key={i}><Cell2 a={sName(r.sid)} b={subj(r.c.subject_id) + (r.note ? ' · ' + r.note : '')} /><td>{shortD(r.c.start_at)}</td><td>{r.join_time ? fTime(r.join_time) : '—'}</td></tr>
      ))}</RTbl> : <Empty>No late arrivals in this range.</Empty>;
      csv = [...head, ['Student', 'Batch', 'Subject', 'Date', 'Class time', 'Arrived', 'Note'], ...late.map(r => [sName(r.sid), app.bname(r.c.batch_id), subj(r.c.subject_id), fDateY(r.c.start_at), fTime(r.c.start_at), r.join_time ? fTime(r.join_time) : '', r.note || ''])];
      name = 'late-arrivals.csv';
    } else if (view === 'att-low') {
      const low = d.students.filter(s => s.percent != null && s.percent < st.low).sort((a, b) => (a.percent as number) - (b.percent as number) || a.name.localeCompare(b.name));
      body = <>
        <div className="small mute" style={{ margin: '8px 0' }}>{low.length} of {d.students.length} {d.students.length === 1 ? 'student is' : 'students are'} below {st.low}%.</div>
        {low.length ? <><RTbl head={['Student', 'P', 'L', 'A', '%']}>{low.map(s => (
          <tr key={s.sid}><Cell2 a={s.name} b={`${s.batch}${s.school ? ' · ' + s.school : ''} · ${s.held} ${s.held === 1 ? 'class' : 'classes'}`} /><td>{s.present}</td><td>{s.late}</td><td>{s.absent}</td><td><PctChip p={s.percent} /></td></tr>
        ))}</RTbl>{LEG}</> : <Empty>Nobody is below this level. 🎉</Empty>}</>;
      csv = [...head, ['Below', st.low + '%'], [], ['Student', 'School', 'Batch', 'Classes', 'Present', 'Late', 'Absent', 'Percent attended'], ...low.map(s => [s.name, s.school, s.batch, s.held, s.present, s.late, s.absent, s.percent])];
      name = 'low-attendance.csv';
    } else if (view === 'att-school') {
      const g: Record<string, { school: string; students: number; held: number; present: number; late: number; absent: number }> = {};
      for (const s of d.students) { const k = skey(s.school), e = g[k] ||= { school: s.school || '', students: 0, held: 0, present: 0, late: 0, absent: 0 }; e.students++; e.held += s.held; e.present += s.present; e.late += s.late; e.absent += s.absent; }
      const rows = Object.values(g).map(e => ({ ...e, percent: e.held ? Math.round((e.present + e.late) * 1000 / e.held) / 10 : null })).sort((a, b) => Number(!a.school) - Number(!b.school) || a.school.localeCompare(b.school));
      body = <><RTbl head={['School', 'P', 'L', 'A', '%']}>{rows.map((e, i) => (
        <tr key={i}><Cell2 a={e.school || 'No school entered'} b={`${e.students} ${e.students === 1 ? 'student' : 'students'}`} /><td>{e.present}</td><td>{e.late}</td><td>{e.absent}</td><td><PctChip p={e.percent} /></td></tr>
      ))}</RTbl>{LEG}</>;
      csv = [...head, ['School', 'Students', 'Present', 'Late', 'Absent', 'Percent attended'], ...rows.map(e => [e.school || '(none)', e.students, e.present, e.late, e.absent, e.percent])];
      name = 'attendance-by-school.csv';
    }
    return { body, csv: d.recs.length ? csv : null, name, d };
  }, [err, view, scope, st, app.students, app.classes, app.batches, ver, nowIso.slice(0, 16)]); // eslint-disable-line react-hooks/exhaustive-deps

  const d = out?.d, sm = d?.sum;
  return (
    <>
      <ReportHead id={view}>
        {needsRange && <PresetBar keys={['today', 'week', 'd7', 'd30', 'month', 'last']} value={st.preset} onPick={k => { if (k === 'custom') set({ preset: 'custom' }); else { const [from, to] = PRESETS[k][1](); set({ preset: k, from, to }); } }} />}
        <details className="fdet"><summary>Filters</summary>
          <div className="filters" style={{ marginTop: 10 }}>
            {needsRange && <>
              <div><label htmlFor="f1">From</label><input id="f1" type="date" value={st.from} onChange={e => set({ from: e.target.value, preset: 'custom' })} /></div>
              <div><label htmlFor="f2">To</label><input id="f2" type="date" value={st.to} onChange={e => set({ to: e.target.value, preset: 'custom' })} /></div>
            </>}
            <div><label htmlFor="f3">Batch</label><select id="f3" value={st.batch} onChange={e => set({ batch: e.target.value })}><Options items={app.batches} placeholder="All batches" /></select></div>
            <div><label htmlFor="f4">Subject</label><select id="f4" value={st.subject} onChange={e => set({ subject: e.target.value })}><Options items={SUBJECTS} placeholder="All subjects" /></select></div>
            {view !== 'att-school' && view !== 'att-missing' && (
              <div><label htmlFor="f6">School</label>
                <select id="f6" value={st.school} onChange={e => set({ school: e.target.value })}><option value="">All schools</option><option value="__none">No school entered</option>{app.schoolNames(true).map(x => <option key={x.key} value={x.name}>{x.name}</option>)}</select></div>
            )}
            {['att-student', 'att-register', 'att-absent', 'att-late'].includes(view) && (
              <div className="wide"><label htmlFor="f5">Student</label><select id="f5" value={st.student} onChange={e => set({ student: e.target.value })}><Options items={app.students.filter(s => s.active)} placeholder="All students" /></select></div>
            )}
            {view === 'att-low' && <div><label htmlFor="f7">Below attendance %</label><input id="f7" type="number" min={1} max={100} inputMode="numeric" value={st.low} onChange={e => set({ low: Math.max(1, Math.min(100, Number(e.target.value) || 75)) })} /></div>}
          </div>
        </details>
      </ReportHead>
      {err && err !== '…' ? <div className="alert bad">{err}</div> : out && (
        <>
          {view === 'att-missing' ? null : (
            <>
              <div className="card" style={{ marginBottom: 10 }}><b>{rangeText}</b><div className="mute small">{filterText}</div></div>
              {d && d.missing.length > 0 && <Link className="alert" href="/reports/att-missing" style={{ textDecoration: 'none' }}><span><b>{d.missing.length}</b> finished {d.missing.length === 1 ? 'class in this range has' : 'classes in this range have'} no attendance recorded and {d.missing.length === 1 ? 'is' : 'are'} not counted.</span><span className="btn sm">See</span></Link>}
              {sm && <div className="stats">
                <div className="stat"><b>{sm.percent == null ? '—' : sm.percent + '%'}</b><span>Overall attendance</span></div><div className="stat"><b>{sm.classes}</b><span>Classes held</span></div>
                <div className="stat"><b>{sm.present}</b><span>Present</span></div><div className="stat"><b>{sm.late}</b><span>Late</span></div><div className="stat"><b>{sm.absent}</b><span>Absent</span></div>
              </div>}
            </>
          )}
          <div style={{ marginTop: 12 }}>{out.body}</div>
          {out.csv && <div className="row wrap mt"><button className="btn" onClick={() => saveFile(out.name.replace('.csv', needsRange ? `-${st.from}-to-${st.to}.csv` : '.csv'), csvOf(out.csv as (string | number)[][]), 'text/csv')}>Download this report (CSV)</button></div>}
        </>
      )}
    </>
  );
}
