// The recording pipeline:  class recording  ->  YouTube (full class)  ->  60-second vertical clip  ->  Instagram Reel.
//
// It is a state machine over the `recordings` table so that it survives restarts and long videos:
// every step saves its progress, the background worker (worker.ts, every minute) keeps calling it,
// and each call continues where the last one stopped (a half-finished YouTube upload resumes at the same byte).
//
// This file holds the decisions only. Talking to the database, YouTube, Instagram and ffmpeg goes through
// the `Repo` and `Gateways` interfaces (see runtime.ts), which lets the whole flow be tested with fakes.
import { consentIssue, buildCaption } from '../reels';
import { PermanentError } from './env';
import type { ChunkResult, UploadMeta } from './youtube';
import { SessionExpired } from './youtube';
import type { ContainerStatus, IgConnection } from './instagram';
import type { Source } from './source';
import type { Reel, ReelDecision, Recording, RecStage, Settings } from '../types';

export const CHUNK_BYTES = 8 * 1024 * 1024;         // must be a multiple of 256 KiB for YouTube
export const MARGIN_MS = 15_000;                    // stop starting new work this long before the deadline
export const MAX_ATTEMPTS = 5;
export const BACKOFF_MIN = [1, 2, 5, 10, 30];

export interface Repo {
  settings(): Promise<Settings>;
  consent(): Promise<{ status(studentId: string): string; name(studentId: string): string }>;
  get(id: string): Promise<Recording | null>;
  patch(id: string, fields: Partial<Recording>): Promise<Recording>;
  heldRecordings(): Promise<Recording[]>;
  getReel(id: string): Promise<Reel | null>;
  insertReel(fields: Partial<Reel>): Promise<Reel>;
  getDecision(reelId: string): Promise<ReelDecision | null>;
  saveDecision(d: Partial<ReelDecision> & { reel_id: string }): Promise<void>;
  addReelHistory(reelId: string, scope: 'draft' | 'decision', action: string, note?: string): Promise<void>;
}

export interface Gateways {
  nowMs(): number;
  sleep(ms: number): Promise<void>;
  openSource(rec: Recording): Promise<Source>;
  youtube: {
    token(): Promise<string>;
    start(token: string, meta: UploadMeta, size: number, mime: string): Promise<string>;
    send(session: string, bytes: Uint8Array, from: number, total: number, mime: string): Promise<ChunkResult>;
    query(session: string, total: number): Promise<ChunkResult>;
  };
  /** Cuts the clip from the source, stores it, and returns its storage path and real length. */
  cutClip(src: Source, rec: Recording, timeoutMs: number): Promise<{ path: string; seconds: number }>;
  clipUrl(path: string): Promise<string>;
  instagram: {
    connection(): Promise<IgConnection>;
    createContainer(c: IgConnection, videoUrl: string, caption: string): Promise<string>;
    status(c: IgConnection, id: string): Promise<{ code: ContainerStatus; detail: string }>;
    publish(c: IgConnection, containerId: string): Promise<string>;
    permalink(c: IgConnection, mediaId: string): Promise<string>;
  };
}

export const subjectNames: Record<string, string> = { chem: 'Chemistry', phys: 'Physics', math: 'Mathematics' };

// ---------------------------------------------------------------- decisions that can be tested on their own
export const backoffMinutes = (attempts: number) => BACKOFF_MIN[Math.min(Math.max(attempts, 1), BACKOFF_MIN.length) - 1];

export type Gate = { go: true } | { go: false; reason: string; final?: boolean };

/** May this clip go to Instagram now? A student only appears with consent on record; approval mode waits for an admin. */
export function gate(
  rec: Recording, reel: Reel | null, decision: ReelDecision | null,
  consent: { status(id: string): string; name(id: string): string }, nowIso: string,
): Gate {
  if (rec.publish_mode === 'off') return { go: false, final: true, reason: 'Publishing to Instagram is switched off, so the Reel was saved as a draft.' };
  const issue = consentIssue({ appears: rec.appears, appearing: rec.appearing }, consent.status, consent.name);
  if (issue) return { go: false, reason: issue };
  if (rec.hold_released) return { go: true };
  if (rec.publish_mode === 'approval') {
    if (!reel || !decision) return { go: false, reason: 'Waiting for an admin to approve this Reel (Reels tab).' };
    if (decision.state === 'rejected') return { go: false, reason: 'An admin sent this Reel back: ' + (decision.note || 'changes requested') + '. Edit it, or cancel the recording.' };
    if (decision.state !== 'approved' || decision.rev !== reel.rev) return { go: false, reason: 'Waiting for an admin to approve this Reel (Reels tab).' };
    if (decision.scheduled_at && decision.scheduled_at > nowIso) return { go: false, reason: 'Approved and planned for later.' };
  }
  return { go: true };
}

