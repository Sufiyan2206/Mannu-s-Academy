import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, AStatus, AttRow, ClassDetail, ZoomRow } from '../api'
import { useAuth } from '../auth'
import { Chip, Field, Modal, Spinner, STATUS, StatusChip, fmt, useToast } from '../ui'

type Draft = { status: AStatus | ''; join: string; leave: string; note: string }

function AttendanceEditor({ c, onClose, onDone }: { c: ClassDetail; onClose: () => void; onDone: () => void }) {
  const { cfg } = useAuth()
  const { toast } = useToast()
  const f = fmt(cfg)
  const by = useMemo(() => Object.fromEntries((c.attendance ?? []).map(a => [a.student_id, a])), [c.attendance])
  const zr = useMemo(() => Object.fromEntries((c.zoom_attendance ?? []).map(z => [z.student_id, z])) as Record<number, ZoomRow>, [c.zoom_attendance])
  const has = (c.attendance ?? []).length > 0
  const [d, setD] = useState<Record<number, Draft>>(() => Object.fromEntries((c.students ?? []).map(s => { const a = by[s.id]; return [s.id, { status: (a?.status ?? '') as AStatus | '', join: a?.join_time ? f.hhmm(a.join_time) : '', leave: a?.leave_time ? f.hhmm(a.leave_time) : '', note: a?.note ?? '' }] })))
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const startDay = f.day(c.start_at), startTod = f.hhmm(c.start_at), crosses = f.day(c.end_at) !== startDay
  const toLocal = (t: string) => (t ? (t < startTod && crosses ? f.day(c.end_at) : startDay) + 'T' + t : '')
  const set = (id: number, p: Partial<Draft>) => { setErr(''); setD(x => ({ ...x, [id]: { ...x[id], ...p } })) }
  const unmarked = Object.values(d).filter(x => !x.status).length

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('')
    if (unmarked) return setErr(`Mark ${unmarked === 1 ? 'this student' : unmarked + ' students'} as Present, Late or Absent.`)
    const records = (c.students ?? []).map(s => ({ student_id: s.id, status: d[s.id].status, join_local: toLocal(d[s.id].join), leave_local: toLocal(d[s.id].leave), note: d[s.id].note }))
    try { const r = await api<{ changed: number }>(`/classes/${c.id}/attendance`, { method: 'PUT', body: { records, reason } }); toast(r.changed ? `Attendance saved (${r.changed} ${r.changed === 1 ? 'change' : 'changes'})` : 'No changes'); onDone() } catch (x) { setErr((x as Error).message) }
  }
  return (
    <Modal title={has ? 'Correct attendance' : 'Mark attendance by hand'} onClose={onClose}>
      <form className="stack" onSubmit={submit} noValidate>
        <div className="alert info" style={{ display: 'block' }}><b>{c.subject}</b> · {c.batch}<br />{f.dateY(c.start_at)} · {f.time(c.start_at)} – {f.time(c.end_at)}{c.teacher_name ? ' · ' + c.teacher_name : ''}
          <div className="small" style={{ marginTop: 4 }}>Mark every student. “Arrived at” is the time the student joined; it is optional, but useful for Late.</div></div>
        {err && <div className="alert bad" role="alert">{err}</div>}
        <div className="row between"><span className="mute small">{unmarked ? `${unmarked} not marked yet` : 'All students marked'}</span><button type="button" className="btn sm" onClick={() => { setErr(''); setD(x => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v.status ? v : { ...v, status: 'present' as const }]))) }}>Mark all Present</button></div>
        {(c.students ?? []).map(s => {
          const z = zr[s.id]; const dr = d[s.id]
          return (
            <div className="card" key={s.id}>
              <b>{s.name}</b>
              <div className="seg att" role="radiogroup" aria-label={`Status for ${s.name}`} style={{ margin: '8px 0' }}>
                {(['present', 'late', 'absent'] as AStatus[]).map(k => <label key={k} className={k}><input type="radio" name={`st${s.id}`} value={k} checked={dr.status === k} onChange={() => set(s.id, { status: k })} /><span>{STATUS[k].label}</span></label>)}
              </div>
              <div className="two"><div><label>Arrived at <span className="mute">(optional)</span></label><input type="time" value={dr.join} onChange={e => set(s.id, { join: e.target.value })} /></div><div><label>Left at <span className="mute">(optional)</span></label><input type="time" value={dr.leave} onChange={e => set(s.id, { leave: e.target.value })} /></div></div>
              <input style={{ marginTop: 8 }} maxLength={200} placeholder="Note (optional), e.g. joined by phone" aria-label={`Note for ${s.name}`} value={dr.note} onChange={e => set(s.id, { note: e.target.value })} />
              {z && <div className="small mute" style={{ marginTop: 6 }}>Zoom: <StatusChip s={z.status} /> {z.join_time ? `joined ${f.hhmm(z.join_time)} · ` : ''}{f.dur(z.duration_sec)} <button type="button" className="btn sm" onClick={() => set(s.id, { status: z.status, join: z.join_time ? f.hhmm(z.join_time) : '', leave: z.leave_time ? f.hhmm(z.leave_time) : '' })}>Use Zoom’s</button></div>}
            </div>
          )
        })}
        <Field label={has ? 'Reason for correction' : 'Note for the record'} hint={has ? 'saved in the change history' : 'optional'}><input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Joined by phone without logging in" maxLength={300} /></Field>
        <div className="foot"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">{has ? 'Save changes' : 'Save attendance'}</button></div>
      </form>
    </Modal>
  )
}

