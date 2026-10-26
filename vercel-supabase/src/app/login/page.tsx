'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/client';

export default function Login() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { db.auth.getSession().then(({ data }) => { if (data.session) router.replace('/dashboard'); }); }, [router]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setMsg(null);
    const { error } = await db.auth.signInWithPassword(String(f.get('email') || '').trim(), String(f.get('password') || ''));
    setBusy(false);
    if (error) setMsg(error.message); else router.replace('/dashboard');
  };

  return (
    <div className="login">
      <form className="card stack" onSubmit={submit} noValidate>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="brandlogo" src="/brand/logo-full-light.webp" alt="Mannu’s Tuition Academy" width={280} height={120} />
        <h1 style={{ textAlign: 'center' }}>Staff sign-in</h1>
        <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" inputMode="email" required /></div>
        <div className="field"><label htmlFor="pw">Password</label><input id="pw" name="password" type="password" autoComplete="current-password" required /></div>
        {msg && <div className="alert bad" role="alert">{msg}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Please wait…' : 'Sign in'}</button>
        <p className="mute small" style={{ margin: 0, textAlign: 'center' }}>Accounts are created by the academy admin. Forgotten your password? Ask an admin to set a new one.</p>
      </form>
    </div>
  );
}
