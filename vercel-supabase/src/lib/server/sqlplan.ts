// Turns a query "plan" into parameterised SQL and runs it. Table and column names are checked against the real
// database catalogue, values are always parameters, and requests from the browser run inside a transaction that
// switches to the `authenticated` role, so the row level security policies decide what each person can see and change.
import type { Pool, PoolClient } from 'pg';
import type { DbError, Filter, Plan, Result, Row } from '../dbplan';
import { pool } from './pg';

interface Catalog { cols: Map<string, Map<string, string>>; pks: Map<string, string[]> }
const g = globalThis as unknown as { __catalog?: Promise<Catalog> };

async function catalog(p: Pool): Promise<Catalog> {
  return (g.__catalog ||= (async () => {
    const cols = new Map<string, Map<string, string>>(), pks = new Map<string, string[]>();
    for (const r of (await p.query(`select table_name, column_name, udt_name from information_schema.columns where table_schema = 'public' order by ordinal_position`)).rows) {
      if (!cols.has(r.table_name)) cols.set(r.table_name, new Map());
      cols.get(r.table_name)!.set(r.column_name, r.udt_name);
    }
    for (const r of (await p.query(`select c.relname as t, a.attname as col from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey) where i.indisprimary and n.nspname = 'public' order by array_position(i.indkey::int2[], a.attnum)`)).rows) {
      pks.set(r.t, [...(pks.get(r.t) || []), r.col]);
    }
    return { cols, pks };
  })().catch(e => { delete g.__catalog; throw e; }));
}

/** Tables the browser may reach. Row level security still applies on top. */
export const BROWSER_TABLES = new Set([
  'profiles', 'settings', 'batches', 'students', 'classes', 'attendance_class', 'attendance', 'attendance_zoom', 'attendance_audit', 'fee_rates', 'fee_charges', 'receipt_counters',
  'payments', 'parent_report_sends', 'messages', 'resources', 'resource_history', 'reels', 'reel_decisions', 'reel_history', 'consent', 'consent_log', 'recordings',
]);

/** Database functions callable by name, with the SQL type of each argument. */
export const RPCS: Record<string, { args: Record<string, string>; returns: 'void' | 'row'; browser: boolean }> = {
  apply_attendance: { args: { p_class: 'uuid', p_rows: 'jsonb', p_zoom: 'jsonb', p_unmatched: 'jsonb', p_audits: 'jsonb' }, returns: 'void', browser: true },
  record_payment: { args: { p_student: 'uuid', p_cents: 'bigint', p_paid_cents: 'bigint', p_paid_currency: 'text', p_rate: 'numeric', p_method: 'text', p_reference: 'text', p_note: 'text', p_paid_at: 'timestamptz', p_year: 'int', p_received_by: 'text' }, returns: 'row', browser: true },
  claim_recording: { args: { p_lease_seconds: 'int' }, returns: 'row', browser: false },
};

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new PlanError('Invalid name: ' + s);
  return '"' + s + '"';
};
export class PlanError extends Error {}

export interface Built { text: string; values: unknown[]; one?: 'single' | 'maybe'; returns: boolean }