function AttendanceTable({ c }: { c: ClassDetail }) {
  const { cfg } = useAuth()
  const f = fmt(cfg)
  const att = c.attendance ?? []
  const zr = Object.fromEntries((c.zoom_attendance ?? []).map(z => [z.student_id, z])) as Record<number, ZoomRow>
  const n = (k: AStatus) => att.filter(a => a.status === k).length
  const differs = (a: AttRow) => zr[a.student_id] && zr[a.student_id].status !== a.status
  if (!att.length) return <div className="empty">No attendance recorded yet. Use “Mark attendance by hand”.</div>
  return (
    <>
      <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}><Chip kind="ok">Present {n('present')}</Chip><Chip kind="warn">Late {n('late')}</Chip><Chip kind="bad">Absent {n('absent')}</Chip></div>
      <div className="tbl"><table><thead><tr><th>Student</th><th>Status</th><th>Arrived</th><th>Left</th><th>Time in class</th><th>Recorded by</th><th>Note</th></tr></thead><tbody>
        {att.map(a => (
          <tr key={a.student_id}><td>{a.student_name}</td><td><StatusChip s={a.status} />{differs(a) && <> <Chip>≠ Zoom</Chip></>}</td><td>{a.join_time ? f.time(a.join_time) : '—'}</td><td>{a.leave_time ? f.time(a.leave_time) : '—'}</td><td>{f.dur(a.duration_sec)}</td>
            <td className="small">{a.source === 'zoom' ? <>Zoom<div className="mute">{f.dt(a.updated_at)}</div></> : <>Entered by hand<div className="mute">{a.created_by_name ?? '—'} · {f.dt(a.created_at)}{a.updated_at !== a.created_at && <><br />Changed by {a.updated_by_name} · {f.dt(a.updated_at)}</>}</div></>}</td><td className="small">{a.note}</td></tr>
        ))}
      </tbody></table></div>
      <p className="mute small">Present or Late both count as attended.</p>
    </>
  )
}

