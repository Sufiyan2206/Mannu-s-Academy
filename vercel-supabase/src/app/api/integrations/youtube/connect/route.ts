import { randomBytes } from 'node:crypto';
import { deleteIntegration, jsonError, requireUser, setIntegration } from '@/lib/server/admin';
import { authUrl } from '@/lib/server/youtube';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Step 1 of connecting YouTube: returns the Google consent URL. Only an admin can connect the channel. */
export async function POST(req: Request) {
  try {
    const me = await requireUser(req, true);
    const state = randomBytes(24).toString('hex');
    await setIntegration('youtube_oauth', { state, user: me.id, expires: Date.now() + 10 * 60_000 });
    return Response.json({ url: authUrl(state) });
  } catch (e) { return jsonError(e); }
}

export async function DELETE(req: Request) {
  try {
    await requireUser(req, true);
    await deleteIntegration('youtube');
    return Response.json({ ok: true });
  } catch (e) { return jsonError(e); }
}