// ---------------------------------------------------------------- the engine
type Result = { rec: Recording; next: 'continue' | 'yield' };
const iso = (gw: Gateways) => new Date(gw.nowMs()).toISOString();
const withLog = (r: Recording, gw: Gateways, step: string, note?: string): Pick<Recording, 'steps'> => ({ steps: [...(r.steps || []), { at: iso(gw), step, ...(note ? { note } : {}) }].slice(-40) });

/** Does as much work on one recording as the time allows, saving progress after every step. */
export async function advance(start: Recording, repo: Repo, gw: Gateways, deadline: number): Promise<Recording> {
  let r = start;
  try {
    for (let i = 0; i < 10 && gw.nowMs() < deadline - MARGIN_MS; i++) {
      const fresh = await repo.get(r.id);
      if (!fresh || !['queued', 'youtube', 'trim', 'instagram'].includes(fresh.stage)) { r = fresh || r; break; }   // cancelled or removed meanwhile
      r = fresh;
      let res: Result;
      if (r.stage === 'queued') res = { rec: await repo.patch(r.id, { stage: 'youtube', ...withLog(r, gw, 'Queued') }), next: 'continue' };
      else if (r.stage === 'youtube') res = await stageYoutube(r, repo, gw, deadline);
      else if (r.stage === 'trim') res = await stageTrim(r, repo, gw, deadline);
      else res = await stageInstagram(r, repo, gw, deadline);
      r = res.rec;
      if (res.next === 'yield') break;
    }
  } catch (e) {
    r = await fail(r, e, repo, gw);
  }
  return repo.patch(r.id, { locked_until: null });
}

async function fail(r: Recording, e: unknown, repo: Repo, gw: Gateways): Promise<Recording> {
  const message = (e instanceof Error ? e.message : String(e)).slice(0, 600);
  const attempts = r.attempts + 1;
  const permanent = e instanceof PermanentError || attempts >= MAX_ATTEMPTS;
  const f: Partial<Recording> = { attempts, last_error: message, ...withLog(r, gw, permanent ? 'Failed' : 'Will retry', message) };
  if (permanent) f.stage = 'failed';
  else f.next_attempt_at = new Date(gw.nowMs() + backoffMinutes(attempts) * 60_000).toISOString();
  return repo.patch(r.id, f);
}

