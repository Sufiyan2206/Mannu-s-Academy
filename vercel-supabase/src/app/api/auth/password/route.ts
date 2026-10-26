import { jsonError, requireUser } from '@/lib/server/admin';
import { changePassword } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Change your own password (the current one is required). Admins can reset other people’s in Setup. */
export async function POST(req: Request) {
  try {
    const me = await requireUser(req);
    const { current, next } = (await req.json()) as { current?: string; next?: string };
    await changePassword(me.id, current ?? '', next ?? '');
    return Response.json({ ok: true });
  } catch (e) { return jsonError(e); }
}
