// An in-memory stand-in for src/lib/client.ts, used only when the app is started with MOCK_DB=1
// so the screens can be tried in a browser without a database. Not shipped to production.
import { ids, seed } from './seed';

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;
const g = globalThis as unknown as { __mockDb?: Db };
const store = (): Db => (g.__mockDb ||= seed());
if (typeof window !== 'undefined') (window as unknown as { __db: () => Db }).__db = store;

const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '00000000-0000-4000-8000-' + Math.random().toString(16).slice(2).padEnd(12, '0').slice(0, 12));
const DEFAULTS: Record<string, () => Row> = {
  students: () => ({ active: true, created_at: new Date().toISOString(), zoom_email: '', guardian_email: '', school: '' }),
  classes: () => ({ status: 'scheduled', cancel_reason: '', created_at: new Date().toISOString() }),
  messages: () => ({ ts: new Date().toISOString() }),
  resources: () => ({ status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  reels: () => ({ discarded: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), clip_path: null, recording_id: null }),
  recordings: () => ({ created_at: new Date().toISOString(), updated_at: new Date().toISOString(), steps: [], attempts: 0, last_error: '', yt_offset: 0, next_attempt_at: new Date().toISOString() }),
  fee_charges: () => ({ voided: false, created_at: new Date().toISOString() }),
  payments: () => ({ voided: false, void_reason: '', created_at: new Date().toISOString() }),
};
let seq = 1000;

class Query implements PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> {
  private filters: ((r: Row) => boolean)[] = [];
  private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private payload: Row | Row[] | null = null;
  private orders: [string, boolean][] = [];
  private lim: number | null = null;
  private rng: [number, number] | null = null;
  private one: 'single' | 'maybe' | null = null;
  private wantRows = false;
  constructor(private table: string) {}
  select() { this.wantRows = true; return this; }
  insert(p: Row | Row[]) { this.op = 'insert'; this.payload = p; return this; }
  update(p: Row) { this.op = 'update'; this.payload = p; return this; }
  upsert(p: Row | Row[]) { this.op = 'upsert'; this.payload = p; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c: string, v: unknown) { this.filters.push(r => r[c] === v); return this; }
  neq(c: string, v: unknown) { this.filters.push(r => r[c] !== v); return this; }
  in(c: string, v: unknown[]) { this.filters.push(r => v.includes(r[c])); return this; }
  lt(c: string, v: string) { this.filters.push(r => String(r[c]) < v); return this; }
  gt(c: string, v: string) { this.filters.push(r => String(r[c]) > v); return this; }
  not(c: string, op: string, v: unknown) { if (op === 'is' && v === null) this.filters.push(r => r[c] != null); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.orders.push([c, o?.ascending !== false]); return this; }
  limit(n: number) { this.lim = n; return this; }
  range(a: number, b: number) { this.rng = [a, b]; return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }

  private run(): { data: unknown; error: { message: string; code?: string } | null } {
    const rows = (store()[this.table] ||= []);
    const match = (r: Row) => this.filters.every(f => f(r));
    let out: Row[] = [];
    if (this.op === 'insert' || this.op === 'upsert') {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      for (const p of list) {
        const keyCols = this.table === 'consent' ? ['student_id'] : this.table === 'reel_decisions' ? ['reel_id'] : this.table === 'settings' ? ['id'] : [];
        const existing = this.op === 'upsert' && keyCols.length ? rows.find(r => keyCols.every(k => r[k] === p[k])) : undefined;
        if (existing) { Object.assign(existing, p); out.push(existing); continue; }
        if (this.table === 'students' && p.active !== false && rows.some(r => r.active && String(r.email).toLowerCase() === String(p.email).toLowerCase())) return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } };
        if (this.table === 'batches' && rows.some(r => String(r.name).toLowerCase() === String(p.name).toLowerCase())) return { data: null, error: { message: 'duplicate key', code: '23505' } };
        const row: Row = { id: uuid(), ...(DEFAULTS[this.table]?.() || {}), ...p };
        if (this.table.endsWith('_history') || this.table === 'consent_log' || this.table === 'attendance_audit') { row.id = ++seq; row.at ||= new Date().toISOString(); }
        rows.push(row); out.push(row);
      }
    } else if (this.op === 'update') {
      for (const r of rows) if (match(r)) { Object.assign(r, this.payload); out.push(r); }
    } else if (this.op === 'delete') {
      store()[this.table] = rows.filter(r => { const m = match(r); if (m) out.push(r); return !m; });
    } else {
      out = rows.filter(match);
      for (const [c, asc] of [...this.orders].reverse()) out = [...out].sort((a, b) => (String(a[c] ?? '') < String(b[c] ?? '') ? -1 : String(a[c] ?? '') > String(b[c] ?? '') ? 1 : 0) * (asc ? 1 : -1));
      if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
      if (this.lim != null) out = out.slice(0, this.lim);
    }
    const clone = (x: unknown) => JSON.parse(JSON.stringify(x));
    if (this.one) {
      if (!out.length) return this.one === 'single' ? { data: null, error: { message: 'No rows found', code: 'PGRST116' } } : { data: null, error: null };
      return { data: clone(out[0]), error: null };
    }
    return { data: this.op === 'select' || this.wantRows ? clone(out) : null, error: null };
  }
  then<T1, T2>(ok?: ((v: { data: unknown; error: { message: string; code?: string } | null }) => T1 | PromiseLike<T1>) | null, bad?: ((e: unknown) => T2 | PromiseLike<T2>) | null): PromiseLike<T1 | T2> {
    try { return Promise.resolve(this.run()).then(ok, bad); } catch (e) { return Promise.reject(e).then(ok, bad); }
  }
}

