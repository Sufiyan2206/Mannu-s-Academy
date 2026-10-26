import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { api, Student } from '../api'
import { useAuth } from '../auth'
import { Chip, Field, Modal, Spinner, useToast } from '../ui'

interface School { name: string; students: number }

function StudentForm({ s, onDone, onClose, schools }: { s: Student | null; onDone: () => void; onClose: () => void; schools: School[] }) {
  const { cfg } = useAuth()
  const { toast } = useToast()
  const [err, setErr] = useState('')
  const [login, setLogin] = useState(false)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr('')
    const f = e.currentTarget.elements as unknown as Record<string, HTMLInputElement & HTMLSelectElement>
    const subjects = [...e.currentTarget.querySelectorAll<HTMLInputElement>('input[name=sub]:checked')].map(x => Number(x.value))
    const body = { name: f.name.value, email: f.email.value, zoom_email: f.zoom_email.value, mobile: f.mobile.value, guardian_name: f.guardian_name.value, guardian_mobile: f.guardian_mobile.value, guardian_email: f.guardian_email.value,
      school: f.school.value, batch_id: Number(f.batch_id.value), currency: f.currency.value, subjects, ...(s ? { active: f.active.checked } : { create_login: login, password: login ? f.password.value : undefined }) }
    try { await api(s ? `/students/${s.id}` : '/students', { method: s ? 'PUT' : 'POST', body }); toast(s ? 'Saved' : 'Student added'); onDone() } catch (x) { setErr((x as Error).message) }
  }
  return (
    <Modal title={s ? 'Edit student' : 'Add student'} onClose={onClose}>
      <form className="stack" onSubmit={submit} noValidate>
        {err && <div className="alert bad" role="alert">{err}</div>}
        <Field label="Full name"><input name="name" defaultValue={s?.name} maxLength={120} /></Field>
        <Field label="Student email"><input name="email" type="email" defaultValue={s?.email} /></Field>
        <Field label="Zoom email" hint="optional – only if different"><input name="zoom_email" type="email" defaultValue={s?.zoom_email} /></Field>
        <Field label="Student mobile" hint="optional"><input name="mobile" defaultValue={s?.mobile} inputMode="tel" /></Field>
        <Field label="Parent / guardian name"><input name="guardian_name" defaultValue={s?.guardian_name} /></Field>
        <Field label="Parent / guardian mobile (WhatsApp)"><input name="guardian_mobile" defaultValue={s?.guardian_mobile} inputMode="tel" /></Field>
        <Field label="Parent / guardian email" hint="optional"><input name="guardian_email" type="email" defaultValue={s?.guardian_email} /></Field>
        <Field label="School name" hint="optional – where the student currently studies; type any name">
          <input name="school" list="schools" maxLength={120} autoComplete="off" defaultValue={s?.school} placeholder="e.g. Royal College" /><datalist id="schools">{schools.map(x => <option key={x.name} value={x.name} />)}</datalist>
        </Field>
        <Field label="Batch"><select name="batch_id" defaultValue={s?.batch_id ?? ''}><option value="" disabled>Choose a batch</option>{cfg?.batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Fee currency"><input name="currency" defaultValue={s?.currency ?? cfg?.currency} maxLength={3} style={{ textTransform: 'uppercase' }} /></Field>
        <div className="field"><label>Subjects</label><div className="checks">{cfg?.subjects.map(x => <label key={x.id}><input type="checkbox" name="sub" value={x.id} defaultChecked={s?.subjects.some(y => y.id === x.id)} />{x.name}</label>)}</div></div>
        {s ? <label className="row" style={{ fontWeight: 500 }}><input type="checkbox" name="active" defaultChecked={s.active} /> Active student</label> : (
          <>
            <label className="row" style={{ fontWeight: 500 }}><input type="checkbox" checked={login} onChange={e => setLogin(e.target.checked)} /> Create a sign-in for the student</label>
            {login && <Field label="Password" hint="at least 8 characters"><input name="password" type="password" autoComplete="new-password" /></Field>}
          </>
        )}
        <div className="foot"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Save</button></div>
      </form>
    </Modal>
  )
}

