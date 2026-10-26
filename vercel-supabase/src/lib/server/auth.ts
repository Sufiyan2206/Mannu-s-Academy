// Accounts kept in your own database (auth.users): bcrypt password hashes and signed tokens (JWT).
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { pool } from './pg';

const key = () => {
  const s = process.env.JWT_SECRET || '';
  if (s.length < 32) throw new Error('JWT_SECRET is missing or too short. Set it to a random text of at least 32 characters in .env.local.');
  return new TextEncoder().encode(s);
};

export const TOKEN_DAYS = 7;

export async function signToken(userId: string): Promise<string> {
  return new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuedAt().setExpirationTime(`${TOKEN_DAYS}d`).sign(key());
}
export async function verifyToken(token: string): Promise<string | null> {
  try { const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'] }); return payload.sub || null; } catch { return null; }
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 11);

// Sign-in attempts per address+email: after 8 wrong passwords in 15 minutes, wait.
const attempts = new Map<string, { n: number; first: number }>();
export function throttled(id: string): boolean {
  const a = attempts.get(id);
  return !!a && Date.now() - a.first < 15 * 60_000 && a.n >= 8;
}
const note = (id: string, ok: boolean) => {
  if (ok) { attempts.delete(id); return; }
  const a = attempts.get(id);
  attempts.set(id, a && Date.now() - a.first < 15 * 60_000 ? { n: a.n + 1, first: a.first } : { n: 1, first: Date.now() });
};

/** Checks the password. Returns the user id, or null (the same answer for "no such user" and "wrong password"). */
export async function checkLogin(email: string, password: string, who: string): Promise<string | null> {
  const id = who + '|' + email.toLowerCase();
  if (throttled(id)) return null;
  const { rows } = await pool().query('select id, password_hash, banned from auth.users where lower(email) = lower($1)', [email.trim()]);
  const u = rows[0];
  // compare against something even when the user does not exist, so timing does not reveal which emails are real
  const ok = await bcrypt.compare(password, u?.password_hash || '$2a$11$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi');
  const good = !!u && ok && !u.banned;
  note(id, good);
  return good ? u.id : null;
}

export async function changePassword(userId: string, current: string | null, next: string): Promise<void> {
  if (next.length < 8) throw new Error('The new password must be at least 8 characters.');
  if (current !== null) {
    const { rows } = await pool().query('select password_hash from auth.users where id = $1', [userId]);
    if (!rows[0] || !(await bcrypt.compare(current, rows[0].password_hash))) throw new Error('The current password is not right.');
  }
  await pool().query('update auth.users set password_hash = $2 where id = $1', [userId, await hashPassword(next)]);
}