function rpc(name: string, a: Row): { data: unknown; error: { message: string } | null } {
  const d = store();
  if (name === 'apply_attendance') {
    const cid = a.p_class as string;
    const cls = (d.attendance_class ||= []);
    const ex = cls.find(r => r.class_id === cid);
    if (ex) { if (a.p_unmatched) ex.unmatched = a.p_unmatched; } else cls.push({ class_id: cid, taken_at: new Date().toISOString(), unmatched: a.p_unmatched || [] });
    for (const r of (a.p_rows as Row[]) || []) {
      const rows = (d.attendance ||= []), cur = rows.find(x => x.class_id === cid && x.student_id === r.student_id);
      if (cur) Object.assign(cur, r); else rows.push({ class_id: cid, ...r });
    }
    if (a.p_zoom) { d.attendance_zoom = (d.attendance_zoom || []).filter(z => z.class_id !== cid); for (const z of a.p_zoom as Row[]) d.attendance_zoom.push({ class_id: cid, synced_at: new Date().toISOString(), ...z }); }
    for (const x of (a.p_audits as Row[]) || []) (d.attendance_audit ||= []).push({ id: ++seq, class_id: cid, at: new Date().toISOString(), ...x });
    return { data: null, error: null };
  }
  if (name === 'record_payment') {
    const year = a.p_year as number, ctr = (d.receipt_counters ||= []);
    let c = ctr.find(x => x.year === year); if (!c) { c = { year, n: 0 }; ctr.push(c); } c.n = (c.n as number) + 1;
    const s = d.students.find(x => x.id === a.p_student);
    const p = { id: uuid(), receipt_no: `MTA-${year}-${String(c.n).padStart(5, '0')}`, student_id: a.p_student, currency: s?.currency || 'AED', cents: a.p_cents, paid_currency: a.p_paid_currency, paid_cents: a.p_paid_cents, rate: a.p_rate, method: a.p_method, reference: a.p_reference, note: a.p_note, paid_at: a.p_paid_at, received_by: a.p_received_by, voided: false, void_reason: '', created_at: new Date().toISOString() };
    d.payments.push(p);
    return { data: JSON.parse(JSON.stringify(p)), error: null };
  }
  return { data: null, error: { message: 'rpc not mocked: ' + name } };
}

const role = () => { try { return localStorage.getItem('mock-role') === 'teacher' ? ids.teacher : ids.admin; } catch { return ids.admin; } };
const signedOut = () => { try { return localStorage.getItem('mock-out') === '1'; } catch { return false; } };
const listeners = new Set<(e: string) => void>();

export const isConfigured = true;
export const db = {
  from: (t: string) => new Query(t),
  rpc: (n: string, a: Row) => Promise.resolve(rpc(n, a)),
  auth: {
    getSession: async () => ({ data: { session: signedOut() ? null : { access_token: 'mock-token', user: { id: role() } } } }),
    onAuthStateChange: (cb: (e: string) => void) => { listeners.add(cb); return { data: { subscription: { unsubscribe() { listeners.delete(cb); } } } }; },
    signInWithPassword: async () => { try { localStorage.removeItem('mock-out'); } catch { /* ignore */ } return { error: null }; },
    signOut: async () => { try { localStorage.setItem('mock-out', '1'); } catch { /* ignore */ } listeners.forEach(l => l('SIGNED_OUT')); },
  },
};

/** The few API routes the screens call, answered locally. */
export async function api<T = unknown>(path: string): Promise<T> {
  if (path === '/api/integrations/status') return { youtube: { configured: false, connected: false, channel: '', since: null }, instagram: { connected: false, username: '', since: null }, zoom: { configured: false, webhook: false }, scheduler: { cron_secret_set: true, metrics_checked_at: null }, site_url: 'http://localhost:3100' } as T;
  if (path === '/api/media/sign') return { url: 'https://example.com/clip.mp4' } as T;
  return { ok: true } as T;
}

export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
