import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ClassRow, Dashboard as D } from '../api'
import { useAuth } from '../auth'
import { Chip, Spinner, fmt } from '../ui'

function ClassItem({ c }: { c: ClassRow }) {
  const { cfg, user } = useAuth()
  const f = fmt(cfg)
  const needs = user?.role !== 'student' && c.finished && !c.attendance_taken
  return (
    <Link to={`/classes/${c.id}`} className="cls" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <div className="body" style={{ paddingLeft: 12 }}>
        <div className="row between"><b>{c.subject}</b><span className="mute small">{f.time(c.start_at)}–{f.time(c.end_at)}</span></div>
        <div className="mute small">{c.batch}{c.teacher_name ? ' · ' + c.teacher_name : ''}</div>
        <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>{needs && <Chip kind="warn">Attendance needed</Chip>}{c.status === 'cancelled' && <Chip kind="bad">Cancelled</Chip>}</div>
      </div>
    </Link>
  )
}

export default function Dashboard() {
  const { user, cfg } = useAuth()
  const [d, setD] = useState<D | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { api<D>('/dashboard').then(setD).catch(e => setErr((e as Error).message)) }, [])
  if (err) return <div className="alert bad">{err}</div>
  if (!d || !cfg) return <Spinner />
  const f = fmt(cfg)
  return (
    <>
      <div className="head"><h1>{f.date(new Date().toISOString())}</h1></div>
      {user?.role === 'student' ? (
        <>
          <div className="stats"><div className="stat"><b>{d.attendance?.percent ?? '—'}{d.attendance?.percent != null ? '%' : ''}</b><span>My attendance</span></div><div className="stat"><b>{d.attendance?.attended ?? 0}</b><span>Classes attended</span></div></div>
          <div className="sec"><h2>Coming up</h2></div>
          {d.upcoming?.length ? d.upcoming.map(c => <ClassItem key={c.id} c={c} />) : <div className="empty">No classes in the next week.</div>}
        </>
      ) : (
        <>
          {!!d.pending_attendance && <Link className="alert" to="/classes?tab=pending"><span><b>{d.pending_attendance}</b> finished {d.pending_attendance === 1 ? 'class has' : 'classes have'} no attendance recorded</span><span className="btn sm">Review</span></Link>}
          <div className="stats"><div className="stat"><b>{d.students}</b><span>Students</span></div><div className="stat"><b>{d.today?.length ?? 0}</b><span>Classes today</span></div><div className="stat"><b>{d.week_classes}</b><span>Classes this week</span></div></div>
          <div className="sec"><h2>Today’s classes</h2><Link to="/classes" className="small">All classes</Link></div>
          {d.today?.length ? d.today.map(c => <ClassItem key={c.id} c={c} />) : <div className="empty">No classes today.</div>}
        </>
      )}
    </>
  )
}
