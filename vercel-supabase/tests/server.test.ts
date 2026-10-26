// Runs the real server code (accounts, query runner, row level security) against a throw-away PostgreSQL database.
// Needs a server where you can create databases:  TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/postgres npm test
// Skipped when no server is reachable.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const base = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:55432/postgres';
const dbName = 'mannus_srv_' + Date.now();
let reachable = false;
let admin: pg.Client;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let m: { sql: any; auth: any; adm: any; env: any };
let A = '', T = '', firstStudent = '';
const student0 = () => firstStudent;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: base, connectionTimeoutMillis: 2000 });
  try { await admin.connect(); reachable = true; } catch { return; }
  await admin.query(`create database ${dbName}`);
  const url = new URL(base); url.pathname = '/' + dbName;
  process.env.DATABASE_URL = url.toString();
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
  process.env.CRON_SECRET = 'cron-secret';
  process.env.STORAGE_DIR = path.join(process.cwd(), '.test-storage');
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  for (const f of ['0000_auth.sql', '0001_schema.sql', '0002_security_and_functions.sql']) await c.query(fs.readFileSync(path.join('db/migrations', f), 'utf8'));
  await c.end();
  m = { sql: await import('../src/lib/server/sqlplan'), auth: await import('../src/lib/server/auth'), adm: await import('../src/lib/server/admin'), env: await import('../src/lib/server/env') };
  const { pool } = await import('../src/lib/server/pg');
  const h = await m.auth.hashPassword('correct horse battery');
  A = (await pool().query(`insert into auth.users (email, password_hash, raw_user_meta_data) values ('Ada@Example.com', $1, '{"full_name":"Ada Admin"}') returning id`, [h])).rows[0].id;
  T = (await pool().query(`insert into auth.users (email, password_hash) values ('tess@example.com', $1) returning id`, [h])).rows[0].id;
});

afterAll(async () => {
  if (!reachable) return;
  const { pool } = await import('../src/lib/server/pg');
  await pool().end();
  await admin.query(`drop database ${dbName} with (force)`);
  await admin.end();
});

const q = (table: string) => ({ op: 'select' as const, table, filters: [], orders: [] as [string, boolean][], returning: true });
const run = (plan: object, userId: string | null, browser = true) => m.sql.runPlan({ filters: [], orders: [], returning: false, ...plan }, { userId, browser });
const guard = (name: string, fn: () => Promise<void>) => it(name, async () => { if (!reachable) return; await fn(); });

describe('accounts', () => {
  guard('the first account is admin, the second a teacher', async () => {
    const r = await run({ op: 'select', table: 'profiles', orders: [['created_at', true]], returning: true }, A);
    expect(r.data.map((p: { role: string }) => p.role)).toEqual(['admin', 'teacher']);
    expect(r.data[0].full_name).toBe('Ada Admin');
  });
  guard('sign-in checks the password, ignores letter case in the email, and refuses switched-off accounts', async () => {
    expect(await m.auth.checkLogin('ada@example.COM', 'correct horse battery', '1.1.1.1')).toBe(A);
    expect(await m.auth.checkLogin('ada@example.com', 'wrong', '1.1.1.1')).toBeNull();
    expect(await m.auth.checkLogin('nobody@example.com', 'x', '1.1.1.1')).toBeNull();
    const { pool } = await import('../src/lib/server/pg');
    await pool().query('update auth.users set banned = true where id = $1', [T]);
    expect(await m.auth.checkLogin('tess@example.com', 'correct horse battery', '2.2.2.2')).toBeNull();
    await pool().query('update auth.users set banned = false where id = $1', [T]);
    expect(await m.auth.checkLogin('tess@example.com', 'correct horse battery', '2.2.2.2')).toBe(T);
  });
  guard('too many wrong passwords from one address are held up', async () => {
    for (let i = 0; i < 8; i++) await m.auth.checkLogin('ada@example.com', 'nope', '9.9.9.9');
    expect(await m.auth.checkLogin('ada@example.com', 'correct horse battery', '9.9.9.9')).toBeNull();
  });
  guard('tokens are signed and checked, and role checks follow the database', async () => {
    const tok = await m.auth.signToken(A);
    expect(await m.auth.verifyToken(tok)).toBe(A);
    expect(await m.auth.verifyToken(tok.slice(0, -3) + 'abc')).toBeNull();
    const req = (t: string) => new Request('http://x/api', { headers: { authorization: 'Bearer ' + t } });
    expect((await m.adm.requireUser(req(tok), true)).role).toBe('admin');
    await expect(m.adm.requireUser(req(await m.auth.signToken(T)), true)).rejects.toThrow(/Only admins/);
    await expect(m.adm.requireUser(req('garbage'))).rejects.toThrow(/expired/);
  });
  guard('changing a password needs the current one', async () => {
    await expect(m.auth.changePassword(T, 'wrong', 'a-new-password-1')).rejects.toThrow(/not right/);
    await expect(m.auth.changePassword(T, 'correct horse battery', 'short')).rejects.toThrow(/at least 8/);
    await m.auth.changePassword(T, 'correct horse battery', 'a-new-password-1');
    expect(await m.auth.checkLogin('tess@example.com', 'a-new-password-1', '3.3.3.3')).toBe(T);
  });
});

