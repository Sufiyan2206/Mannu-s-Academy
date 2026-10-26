import { Query, rpcPlan, type Row } from '../dbplan';
import { runPlan } from './sqlplan';
import { verifyToken } from './auth';
import { env } from './env';
import { pool } from './pg';
import type { Profile } from '../types';

/** Server-side database access that has already been authorised by the route (runs as the database owner, no row level security). */
export function admin() {
  return {
    from: (table: string) => new Query(table, plan => runPlan(plan, { browser: false })),
    rpc: (name: string, args: Row) => runPlan(rpcPlan(name, args), { browser: false }),
  };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const bearer = (req: Request) => (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');

/** Checks the caller’s token and (optionally) that they are an active admin. */
export async function requireUser(req: Request, adminOnly = false, tokenOverride?: string): Promise<Profile> {
  const token = tokenOverride || bearer(req);
  if (!token) throw new HttpError(401, 'Sign in first.');
  const uid = await verifyToken(token);
  if (!uid) throw new HttpError(401, 'Your session has expired. Sign in again.');
  const { rows } = await pool().query(
    `select p.*, u.banned from public.profiles p join accounts.users u on u.id = p.id where p.id = $1`, [uid]);
  const p = rows[0];
  if (!p || !p.active || p.banned) throw new HttpError(403, 'This account has no access.');
  if (adminOnly && p.role !== 'admin') throw new HttpError(403, 'Only admins can do this.');
  return p as Profile;
}

/** The scheduler (or you, by hand) proves itself with the shared secret. */
export function requireCron(req: Request) {
  const secret = env.cronSecret;
  const got = bearer(req) || req.headers.get('x-cron-secret') || '';
  if (!secret || got !== secret) throw new HttpError(401, 'Not allowed.');
}

export function jsonError(e: unknown) {
  const status = e instanceof HttpError ? e.status : 500;
  const message = e instanceof Error ? e.message : 'Something went wrong';
  return Response.json({ error: message }, { status });
}

export async function getIntegration<T = Record<string, unknown>>(key: string): Promise<T | null> {
  const { rows } = await pool().query('select data from public.integrations where key = $1', [key]);
  return (rows[0]?.data as T) ?? null;
}
export async function setIntegration(key: string, value: Record<string, unknown>) {
  await pool().query(
    `insert into public.integrations (key, data, updated_at) values ($1, $2, now()) on conflict (key) do update set data = excluded.data, updated_at = now()`,
    [key, JSON.stringify(value)]);
}
export async function deleteIntegration(key: string) {
  await pool().query('delete from public.integrations where key = $1', [key]);
}
