'use client';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/client';
import type { Profile } from '@/lib/types';
import { AppProvider } from '@/state/app';
import { Shell } from '@/components/Shell';
import { UIProvider } from '@/components/ui';

type Gate = { s: 'loading' } | { s: 'ready'; me: Profile } | { s: 'blocked'; msg: string };

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [gate, setGate] = useState<Gate>({ s: 'loading' });

  const check = useCallback(async () => {
    const { data } = await db.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) { router.replace('/login'); return; }
    const { data: p, error } = await db.from('profiles').select('*').eq('id', uid).maybeSingle();
    if (error) { setGate({ s: 'blocked', msg: error.message }); return; }
    if (!p || !p.active) { setGate({ s: 'blocked', msg: 'This account is not switched on for the academy. Ask an admin.' }); return; }
    setGate({ s: 'ready', me: p as Profile });
  }, [router]);

  useEffect(() => {
    check();
    const { data } = db.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') router.replace('/login'); });
    return () => data.subscription.unsubscribe();
  }, [check, router]);

  const signOut = useCallback(async () => { await db.auth.signOut(); router.replace('/login'); }, [router]);

  if (gate.s === 'loading') return <div className="spin" style={{ paddingTop: '30vh' }}>Opening academy records…</div>;
  if (gate.s === 'blocked') {
    return (
      <div className="login"><div className="card stack">
        <h1>Mannu’s Tuition Academy</h1>
        <p>{gate.msg}</p>
        <button className="btn" onClick={signOut}>Sign out</button>
      </div></div>
    );
  }
  return (
    // the dialogs live inside the data provider, so they can read the academy records too
    <AppProvider me={gate.me} onSignOut={signOut}>
      <UIProvider><Shell>{children}</Shell></UIProvider>
    </AppProvider>
  );
}
