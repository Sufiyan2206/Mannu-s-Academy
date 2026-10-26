// DANGER: deletes every table and every record in the database DATABASE_URL points at, so you can start clean.
//   npm run reset-db -- --yes      then:  npm run migrate
import pg from 'pg';
import { loadEnv } from './env.mjs';

loadEnv();
if (!process.argv.includes('--yes')) { console.error('This DELETES everything in the database. Run again with --yes to confirm:  npm run reset-db -- --yes'); process.exit(1); }
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === '1' ? { rejectUnauthorized: false } : undefined });
await db.connect();
console.log('Connected to', new URL(process.env.DATABASE_URL).pathname.slice(1));
await db.query('drop schema if exists accounts cascade; drop schema if exists auth cascade; drop schema if exists public cascade; create schema public; grant usage on schema public to public;');
console.log('Emptied. Now run: npm run migrate');
await db.end();