// ---------------------------------------------------------------- stage 1: the full class to YouTube
async function stageYoutube(r: Recording, repo: Repo, gw: Gateways, deadline: number): Promise<Result> {
  const settings = await repo.settings();
  const token = await gw.youtube.token();
  const src = await gw.openSource(r);
  const total = src.size, mime = r.source_mime || 'video/mp4';
  let session = r.yt_session_uri, offset = r.yt_offset;

  const finish = async (videoId: string): Promise<Result> => ({
    next: 'continue',
    rec: await repo.patch(r.id, {
      stage: 'trim', yt_video_id: videoId, yt_url: `https://youtu.be/${videoId}`, yt_session_uri: null, yt_offset: total, attempts: 0, last_error: '',
      ...withLog(r, gw, 'Saved to YouTube', `https://youtu.be/${videoId}`),
    }),
  });

  if (session) {                 // continue an upload that an earlier run started
    try {
      const q = await gw.youtube.query(session, total);
      if (q.done) return finish(q.videoId);
      offset = q.offset;
    } catch (e) { if (!(e instanceof SessionExpired)) throw e; session = null; offset = 0; }
  }
  if (!session) {
    const meta: UploadMeta = {
      title: r.title,
      description: `${settings.academy}\n${subjectNames[r.subject_id] || ''}${r.topic ? ' – ' + r.topic : ''}${r.teacher_name ? '\nTeacher: ' + r.teacher_name : ''}`,
      tags: [subjectNames[r.subject_id], r.topic, settings.academy].filter(Boolean) as string[],
      privacy: r.yt_privacy,
    };
    session = await gw.youtube.start(token, meta, total, mime);
    offset = 0;
    r = await repo.patch(r.id, { yt_session_uri: session, yt_offset: 0, ...withLog(r, gw, 'YouTube upload started') });
  }

  while (offset < total) {
    if (gw.nowMs() > deadline - MARGIN_MS) break;
    const end = Math.min(offset + CHUNK_BYTES, total) - 1;
    const bytes = await src.read(offset, end);
    const res = await gw.youtube.send(session, bytes, offset, total, mime);
    if (res.done) return finish(res.videoId);
    offset = res.offset;
    await repo.patch(r.id, { yt_offset: offset });
  }
  if (offset >= total) {            // all bytes sent but YouTube has not confirmed yet: ask once more
    const q = await gw.youtube.query(session, total);
    if (q.done) return finish(q.videoId);
  }
  return { next: 'yield', rec: await repo.patch(r.id, { yt_offset: offset, next_attempt_at: iso(gw) }) };
}

// ---------------------------------------------------------------- stage 2: cut the 60-second clip
async function stageTrim(r: Recording, repo: Repo, gw: Gateways, deadline: number): Promise<Result> {
  const settings = await repo.settings();
  let reel = r.reel_id ? await repo.getReel(r.reel_id) : null;
  let rec = r, seconds = r.trim_len_sec;
  if (!rec.clip_path) {
    const src = await gw.openSource(rec);
    const cut = await gw.cutClip(src, rec, Math.max(30_000, deadline - gw.nowMs() - MARGIN_MS));
    seconds = cut.seconds;
    rec = await repo.patch(rec.id, { clip_path: cut.path, ...withLog(rec, gw, `Cut a ${Math.round(cut.seconds)}-second clip`) });
  }
  if (!reel) {
    const subjectName = subjectNames[rec.subject_id] || '';
    const caption = buildCaption({ title: rec.title, topic: rec.topic, subject_id: rec.subject_id, yt_url: rec.yt_url, yt_start: rec.trim_start_sec }, { handle: settings.ig_handle, academy: settings.academy, subjectName });
    const auto = rec.publish_mode === 'auto';
    const now = iso(gw);
    reel = await repo.insertReel({
      title: rec.title.slice(0, 100), subject_id: rec.subject_id, batch_id: rec.batch_id, topic: rec.topic, teacher_name: rec.teacher_name,
      clip_path: rec.clip_path, clip_len: Math.round(seconds), yt_url: rec.yt_url, yt_start: rec.trim_start_sec, caption,
      appears: rec.appears, appearing: rec.appearing, rev: 1, submitted: rec.publish_mode !== 'off', submitted_at: rec.publish_mode !== 'off' ? now : null,
      recording_id: rec.id, by_id: rec.by_id, by_name: rec.by_name || 'Auto pipeline',
    });
    await repo.addReelHistory(reel.id, 'draft', 'created automatically', `From the recording “${rec.title}”`);
    if (auto) {
      await repo.saveDecision({ reel_id: reel.id, state: 'approved', rev: reel.rev, scheduled_at: now, by_name: 'Auto pipeline', at: now, note: 'Auto-publish is on' });
      await repo.addReelHistory(reel.id, 'decision', 'approved automatically', 'Publish mode: automatic');
    }
  }
  const consent = await repo.consent();
  const decision = await repo.getDecision(reel.id);
  const g = gate(rec, reel, decision, consent, iso(gw));
  if (g.go) {
    return { next: 'continue', rec: await repo.patch(rec.id, { stage: 'instagram', reel_id: reel.id, attempts: 0, last_error: '', ...withLog(rec, gw, 'Clip ready') }) };
  }
  if (g.final) return { next: 'yield', rec: await repo.patch(rec.id, { stage: 'completed', reel_id: reel.id, last_error: '', ...withLog(rec, gw, 'Finished', g.reason) }) };
  return { next: 'yield', rec: await repo.patch(rec.id, { stage: 'held', reel_id: reel.id, attempts: 0, last_error: g.reason, ...withLog(rec, gw, 'Waiting', g.reason) }) };
}

