import { beforeEach, describe, expect, it } from 'vitest';
import { advance, backoffMinutes, CHUNK_BYTES, gate, releaseHeld, type Gateways, type Repo } from '../src/lib/server/pipeline';
import { PermanentError } from '../src/lib/server/env';
import { SessionExpired } from '../src/lib/server/youtube';
import type { Reel, ReelDecision, Recording, Settings } from '../src/lib/types';

// ------------------------------------------------------------------ in-memory fakes
const settings = { academy: 'Mannu’s Tuition Academy', ig_handle: 'mannus', tz: 'Asia/Dubai' } as Settings;
let clock = 0;
let recs: Map<string, Recording>, reels: Map<string, Reel>, decisions: Map<string, ReelDecision>, history: string[];
let consentMap: Record<string, string>;
let calls: string[];

const baseRec = (over: Partial<Recording> = {}): Recording => ({
  id: 'rec1', class_id: null, title: 'Chemistry – Alkenes', subject_id: 'chem', batch_id: 'b1', topic: 'Alkenes', teacher_name: 'Mr T',
  source_path: 'rec1.mp4', source_url: null, source_kind: 'upload', source_size: 20 * 1024 * 1024, source_mime: 'video/mp4', appears: 'none', appearing: [],
  trim_start_sec: 0, trim_len_sec: 60, publish_mode: 'auto', yt_privacy: 'unlisted', stage: 'queued', yt_session_uri: null, yt_offset: 0, yt_video_id: null,
  yt_url: '', clip_path: null, reel_id: null, ig_container_id: null, ig_media_id: null, ig_url: '', hold_released: false, attempts: 0, last_error: '',
  next_attempt_at: '', locked_until: 'lease', steps: [], original_deleted: false, by_id: 'u1', by_name: 'Tess', created_at: '', updated_at: '', ...over,
});

const repo: Repo = {
  settings: async () => settings,
  consent: async () => ({ status: id => consentMap[id] || 'unknown', name: id => ({ s1: 'Sam', s2: 'Ann' } as Record<string, string>)[id] || id }),
  get: async id => recs.get(id) ?? null,
  patch: async (id, f) => { const r = { ...recs.get(id)!, ...f } as Recording; recs.set(id, r); return r; },
  heldRecordings: async () => [...recs.values()].filter(r => r.stage === 'held'),
  getReel: async id => reels.get(id) ?? null,
  insertReel: async f => { const r = { id: 'reel1', rev: 1, discarded: false, ...f } as Reel; reels.set(r.id, r); return r; },
  getDecision: async id => decisions.get(id) ?? null,
  saveDecision: async d => { decisions.set(d.reel_id, { ...(decisions.get(d.reel_id) || {}), ...d } as ReelDecision); },
  addReelHistory: async (_id, scope, action) => { history.push(`${scope}:${action}`); },
};

interface Knobs { chunkMs: number; igStatuses: string[]; ytStartError?: Error; sessionExpired?: boolean; queryOffset?: number }
let knobs: Knobs;
let received: number[];
let sent: { url: string; caption: string } | null;            // byte offsets YouTube accepted

const gw: Gateways = {
  nowMs: () => clock,
  sleep: async ms => { clock += ms; },
  openSource: async rec => ({ url: 'https://storage/signed', size: rec.source_size || 0, read: async (a, b) => new Uint8Array(b - a + 1) }),
  youtube: {
    token: async () => 'yt-token',
    start: async () => { calls.push('yt.start'); if (knobs.ytStartError) throw knobs.ytStartError; return 'https://upload/session'; },
    send: async (_s, bytes, from, total) => {
      calls.push('yt.send'); clock += knobs.chunkMs; received.push(from);
      const next = from + bytes.length;
      return next >= total ? { done: true, videoId: 'VID12345678' } : { done: false, offset: next };
    },
    query: async (_s, total) => {
      calls.push('yt.query');
      if (knobs.sessionExpired) throw new SessionExpired();
      return knobs.queryOffset == null ? { done: false, offset: 0 } : knobs.queryOffset >= total ? { done: true, videoId: 'VID12345678' } : { done: false, offset: knobs.queryOffset };
    },
  },
  cutClip: async (_src, rec) => { calls.push('cut'); return { path: `${rec.id}.mp4`, seconds: rec.trim_len_sec }; },
  clipUrl: async p => `https://storage/clips/${p}?token=1`,
  instagram: {
    connection: async () => ({ token: 't', igUserId: '1784' }),
    createContainer: async (_c, url, caption) => { calls.push('ig.create'); sent = { url, caption }; return 'container1'; },
    status: async () => { calls.push('ig.status'); const s = knobs.igStatuses.shift() || 'FINISHED'; return { code: s as 'FINISHED', detail: s === 'ERROR' ? 'bad codec' : '' }; },
    publish: async () => { calls.push('ig.publish'); return 'media1'; },
    permalink: async () => 'https://www.instagram.com/reel/ABC/',
  },
};

