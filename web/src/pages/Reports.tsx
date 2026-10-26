import { ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import AttReport from './AttReports'
import OutReport from './OutReports'
import ParentReports from './ParentReports'
import { useEffect, useState } from 'react'
import { api, ClassRow } from '../api'

export const ATT: [string, string, string][] = [
  ['att-student', 'Attendance summary', 'Each student’s Present, Late and Absent counts and attendance % for the dates you choose'],
  ['att-class', 'Attendance by class', 'One row per class: how many were present, late or absent'],
  ['att-register', 'Attendance register', 'Students down the side, class dates across, P / L / A in every cell'],
  ['att-absent', 'Absent students', 'Every absence in the range, and who was absent most'],
  ['att-late', 'Late arrivals', 'Who arrived late, when, and any note'],
  ['att-low', 'Low attendance', 'Students whose attendance is below a percentage you choose'],
  ['att-school', 'Attendance by school', 'Totals grouped by the school entered for each student'],
  ['att-missing', 'Classes with no attendance recorded', 'Finished classes that still need attendance, so they are not missing from reports'],
]
export const OUT: [string, string, string][] = [
  ['out-student', 'Outstanding fees by student', 'Who owes what today, with the amount overdue and the oldest unpaid due date'],
  ['out-overdue', 'Overdue fees', 'Every unpaid fee past its due date, with days overdue'],
  ['out-ageing', 'Overdue ageing', 'Outstanding fees grouped by how long they have been overdue'],
  ['out-batch', 'Outstanding by batch', 'Outstanding and overdue amounts for each batch'],
  ['out-subject', 'Outstanding by subject', 'Outstanding and overdue amounts for each subject'],
  ['out-month', 'Outstanding by month', 'Outstanding and overdue amounts for each billing month'],
  ['out-soon', 'Fees due in the next 7 days', 'Unpaid fees falling due soon'],
  ['out-credit', 'Advance payments (credit balances)', 'Students who have paid more than they have been charged'],
  ['out-payments', 'Payments received', 'Payments in a date range, with totals by method'],
]
export const PARENT: [string, string, string][] = [['parent', 'Monthly attendance report for parents', 'A neat PDF for each student to share with their parent or guardian by WhatsApp or email']]

export function ReportShell({ id, children }: { id: string; children: ReactNode }) {
  const { user } = useAuth()
  const nav = useNavigate()
  const groups: [string, [string, string, string][]][] = [['Attendance Reports', ATT], ...(user?.role === 'admin' ? ([['Outstanding Reports', OUT], ['Parent Reports', PARENT]] as [string, [string, string, string][]][]) : [])]
  const title = [...ATT, ...OUT, ...PARENT].find(r => r[0] === id)?.[1]
  return (
    <>
      <div className="row between" style={{ marginBottom: 6 }}><Link to="/reports" className="small" style={{ textDecoration: 'none' }}>‹ All reports</Link></div>
      <div className="head"><h1 style={{ fontSize: '1.4rem' }}>{title}</h1></div>
      <label htmlFor="rv" className="small mute">Switch report</label>
      <select id="rv" aria-label="Switch report" value={id} onChange={e => nav('/reports/' + e.target.value)} style={{ marginBottom: 12 }}>
        {groups.map(([n, g]) => <optgroup key={n} label={n}>{g.map(r => <option key={r[0]} value={r[0]}>{r[1]}</option>)}</optgroup>)}
      </select>
      {children}
    </>
  )
}

function Hub() {
  const { user } = useAuth()
  const admin = user?.role === 'admin'
  const [pend, setPend] = useState(0)
  useEffect(() => { api<ClassRow[]>('/attendance/pending').then(r => setPend(r.length)).catch(() => {}) }, [])
  const rows = (list: [string, string, string][]) => list.map(([id, t, d]) => <Link key={id} className="rrow" to={`/reports/${id}`}><span className="grow"><b>{t}</b><span className="mute small">{d}</span></span><span className="chev" aria-hidden="true">›</span></Link>)
  return (
    <>
      <div className="head"><h1>Reports</h1></div>
      <div className="small mute" style={{ margin: '-6px 0 12px' }}>Choose a report. Each one can be filtered and downloaded as a CSV file.</div>
      {pend > 0 && <Link className="alert" to="/reports/att-missing"><span><b>{pend}</b> finished {pend === 1 ? 'class has' : 'classes have'} no attendance recorded</span><span className="btn sm">Open</span></Link>}
      <section aria-labelledby="h-att"><div className="sec"><h2 id="h-att">Attendance Reports</h2><span className="mute small">{ATT.length} reports</span></div><div className="card rlist">{rows(ATT)}</div></section>
      {admin && <>
        <section aria-labelledby="h-out"><div className="sec"><h2 id="h-out">Outstanding Reports</h2><span className="mute small">{OUT.length} reports · fees and payments</span></div><div className="card rlist">{rows(OUT)}</div></section>
        <section aria-labelledby="h-par"><div className="sec"><h2 id="h-par">Parent Reports</h2><span className="mute small">to share with families</span></div><div className="card rlist">{rows(PARENT)}</div></section>
      </>}
    </>
  )
}

export default function Reports() {
  const { id } = useParams()
  const { user } = useAuth()
  if (!id) return <Hub />
  if (ATT.some(r => r[0] === id)) return <AttReport view={id} key={id} />
  if (user?.role === 'admin' && OUT.some(r => r[0] === id)) return <OutReport view={id} key={id} />
  if (user?.role === 'admin' && id === 'parent') return <ParentReports key={id} />
  return <Navigate to="/reports" replace />
}
