'use client';
// Loads the academy’s records once after sign-in and shares them with every screen.
// Reads and writes go through /api/db to PostgreSQL; row level security in the database decides what each role may see and change.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { db, fetchAll } from '@/lib/client';
import { endIso, fDateISO, setFormatConfig, skey, subj } from '@/lib/format';
import type { FeeCtx } from '@/lib/fees';
import type { ParentCtx } from '@/lib/parent';
import type {
  AttAudit, AttDoc, AttRow, Batch, ClassRow, ConsentLog, ConsentRow, FeeCharge, FeeRate, MessageLog, ParentSend, Payment, Profile,
  Reel, ReelDecision, Recording, Resource, Settings, Student, ZoomRow,
} from '@/lib/types';

export interface Data {
  settings: Settings; batches: Batch[]; students: Student[]; classes: ClassRow[]; profiles: Profile[];
  reels: Reel[]; decisions: Record<string, ReelDecision>; consent: Record<string, ConsentRow>; consentLog: ConsentLog[];
  resources: Resource[]; messages: MessageLog[]; recordings: Recording[];
  rates: FeeRate[]; charges: FeeCharge[]; payments: Payment[]; sends: ParentSend[];
}
type Key = keyof Data;

interface App extends Data {
  me: Profile; isAdmin: boolean; by: string;
  reload(...keys: Key[]): Promise<void>;
  /** Make sure the attendance of these classes is loaded (one query batch per call). */
  ensureAtt(classIds: string[]): Promise<void>;
  /** Forget and reload the attendance of these classes after a change. */
  refreshAtt(classIds: string[]): Promise<void>;
  att(classId: string): AttDoc | undefined;
  loadAudit(classId: string): Promise<AttAudit[]>;
  bname(id: string | null | undefined): string; sname(id: string): string;
  enrolled(c: ClassRow): Student[]; cstate(c: ClassRow): 'cancelled' | 'ended' | 'live' | 'upcoming';
  announced(c: ClassRow): boolean;
  feeCtx(): FeeCtx; parentCtx(): ParentCtx;
  schoolNames(all?: boolean): { name: string; key: string; students: number }[];
  signOut(): Promise<void>;
}

const Ctx = createContext<App>(null as unknown as App);
export const useApp = () => useContext(Ctx);

const EMPTY: AttDoc = { taken_at: null, unmatched: [], rows: {}, zoom: {}, audit: [] };

async function loadTable(key: Key, isAdmin: boolean): Promise<unknown> {
  const t = (name: string, order?: [string, boolean]) => fetchAll<never>((a, b) => {
    let q = db.from(name).select('*');
    if (order) q = q.order(order[0], { ascending: order[1] });
    return q.range(a, b) as unknown as PromiseLike<{ data: never[] | null; error: { message: string } | null }>;
  });
  switch (key) {
    case 'settings': { const { data, error } = await db.from('settings').select('*').eq('id', 1).single(); if (error) throw new Error(error.message); return data; }
    case 'batches': return t('batches', ['name', true]);
    case 'students': return t('students', ['name', true]);
    case 'classes': return t('classes', ['start_at', true]);
    case 'profiles': return t('profiles', ['full_name', true]);
    case 'reels': return t('reels', ['created_at', false]);
    case 'decisions': return Object.fromEntries((await t('reel_decisions') as ReelDecision[]).map(d => [d.reel_id, d]));
    case 'consent': return Object.fromEntries((await t('consent') as ConsentRow[]).map(d => [d.student_id, d]));
    case 'consentLog': return isAdmin ? (await t('consent_log', ['at', false]) as ConsentLog[]).slice(0, 300) : [];
    case 'resources': return t('resources', ['date', false]);
    case 'messages': { const { data, error } = await db.from('messages').select('*').order('ts', { ascending: false }).limit(600); if (error) throw new Error(error.message); return data; }
    case 'recordings': { const { data, error } = await db.from('recordings').select('*').order('created_at', { ascending: false }).limit(200); if (error) throw new Error(error.message); return data; }
    case 'rates': return isAdmin ? t('fee_rates') : [];
    case 'charges': return isAdmin ? t('fee_charges', ['due_date', true]) : [];
    case 'payments': return isAdmin ? t('payments', ['paid_at', false]) : [];
    case 'sends': return isAdmin ? t('parent_report_sends', ['at', false]) : [];
  }
}
const ALL: Key[] = ['settings', 'batches', 'students', 'classes', 'profiles', 'reels', 'decisions', 'consent', 'consentLog', 'resources', 'messages', 'recordings', 'rates', 'charges', 'payments', 'sends'];