describe('the query runner', () => {
  let batch = '', student = '';
  guard('an admin saves and reads back rows; numbers, dates and lists keep their types', async () => {
    batch = (await run({ op: 'insert', table: 'batches', payload: { name: 'Grade 11' }, returning: true, one: 'single' }, A)).data.id;
    const s = await run({ op: 'insert', table: 'students', payload: { name: 'Sam', email: 'sam@x.com', batch_id: batch, subjects: ['chem', 'phys'] }, one: 'single' }, A);
    expect(s.error).toBeNull(); student = s.data.id; firstStudent = student; expect(s.data.subjects).toEqual(['chem', 'phys']);
    const c = await run({ op: 'insert', table: 'fee_charges', payload: { student_id: student, subject_id: 'chem', period: '2026-03', description: 'Chem', currency: 'AED', cents: 25000, due_date: '2026-03-10' }, one: 'single' }, A);
    expect(c.data.cents).toBe(25000); expect(typeof c.data.cents).toBe('number'); expect(c.data.due_date).toBe('2026-03-10'); expect(c.data.created_at).toMatch(/Z$/);
  });
  guard('filters, ordering, paging and lists of ids work', async () => {
    for (const n of ['b', 'a', 'c']) await run({ op: 'insert', table: 'batches', payload: { name: 'Batch ' + n } }, A);
    const all = await run({ ...q('batches'), orders: [['name', true]] }, A);
    expect(all.data.map((b: { name: string }) => b.name)).toEqual(['Batch a', 'Batch b', 'Batch c', 'Grade 11']);
    const page = await run({ ...q('batches'), orders: [['name', false]], range: [1, 2] }, A);
    expect(page.data.map((b: { name: string }) => b.name)).toEqual(['Batch c', 'Batch b']);
    const ids = all.data.slice(0, 2).map((b: { id: string }) => b.id);
    expect((await run({ ...q('batches'), filters: [{ col: 'id', op: 'in', val: ids }] }, A)).data).toHaveLength(2);
    expect((await run({ ...q('batches'), filters: [{ col: 'id', op: 'in', val: [] }] }, A)).data).toEqual([]);
    expect((await run({ ...q('batches'), filters: [{ col: 'name', op: 'ilike', val: 'batch%' }] }, A)).data).toHaveLength(3);
  });
  guard('single and maybeSingle behave like the original', async () => {
    expect((await run({ ...q('batches'), filters: [{ col: 'name', op: 'eq', val: 'none' }], one: 'maybe' }, A))).toEqual({ data: null, error: null });
    expect((await run({ ...q('batches'), filters: [{ col: 'name', op: 'eq', val: 'none' }], one: 'single' }, A)).error?.code).toBe('PGRST116');
  });
  guard('upsert merges on the primary key, and jsonb lists are stored as lists', async () => {
    await run({ op: 'upsert', table: 'consent', payload: { student_id: student, status: 'granted', note: 'a' } }, A);
    await run({ op: 'upsert', table: 'consent', payload: { student_id: student, status: 'denied', note: 'b' } }, A);
    const c = await run({ ...q('consent') }, A); expect(c.data).toHaveLength(1); expect(c.data[0].status).toBe('denied');
    const cls = (await run({ op: 'insert', table: 'classes', payload: { batch_id: batch, subject_id: 'chem', title: 'C', start_at: new Date().toISOString(), duration_min: 60, join_url: 'https://zoom.us/j/1' }, one: 'single' }, A)).data.id;
    const w = await run({ op: 'insert', table: 'attendance_class', payload: { class_id: cls, unmatched: [{ name: 'Guest' }, { name: 'Other' }] } }, A);
    expect(w.error).toBeNull();
    expect((await run({ ...q('attendance_class') }, A)).data[0].unmatched).toHaveLength(2);
  });
  guard('update and delete need a filter', async () => {
    expect((await run({ op: 'update', table: 'batches', payload: { name: 'x' } }, A)).error?.message).toMatch(/every row/);
    expect((await run({ op: 'delete', table: 'batches' }, A)).error?.message).toMatch(/every row/);
    expect((await run({ op: 'update', table: 'batches', payload: { name: 'Batch z' }, filters: [{ col: 'name', op: 'eq', val: 'Batch c' }], returning: true }, A)).data).toHaveLength(1);
    expect((await run({ op: 'delete', table: 'batches', filters: [{ col: 'name', op: 'eq', val: 'Batch z' }], returning: true }, A)).data).toHaveLength(1);
  });
  guard('the browser cannot reach other tables, unknown columns or injected names', async () => {
    expect((await run(q('integrations'), A)).error?.message).toMatch(/Unknown table/);
    expect((await run(q('users'), A)).error?.message).toMatch(/Unknown table/);
    expect((await run({ ...q('batches'), filters: [{ col: 'nope', op: 'eq', val: 1 }] }, A)).error?.message).toMatch(/Unknown column/);
    expect((await run({ ...q('batches'), filters: [{ col: 'id"; drop table batches; --', op: 'eq', val: 1 }] }, A)).error?.message).toMatch(/Unknown column|Invalid name/);
    expect((await run({ ...q('batches; drop table batches') }, A)).error?.message).toMatch(/Invalid name|Unknown table/);
    expect((await run({ ...q('batches'), filters: [{ col: 'name', op: 'eq', val: "x' or '1'='1" }] }, A)).data).toEqual([]);
    expect((await run({ op: 'rpc', rpc: 'claim_recording', args: { p_lease_seconds: 5 } }, A)).error?.message).toMatch(/Unknown function/);
    expect((await run({ op: 'rpc', rpc: 'pg_sleep', args: {} }, A)).error?.message).toMatch(/Unknown function/);
  });
  guard('the server itself may read the secrets table and claim recordings', async () => {
    await m.adm.setIntegration('youtube', { refresh_token: 's' });
    expect(await m.adm.getIntegration('youtube')).toEqual({ refresh_token: 's' });
    expect((await m.adm.admin().from('integrations').select('*')).data).toHaveLength(1);
    expect((await m.adm.admin().rpc('claim_recording', { p_lease_seconds: 5 })).data).toBeNull();
  });
});

