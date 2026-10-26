// Real implementations of the pipeline’s Repo (your PostgreSQL) and Gateways (YouTube, Instagram, ffmpeg, storage), and the scheduler tick.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { admin, getIntegration, setIntegration } from './admin';
import * as store from './storage';
import { PermanentError } from './env';
import { durationOf, trim } from './ffmpeg';
import * as ig from './instagram';
import { advance, releaseHeld, type Gateways, type Repo } from './pipeline';
import { openSource } from './source';
import * as yt from './youtube';
import type { ConsentRow, Reel, ReelDecision, Recording, Settings, Student } from '../types';

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

export const dbRepo: Repo = {
  async settings() { return must(await admin().from('settings').select('*').eq('id', 1).single(), 'settings') as Settings; },
  async consent() {
    const [c, s] = await Promise.all([admin().from('consent').select('student_id,status'), admin().from('students').select('id,name')]);
    const status = new Map((must(c, 'consent') as Pick<ConsentRow, 'student_id' | 'status'>[]).map(x => [x.student_id, x.status]));
    const names = new Map((must(s, 'students') as Pick<Student, 'id' | 'name'>[]).map(x => [x.id, x.name]));
    return { status: (id: string) => status.get(id) || 'unknown', name: (id: string) => names.get(id) || 'a student' };
  },
  async get(id) { return ((await admin().from('recordings').select('*').eq('id', id).maybeSingle()).data as Recording | null) ?? null; },
  async patch(id, fields) {
    return must(await admin().from('recordings').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id).select('*').single(), 'recording') as Recording;
  },
  async heldRecordings() { return (must(await admin().from('recordings').select('*').eq('stage', 'held'), 'recordings') ?? []) as Recording[]; },
  async getReel(id) { return ((await admin().from('reels').select('*').eq('id', id).maybeSingle()).data as Reel | null) ?? null; },
  async insertReel(f) { return must(await admin().from('reels').insert(f).select('*').single(), 'reel') as Reel; },
  async getDecision(reelId) { return ((await admin().from('reel_decisions').select('*').eq('reel_id', reelId).maybeSingle()).data as ReelDecision | null) ?? null; },
  async saveDecision(d) { must(await admin().from('reel_decisions').upsert(d), 'reel decision'); },
  async addReelHistory(reelId, scope, action, note = '') {
    await admin().from('reel_history').insert({ reel_id: reelId, scope, action, by_name: 'Auto pipeline', note });
  },
};

export const realGateways: Gateways = {
  nowMs: () => Date.now(),
  sleep: ms => new Promise(r => setTimeout(r, ms)),
  openSource,
  youtube: { token: yt.accessToken, start: yt.startSession, send: yt.sendChunk, query: yt.queryOffset },
  async cutClip(src, rec, timeoutMs) {
    const tmp = path.join(os.tmpdir(), `clip-${rec.id}.mp4`);
    try {
      await trim({ input: src.url, output: tmp, startSec: rec.trim_start_sec, lengthSec: rec.trim_len_sec }, timeoutMs);
      const seconds = (await durationOf(tmp)) ?? 0;
      if (seconds < 3) throw new PermanentError(`The recording is shorter than the point where the clip should start (${rec.trim_start_sec} s), so no clip could be cut. Change the clip start and retry.`);
      const key = `${rec.id}.mp4`;
      store.put('clips', key, tmp);
      return { path: key, seconds };
    } finally { fs.rmSync(tmp, { force: true }); }
  },
  async clipUrl(p) { return store.signedClipUrl(p, 24 * 3600); },
  instagram: { connection: ig.connection, createContainer: ig.createReelContainer, status: ig.containerStatus, publish: ig.publish, permalink: ig.permalink },
};

export interface TickResult { processed: string[]; released: number; cleaned: number; metrics: number }

/** One scheduler run: resume held recordings, work on queued ones, tidy up, refresh Instagram numbers. */
export async function runTick(budgetMs = 270_000, repo: Repo = dbRepo, gw: Gateways = realGateways): Promise<TickResult> {
  const deadline = Date.now() + budgetMs;
  const out: TickResult = { processed: [], released: 0, cleaned: 0, metrics: 0 };
  out.released = await releaseHeld(repo, gw);
  while (Date.now() < deadline - 20_000) {
    const { data, error } = await admin().rpc('claim_recording', { p_lease_seconds: Math.ceil(budgetMs / 1000) + 150 });
    if (error) throw new Error('claim_recording: ' + error.message);
    const rec = data as Recording | null;
    if (!rec?.id) break;
    await advance(rec, repo, gw, deadline);
    out.processed.push(rec.id);
  }
  out.cleaned = await cleanupOriginals().catch(() => 0);
  out.metrics = await refreshMetrics(deadline).catch(() => 0);
  return out;
}

/** Deletes the big original from storage once the clip is published (after the retention period set in Setup). */
async function cleanupOriginals(): Promise<number> {
  const s = await dbRepo.settings();
  const cutoff = new Date(Date.now() - s.keep_original_days * 864e5).toISOString();
  const { data } = await admin().from('recordings').select('id,source_path').eq('stage', 'completed').eq('original_deleted', false).not('source_path', 'is', null).lt('updated_at', cutoff).limit(20);
  let n = 0;
  for (const r of (data || []) as Pick<Recording, 'id' | 'source_path'>[]) {
    try { store.remove('recordings', r.source_path as string); await admin().from('recordings').update({ original_deleted: true }).eq('id', r.id); n++; } catch { /* try again next time */ }
  }
  return n;
}

/** Instagram numbers (views, reach, likes…) every six hours for Reels published in the last 90 days. */
async function refreshMetrics(deadline: number): Promise<number> {
  const st = (await getIntegration<{ metrics_at?: string }>('pipeline_state')) || {};
  if (st.metrics_at && Date.now() - new Date(st.metrics_at).getTime() < 6 * 3600_000) return 0;
  let c: ig.IgConnection;
  try { c = await ig.connection(); } catch { return 0; }
  const since = new Date(Date.now() - 90 * 864e5).toISOString();
  const { data } = await admin().from('reel_decisions').select('reel_id,ig_media_id,metrics').eq('state', 'published').not('ig_media_id', 'is', null).gt('published_at', since).limit(60);
  let n = 0;
  for (const d of (data || []) as Pick<ReelDecision, 'reel_id' | 'ig_media_id' | 'metrics'>[]) {
    if (Date.now() > deadline - 10_000) return n;
    try {
      const m = await ig.insights(c, d.ig_media_id as string);
      await admin().from('reel_decisions').update({ metrics: { ...m, as_of: new Date().toISOString() } }).eq('reel_id', d.reel_id);
      n++;
    } catch { /* one Reel failing (for example deleted on Instagram) must not stop the rest */ }
  }
  await setIntegration('pipeline_state', { ...st, metrics_at: new Date().toISOString() });
  return n;
}
