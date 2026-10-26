import { after } from 'next/server';
import { admin, HttpError, jsonError, requireUser } from '@/lib/server/admin';
import { runTick } from '@/lib/server/runtime';
import type { Recording } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Body =
  | { id: string; action: 'retry' | 'cancel' | 'publish_now' }
  | { id: string; action: 'declare'; appears: 'none' | 'students'; appearing?: string[] }
  | { id: string; action: 'trim'; start_sec: number };

/** Buttons on the Recordings screen: try again, cancel, publish without waiting, say who appears, change where the clip starts. */
export async function POST(req: Request) {
  try {
    const me = await requireUser(req);
    const body = (await req.json()) as Body;
    const { data } = await admin().from('recordings').select('*').eq('id', body.id).maybeSingle();
    const rec = data as Recording | null;
    if (!rec) throw new HttpError(404, 'Recording not found.');
    const mine = rec.by_id === me.id;
    const now = new Date().toISOString();
    const log = (step: string, note = '') => [...(rec.steps || []), { at: now, step, ...(note ? { note } : {}) }].slice(-40);
    const upd = async (f: Partial<Recording>) => { await admin().from('recordings').update({ ...f, updated_at: now }).eq('id', rec.id); };
    const kick = () => after(async () => { try { await runTick(270_000); } catch { /* scheduler retries */ } });

    switch (body.action) {
      case 'declare': {
        if (!mine && me.role !== 'admin') throw new HttpError(403, 'Only the person who made the recording or an admin can do this.');
        if (!['none', 'students'].includes(body.appears)) throw new HttpError(400, 'Choose whether students appear.');
        const appearing = body.appears === 'students' ? (body.appearing || []) : [];
        await upd({ appears: body.appears, appearing, steps: log('Students declared', body.appears === 'none' ? 'No student appears' : `${appearing.length} student(s) appear`) });
        if (rec.reel_id) await admin().from('reels').update({ appears: body.appears, appearing, updated_at: now }).eq('id', rec.reel_id);
        kick();
        break;
      }
      case 'trim': {
        if (!mine && me.role !== 'admin') throw new HttpError(403, 'Only the person who made the recording or an admin can do this.');
        if (rec.clip_path || !['uploading', 'queued', 'youtube', 'trim', 'held', 'failed'].includes(rec.stage)) throw new HttpError(409, 'The clip has already been cut.');
        const s = Math.max(0, Math.floor(Number(body.start_sec)));
        if (!Number.isFinite(s)) throw new HttpError(400, 'Enter the start time.');
        await upd({ trim_start_sec: s, steps: log('Clip start changed', `${s} s`) });
        break;
      }
      case 'retry': {
        if (me.role !== 'admin' && !mine) throw new HttpError(403, 'Only the person who made the recording or an admin can do this.');
        if (!['failed', 'held'].includes(rec.stage)) throw new HttpError(409, 'Only failed or waiting recordings can be retried.');
        const stage = !rec.yt_video_id ? 'youtube' : !rec.clip_path ? 'trim' : 'instagram';
        await upd({ stage, attempts: 0, last_error: '', next_attempt_at: now, locked_until: null, steps: log('Retry', `from ${stage}`) });
        kick();
        break;
      }
      case 'cancel': {
        if (me.role !== 'admin' && !mine) throw new HttpError(403, 'Only the person who made the recording or an admin can do this.');
        if (['completed', 'cancelled'].includes(rec.stage)) throw new HttpError(409, 'This recording is already finished.');
        await upd({ stage: 'cancelled', last_error: '', steps: log('Cancelled', me.full_name) });
        break;
      }
      case 'publish_now': {
        if (me.role !== 'admin') throw new HttpError(403, 'Only admins can publish without waiting for approval.');
        if (rec.stage !== 'held') throw new HttpError(409, 'This recording is not waiting.');
        await upd({ hold_released: true, steps: log('Released by admin', me.full_name) });
        kick();
        break;
      }
      default: throw new HttpError(400, 'Unknown action.');
    }
    return Response.json({ ok: true });
  } catch (e) { return jsonError(e); }
}