beforeEach(() => {
  clock = 1_700_000_000_000; recs = new Map(); reels = new Map(); decisions = new Map(); history = []; consentMap = {}; calls = []; received = []; sent = null;
  knobs = { chunkMs: 1000, igStatuses: [] };
});
const start = (r: Recording) => { recs.set(r.id, r); return r; };
const deadlineIn = (ms: number) => clock + ms;

describe('the recording pipeline', () => {
  it('saves to YouTube, cuts 60 seconds and publishes on Instagram in one run', async () => {
    const r = await advance(start(baseRec()), repo, gw, deadlineIn(250_000));
    expect(r.stage).toBe('completed');
    expect(r.yt_url).toBe('https://youtu.be/VID12345678'); expect(r.ig_url).toBe('https://www.instagram.com/reel/ABC/'); expect(r.locked_until).toBeNull();
    expect(received).toEqual([0, CHUNK_BYTES, 2 * CHUNK_BYTES]);           // 20 MB in 8 MB pieces
    expect(calls.filter(c => c === 'ig.publish')).toHaveLength(1);
    const reel = reels.get('reel1')!;
    expect(reel).toMatchObject({ clip_path: 'rec1.mp4', clip_len: 60, yt_url: 'https://youtu.be/VID12345678', recording_id: 'rec1', subject_id: 'chem' });
    expect(reel.caption).toContain('@mannus');
    expect(sent!.url).toBe('https://storage/clips/rec1.mp4?token=1'); expect(sent!.caption).toBe(reel.caption); expect(sent!.caption).toContain('https://youtu.be/VID12345678');
    expect(decisions.get('reel1')).toMatchObject({ state: 'published', ig_media_id: 'media1', ig_url: 'https://www.instagram.com/reel/ABC/', by_name: 'Auto pipeline' });
    expect(history).toContain('decision:published automatically');
    expect(r.steps.map(s => s.step)).toEqual(['Queued', 'YouTube upload started', 'Saved to YouTube', 'Cut a 60-second clip', 'Clip ready', 'Sent to Instagram', 'Published on Instagram']);
  });

  it('carries a long YouTube upload over several runs without sending anything twice', async () => {
    knobs.chunkMs = 50_000;
    let r = await advance(start(baseRec()), repo, gw, deadlineIn(60_000));
    expect(r.stage).toBe('youtube'); expect(r.yt_offset).toBe(CHUNK_BYTES); expect(r.yt_session_uri).toBe('https://upload/session'); expect(r.locked_until).toBeNull();
    expect(received).toEqual([0]);
    knobs.queryOffset = CHUNK_BYTES;                                     // YouTube confirms it has the first piece
    r = await advance(recs.get('rec1')!, repo, gw, deadlineIn(60_000));
    expect(received).toEqual([0, CHUNK_BYTES]);
    expect(calls.filter(c => c === 'yt.start')).toHaveLength(1);        // the same upload session is reused
    knobs.queryOffset = 2 * CHUNK_BYTES;
    knobs.chunkMs = 1000;
    r = await advance(recs.get('rec1')!, repo, gw, deadlineIn(250_000));
    expect(received).toEqual([0, CHUNK_BYTES, 2 * CHUNK_BYTES]);
    expect(r.stage).toBe('completed');
  });

  it('starts a fresh upload if YouTube has forgotten the session', async () => {
    knobs.sessionExpired = true;
    const r = await advance(start(baseRec({ yt_session_uri: 'https://upload/old', yt_offset: CHUNK_BYTES })), repo, gw, deadlineIn(250_000));
    expect(calls).toContain('yt.start'); expect(received[0]).toBe(0); expect(r.stage).toBe('completed');
  });

  it('keeps polling Instagram, then publishes exactly once', async () => {
    reels.set('reel1', { id: 'reel1', rev: 1, caption: 'x https://youtu.be/VID12345678', discarded: false } as Reel);
    decisions.set('reel1', { reel_id: 'reel1', state: 'approved', rev: 1, scheduled_at: null } as ReelDecision);
    knobs.igStatuses = ['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED'];
    const r = await advance(start(baseRec({ stage: 'instagram', clip_path: 'rec1.mp4', reel_id: 'reel1', yt_url: 'https://youtu.be/VID12345678' })), repo, gw, deadlineIn(250_000));
    expect(r.stage).toBe('completed');
    expect(calls.filter(c => c === 'ig.create')).toHaveLength(1); expect(calls.filter(c => c === 'ig.publish')).toHaveLength(1);
  });

  it('never publishes twice if the media id was already saved', async () => {
    reels.set('reel1', { id: 'reel1', rev: 1, caption: 'c', discarded: false } as Reel);
    decisions.set('reel1', { reel_id: 'reel1', state: 'approved', rev: 1, scheduled_at: null } as ReelDecision);
    const r = await advance(start(baseRec({ stage: 'instagram', clip_path: 'rec1.mp4', reel_id: 'reel1', ig_container_id: 'container1', ig_media_id: 'media1' })), repo, gw, deadlineIn(250_000));
    expect(r.stage).toBe('completed'); expect(calls).not.toContain('ig.publish'); expect(calls).not.toContain('ig.create');
  });

  it('yields while Instagram is still processing when time is short', async () => {
    reels.set('reel1', { id: 'reel1', rev: 1, caption: 'c', discarded: false } as Reel);
    decisions.set('reel1', { reel_id: 'reel1', state: 'approved', rev: 1, scheduled_at: null } as ReelDecision);
    knobs.igStatuses = ['IN_PROGRESS', 'IN_PROGRESS', 'IN_PROGRESS'];
    const r = await advance(start(baseRec({ stage: 'instagram', clip_path: 'rec1.mp4', reel_id: 'reel1' })), repo, gw, deadlineIn(30_000));
    expect(r.stage).toBe('instagram'); expect(r.ig_container_id).toBe('container1'); expect(r.locked_until).toBeNull();
    expect(new Date(r.next_attempt_at).getTime()).toBeGreaterThan(clock);
  });

  it('retries with a delay, then gives up after five failures', async () => {
    knobs.ytStartError = new Error('network down');
    let r = await advance(start(baseRec()), repo, gw, deadlineIn(250_000));
    expect(r.stage).toBe('youtube'); expect(r.attempts).toBe(1); expect(r.last_error).toBe('network down');
    expect(new Date(r.next_attempt_at).getTime()).toBe(clock + backoffMinutes(1) * 60_000);
    for (let i = 2; i <= 5; i++) r = await advance(recs.get('rec1')!, repo, gw, deadlineIn(250_000));
    expect(r.stage).toBe('failed'); expect(r.attempts).toBe(5);
  });

  it('fails at once when the problem will not fix itself', async () => {
    knobs.ytStartError = new PermanentError('YouTube is not connected.');
    const r = await advance(start(baseRec()), repo, gw, deadlineIn(250_000));
    expect(r.stage).toBe('failed'); expect(r.last_error).toBe('YouTube is not connected.');
  });

  it('retries Instagram from scratch when it rejects the video', async () => {
    reels.set('reel1', { id: 'reel1', rev: 1, caption: 'c', discarded: false } as Reel);
    decisions.set('reel1', { reel_id: 'reel1', state: 'approved', rev: 1, scheduled_at: null } as ReelDecision);
    knobs.igStatuses = ['ERROR'];
    const r = await advance(start(baseRec({ stage: 'instagram', clip_path: 'rec1.mp4', reel_id: 'reel1' })), repo, gw, deadlineIn(250_000));
    expect(r.stage).toBe('instagram'); expect(r.ig_container_id).toBeNull(); expect(r.last_error).toContain('bad codec'); expect(r.attempts).toBe(1);
  });

  it('stops quietly if the recording was cancelled while it ran', async () => {
    start(baseRec({ stage: 'cancelled' }));
    const r = await advance(recs.get('rec1')!, repo, gw, deadlineIn(250_000));
    expect(r.stage).toBe('cancelled'); expect(calls).toEqual([]);
  });
});