describe('row level security through the runner', () => {
  guard('a teacher reads classes but cannot change students, see fees, or touch settings', async () => {
    expect((await run(q('students'), T)).data).toHaveLength(1);
    expect((await run({ op: 'insert', table: 'students', payload: { name: 'X', email: 'x@x.com', batch_id: (await run(q('batches'), T)).data[0].id } }, T)).error?.message).toMatch(/row-level security/);
    expect((await run(q('fee_charges'), T)).data).toEqual([]);
    expect((await run({ op: 'update', table: 'settings', payload: { academy: 'Hacked' }, filters: [{ col: 'id', op: 'eq', val: 1 }], returning: true }, T)).data).toEqual([]);
    expect((await run({ ...q('settings') }, A)).data[0].academy).not.toBe('Hacked');
  });
  guard('payments: admin gets numbered receipts back as an object, a teacher is refused', async () => {
    const args = (n: number) => ({ p_student: student0(), p_cents: 10000, p_paid_cents: 10000, p_paid_currency: 'AED', p_rate: 1, p_method: 'cash', p_reference: 'r' + n, p_note: '', p_paid_at: new Date().toISOString(), p_year: 2026, p_received_by: 'Ada' });
    const one = await run({ op: 'rpc', rpc: 'record_payment', args: args(1) }, A);
    const two = await run({ op: 'rpc', rpc: 'record_payment', args: args(2) }, A);
    expect(one.error).toBeNull(); expect(one.data.receipt_no).toBe('MTA-2026-00001'); expect(two.data.receipt_no).toBe('MTA-2026-00002'); expect(one.data.cents).toBe(10000);
    expect((await run({ op: 'rpc', rpc: 'record_payment', args: args(3) }, T)).error?.message).toMatch(/only admins/);
  });
  guard('attendance is saved in one go through the function', async () => {
    const cls = (await run(q('classes'), T)).data[0].id;
    const r = await run({ op: 'rpc', rpc: 'apply_attendance', args: { p_class: cls, p_rows: [{ student_id: student0(), status: 'present', source: 'manual', created_by: 'Tess', updated_by: 'Tess' }], p_zoom: null, p_unmatched: null, p_audits: [] } }, T);
    expect(r.error).toBeNull();
    expect((await run(q('attendance'), T)).data).toHaveLength(1);
  });
});