function BatchModal({ onClose }: { onClose: () => void }) {
  const { reload } = useAuth()
  const { toast } = useToast()
  const [rows, setRows] = useState<{ id: number; name: string; students: number }[] | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => api<{ id: number; name: string; students: number }[]>('/batches').then(setRows), [])
  useEffect(() => { void load() }, [load])
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr('')
    const f = e.currentTarget.elements as unknown as Record<string, HTMLInputElement>
    try { await api('/batches', { method: 'POST', body: { name: f.name.value } }); f.name.value = ''; toast('Batch added'); await load(); await reload() } catch (x) { setErr((x as Error).message) }
  }
  return (
    <Modal title="Batches" onClose={onClose}>
      <div className="stack">{err && <div className="alert bad">{err}</div>}
        {rows ? <div className="card list">{rows.map(b => <div key={b.id}><div className="grow"><b>{b.name}</b></div><span className="mute small">{b.students} students</span></div>)}{!rows.length && <div className="empty">No batches yet.</div>}</div> : <Spinner />}
        <form className="row" onSubmit={add}><input name="name" placeholder="New batch name, e.g. Grade 11 – Evening" style={{ flex: 1 }} /><button className="btn primary">Add</button></form>
      </div>
    </Modal>
  )
}

export default function Students() {
  const { user, cfg } = useAuth()
  const admin = user?.role === 'admin'
  const [rows, setRows] = useState<Student[] | null>(null)
  const [schools, setSchools] = useState<School[]>([])
  const [f, setF] = useState({ q: '', batch: '', subject: '', school: '' })
  const [edit, setEdit] = useState<Student | 'new' | null>(null)
  const [batches, setBatches] = useState(false)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v))
      setRows(await api<Student[]>('/students?' + p)); setSchools(await api<School[]>('/students/schools'))
    } catch (e) { setErr((e as Error).message) }
  }, [f])
  useEffect(() => { const t = setTimeout(() => void load(), f.q ? 250 : 0); return () => clearTimeout(t) }, [load, f.q])
  const filterSchool = useMemo(() => schools.map(x => <option key={x.name} value={x.name}>{x.name} ({x.students})</option>), [schools])
  if (err) return <div className="alert bad">{err}</div>
  return (
    <>
      <div className="head"><h1>Students</h1>{admin && <div className="row"><button className="btn" onClick={() => setBatches(true)}>Batches</button><button className="btn primary" onClick={() => setEdit('new')}>Add student</button></div>}</div>
      <div className="filters">
        <div className="wide"><input type="search" placeholder="Search name, email, mobile or school" aria-label="Search students" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} /></div>
        <select aria-label="Batch" value={f.batch} onChange={e => setF({ ...f, batch: e.target.value })}><option value="">All batches</option>{cfg?.batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <select aria-label="Subject" value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })}><option value="">All subjects</option>{cfg?.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select aria-label="School" className="wide" value={f.school} onChange={e => setF({ ...f, school: e.target.value })}><option value="">All schools</option><option value="__none">No school entered</option>{filterSchool}</select>
      </div>
      {!rows ? <Spinner /> : rows.length ? (
        <div className="card list">{rows.map(s => (
          <div key={s.id} className={admin ? 'tap' : ''} onClick={() => admin && setEdit(s)} role={admin ? 'button' : undefined}>
            <div className="grow"><b>{s.name}</b><div className="mute small">{s.batch} · {s.subjects.map(x => x.name).join(', ')}</div>{s.school && <div className="mute small">🏫 {s.school}</div>}<div className="mute small">{s.mobile || s.guardian_mobile} · {s.email}</div></div>
            {s.has_login && <Chip>Login</Chip>}
          </div>
        ))}</div>
      ) : <div className="empty">{Object.values(f).some(Boolean) ? 'No students match.' : 'No students yet.'}</div>}
      {edit && <StudentForm s={edit === 'new' ? null : edit} schools={schools} onClose={() => setEdit(null)} onDone={() => { setEdit(null); void load() }} />}
      {batches && <BatchModal onClose={() => { setBatches(false); void load() }} />}
    </>
  )
}
