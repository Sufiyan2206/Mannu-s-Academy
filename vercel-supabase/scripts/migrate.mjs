// Applies the SQL files in db/migrations that have not been applied yet.   npm run migrate
// Uses DATABASE_URL (from .env.local or the environment). Safe to run again: applied files are recorded and skipped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadEnv } from './env.mjs';

loadEnv();
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set. Put it in .env.local, for example\n  DATABASE_URL=postgres://postgres:YOURPASSWORD@127.0.0.1:5432/mannu_academy'); process.exit(1); }

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await db.query('create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())');
const done = new Set((await db.query('select name from public.schema_migrations')).rows.map(r => r.name));
let n = 0;
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.sql')).sort()) {
  if (done.has(f)) { console.log('  already applied  ' + f); continue; }
  process.stdout.write('  applying         ' + f + ' … ');
  try {
    await db.query('begin');
    await db.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    await db.query('insert into public.schema_migrations (name) values ($1)', [f]);
    await db.query('commit');
    console.log('ok'); n++;
  } catch (e) { await db.query('rollback'); console.log('FAILED\n' + e.message); process.exit(1); }
}
await db.end();
console.log(n ? `Done: ${n} file(s) applied.` : 'Nothing to do: the database is up to date.');
