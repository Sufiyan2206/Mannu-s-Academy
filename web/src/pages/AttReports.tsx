import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, AttReport as R, AStatus, Student } from '../api'
import { useAuth } from '../auth'
import { Chip, Spinner, StatusChip, fmt } from '../ui'
import { dayTz, downloadCsv, Preset, PRESET_LABEL, presetRange, pctClass } from '../lib'
import { ATT, ReportShell } from './Reports'

const L: Record<AStatus, string> = { present: 'P', late: 'L', absent: 'A' }
const NAMES: Record<AStatus, string> = { present: 'Present', late: 'Late', absent: 'Absent' }
const Pct = ({ p }: { p: number | null }) => p == null ? <>—</> : <Chip kind={pctClass(p)}>{p}%</Chip>

export default function AttReport({ view }: { view: string }) {
  const { cfg } = useAuth()
  const nav = useNavigate()
  const f = fmt(cfg)
  const needsRange = view !== 'att-missing'
  const today = dayTz(cfg!)
  const [st, setSt] = useState({ from: presetRange('d30', today)[0], to: today, batch: '', subject: '', student: '', school: '', preset: 'd30' as Preset | 'custom', low: 75 })
  const [data, setData] = useState<R | null>(null)
  const [err, setErr] = useState('')
  const [students, setStudents] = useState<Student[]>([])
  const [schools, setSchools] = useState<{ name: string }[]>([])
  useEffect(() => { api<Student[]>('/students').then(setStudents); api<{ name: string }[]>('/students/schools').then(setSchools) }, [])
  useEffect(() => {
    setErr(''); setData(null)
    const p = new URLSearchParams({ ...(needsRange ? { from: st.from, to: st.to } : {}), batch: st.batch, subject: st.subject, student_id: st.student, school: st.school, detail: '1' })
    for (const [k, v] of [...p]) if (!v) p.delete(k)
    if (needsRange && st.from > st.to) { setErr('The “From” date is after the “To” date.'); return }
    api<R>('/reports/attendance?' + p).then(setData).catch(e => setErr((e as Error).message))
  }, [st.from, st.to, st.batch, st.subject, st.student, st.school, needsRange])
  const filterText = [st.batch && cfg!.batches.find(b => String(b.id) === st.batch)?.name, st.subject && cfg!.subjects.find(s => String(s.id) === st.subject)?.name, st.school && (st.school === '__none' ? 'no school entered' : st.school), st.student && students.find(s => String(s.id) === st.student)?.name].filter(Boolean).join(' · ') || 'All batches, subjects and students'
  const rangeText = !needsRange ? 'Up to today' : st.from === st.to ? f.dateY(st.from + 'T12:00:00Z') : `${f.dateY(st.from + 'T12:00:00Z')} – ${f.dateY(st.to + 'T12:00:00Z')}`
  const title = ATT.find(a => a[0] === view)![1]
  const head: (string | number | null)[][] = [['Report', title], ['Range', needsRange ? `${st.from} to ${st.to}` : 'Up to today'], ['Filters', filterText], []]
  const setPreset = (p: Preset) => { const [a, b] = presetRange(p, today); setSt(s => ({ ...s, from: a, to: b, preset: p })) }

  const body = useMemo(() => {
    if (!data) return null
    const sm = data.summary, recs = data.records ?? []
    const noData = !sm.records
    const tbl = (h: string[], rows: JSX.Element[]) => <div className="tbl"><table className="cmp"><thead><tr>{h.map(x => <th key={x}>{x}</th>)}</tr></thead><tbody>{rows}</tbody></table></div>
    const leg = <p className="mute small" style={{ margin: '6px 0 0' }}>P = Present · L = Late · A = Absent</p>
    const dl = (name: string, rows: (string | number | null)[][]) => <div className="row wrap mt"><button className="btn" onClick={() => downloadCsv(`${name}${needsRange ? `-${st.from}-to-${st.to}` : ''}.csv`, [...head, ...rows])}>Download this report (CSV)</button></div>
    const studentRow = (s: R['students'][number]) => <tr key={s.student_id}><td><b>{s.name}</b><div className="mute small">{s.batch}{s.school ? ' · ' + s.school : ''} · {s.held} {s.held === 1 ? 'class' : 'classes'}</div></td><td>{s.present}</td><td>{s.late}</td><td>{s.absent}</td><td><Pct p={s.percent} /></td></tr>
    const sumCsv = (list: R['students']) => [['Student', 'School', 'Batch', 'Classes', 'Present', 'Late', 'Absent', 'Percent attended'], ...list.map(s => [s.name, s.school, s.batch, s.held, s.present, s.late, s.absent, s.percent])]
    if (view === 'att-missing') {
      const miss = data.missing ?? []
      return <>{miss.length ? <>{tbl(['Class', 'Date'], miss.map(m => <tr key={m.class_id} className="tap" onClick={() => nav(`/classes/${m.class_id}`)}><td><b>{m.subject}</b><div className="mute small">{m.batch}</div></td><td>{f.date(m.start_at)}<div className="mute small">{f.time(m.start_at)}</div></td></tr>))}<p className="mute small">Tap a class to record its attendance.</p>{dl('classes-without-attendance', [['Subject', 'Batch', 'Date', 'Time'], ...miss.map(m => [m.subject, m.batch, f.dateY(m.start_at), f.time(m.start_at)])])}</> : <div className="empty">Every finished class has attendance recorded. 🎉</div>}</>
    }
    if (noData) return <div className="empty mt">No attendance recorded in this date range for these filters.</div>
    switch (view) {
      case 'att-student': return <>{st.student ? tbl(['Date', 'Subject', 'Status', 'Arrived'], recs.map((r, i) => <tr key={i}><td>{f.date(r.start_at)}</td><td>{r.subject}</td><td><StatusChip s={r.status} />{r.note && <div className="mute small">{r.note}</div>}</td><td>{r.join_time ? f.time(r.join_time) : '—'}</td></tr>)) : tbl(['Student', 'P', 'L', 'A', '%'], data.students.map(studentRow))}{leg}
        {dl('attendance-summary', st.student ? [['Date', 'Subject', 'Batch', 'Status', 'Arrived', 'Left', 'Minutes', 'Note'], ...recs.map(r => [f.dateY(r.start_at), r.subject, r.batch, NAMES[r.status], r.join_time ? f.time(r.join_time) : '', r.leave_time ? f.time(r.leave_time) : '', r.duration_sec == null ? '' : Math.round(r.duration_sec / 60), r.note])] : sumCsv(data.students))}</>
      case 'att-class': return <>{tbl(['Class', 'P', 'L', 'A', '%'], data.by_class.map(b => <tr key={b.class_id} className="tap" onClick={() => nav(`/classes/${b.class_id}`)}><td><b>{f.date(b.start_at)}</b> · {f.time(b.start_at)}<div className="mute small">{b.subject} · {b.batch}</div></td><td>{b.present}</td><td>{b.late}</td><td>{b.absent}</td><td><Pct p={b.percent} /></td></tr>))}{leg}
        {dl('attendance-by-class', [['Date', 'Time', 'Subject', 'Batch', 'Present', 'Late', 'Absent', 'Percent attended'], ...data.by_class.map(b => [f.dateY(b.start_at), f.time(b.start_at), b.subject, b.batch, b.present, b.late, b.absent, b.percent])])}</>
      case 'att-register': { const rg = data.register!; return <><div className="tbl"><table className="reg"><thead><tr><th>Student</th>{rg.classes.map(c => <th key={c.class_id}>{f.date(c.start_at).replace(/^\w+, /, '')}<div className="mute small">{c.subject.slice(0, 4)}</div></th>)}<th>%</th></tr></thead><tbody>{rg.rows.map(r => <tr key={r.student_id}><td>{r.name}</td>{rg.classes.map(c => { const v = r.cells[c.class_id]; return v ? <td key={c.class_id} className={`rg ${v}`} title={NAMES[v]}>{L[v]}</td> : <td key={c.class_id} className="rg none">·</td> })}<td>{r.percent}%</td></tr>)}</tbody></table></div>
        <p className="mute small">P = Present, L = Late, A = Absent, · = not in that class. Swipe sideways for more dates.{rg.truncated ? ' Showing the latest 60 classes.' : ''}</p>
        {dl('attendance-register', [['Student', ...rg.classes.map(c => `${f.dateY(c.start_at)} ${c.subject}`), 'Percent attended'], ...rg.rows.map(r => [r.name, ...rg.classes.map(c => r.cells[c.class_id] ? NAMES[r.cells[c.class_id]] : ''), r.percent])])}</> }
      case 'att-absent': { const ab = data.absences ?? []; const by: Record<string, number> = {}; ab.forEach(a => { by[a.student] = (by[a.student] || 0) + 1 }); const top = Object.entries(by).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        return ab.length ? <><div className="sec"><h2>Most absences</h2></div>{tbl(['Student', 'Absences'], top.slice(0, 10).map(([n, c]) => <tr key={n}><td><b>{n}</b></td><td>{c}</td></tr>))}<div className="sec"><h2>All absences</h2><span className="mute small">{ab.length}</span></div>{tbl(['Student', 'Date'], ab.map((a, i) => <tr key={i}><td><b>{a.student}</b><div className="mute small">{a.subject} · {a.batch}{a.note ? ' · ' + a.note : ''}</div></td><td>{f.date(a.start_at)}<div className="mute small">{f.time(a.start_at)}</div></td></tr>))}
          {dl('absent-students', [['Student', 'Batch', 'Subject', 'Date', 'Time', 'Note'], ...ab.map(a => [a.student, a.batch, a.subject, f.dateY(a.start_at), f.time(a.start_at), a.note])])}</> : <div className="empty">No absences in this range. 🎉</div> }
      case 'att-late': { const late = recs.filter(r => r.status === 'late')
        return late.length ? <>{tbl(['Student', 'Date', 'Arrived'], late.map((r, i) => <tr key={i}><td><b>{r.student}</b><div className="mute small">{r.subject}{r.note ? ' · ' + r.note : ''}</div></td><td>{f.date(r.start_at)}</td><td>{r.join_time ? f.time(r.join_time) : '—'}</td></tr>))}
          {dl('late-arrivals', [['Student', 'Batch', 'Subject', 'Date', 'Class time', 'Arrived', 'Note'], ...late.map(r => [r.student, r.batch, r.subject, f.dateY(r.start_at), f.time(r.start_at), r.join_time ? f.time(r.join_time) : '', r.note])])}</> : <div className="empty">No late arrivals in this range.</div> }
      case 'att-low': { const low = data.students.filter(s => s.percent != null && s.percent < st.low).sort((a, b) => a.percent! - b.percent! || a.name.localeCompare(b.name))
        return <><div className="small mute" style={{ margin: '8px 0' }}>{low.length} of {data.students.length} {data.students.length === 1 ? 'student is' : 'students are'} below {st.low}%.</div>{low.length ? <>{tbl(['Student', 'P', 'L', 'A', '%'], low.map(studentRow))}{leg}{dl('low-attendance', [['Below', st.low + '%'], [], ...sumCsv(low)])}</> : <div className="empty">Nobody is below this level. 🎉</div>}</> }
      case 'att-school': { const g: Record<string, { school: string; students: number; held: number; present: number; late: number; absent: number }> = {}
        data.students.forEach(s => { const k = s.school.trim().toLowerCase(); const e = (g[k] ||= { school: s.school, students: 0, held: 0, present: 0, late: 0, absent: 0 }); e.students++; e.held += s.held; e.present += s.present; e.late += s.late; e.absent += s.absent })
        const rows = Object.values(g).map(e => ({ ...e, percent: e.held ? Math.round((e.present + e.late) * 1000 / e.held) / 10 : null })).sort((a, b) => Number(!a.school) - Number(!b.school) || a.school.localeCompare(b.school))
        return <>{tbl(['School', 'P', 'L', 'A', '%'], rows.map(e => <tr key={e.school}><td><b>{e.school || 'No school entered'}</b><div className="mute small">{e.students} {e.students === 1 ? 'student' : 'students'}</div></td><td>{e.present}</td><td>{e.late}</td><td>{e.absent}</td><td><Pct p={e.percent} /></td></tr>))}{leg}
          {dl('attendance-by-school', [['School', 'Students', 'Present', 'Late', 'Absent', 'Percent attended'], ...rows.map(e => [e.school || '(none)', e.students, e.present, e.late, e.absent, e.percent])])}</> }
    }
    return null
  }, [data, view, st, f, nav, head, needsRange])  // eslint-disable-line react-hooks/exhaustive-deps

  const sm = data?.summary
  return (
    <ReportShell id={view}>
      {needsRange && <div className="seg wrapseg" role="group" aria-label="Date range">{(Object.keys(PRESET_LABEL) as Preset[]).map(p => <button key={p} aria-pressed={st.preset === p} onClick={() => setPreset(p)}>{PRESET_LABEL[p]}</button>)}<button aria-pressed={st.preset === 'custom'} onClick={() => setSt(s => ({ ...s, preset: 'custom' }))}>Custom</button></div>}
      <details className="fdet"><summary>Filters</summary><div className="filters" style={{ marginTop: 10 }}>
        {needsRange && <><div><label htmlFor="f1">From</label><input id="f1" type="date" value={st.from} onChange={e => setSt({ ...st, from: e.target.value, preset: 'custom' })} /></div><div><label htmlFor="f2">To</label><input id="f2" type="date" value={st.to} onChange={e => setSt({ ...st, to: e.target.value, preset: 'custom' })} /></div></>}
        <div><label htmlFor="f3">Batch</label><select id="f3" value={st.batch} onChange={e => setSt({ ...st, batch: e.target.value })}><option value="">All batches</option>{cfg!.batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
        <div><label htmlFor="f4">Subject</label><select id="f4" value={st.subject} onChange={e => setSt({ ...st, subject: e.target.value })}><option value="">All subjects</option>{cfg!.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        {view !== 'att-school' && view !== 'att-missing' && <div><label htmlFor="f6">School</label><select id="f6" value={st.school} onChange={e => setSt({ ...st, school: e.target.value })}><option value="">All schools</option><option value="__none">No school entered</option>{schools.map(x => <option key={x.name} value={x.name}>{x.name}</option>)}</select></div>}
        {['att-student', 'att-register', 'att-absent', 'att-late'].includes(view) && <div className="wide"><label htmlFor="f5">Student</label><select id="f5" value={st.student} onChange={e => setSt({ ...st, student: e.target.value })}><option value="">All students</option>{students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>}
        {view === 'att-low' && <div><label htmlFor="f7">Below attendance %</label><input id="f7" type="number" min={1} max={100} inputMode="numeric" value={st.low} onChange={e => setSt({ ...st, low: Math.max(1, Math.min(100, Number(e.target.value) || 75)) })} /></div>}
      </div></details>
      {err ? <div className="alert bad">{err}</div> : !data ? <Spinner /> : <>
        <div className="card" style={{ marginBottom: 10 }}><b>{rangeText}</b><div className="mute small">{filterText}</div></div>
        {view !== 'att-missing' && data.missing && data.missing.length > 0 && <a className="alert" href="/reports/att-missing" onClick={e => { e.preventDefault(); nav('/reports/att-missing') }}><span><b>{data.missing.length}</b> finished {data.missing.length === 1 ? 'class in this range has' : 'classes in this range have'} no attendance recorded and {data.missing.length === 1 ? 'is' : 'are'} not counted.</span><span className="btn sm">See</span></a>}
        {view !== 'att-missing' && sm && <div className="stats"><div className="stat"><b>{sm.percent == null ? '—' : sm.percent + '%'}</b><span>Overall attendance</span></div><div className="stat"><b>{sm.classes}</b><span>Classes held</span></div><div className="stat"><b>{sm.present}</b><span>Present</span></div><div className="stat"><b>{sm.late}</b><span>Late</span></div><div className="stat"><b>{sm.absent}</b><span>Absent</span></div></div>}
        <div style={{ marginTop: 12 }}>{body}</div></>}
    </ReportShell>
  )
}
