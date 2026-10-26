import { admin, HttpError, jsonError, requireUser } from '@/lib/server/admin';
import { sizeOf, writeAt } from '@/lib/server/storage';
import type { Recording } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function target(req: Request, id: string): Promise<Recording> {
  const me = await requireUser(req);
  const { data } = await admin().from('recordings').select('*').eq('id', id).maybeSingle();
  const rec = data as Recording | null;
  if (!rec) throw new HttpError(404, 'Recording not found.');
  if (rec.by_id !== me.id && me.role !== 'admin') throw new HttpError(403, 'This is not your recording.');
  if (rec.stage !== 'uploading' || !rec.source_path) throw new HttpError(409, 'This recording is not waiting for its file.');
  return rec;
}

/** How many bytes the server already has (so an interrupted upload continues where it stopped). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const rec = await target(req, (await ctx.params).id);
    return Response.json({ size: sizeOf('recordings', rec.source_path as string) });
  } catch (e) { return jsonError(e); }
}

/** Receives one piece of the file at ?offset=. The offset must be exactly where the file currently ends. */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const rec = await target(req, (await ctx.params).id);
    const key = rec.source_path as string;
    const offset = Number(new URL(req.url).searchParams.get('offset') || 0);
    const have = sizeOf('recordings', key);
    if (!Number.isInteger(offset) || offset < 0) throw new HttpError(400, 'Bad offset.');
    if (offset !== have) return Response.json({ error: 'Out of order.', size: have }, { status: 409 });
    const body = new Uint8Array(await req.arrayBuffer());
    if (!body.length) throw new HttpError(400, 'Empty piece.');
    if (rec.source_size && offset + body.length > rec.source_size) throw new HttpError(400, 'More data than the file should have.');
    return Response.json({ size: await writeAt('recordings', key, offset, body) });
  } catch (e) { return jsonError(e); }
}
