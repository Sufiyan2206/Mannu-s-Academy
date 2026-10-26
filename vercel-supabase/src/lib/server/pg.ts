// The PostgreSQL connection pool. DATABASE_URL points at your own server (local now, OCI later).
import pg from 'pg';

// Return numbers as numbers, dates as plain text, and timestamps as ISO strings so the JSON the browser gets is predictable.
pg.types.setTypeParser(20, v => Number(v));            // bigint
pg.types.setTypeParser(1700, v => parseFloat(v));      // numeric
pg.types.setTypeParser(1082, v => v);                  // date -> 'YYYY-MM-DD'
pg.types.setTypeParser(1184, v => new Date(v).toISOString());   // timestamptz

const g = globalThis as unknown as { __pool?: pg.Pool };

export function pool(): pg.Pool {
  if (!g.__pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set. Add it to .env.local, for example postgres://postgres:PASSWORD@127.0.0.1:5432/mannu_academy');
    g.__pool = new pg.Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL || 10), ssl: process.env.DATABASE_SSL === '1' ? { rejectUnauthorized: false } : undefined });
    g.__pool.on('error', e => console.error('database pool error', e.message));
  }
  return g.__pool;
}
