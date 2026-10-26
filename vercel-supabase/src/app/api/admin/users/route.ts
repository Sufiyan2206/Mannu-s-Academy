import { HttpError, jsonError, requireUser } from '@/lib/server/admin';
import { hashPassword } from '@/lib/server/auth';
import { pool } from '@/lib/server/pg';
import { isEmail } from '@/lib/format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Admins create teacher (or admin) accounts here. There is no public sign-up. */
export async function POST(req: Request) {
  try {
    await requireUser(req, true);
    const b = (await req.json()) as { email?: string; full_name?: string; role?: 'admin' | 'teacher'; password?: string };
    const email = (b.email || '').trim().toLowerCase(), name = (b.full_name || '').trim();
    if (!isEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
    if (!name) throw new HttpError(400, 'Enter the person’s name.');
    if (!b.password || b.password.length < 8) throw new HttpError(400, 'The password must be at least 8 characters.');
    if ((await pool().query('select 1 from accounts.users where lower(email) = $1', [email])).rowCount) throw new HttpError(400, 'An account with that email already exists.');
    const { rows } = await pool().query('insert into accounts.users (email, password_hash, raw_user_meta_data) values ($1, $2, $3) returning id', [email, await hashPassword(b.password), JSON.stringify({ full_name: name })]);
    if (b.role === 'admin') await pool().query(`update public.profiles set role = 'admin' where id = $1`, [rows[0].id]);
    return Response.json({ id: rows[0].id });
  } catch (e) { return jsonError(e); }
}

/** Change role, name or password, or switch an account off (it can no longer sign in or use the app). */
export async function PATCH(req: Request) {
  try {
    const me = await requireUser(req, true);
    const b = (await req.json()) as { id?: string; role?: 'admin' | 'teacher'; active?: boolean; full_name?: string; password?: string };
    if (!b.id) throw new HttpError(400, 'Missing account.');
    if (b.id === me.id && (b.active === false || (b.role && b.role !== 'admin'))) throw new HttpError(400, 'You cannot switch off or demote your own account. Ask another admin.');
    if (b.role && !['admin', 'teacher'].includes(b.role)) throw new HttpError(400, 'Unknown role.');
    const sets: string[] = [], vals: unknown[] = [b.id];
    const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if (b.role) add('role', b.role);
    if (typeof b.active === 'boolean') add('active', b.active);
    if (b.full_name?.trim()) add('full_name', b.full_name.trim());
    if (sets.length) await pool().query(`update public.profiles set ${sets.join(', ')} where id = $1`, vals);
    if (typeof b.active === 'boolean') await pool().query('update accounts.users set banned = $2 where id = $1', [b.id, !b.active]);
    if (b.password) {
      if (b.password.length < 8) throw new HttpError(400, 'The password must be at least 8 characters.');
      await pool().query('update accounts.users set password_hash = $2 where id = $1', [b.id, await hashPassword(b.password)]);
    }
    return Response.json({ ok: true });
  } catch (e) { return jsonError(e); }
}