export default function ClassDetailPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const { cfg, user } = useAuth()
  const { toast } = useToast()
  const [c, setC] = useState<ClassDetail | null>(null)
  const [err, setErr] = useState('')
  const [edit, setEdit] = useState(false)
  const f = fmt(cfg)
  const load = useCallback(() => api<ClassDetail>(`/classes/${id}`).then(setC).catch(e => setErr((e as Error).message)), [id])
  useEffect(() => { void load() }, [load])
  if (err) return <div className="alert bad">{err}</div>
  if (!c) return <Spinner />
  const staff = user?.role !== 'student'
  async function syncZoom() {
    try { const r = await api<{ applied: number; kept_manual: number; unmatched: number }>(`/classes/${c!.id}/sync-attendance`, { method: 'POST' }); toast(`Zoom attendance read: ${r.applied} updated${r.kept_manual ? `, ${r.kept_manual} kept as you entered them` : ''}${r.unmatched ? `, ${r.unmatched} unknown joiner(s)` : ''}`); await load() } catch (x) { toast((x as Error).message, true) }
  }
  async function cancel() {
    const reason = window.prompt('Why is the class cancelled? (optional)') ?? null
    if (reason === null) return
    try { await api(`/classes/${c!.id}/cancel`, { method: 'POST', body: { reason } }); toast('Class cancelled'); await load() } catch (x) { toast((x as Error).message, true) }
  }
  return (
    <>
      <div className="row between" style={{ marginBottom: 6 }}><button className="btn sm" onClick={() => nav(-1)}>‹ Back</button></div>
      <div className="head"><h1 style={{ fontSize: '1.4rem' }}>{c.subject} · {c.batch}</h1></div>
      <div className="row wrap" style={{ gap: 6 }}>{c.status === 'cancelled' && <Chip kind="bad">Cancelled</Chip>}{c.finished && <Chip>Finished</Chip>}</div>
      <dl className="kv"><dt>When</dt><dd>{f.date(c.start_at)} {f.dateY(c.start_at)}, {f.time(c.start_at)}–{f.time(c.end_at)}</dd><dt>Teacher</dt><dd>{c.teacher_name ?? '—'}</dd>{c.agenda && <><dt>Topic</dt><dd>{c.agenda}</dd></>}{c.status === 'cancelled' && c.cancel_reason && <><dt>Reason</dt><dd>{c.cancel_reason}</dd></>}</dl>
      {c.status === 'scheduled' && !c.finished && c.join_url && <a className="btn primary" href={c.join_url} target="_blank" rel="noopener noreferrer">Join the class</a>}
      {!staff ? (c.my_attendance ? <div className="card mt"><b>My attendance</b> <StatusChip s={c.my_attendance.status} />{c.my_attendance.note && <div className="mute small">{c.my_attendance.note}</div>}</div> : null) : (
        <>
          <div className="sec"><h2>Attendance</h2>{c.can_edit && c.has_zoom && c.finished && c.status === 'scheduled' && <button className="btn sm" onClick={syncZoom}>Read attendance from Zoom</button>}{c.can_edit && c.started && c.status === 'scheduled' && <button className="btn sm primary" onClick={() => setEdit(true)}>{c.attendance?.length ? 'Mark or correct by hand' : 'Mark attendance by hand'}</button>}</div>
          {c.started ? <AttendanceTable c={c} /> : <div className="empty">Attendance opens when the class starts.</div>}
          {c.unmatched && c.unmatched.length > 0 && <div className="card small mt"><b>Joined Zoom but not in this class</b><div className="mute">Not counted. Add their Zoom email to the student if one of them is a student.</div>{c.unmatched.map(u => <div key={u.name + u.email}>{u.name}{u.email ? ` (${u.email})` : ''} · {f.dur(u.duration_sec)}</div>)}</div>}
          {c.audit && c.audit.length > 0 && (
            <><div className="sec"><h2>Change history</h2></div><div className="card list small">{c.audit.map(a => (
              <div key={a.id} style={{ alignItems: 'flex-start' }}><div className="grow"><b>{a.student_name}</b>: {a.old_value ? a.old_value.status : '—'} → {a.new_value.status}<div className="mute">{a.reason}</div></div><div className="mute" style={{ textAlign: 'right' }}>{a.changed_by_name}<br />{f.dt(a.changed_at)}</div></div>
            ))}</div></>
          )}
          {c.can_edit && c.status === 'scheduled' && <div className="row mt"><button className="btn danger" onClick={cancel}>Cancel this class</button></div>}
        </>
      )}
      {edit && <AttendanceEditor c={c} onClose={() => setEdit(false)} onDone={() => { setEdit(false); void load() }} />}
    </>
  )
}
