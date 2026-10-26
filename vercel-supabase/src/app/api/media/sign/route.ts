import { admin, HttpError, jsonError, requireUser } from '@/lib/server/admin';
import { signedClipUrl } from '@/lib/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A short-lived link to watch a Reel’s clip in the browser. */
export async function POST(req: Request) {
  try {
    await requireUser(req);
    const { reelId } = (await req.json()) as { reelId?: string };
    const { data } = await admin().from('reels').select('clip_path').eq('id', reelId || '').maybeSingle();
    if (!data?.clip_path) throw new HttpError(404, 'This Reel has no stored clip.');
    return Response.json({ url: signedClipUrl(data.clip_path, 3600) });
  } catch (e) { return jsonError(e); }
}
