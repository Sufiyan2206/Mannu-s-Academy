import { FormEvent, useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { Chip, Field, Modal, Spinner, useToast } from '../ui'

interface U { id: number; email: string; name: string; role: string; phone: string; active: number }

export default function Users() {
  const [rows, setRows] = useState<U[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState('')
  const { toast } = useToast()
  const load = useCallback(() => api<U[]>('/users').then(setRows), [])
  useEffect(() => { void load() }, [load])
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr('')
    const f = e.currentTarget.elements as unknown as Record<string, HTMLInputElement>
    try { await api('/users', { method: 'POST', body: { name: f.name.value, email: f.email.value, phone: f.phone.value, role: f.role.value, password: f.password.value } }); setAdding(false); toast('User added'); await load() } catch (x) { setErr((x as Error).message) }
  }
  async function toggle(u: U) { try { await api(`/users/${u.id}`, { method: 'PUT', body: { active: !u.active } }); await load() } catch (x) { toast((x as Error).message, true) } }
  if (!rows) return <Spinner />
  return (
    <>
      <div className="head"><h1>Users</h1><button className="btn primary" onClick={() => { setErr(''); setAdding(true) }}>Add user</button></div>
      <div className="card list">{rows.filter(u => u.role !== 'student').map(u => (
        <div key={u.id}><div className="grow"><b>{u.name}</b><div className="mute small">{u.email} · {u.role}</div></div>{!u.active && <Chip kind="bad">Off</Chip>}<button className="btn sm" onClick={() => toggle(u)}>{u.active ? 'Deactivate' : 'Activate'}</button></div>
      ))}</div>
      {adding && (
        <Modal title="Add a teacher or admin" onClose={() => setAdding(false)}>
          <form className="stack" onSubmit={add}>{err && <div className="alert bad">{err}</div>}
            <Field label="Name"><input name="name" /></Field><Field label="Email"><input name="email" type="email" /></Field><Field label="Phone" hint="optional"><input name="phone" /></Field>
            <Field label="Role"><select name="role"><option value="teacher">Teacher</option><option value="admin">Admin</option></select></Field>
            <Field label="Password" hint="at least 8 characters"><input name="password" type="password" autoComplete="new-password" /></Field>
            <div className="foot"><button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn primary">Add</button></div>
          </form>
        </Modal>
      )}
    </>
  )
}