describe('consent and approval gates', () => {
  it('holds the clip when a student appears without consent, and goes ahead once consent is recorded', async () => {
    let r = await advance(start(baseRec({ appears: 'students', appearing: ['s1'] })), repo, gw, deadlineIn(250_000));
    expect(r.stage).toBe('held'); expect(r.last_error).toBe('Consent has not been recorded for: Sam.');
    expect(calls).not.toContain('ig.create');
    expect(reels.get('reel1')!.clip_path).toBe('rec1.mp4');           // YouTube + clip are done, only Instagram waits
    expect(await releaseHeld(repo, gw)).toBe(0);
    consentMap.s1 = 'granted';
    expect(await releaseHeld(repo, gw)).toBe(1);
    r = await advance(recs.get('rec1')!, repo, gw, deadlineIn(250_000));
    expect(r.stage).toBe('completed');
  });

  it('holds when nobody has said whether students appear (for example a Zoom recording)', async () => {
    const r = await advance(start(baseRec({ appears: null })), repo, gw, deadlineIn(250_000));
    expect(r.stage).toBe('held'); expect(r.last_error).toMatch(/Say whether any student appears/);
  });

  it('stops at the last moment if consent is withdrawn before publishing', async () => {
    reels.set('reel1', { id: 'reel1', rev: 1, caption: 'c', discarded: false } as Reel);
    decisions.set('reel1', { reel_id: 'reel1', state: 'approved', rev: 1, scheduled_at: null } as ReelDecision);
    consentMap.s1 = 'denied';
    const r = await advance(start(baseRec({ stage: 'instagram', clip_path: 'rec1.mp4', reel_id: 'reel1', appears: 'students', appearing: ['s1'] })), repo, gw, deadlineIn(250_000));
    expect(r.stage).toBe('held'); expect(calls).not.toContain('ig.create');
  });

  it('in approval mode waits for an admin, and only an approval of the current version counts', async () => {
    let r = await advance(start(baseRec({ publish_mode: 'approval' })), repo, gw, deadlineIn(250_000));
    expect(r.stage).toBe('held'); expect(r.last_error).toMatch(/Waiting for an admin/);
    expect(reels.get('reel1')!.submitted).toBe(true);                // it appears under “Awaiting approval” in the Reels tab
    decisions.set('reel1', { reel_id: 'reel1', state: 'approved', rev: 2, scheduled_at: null, note: '' } as ReelDecision);   // approval of an older/other version
    expect(await releaseHeld(repo, gw)).toBe(0);
    decisions.set('reel1', { reel_id: 'reel1', state: 'approved', rev: 1, scheduled_at: new Date(clock + 3600_000).toISOString(), note: '' } as ReelDecision);
    expect(await releaseHeld(repo, gw)).toBe(0);                      // planned for later
    decisions.set('reel1', { reel_id: 'reel1', state: 'approved', rev: 1, scheduled_at: new Date(clock - 1000).toISOString(), note: '' } as ReelDecision);
    expect(await releaseHeld(repo, gw)).toBe(1);
    r = await advance(recs.get('rec1')!, repo, gw, deadlineIn(250_000));
    expect(r.stage).toBe('completed');
  });

  it('with publishing switched off it keeps the Reel as a draft', async () => {
    const r = await advance(start(baseRec({ publish_mode: 'off' })), repo, gw, deadlineIn(250_000));
    expect(r.stage).toBe('completed'); expect(calls).not.toContain('ig.create');
    expect(reels.get('reel1')!.submitted).toBe(false);
  });

  it('gate(): an admin’s “publish now” skips approval but never consent', () => {
    const rec = baseRec({ publish_mode: 'approval', hold_released: true });
    const c = { status: () => 'unknown', name: () => 'Sam' };
    expect(gate(rec, null, null, c, '').go).toBe(true);
    expect(gate({ ...rec, appears: 'students', appearing: ['s1'] }, null, null, c, '').go).toBe(false);
  });
});

describe('backoff', () => {
  it('waits longer after each failure', () => { expect([1, 2, 3, 4, 5, 9].map(backoffMinutes)).toEqual([1, 2, 5, 10, 30, 30]); });
});
