import { after } from 'next/server';
import { admin, HttpError, jsonError, requireUser } from '@/lib/server/admin';
import { runTick } from '@/lib/server/runtime';
import { sizeOf } from '@/lib/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** The browser calls this once the recording file has been uploaded. It checks the file and queues the pipeline. */
export async function POST(req: Request) {
  try {
    const me = await requireUser(req);
    const { id } = (await req.json()) as { id?: string };
    if (!id) throw new HttpError(400, 'Missing recording id.');
    const { data: rec } = await admin().from('recordings').select('*').eq('id', id).maybeSingle();
    if (!rec) throw new HttpError(404, 'Recording not found.');
    if (rec.by_id !== me.id && me.role !== 'admin') throw new HttpError(403, 'This is not your recording.');
    if (rec.stage !== 'uploading') throw new HttpError(409, 'This recording has already been started.');
    if (!rec.source_path) throw new HttpError(400, 'No file was uploaded.');

    const size = sizeOf('recordings', rec.source_path);
    if (!size) throw new HttpError(400, 'The uploaded file was not found. Upload it again.');
    if (rec.source_size && size !== rec.source_size) throw new HttpError(400, `The upload is incomplete (${size} of ${rec.source_size} bytes). Upload it again.`);

    await admin().from('recordings').update({
      stage: 'queued', source_size: size, next_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      steps: [{ at: new Date().toISOString(), step: 'Upload complete', note: `${(size / 1048576).toFixed(0)} MB` }],
    }).eq('id', id);

    // start working straight away instead of waiting for the next scheduler tick
    after(async () => { try { await runTick(270_000); } catch { /* the scheduler will try again */ } });
    return Response.json({ ok: true, size });
  } catch (e) { return jsonError(e); }
}
