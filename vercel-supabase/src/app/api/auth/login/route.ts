import { jsonError, HttpError } from '@/lib/server/admin';
import { checkLogin, signToken } from '@/lib/server/auth';
import { pool } from '@/lib/server/pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { email, password } = (await req.json()) as { email?: string; password?: string };
    if (!email || !password) throw new HttpError(400, 'Enter your email and password.');
    const who = (req.headers.get('x-forwarded-for') || 'local').split(',')[0].trim();
    const uid = await checkLogin(email, password, who);
    if (!uid) throw new HttpError(401, 'That email and password do not match.');
    const { rows } = await pool().query('select id, full_name, email, role, active from public.profiles where id = $1', [uid]);
    if (!rows[0]?.active) throw new HttpError(403, 'This account is not switched on. Ask an admin.');
    return Response.json({ token: await signToken(uid), user: rows[0] });
  } catch (e) { return jsonError(e); }
}