export function buildSql(plan: Plan, cat: Catalog, opts: { browser: boolean }): Built {
  if (plan.op === 'rpc') {
    const def = RPCS[plan.rpc || ''];
    if (!def || (opts.browser && !def.browser)) throw new PlanError('Unknown function.');
    const values: unknown[] = [], named: string[] = [];
    for (const [k, t] of Object.entries(def.args)) {
      if (!(plan.args && k in plan.args)) continue;
      let v = plan.args[k];
      if (t === 'jsonb' && v != null) v = JSON.stringify(v);
      values.push(v); named.push(`${k} => $${values.length}::${t}`);
    }
    const call = `public.${plan.rpc}(${named.join(', ')})`;
    return { text: def.returns === 'row' ? `select to_jsonb(${call}) as data` : `select ${call}`, values, returns: true, one: 'maybe' };
  }
  const table = plan.table || '';
  if (!cat.cols.has(table) || (opts.browser && !BROWSER_TABLES.has(table))) throw new PlanError('Unknown table.');
  const cols = cat.cols.get(table)!;
  const col = (c: string) => { if (!cols.has(c)) throw new PlanError(`Unknown column ${table}.${c}`); return ident(c); };
  const values: unknown[] = [];
  const param = (v: unknown) => { values.push(v); return '$' + values.length; };
  const val = (c: string, v: unknown) => (cols.get(c) === 'jsonb' && v !== null && v !== undefined ? JSON.stringify(v) : v);

  const where = (filters: Filter[]) => filters.length ? ' where ' + filters.map(f => {
    const c = col(f.col);
    switch (f.op) {
      case 'eq': return `${c} = ${param(f.val)}`;
      case 'neq': return `${c} is distinct from ${param(f.val)}`;
      case 'lt': return `${c} < ${param(f.val)}`;
      case 'lte': return `${c} <= ${param(f.val)}`;
      case 'gt': return `${c} > ${param(f.val)}`;
      case 'gte': return `${c} >= ${param(f.val)}`;
      case 'ilike': return `${c} ilike ${param(f.val)}`;
      case 'isnull': return `${c} is null`;
      case 'notnull': return `${c} is not null`;
      case 'in': { if (!Array.isArray(f.val)) throw new PlanError('in needs a list'); return f.val.length ? `${c} = any(${param(f.val)}::${cols.get(f.col)!.replace(/^_/, '')}[])` : 'false'; }
      default: throw new PlanError('Unknown filter.');
    }
  }).join(' and ') : '';
  const ret = plan.returning || !!plan.one ? ' returning *' : '';
  const tbl = `public.${ident(table)}`;

  if (plan.op === 'select') {
    let t = `select * from ${tbl}` + where(plan.filters);
    if (plan.orders.length) t += ' order by ' + plan.orders.map(([c, asc]) => `${col(c)} ${asc ? 'asc' : 'desc'}`).join(', ');
    const n = plan.one === 'single' ? 2 : plan.one === 'maybe' ? 2 : plan.range ? plan.range[1] - plan.range[0] + 1 : plan.limit;
    if (n != null) t += ` limit ${Math.max(0, Math.floor(Number(n)))}`;
    if (plan.range) t += ` offset ${Math.max(0, Math.floor(Number(plan.range[0])))}`;
    return { text: t, values, one: plan.one, returns: true };
  }

  if (plan.op === 'insert' || plan.op === 'upsert') {
    const rows = (Array.isArray(plan.payload) ? plan.payload : [plan.payload]) as Row[];
    if (!rows.length || rows.some(r => !r || typeof r !== 'object')) throw new PlanError('Nothing to save.');
    const names = [...new Set(rows.flatMap(r => Object.keys(r)))];
    if (!names.length) throw new PlanError('Nothing to save.');
    const tuples = rows.map(r => '(' + names.map(n => (n in r ? param(val(n, r[n])) : 'default')).join(', ') + ')');
    let t = `insert into ${tbl} (${names.map(col).join(', ')}) values ${tuples.join(', ')}`;
    if (plan.op === 'upsert') {
      const key = plan.onConflict ? plan.onConflict.split(',').map(s => s.trim()) : cat.pks.get(table) || [];
      if (!key.length) throw new PlanError('No key to merge on.');
      const set = names.filter(n => !key.includes(n));
      t += ` on conflict (${key.map(col).join(', ')}) ` + (set.length ? `do update set ${set.map(n => `${col(n)} = excluded.${col(n)}`).join(', ')}` : 'do nothing');
    }
    return { text: t + ret, values, one: plan.one, returns: ret !== '' };
  }

  if (plan.op === 'update') {
    if (!plan.filters.length) throw new PlanError('Refusing to update every row.');
    const p = (plan.payload || {}) as Row, names = Object.keys(p);
    if (!names.length) throw new PlanError('Nothing to save.');
    const set = names.map(n => `${col(n)} = ${param(val(n, p[n]))}`).join(', ');
    return { text: `update ${tbl} set ${set}${where(plan.filters)}${ret}`, values, one: plan.one, returns: ret !== '' };
  }
  if (plan.op === 'delete') {
    if (!plan.filters.length) throw new PlanError('Refusing to delete every row.');
    return { text: `delete from ${tbl}${where(plan.filters)}${ret}`, values, one: plan.one, returns: ret !== '' };
  }
  throw new PlanError('Unknown operation.');
}

function shape(b: Built, rows: Row[], rpc: boolean): Result {
  if (rpc) {
    const first = rows[0], v = first && ('data' in first ? first.data : null);
    return { data: v && typeof v === 'object' && v.id === null ? null : v ?? null, error: null };
  }
  if (!b.returns) return { data: null, error: null };
  if (b.one) {
    if (rows.length > 1 && b.one === 'single') return { data: null, error: { message: 'More than one row was found.', code: 'PGRST116' } };
    if (!rows.length) return b.one === 'single' ? { data: null, error: { message: 'No rows found.', code: 'PGRST116' } } : { data: null, error: null };
    return { data: rows[0], error: null };
  }
  return { data: rows, error: null };
}

const toErr = (e: unknown): DbError => {
  if (e instanceof PlanError) return { message: e.message, code: 'PLAN' };
  const x = e as { message?: string; code?: string; detail?: string };
  return { message: x.message || 'Database error', code: x.code };
};

/**
 * Runs a plan. With `userId` it behaves like a signed-in person: role `authenticated` and request.jwt.claim.sub set, for this
 * one transaction (row level security applies). Without it (server code that has already checked who is asking) it runs as the owner.
 */
export async function runPlan(plan: Plan, opts: { userId?: string | null; browser?: boolean }): Promise<Result> {
  const p = pool();
  let client: PoolClient | null = null;
  try {
    const built = buildSql(plan, await catalog(p), { browser: !!opts.browser });
    client = await p.connect();
    if (opts.userId) {
      await client.query('begin');
      await client.query('set local role authenticated');
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [opts.userId]);
    }
    let res;
    try { res = await client.query(built.text, built.values); } catch (e) { if (opts.userId) await client.query('rollback').catch(() => {}); throw e; }
    if (opts.userId) await client.query('commit');
    return shape(built, res.rows, plan.op === 'rpc');
  } catch (e) {
    return { data: null, error: toErr(e) };
  } finally { client?.release(); }
}
