import { after } from 'next/server';
import { jsonError, requireCron } from '@/lib/server/admin';
import { runTick } from '@/lib/server/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// The app’s own worker (instrumentation.ts) calls the pipeline every minute. This endpoint lets an outside scheduler
// (cron, systemd timer) or you trigger a run too, with the CRON_SECRET. It answers at once and keeps working after the response, so the scheduler never times out waiting for a long video.
// Add ?wait=1 to run in the foreground and see the result (handy when testing by hand).
async function handler(req: Request) {
  try {
    requireCron(req);
    if (new URL(req.url).searchParams.get('wait') === '1') return Response.json(await runTick());
    after(async () => { try { await runTick(); } catch (e) { console.error('pipeline tick failed', e); } });
    return Response.json({ accepted: true }, { status: 202 });
  } catch (e) { return jsonError(e); }
}
export const GET = handler;
export const POST = handler;
