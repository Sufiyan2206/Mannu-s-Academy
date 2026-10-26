// Creates the first administrator (or any account).   npm run create-admin -- you@example.com "A strong password" "Your Name" [admin|teacher]
// The very first account in an empty database becomes admin automatically.
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { loadEnv } from './env.mjs';

loadEnv();
const [email, password, name = '', role] = process.argv.slice(2);
if (!email || !password) { console.error('Usage: npm run create-admin -- email password "Full name" [admin|teacher]'); process.exit(1); }
if (password.length < 8) { console.error('The password must be at least 8 characters.'); process.exit(1); }
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === '1' ? { rejectUnauthorized: false } : undefined });
await db.connect();
const hash = await bcrypt.hash(password, 11);
const { rows } = await db.query('insert into accounts.users (email, password_hash, raw_user_meta_data) values ($1, $2, $3) returning id', [email.trim().toLowerCase(), hash, JSON.stringify({ full_name: name || email.split('@')[0] })]);
if (role === 'admin' || role === 'teacher') await db.query('update public.profiles set role = $2 where id = $1', [rows[0].id, role]);
const p = (await db.query('select role from public.profiles where id = $1', [rows[0].id])).rows[0];
console.log(`Created ${email} as ${p.role}.`);
await db.end();
