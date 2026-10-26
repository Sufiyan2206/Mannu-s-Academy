'use client';
// The browser's connection to the app's own server: sign-in, database queries (as plans, never SQL) and API calls.
import { Query, rpcPlan, type Exec, type Result, type Row } from './dbplan';

const KEY = 'mannus_token';
export const isConfigured = true;

type Listener = (event: 'SIGNED_IN' | 'SIGNED_OUT') => void;
const listeners = new Set<Listener>();
const emit = (e: 'SIGNED_IN' | 'SIGNED_OUT') => listeners.forEach(l => l(e));

const read = (): string | null => { try { return localStorage.getItem(KEY); } catch { return null; } };
function claims(token: string): { sub: string; exp: number } | null {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
}
function currentToken(): string | null {
  const t = read(), c = t ? claims(t) : null;
  return t && c && c.exp * 1000 > Date.now() ? t : null;
}

const auth = {
  async getSession() {
    const t = currentToken(), c = t ? claims(t) : null;
    return { data: { session: t && c ? { access_token: t, user: { id: c.sub } } : null } };
  },
  onAuthStateChange(cb: Listener) {
    listeners.add(cb);
    return { data: { subscription: { unsubscribe: () => { listeners.delete(cb); } } } };
  },
  async signInWithPassword(email: string, password: string): Promise<{ error: { message: string } | null }> {
    let r: Response;
    try { r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }); }
    catch { return { error: { message: 'Cannot reach the app server. Is “npm run dev” still running? Open the exact address it shows (for example http://localhost:3000).' } }; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: { message: (j as { error?: string }).error || (r.status >= 500 ? 'The server had a problem. Look at the terminal where npm run dev is running for the reason (often DATABASE_URL).' : 'Could not sign in.') } };
    try { localStorage.setItem(KEY, (j as { token: string }).token); } catch { return { error: { message: 'This browser blocks saving the sign-in. Allow site data and try again.' } }; }
    emit('SIGNED_IN');
    return { error: null };
  },
  async signOut() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } emit('SIGNED_OUT'); },
};

const exec: Exec = async plan => {
  const t = currentToken();
  if (!t) { emit('SIGNED_OUT'); return { data: null, error: { message: 'Your session has expired. Sign in again.' } }; }
  let r: Response;
  try { r = await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify(plan) }); }
  catch { return { data: null, error: { message: 'Could not reach the server. Check your connection.' } }; }
  if (r.status === 401) { try { localStorage.removeItem(KEY); } catch { /* ignore */ } emit('SIGNED_OUT'); }
  const j = await r.json().catch(() => null);
  if (!r.ok) return { data: null, error: { message: (j as { error?: string } | null)?.error || `Request failed (${r.status})` } };
  return j as Result;
};

/** Same shape the screens were written against: db.from('students').select().eq(...), db.rpc('record_payment', {...}), db.auth.* */
export const db = {
  from: (table: string) => new Query(table, exec),
  rpc: (name: string, args: Row) => exec(rpcPlan(name, args)),
  auth,
};

/** Calls one of our own API routes with the signed-in user's token. */
export async function api<T = unknown>(path: string, body?: unknown, method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentToken() || ''}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Request failed (${r.status})`);
  return j as T;
}

/** Reads every row of a query, 1000 at a time. */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
