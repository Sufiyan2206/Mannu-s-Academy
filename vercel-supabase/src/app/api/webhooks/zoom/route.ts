import { createHmac, timingSafeEqual } from 'node:crypto';
import { after } from 'next/server';
import { admin } from '@/lib/server/admin';
import { env } from '@/lib/server/env';
import { runTick } from '@/lib/server/runtime';
import { fDateISO, setFormatConfig } from '@/lib/format';
import type { ClassRow, Settings } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const hmac = (secret: string, text: string) => createHmac('sha256', secret).update(text).digest('hex');
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

interface ZoomFile { id: string; file_type: string; file_size: number; download_url: string; status?: string; recording_type?: string }

/**
 * Zoom -> recording.completed. When a class held on Zoom has a cloud recording, it enters the pipeline by itself:
 * full class to YouTube, 60-second clip, Instagram. Which students appear is unknown here, so the Reel waits for that answer.
 */
export async function POST(req: Request) {
  const secret = env.zoom.webhookSecret;
  if (!secret) return Response.json({ error: 'ZOOM_WEBHOOK_SECRET_TOKEN is not set.' }, { status: 501 });
  const raw = await req.text();
  let body: { event?: string; payload?: { plainToken?: string; object?: { id?: number | string; topic?: string; start_time?: string; recording_files?: ZoomFile[] } } };
  try { body = JSON.parse(raw); } catch { return Response.json({ error: 'Bad request' }, { status: 400 }); }

  if (body.event === 'endpoint.url_validation' && body.payload?.plainToken) {
    return Response.json({ plainToken: body.payload.plainToken, encryptedToken: hmac(secret, body.payload.plainToken) });
  }
  const ts = req.headers.get('x-zm-request-timestamp') || '', sig = req.headers.get('x-zm-signature') || '';
  if (!ts || !same(sig, 'v0=' + hmac(secret, `v0:${ts}:${raw}`)) || Math.abs(Date.now() / 1000 - Number(ts)) > 600) return Response.json({ error: 'Invalid signature' }, { status: 401 });
  if (body.event !== 'recording.completed') return Response.json({ ignored: true });

  const obj = body.payload?.object;
  const files = (obj?.recording_files || []).filter(f => f.file_type === 'MP4' && (!f.status || f.status === 'completed'));
  if (!obj?.id || !files.length) return Response.json({ ignored: true });
  const file = files.find(f => f.recording_type === 'shared_screen_with_speaker_view') || files.sort((a, b) => b.file_size - a.file_size)[0];

  const { data: dup } = await admin().from('recordings').select('id').eq('source_url', file.download_url).maybeSingle();
  if (dup) return Response.json({ duplicate: true });

  const { data: cands } = await admin().from('classes').select('*').ilike('join_url', `%/j/${String(obj.id)}%`).order('start_at', { ascending: false }).limit(10);
  const when = obj.start_time ? new Date(obj.start_time).getTime() : Date.now();
  const cls = ((cands || []) as ClassRow[]).sort((a, b) => Math.abs(new Date(a.start_at).getTime() - when) - Math.abs(new Date(b.start_at).getTime() - when))[0];
  if (!cls || Math.abs(new Date(cls.start_at).getTime() - when) > 36 * 3600_000) return Response.json({ ignored: 'no matching class' });

  const { data: s } = await admin().from('settings').select('*').eq('id', 1).single();
  const st = s as Settings;
  setFormatConfig({ tz: st.tz, currency: st.currency });
  const names: Record<string, string> = { chem: 'Chemistry', phys: 'Physics', math: 'Mathematics' };
  const now = new Date().toISOString();
  const { error } = await admin().from('recordings').insert({
    class_id: cls.id, title: `${names[cls.subject_id]} – ${cls.title.replace(/^.* – /, '')} – ${fDateISO(cls.start_at)}`.slice(0, 100),
    subject_id: cls.subject_id, batch_id: cls.batch_id, topic: '', teacher_name: cls.teacher_name,
    source_kind: 'zoom', source_url: file.download_url, source_size: file.file_size, source_mime: 'video/mp4',
    appears: null, appearing: [], trim_start_sec: st.reel_start_sec, trim_len_sec: st.reel_len_sec, publish_mode: st.publish_mode, yt_privacy: st.yt_privacy,
    stage: 'queued', next_attempt_at: now, by_name: 'Zoom recording', steps: [{ at: now, step: 'Zoom recording received', note: cls.title }],
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  after(async () => { try { await runTick(270_000); } catch { /* the scheduler retries */ } });
  return Response.json({ queued: true });
}