// ---------------------------------------------------------------- stage 3: publish the Reel on Instagram
async function stageInstagram(r: Recording, repo: Repo, gw: Gateways, deadline: number): Promise<Result> {
  const reel = r.reel_id ? await repo.getReel(r.reel_id) : null;
  if (!reel || !r.clip_path) throw new PermanentError('The Reel for this recording was deleted.');
  const dec = await repo.getDecision(reel.id);
  if (dec?.state === 'deleted' || reel.discarded) return { next: 'yield', rec: await repo.patch(r.id, { stage: 'cancelled', last_error: 'The Reel was deleted.', ...withLog(r, gw, 'Cancelled', 'The Reel was deleted') }) };
  const g = gate(r, reel, dec, await repo.consent(), iso(gw));          // consent may have been withdrawn since the clip was cut
  if (!g.go) return { next: 'yield', rec: await repo.patch(r.id, { stage: 'held', last_error: g.reason, ...withLog(r, gw, 'Waiting', g.reason) }) };

  const c = await gw.instagram.connection();
  if (!r.ig_media_id) {
    if (!r.ig_container_id) {
      const id = await gw.instagram.createContainer(c, await gw.clipUrl(r.clip_path), reel.caption);
      r = await repo.patch(r.id, { ig_container_id: id, ...withLog(r, gw, 'Sent to Instagram') });
    }
    for (;;) {
      const s = await gw.instagram.status(c, r.ig_container_id as string);
      if (s.code === 'FINISHED') {
        const mediaId = await gw.instagram.publish(c, r.ig_container_id as string);
        r = await repo.patch(r.id, { ig_media_id: mediaId });        // saved at once so a crash can never publish twice
        break;
      }
      if (s.code === 'PUBLISHED') break;
      if (s.code === 'ERROR' || s.code === 'EXPIRED') {
        await repo.patch(r.id, { ig_container_id: null });
        throw new Error(`Instagram could not process the video (${s.code}${s.detail ? ': ' + s.detail : ''}).`);
      }
      if (gw.nowMs() + 12_000 > deadline - MARGIN_MS) {
        return { next: 'yield', rec: await repo.patch(r.id, { next_attempt_at: new Date(gw.nowMs() + 20_000).toISOString() }) };
      }
      await gw.sleep(8000);
    }
  }
  const link = r.ig_media_id ? await gw.instagram.permalink(c, r.ig_media_id).catch(() => '') : '';
  const now = iso(gw);
  await repo.saveDecision({ reel_id: reel.id, state: 'published', rev: reel.rev, ig_url: link, ig_media_id: r.ig_media_id, published_at: now, appears: reel.appears, by_name: 'Auto pipeline', at: now, error: '', note: '' });
  await repo.addReelHistory(reel.id, 'decision', 'published automatically', link);
  const done = await repo.patch(r.id, { stage: 'completed', ig_url: link, attempts: 0, last_error: '', ...withLog(r, gw, 'Published on Instagram', link) });
  return { next: 'yield', rec: done };
}

// ---------------------------------------------------------------- held recordings that may now go ahead
export async function releaseHeld(repo: Repo, gw: Gateways): Promise<number> {
  let n = 0;
  const consent = await repo.consent();
  for (const rec of await repo.heldRecordings()) {
    const reel = rec.reel_id ? await repo.getReel(rec.reel_id) : null;
    if (!reel) continue;
    const g = gate(rec, reel, await repo.getDecision(reel.id), consent, iso(gw));
    if (g.go) { await repo.patch(rec.id, { stage: 'instagram', next_attempt_at: iso(gw), last_error: '', ...withLog(rec, gw, 'Released') }); n++; }
    else if (g.reason !== rec.last_error) await repo.patch(rec.id, { last_error: g.reason });
  }
  return n;
}

export const ACTIVE_STAGES: RecStage[] = ['queued', 'youtube', 'trim', 'instagram'];