export function AppProvider({ me, children, onSignOut }: { me: Profile; children: ReactNode; onSignOut: () => Promise<void> }) {
  const isAdmin = me.role === 'admin';
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const attCache = useRef<Record<string, AttDoc>>({});
  const [attV, bump] = useState(0);

  const reload = useCallback(async (...keys: Key[]) => {
    const list = keys.length ? keys : ALL;
    const vals = await Promise.all(list.map(k => loadTable(k, isAdmin)));
    setData(d => ({ ...(d || ({} as Data)), ...Object.fromEntries(list.map((k, i) => [k, vals[i]])) }) as Data);
  }, [isAdmin]);

  const first = useRef(true);
  useEffect(() => {
    if (!first.current) return; first.current = false;
    reload().catch(e => setError(e instanceof Error ? e.message : 'Could not load the records.'));
  }, [reload]);

  // recordings change while the pipeline works: keep the list fresh without a manual refresh
  const active = data?.recordings.some(r => ['uploading', 'queued', 'youtube', 'trim', 'instagram'].includes(r.stage));
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => { reload('recordings', 'reels', 'decisions').catch(() => {}); }, 8000);
    return () => clearInterval(t);
  }, [active, reload]);

  if (data?.settings) setFormatConfig({ tz: data.settings.tz, currency: data.settings.currency });

  const ensureAtt = useCallback(async (ids: string[]) => {
    const need = [...new Set(ids)].filter(id => !attCache.current[id]);
    for (let i = 0; i < need.length; i += 120) {
      const chunk = need.slice(i, i + 120);
      const [cls, rows, zoom] = await Promise.all([
        db.from('attendance_class').select('*').in('class_id', chunk),
        fetchAll<AttRow & { class_id: string }>((a, b) => db.from('attendance').select('*').in('class_id', chunk).range(a, b)),
        fetchAll<ZoomRow & { class_id: string }>((a, b) => db.from('attendance_zoom').select('*').in('class_id', chunk).range(a, b)),
      ]);
      if (cls.error) throw new Error(cls.error.message);
      const docs: Record<string, AttDoc> = {};
      for (const id of chunk) docs[id] = { ...EMPTY, rows: {}, zoom: {}, unmatched: [], audit: [] };
      for (const c of cls.data || []) { docs[c.class_id].taken_at = c.taken_at; docs[c.class_id].unmatched = c.unmatched || []; }
      for (const r of rows) docs[r.class_id].rows[r.student_id] = r;
      for (const z of zoom) docs[z.class_id].zoom[z.student_id] = z;
      Object.assign(attCache.current, docs);
    }
    if (need.length) bump(n => n + 1);
  }, []);
  const refreshAtt = useCallback(async (ids: string[]) => { for (const id of ids) delete attCache.current[id]; await ensureAtt(ids); }, [ensureAtt]);
  const att = useCallback((id: string) => attCache.current[id], []);
  const loadAudit = useCallback(async (classId: string) => {
    const { data: a, error: e } = await db.from('attendance_audit').select('*').eq('class_id', classId).order('at', { ascending: true });
    if (e) throw new Error(e.message);
    return (a || []) as AttAudit[];
  }, []);

  const value = useMemo<App | null>(() => {
    if (!data) return null;
    const bname = (id: string | null | undefined) => data.batches.find(b => b.id === id)?.name || '—';
    const sname = (id: string) => data.students.find(s => s.id === id)?.name || 'Removed student';
    const by = me.full_name || me.email || (isAdmin ? 'Admin' : 'Teacher');
    const cstate = (c: ClassRow) => c.status === 'cancelled' ? 'cancelled' as const : Date.now() > new Date(endIso(c)).getTime() ? 'ended' as const : Date.now() >= new Date(c.start_at).getTime() ? 'live' as const : 'upcoming' as const;
    const feeCtx = (): FeeCtx => ({
      students: data.students, batches: data.batches, charges: data.charges, payments: data.payments, rates: data.rates,
      today: fDateISO(Date.now()), defaultCurrency: data.settings.currency, subjectName: id => subj(id),
    });
    return {
      ...data, me, isAdmin, by, reload, ensureAtt, refreshAtt, att, loadAudit, bname, sname, cstate,
      enrolled: c => data.students.filter(s => s.active && s.batch_id === c.batch_id && s.subjects.includes(c.subject_id)),
      announced: c => data.messages.some(m => m.class_id === c.id && (m.kind === 'class_info' || m.kind === 'class_change')),
      feeCtx,
      parentCtx: (): ParentCtx => ({
        students: data.students, batches: data.batches, classes: data.classes.filter(c => ['scheduled', 'cancelled'].includes(c.status)), att: attCache.current,
        fees: feeCtx(), settings: data.settings, nowIso: new Date().toISOString(), today: fDateISO(Date.now()),
      }),
      schoolNames: (all = false) => {
        const g = new Map<string, { names: Record<string, number>; n: number }>();
        for (const st of data.students.filter(x => all || x.active)) {
          const k = skey(st.school); if (!k) continue;
          const e = g.get(k) || { names: {}, n: 0 }; e.names[st.school] = (e.names[st.school] || 0) + 1; e.n++; g.set(k, e);
        }
        const caps = (n: string) => (n.match(/\p{Lu}/gu) || []).length;
        return [...g.entries()].map(([key, e]) => ({
          key, students: e.n, name: Object.entries(e.names).sort((a, b) => b[1] - a[1] || caps(b[0]) - caps(a[0]) || a[0].localeCompare(b[0]))[0][0],
        })).sort((a, b) => a.name.localeCompare(b.name));
      },
      signOut: onSignOut,
    };
    // attV changes whenever the attendance cache changes, so screens that read it re-render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, attV, me, isAdmin, reload, ensureAtt, refreshAtt, att, loadAudit, onSignOut]);

  if (error) return <div className="login"><div className="card"><div className="alert bad">Could not load the records: {error}. Reload the page to try again.</div></div></div>;
  if (!value) return <div className="spin" style={{ paddingTop: '30vh' }}>Opening academy records…</div>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
