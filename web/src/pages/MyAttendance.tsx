import { useEffect, useState } from 'react'
import { api, AttReport } from '../api'
import { useAuth } from '../auth'
import { Spinner, StatusChip, fmt } from '../ui'
import { dayTz, addDays } from '../lib'

export default function MyAttendance() {
  const { cfg } = useAuth()
  const f = fmt(cfg)
  const [from, setFrom] = useState(addDays(dayTz(cfg!), -29))
  const [to, setTo] = useState(dayTz(cfg!))
  const [d, setD] = useState<AttReport | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { setD(null); setErr(''); api<AttReport>(`/reports/attendance?from=${from}&to=${to}`).then(setD).catch(e => setErr((e as Error).message)) }, [from, to])
  return (
    <>
      <div className="head"><h1>My attendance</h1></div>
      <div className="filters"><div><label htmlFor="a1">From</label><input id="a1" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div><div><label htmlFor="a2">To</label><input id="a2" type="date" value={to} onChange={e => setTo(e.target.value)} /></div></div>
      {err ? <div className="alert bad">{err}</div> : !d ? <Spinner /> : <>
        <div className="stats"><div className="stat"><b>{d.summary.percent == null ? '—' : d.summary.percent + '%'}</b><span>Attendance</span></div><div className="stat"><b>{d.summary.classes}</b><span>Classes</span></div><div className="stat"><b>{d.summary.present}</b><span>Present</span></div><div className="stat"><b>{d.summary.late}</b><span>Late</span></div><div className="stat"><b>{d.summary.absent}</b><span>Absent</span></div></div>
        {d.records?.length ? <div className="tbl mt"><table className="cmp"><thead><tr><th>Date</th><th>Subject</th><th>Status</th></tr></thead><tbody>{d.records.map((r, i) => <tr key={i}><td>{f.date(r.start_at)}</td><td>{r.subject}</td><td><StatusChip s={r.status} /></td></tr>)}</tbody></table></div> : <div className="empty mt">No attendance recorded for these dates.</div>}</>}
    </>
  )
}
