// Applies the migrations to a throw-away database and checks the security rules and database functions.
//   TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/postgres  npm run test:db
// The URL must point at a server where the user may create databases. Nothing in the target database is touched.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
import { loadEnv } from './env.mjs';
loadEnv();
const base = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5432/postgres';
const dbName = 'mannus_test_' + Date.now();

const admin = new pg.Client({ connectionString: base });
await admin.connect();
await admin.query(`create database ${dbName}`);
const url = new URL(base); url.pathname = '/' + dbName;
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();

let failed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.message || e)); }
};
// run a statement as an authenticated user (RLS applies), or as the service role
async function as(userId, fn) {
  await db.query('begin');
  try {
    if (userId) {
      await db.query('set local role authenticated');
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    }
    const r = await fn((sql, params) => db.query(sql, params));
    await db.query('commit');
    return r;
  } catch (e) { await db.query('rollback'); throw e; }
}
const rejects = async (p, re) => { try { await p; } catch (e) { if (!re || re.test(e.message)) return; throw new Error('wrong error: ' + e.message); } throw new Error('expected an error'); };

try {
  for (const f of ['db/migrations/0000_auth.sql', 'db/migrations/0001_schema.sql', 'db/migrations/0002_security_and_functions.sql'])
    await db.query(fs.readFileSync(path.join(root, f), 'utf8'));

  // accounts: the first one becomes admin
  const A = (await db.query(`insert into accounts.users (email, password_hash, raw_user_meta_data) values ('admin@x.com', 'x', '{"full_name":"Ada Admin"}') returning id`)).rows[0].id;
  const T = (await db.query(`insert into accounts.users (email, password_hash) values ('teach@x.com', 'x') returning id`)).rows[0].id;
  const { rows: profiles } = await db.query('select id, role, full_name from public.profiles order by created_at');

  console.log('Accounts');
  await test('first account is admin, second is teacher', () => {
    assert.equal(profiles.find(p => p.id === A).role, 'admin');
    assert.equal(profiles.find(p => p.id === T).role, 'teacher');
    assert.equal(profiles.find(p => p.id === A).full_name, 'Ada Admin');
  });

  const batch = (await as(A, q => q(`insert into batches (name) values ('Grade 11 – Evening') returning id`))).rows[0].id;
  const stu = (await as(A, q => q(`insert into students (name,email,mobile,guardian_name,guardian_mobile,batch_id,subjects) values ('Sam','sam@x.com','+971500000001','Pat','+971500000002',$1,'{chem,phys}') returning id`, [batch]))).rows[0].id;
  const cls = (await as(T, q => q(`insert into classes (batch_id,subject_id,title,start_at,duration_min,join_url) values ($1,'chem','Chem',now(),60,'https://zoom.us/j/1') returning id`, [batch]))).rows[0].id;

  console.log('Security');
  await test('teacher cannot create a student', () => rejects(as(T, q => q(`insert into students (name,email,batch_id) values ('x','x@x.com',$1)`, [batch])), /row-level security/));
  await test('teacher can read students and classes', async () => {
    assert.equal((await as(T, q => q('select * from students'))).rowCount, 1);
    assert.equal((await as(T, q => q('select * from classes'))).rowCount, 1);
  });
  await test('teacher sees no fees or payments', async () => {
    await as(A, q => q(`insert into fee_charges (student_id,subject_id,period,description,currency,cents,due_date) values ($1,'chem','2026-01','Chem','AED',25000,'2026-01-10')`, [stu]));
    assert.equal((await as(T, q => q('select * from fee_charges'))).rowCount, 0);
    assert.equal((await as(A, q => q('select * from fee_charges'))).rowCount, 1);
  });
  await test('a month cannot be generated twice for the same student and subject', () =>
    rejects(as(A, q => q(`insert into fee_charges (student_id,subject_id,period,description,currency,cents,due_date) values ($1,'chem','2026-01','Chem again','AED',25000,'2026-01-10')`, [stu])), /duplicate key/));
  await test('teacher cannot change settings or consent', async () => {
    const r = await as(T, q => q(`update settings set academy = 'Hacked' returning 1`));
    assert.equal(r.rowCount, 0);
    await rejects(as(T, q => q(`insert into consent (student_id,status) values ($1,'granted')`, [stu])), /row-level security/);
  });
  await test('teacher cannot call record_payment', () =>
    rejects(as(T, q => q(`select record_payment($1,1000,1000,'AED',1,'cash','','',now(),2026,'t')`, [stu])), /only admins/));
  await test('teacher can write a Reel draft but not a decision', async () => {
    const reel = (await as(T, q => q(`insert into reels (title,subject_id,batch_id,by_id) values ('R','chem',$1,$2) returning id`, [batch, T]))).rows[0].id;
    await rejects(as(T, q => q(`insert into reel_decisions (reel_id,state) values ($1,'published')`, [reel])), /row-level security/);
    await as(A, q => q(`insert into reel_decisions (reel_id,state) values ($1,'approved')`, [reel]));
  });
  await test('teacher cannot edit another teacher’s resource', async () => {
    const res = (await as(A, q => q(`insert into resources (title,subject_id,type,url,by_id) values ('N','chem','notes','https://x.com/a',$1) returning id`, [A]))).rows[0].id;
    assert.equal((await as(T, q => q(`update resources set title='x' where id=$1 returning 1`, [res]))).rowCount, 0);
  });
  await test('teachers do not see fee reminders in the message log', async () => {
    await as(A, q => q(`insert into messages (kind, body) values ('fee_reminder','pay'), ('class_info','hi')`));
    assert.equal((await as(T, q => q('select * from messages'))).rowCount, 1);
    assert.equal((await as(A, q => q('select * from messages'))).rowCount, 2);
  });
  await test('integrations (tokens) are invisible to everyone but the service role', async () => {
    await as(null, q => q(`insert into integrations (key, data) values ('youtube', '{"refresh_token":"s"}')`));
    assert.equal((await as(A, q => q('select * from integrations'))).rowCount, 0);
    assert.equal((await as(null, q => q('select * from integrations'))).rowCount, 1);
  });
  await test('a deactivated account loses access', async () => {
    await db.query('update profiles set active = false where id = $1', [T]);
    assert.equal((await as(T, q => q('select * from students'))).rowCount, 0);
    await db.query('update profiles set active = true where id = $1', [T]);
  });

  console.log('Payments');
  await test('receipt numbers count up per year without gaps', async () => {
    const pay = () => as(A, q => q(`select * from record_payment($1,10000,10000,'AED',1,'cash','','',now(),2026,'Ada')`, [stu]));
    const a = (await pay()).rows[0], b = (await pay()).rows[0];
    assert.equal(a.receipt_no, 'MTA-2026-00001'); assert.equal(b.receipt_no, 'MTA-2026-00002');
    const c = (await as(A, q => q(`select * from record_payment($1,10000,10000,'AED',1,'cash','','',now(),2027,'Ada')`, [stu]))).rows[0];
    assert.equal(c.receipt_no, 'MTA-2027-00001');
    assert.equal(a.currency, 'AED');
  });

  console.log('Attendance');
  await test('apply_attendance saves rows, the Zoom copy and the audit trail together', async () => {
    const row = (status, by) => ({ student_id: stu, status, join_time: null, leave_time: null, duration_sec: null, source: 'manual', note: '', created_by: by, updated_by: by });
    await as(T, q => q('select apply_attendance($1,$2,null,null,$3)', [cls, JSON.stringify([row('present', 'Tess')]), '[]']));
    await as(T, q => q('select apply_attendance($1,$2,$3,$4,$5)', [cls, JSON.stringify([row('absent', 'Tess')]),
      JSON.stringify([{ student_id: stu, status: 'present', duration_sec: 3000 }]), JSON.stringify([{ name: 'Guest' }]),
      JSON.stringify([{ student_id: stu, old_value: { status: 'present' }, new_value: { status: 'absent' }, reason: 'left early', by_name: 'Tess' }])]));
    assert.equal((await db.query('select status from attendance where class_id=$1', [cls])).rows[0].status, 'absent');
    assert.equal((await db.query('select status from attendance_zoom where class_id=$1', [cls])).rows[0].status, 'present');
    assert.equal((await db.query('select count(*)::int n from attendance_audit where class_id=$1', [cls])).rows[0].n, 1);
    assert.equal((await db.query('select jsonb_array_length(unmatched) n from attendance_class where class_id=$1', [cls])).rows[0].n, 1);
  });

  console.log('Pipeline');
  await test('claim_recording leases a recording so two ticks never take the same one', async () => {
    const rec = (await as(T, q => q(`insert into recordings (title,subject_id,batch_id,by_id,stage) values ('Rec','chem',$1,$2,'queued') returning id`, [batch, T]))).rows[0].id;
    const first = (await as(null, q => q('select * from claim_recording(60)'))).rows[0];
    assert.equal(first.id, rec);
    const second = (await as(null, q => q('select * from claim_recording(60)'))).rows[0];
    assert.equal(second.id, null);
    await rejects(as(T, q => q('select * from claim_recording(60)')), /permission denied/);
  });
} finally {
  await db.end();
  await admin.query(`drop database ${dbName} with (force)`);
  await admin.end();
}
console.log(failed ? `\n${failed} test(s) failed` : '\nAll database tests passed');
process.exit(failed ? 1 : 0);
