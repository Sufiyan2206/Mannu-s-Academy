import { FormEvent, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { Field, useToast } from '../ui'

export default function Account() {
  const { user, signOut } = useAuth()
  const { toast } = useToast()
  const [err, setErr] = useState('')
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr('')
    const f = e.currentTarget.elements as unknown as Record<string, HTMLInputElement>
    try { await api('/auth/password', { method: 'POST', body: { current: f.current.value, new: f.next.value } }); toast('Password changed'); e.currentTarget.reset() } catch (x) { setErr((x as Error).message) }
  }
  return (
    <>
      <div className="head"><h1>Account</h1></div>
      <div className="card stack"><b>{user?.name}</b><div className="mute small">{user?.email} · {user?.role}</div><button className="btn" onClick={signOut}>Sign out</button></div>
      <form className="card stack mt" onSubmit={submit}>
        <h3>Change password</h3>{err && <div className="alert bad">{err}</div>}
        <Field label="Current password"><input name="current" type="password" autoComplete="current-password" /></Field>
        <Field label="New password" hint="at least 8 characters"><input name="next" type="password" autoComplete="new-password" /></Field>
        <button className="btn primary">Change password</button>
      </form>
    </>
  )
}
