import { deleteIntegration, HttpError, jsonError, requireUser } from '@/lib/server/admin';
import { saveConnection, verify } from '@/lib/server/instagram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Saves the Instagram account the Reels are published to. The token is checked with Instagram before it is stored. */
export async function POST(req: Request) {
  try {
    await requireUser(req, true);
    const b = (await req.json()) as { access_token?: string; ig_user_id?: string };
    const token = (b.access_token || '').trim(), id = (b.ig_user_id || '').trim();
    if (!token || !/^\d{5,25}$/.test(id)) throw new HttpError(400, 'Enter the access token and the numeric Instagram account id.');
    let who: { username: string };
    try { who = await verify(token, id); } catch (e) { throw new HttpError(400, e instanceof Error ? e.message : 'Instagram rejected these details.'); }
    await saveConnection(token, id, who.username);
    return Response.json({ username: who.username });
  } catch (e) { return jsonError(e); }
}

export async function DELETE(req: Request) {
  try {
    await requireUser(req, true);
    await deleteIntegration('instagram');
    return Response.json({ ok: true });
  } catch (e) { return jsonError(e); }
}
