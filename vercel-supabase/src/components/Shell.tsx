'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useApp } from '@/state/app';
import { api } from '@/lib/client';
import { Field, Form, useRun, useUI } from './ui';

const ICON: Record<string, string> = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10', users: 'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M22 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8',
  chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2', video: 'M15 10l6-4v12l-6-4M3 6h12v12H3z', film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M16 9h4M4 15h4M16 15h4',
  wallet: 'M3 7h18v12H3zM3 7l3-3h12M16 13h2', book: 'M4 19.5A2.5 2.5 0 016.5 17H20V3H6.5A2.5 2.5 0 004 5.5zM4 19.5A2.5 2.5 0 006.5 22H20v-5',
  chat: 'M21 12a8 8 0 01-11.6 7.1L3 21l1.9-6.4A8 8 0 1121 12z', cog: 'M12 15a3 3 0 100-6 3 3 0 000 6M4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4',
};
export const Icon = ({ name }: { name: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON[name]} /></svg>
);

const NAV = {
  admin: [['dashboard', 'Home', 'home'], ['students', 'Students', 'users'], ['classes', 'Classes', 'video'], ['reports', 'Reports', 'chart'], ['fees', 'Fees', 'wallet'], ['resources', 'Resources', 'book'], ['reels', 'Reels', 'film'], ['messages', 'WhatsApp', 'chat'], ['settings', 'Setup', 'cog']],
  teacher: [['dashboard', 'Home', 'home'], ['classes', 'Classes', 'video'], ['reports', 'Reports', 'chart'], ['students', 'Students', 'users'], ['resources', 'Resources', 'book'], ['reels', 'Reels', 'film'], ['messages', 'WhatsApp', 'chat']],
} as const;

export function Shell({ children }: { children: ReactNode }) {
  const app = useApp(), path = usePathname(), { toast, openModal } = useUI(), run = useRun();
  const password = () => openModal('Change your password', close => (
    <Form close={close} label="Change password" onSubmit={async f => {
      if (f.get('n') !== f.get('n2')) throw new Error('The two new passwords are not the same.');
      await api('/api/auth/password', { current: f.get('c'), next: f.get('n') });
      close(); toast('Password changed');
    }}>
      <Field label="Current password"><input name="c" type="password" autoComplete="current-password" /></Field>
      <Field label="New password" hint="(at least 8 characters)"><input name="n" type="password" autoComplete="new-password" /></Field>
      <Field label="New password again"><input name="n2" type="password" autoComplete="new-password" /></Field>
    </Form>
  ));
  const seg = path.split('/')[1] || 'dashboard';
  return (
    <div id="app">
      <header className="top">
        <span className="logo" aria-hidden="true"><img src="/brand/logo-emblem-64.webp" alt="" width={30} height={27} /></span>
        <div className="title">{app.settings.academy}</div>
        <button onClick={() => run(async () => { await app.reload(); toast('Records refreshed'); })}>Refresh</button>
        <button onClick={password} title={app.me.email}>Password</button>
        <button onClick={() => run(app.signOut)}>Sign out</button>
      </header>
      <nav className="tabs" aria-label="Main">
        {NAV[app.me.role].map(([r, l, i]) => (
          <Link key={r} href={`/${r}`} aria-current={seg === r ? 'page' : undefined}><Icon name={i} /><span>{l}</span></Link>
        ))}
      </nav>
      <main id="main">{children}</main>
    </div>
  );
}
