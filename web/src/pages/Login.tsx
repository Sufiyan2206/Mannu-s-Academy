import { FormEvent, useState } from 'react'
import { useAuth } from '../auth'

export default function Login() {
  const { signIn } = useAuth()
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(''); setBusy(true)
    const f = e.currentTarget.elements as unknown as Record<string, HTMLInputElement>
    try { await signIn(f.email.value, f.password.value) } catch (x) { setErr((x as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="login">
      <form className="card stack" onSubmit={submit} noValidate>
        <picture>
          <source media="(prefers-color-scheme: dark)" srcSet="/brand/logo-full-light.webp" />
          <img className="brandlogo" src="/brand/logo-full.webp" alt="Mannu’s Academy – Building Strong Foundations for Future Success" width={760} height={611} />
        </picture>
        <div><h1>Mannu’s Tuition Academy</h1><p className="mute" style={{ margin: '6px 0 0' }}>Sign in to see classes, attendance and fees.</p></div>
        {err && <div className="alert bad" role="alert">{err}</div>}
        <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" autoFocus /></div>
        <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" /></div>
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  )
}
