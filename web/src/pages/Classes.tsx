import { FormEvent, useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ClassRow } from '../api'
import { useAuth } from '../auth'
import { Chip, Field, Modal, Spinner, fmt, nowLocalInput, useToast } from '../ui'

function ScheduleModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { cfg, user } = useAuth()
  const { toast } = useToast()
  const [teachers, setTeachers] = useState<{ id: number; name: string }[]>([])
  const [err, setErr] = useState('')
  useEffect(() => { api<{ id: number; name: string }[]>('/teachers').then(setTeachers) }, [])
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr('')
    const f = e.currentTarget.elements as unknown as Record<string, HTMLInputElement & HTMLSelectElement>
    try {
      await api('/classes', { method: 'POST', body: { batch_id: Number(f.batch_id.value), subject_id: Number(f.subject_id.value), teacher_id: user?.role === 'admin' ? Number(f.teacher_id.value) : undefined, start_local: f.start_local.value, duration_min: Number(f.duration_min.value), agenda: f.agenda.value, manual_join_url: f.url.value } })
      toast('Class scheduled'); onDone()
    } catch (x) { setErr((x as Error).message) }
  }
  return (
    <Modal title="Schedule class" onClose={onClose}>
      <form className="stack" onSubmit={submit} noValidate>{err && <div className="alert bad" role="alert">{err}</div>}
        <Field label="Batch"><select name="batch_id" defaultValue=""><option value="" disabled>Choose a batch</option>{cfg?.batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Subject"><select name="subject_id" defaultValue=""><option value="" disabled>Choose a subject</option>{cfg?.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        {user?.role === 'admin' && <Field label="Teacher"><select name="teacher_id" defaultValue={user.id}>{teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>}
        <div className="two"><Field label="Date and time"><input name="start_local" type="datetime-local" defaultValue={cfg ? nowLocalInput(cfg.tz) : ''} /></Field><Field label="Length (min)"><input name="duration_min" type="number" min={15} max={300} defaultValue={60} /></Field></div>
        <Field label="Meeting link" hint={cfg?.zoom ? 'leave empty to create a Zoom meeting' : 'https://…'}><input name="url" type="url" inputMode="url" placeholder="https://zoom.us/j/…" /></Field>
        <Field label="Topic" hint="optional"><input name="agenda" maxLength={500} /></Field>
        <div className="foot"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Schedule</button></div>
      </form>
    </Modal>
  )
}

export default function Classes() {
  const { cfg, user } = useAuth()
  const staff = user?.role !== 'student'
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') ?? 'upcoming'
  const [rows, setRows] = useState<ClassRow[] | null>(null)
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState(false)
  const f = fmt(cfg)
  const load = useCallback(async () => {
    setRows(null)
    try {
      if (tab === 'pending') setRows(await api<ClassRow[]>('/attendance/pending'))
      else if (tab === 'past') setRows(await api<ClassRow[]>('/classes?order=desc&to=' + new Intl.DateTimeFormat('sv-SE', { timeZone: cfg!.tz }).format(new Date())))
      else setRows((await api<ClassRow[]>('/classes?from=' + new Intl.DateTimeFormat('sv-SE', { timeZone: cfg!.tz }).format(new Date()))).filter(c => !c.finished))
    } catch (e) { setErr((e as Error).message) }
  }, [tab, cfg])
  useEffect(() => { void load() }, [load])
  if (err) return <div className="alert bad">{err}</div>
  return (
    <>
      <div className="head"><h1>Classes</h1>{staff && <button className="btn primary" onClick={() => setAdding(true)}>Schedule class</button>}</div>
      <div className="seg" role="group" aria-label="Show">
        {(['upcoming', 'past', ...(staff ? ['pending'] : [])] as string[]).map(t => <button key={t} aria-pressed={tab === t} onClick={() => setSp(t === 'upcoming' ? {} : { tab: t })}>{t === 'pending' ? 'Needs attendance' : t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>
      <div style={{ marginTop: 12 }}>{!rows ? <Spinner /> : rows.length ? rows.map(c => (
        <Link key={c.id} to={`/classes/${c.id}`} className={`cls sub-${c.subject}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
          <div className="bar" /><div className="body" style={{ paddingLeft: 12 }}>
            <div className="row between"><b>{c.subject} · {c.batch}</b><span className="mute small">{f.date(c.start_at)}, {f.time(c.start_at)}</span></div>
            <div className="mute small">{c.teacher_name}{c.agenda ? ' · ' + c.agenda : ''}</div>
            <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>{c.status === 'cancelled' && <Chip kind="bad">Cancelled</Chip>}{staff && c.finished && c.status === 'scheduled' && (c.attendance_taken ? <Chip kind="ok">{c.present} attended{c.late ? ` (${c.late} late)` : ''}</Chip> : <Chip kind="warn">Attendance needed</Chip>)}</div>
          </div>
        </Link>
      )) : <div className="empty">{tab === 'pending' ? 'Every finished class has attendance recorded. 🎉' : 'No classes here.'}</div>}</div>
      {adding && <ScheduleModal onClose={() => setAdding(false)} onDone={() => { setAdding(false); void load() }} />}
    </>
  )
}
